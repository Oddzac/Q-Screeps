/**
 * Spawn Manager - Handles creep spawning logic
 * CPU optimized for maximum efficiency
 */
const roomManager = require('roomManager');

const spawnManager = {
    // Cache for body part calculations
    bodyCache: {},
    
    /**
     * Run the spawn logic for a room
     * @param {Room} room - The room to manage spawning for
     */
    run: function(room) {
        const utils = require('utils');
        
        try {
            // Skip if no energy available for even the smallest creep
            if (room.energyAvailable < 250) return;
            
            // Find all spawns in the room - use cached data if available
            const spawns = room.find(FIND_MY_SPAWNS);
            if (spawns.length === 0) return;
            
            // Get creep counts from room manager cache
            const counts = roomManager.getRoomData(room.name, 'creepCounts') || {
                harvester: 0,
                hauler: 0,
                upgrader: 0,
                builder: 0,
                total: 0
            };
            
            // Colony collapse prevention - if critical roles are missing, force spawn
            const criticalCollapse = counts.harvester === 0 || 
                                    (counts.harvester > 0 && counts.hauler === 0);
            
            // In emergency mode, only spawn critical creeps unless we're in collapse prevention
            if (global.emergencyMode && !criticalCollapse) {
                if (global.emergencyMode.level === 'critical') return;
                
                // In high emergency, only spawn if we have very few creeps
                if (counts.total > 5) return;
            }
            
            // Use the first available spawn
            for (const spawn of spawns) {
                if (spawn.spawning) continue;
                
                // Emergency recovery - if no harvesters, spawn one immediately
                if (counts.harvester === 0) {
                    this.spawnCreep(spawn, 'harvester', room.energyAvailable);
                    return;
                }
                
                // Emergency recovery - if no haulers but we have harvesters, spawn hauler
                if (counts.harvester > 0 && counts.hauler === 0) {
                    this.spawnCreep(spawn, 'hauler', room.energyAvailable);
                    return;
                }
                
                // Normal spawning - only if CPU conditions allow
                if (utils.shouldExecute('medium')) {
                    // Determine what role we need most
                    const neededRole = this.getNeededRole(room, counts);
                    if (neededRole) {
                        // In emergency mode, spawn smaller creeps to save energy
                        const energyToUse = global.emergencyMode ? 
                            Math.min(room.energyAvailable, room.energyCapacityAvailable * 0.7) : 
                            room.energyAvailable;
                            
                        // Spawn the appropriate creep
                        this.spawnCreep(spawn, neededRole, energyToUse);
                    }
                }
            }
        } catch (error) {
            console.log(`Error in spawnManager.run for room ${room.name}: ${error}`);
            
            // Emergency recovery - try to spawn a basic harvester if we have any spawn available
            const spawn = room.find(FIND_MY_SPAWNS)[0];
            if (spawn && !spawn.spawning && room.energyAvailable >= 250) {
                spawn.spawnCreep([WORK, CARRY, MOVE], 'emergency' + Game.time, {
                    memory: { role: 'harvester', homeRoom: room.name }
                });
            }
        }
    },
    
    /**
     * Determine which role needs to be spawned next
     * @param {Room} room - The room to analyze
     * @param {Object} counts - Current creep counts by role
     * @returns {string|null} - The role to spawn or null if none needed
     */
    getNeededRole: function(room, counts) {
        // Get optimal counts from roomManager - single source of truth
        const optimalCounts = roomManager.analyzeRoomNeeds(room);
        if (!optimalCounts) return null;
        
        // Check if we're at total creep capacity
        if (counts.total >= optimalCounts.total) {
            return null;
        }
        
        // Log current creep counts for monitoring
        if (Game.time % 100 === 0) {
            console.log(`Room ${room.name} creep counts: H:${counts.harvester}/${optimalCounts.harvester}, ` +
                `Ha:${counts.hauler}/${optimalCounts.hauler}, U:${counts.upgrader}/${optimalCounts.upgrader}, ` +
                `B:${counts.builder}/${optimalCounts.builder}, Total:${counts.total}/${optimalCounts.total}`);
        }
        
        // Check minimum requirements in priority order
        if (counts.harvester < Math.min(optimalCounts.harvester, 1)) return 'harvester';
        if (counts.hauler < Math.min(optimalCounts.hauler, 1)) return 'hauler';
        if (counts.upgrader < Math.min(optimalCounts.upgrader, 1)) return 'upgrader';
        if (counts.builder < Math.min(optimalCounts.builder, 1)) return 'builder';
        
        // Don't spawn more than max for each role
        if (counts.harvester >= optimalCounts.harvester && 
            counts.hauler >= optimalCounts.hauler && 
            counts.upgrader >= optimalCounts.upgrader && 
            counts.builder >= optimalCounts.builder) {
            return null;
        }
        
        // Calculate percentage deficits for balanced spawning
        const deficits = [
            { role: 'harvester', deficit: ((optimalCounts.harvester - counts.harvester) / optimalCounts.harvester) * 100, current: counts.harvester, max: optimalCounts.harvester },
            { role: 'hauler', deficit: ((optimalCounts.hauler - counts.hauler) / optimalCounts.hauler) * 100, current: counts.hauler, max: optimalCounts.hauler },
            { role: 'builder', deficit: ((optimalCounts.builder - counts.builder) / optimalCounts.builder) * 100, current: counts.builder, max: optimalCounts.builder },
            { role: 'upgrader', deficit: ((optimalCounts.upgrader - counts.upgrader) / optimalCounts.upgrader) * 100, current: counts.upgrader, max: optimalCounts.upgrader }
        ];
        
        // Apply priority modifiers
        const constructionSites = roomManager.getRoomData(room.name, 'constructionSites') || 0;
        const repairTargets = roomManager.getRoomData(room.name, 'repairTargets') || 0;
        const rcl = room.controller.level;
        
        for (const priority of deficits) {
            if (priority.role === 'harvester') {
                priority.deficit *= 1.5; // Harvesters are most important
            }
            
            if (priority.role === 'hauler' && counts.harvester > 0) {
                priority.deficit *= 1.3; // Haulers are important once we have harvesters
            }
            
            if (priority.role === 'builder') {
                // Check if we have a dedicated repairer
                const hasRepairer = _.some(Game.creeps, creep => 
                    creep.memory.role === 'builder' && 
                    creep.memory.isRepairer === true && 
                    creep.memory.homeRoom === room.name
                );
                
                if (!hasRepairer) {
                    priority.deficit = Math.max(priority.deficit, 70); // Very high priority for first builder (repairer)
                }
                
                if (constructionSites > 0 && hasRepairer && counts.builder < 2) {
                    priority.deficit *= 1.3; // Boost for additional builders when we have construction
                }
                
                if (repairTargets > 0 && !hasRepairer) {
                    priority.deficit *= 1.5; // Higher priority for repairs when no repairer exists
                }
            }
            
            if (priority.role === 'upgrader') {
                if (constructionSites > 0 && rcl <= 3) {
                    priority.deficit *= 0.7; // Lower priority when construction is needed
                } else if (rcl === 7) {
                    priority.deficit *= 1.2; // Boost at RCL 7
                }
            }
        }
        
        // Sort by deficit and filter out roles at max capacity
        deficits.sort((a, b) => b.deficit - a.deficit)
                .filter(p => p.current < p.max && p.deficit > 0);
        
        return deficits.length > 0 ? deficits[0].role : null;
    },
    
    /**
     * Spawn a creep with the best possible body for the given role and energy
     * @param {StructureSpawn} spawn - The spawn to use
     * @param {string} role - The role for the new creep
     * @param {number} energy - Available energy for spawning
     * @returns {boolean} - True if spawning was initiated
     */
    spawnCreep: function(spawn, role, energy) {
        // Calculate the best body based on available energy
        const body = this.calculateBody(role, energy);
        
        if (body.length === 0) return false;
        
        // Create a unique name
        const name = role + Game.time;
        
        // Spawn the creep with minimal memory
        const result = spawn.spawnCreep(body, name, {
            memory: {
                role: role,
                homeRoom: spawn.room.name
            }
        });
        
        if (result === OK) {
            // Check if this is the first builder (will become a repairer)
            const isFirstBuilder = role === 'builder' && 
                !_.some(Game.creeps, c => 
                    c.memory.role === 'builder' && 
                    c.memory.homeRoom === spawn.room.name && 
                    c.id !== Game.creeps[name].id
                );
            
            if (isFirstBuilder) {
                console.log(`Spawning dedicated repairer: ${body.length} parts`);
            } else if (role === 'builder') {
                console.log(`Spawning builder: ${body.length} parts`);
            } else {
                console.log(`Spawning ${role}: ${body.length} parts`);
            }
            return true;
        }
        
        return false;
    },
    
    /**
     * Calculate the best possible body for a creep based on role and energy
     * @param {string} role - The creep's role
     * @param {number} energy - Available energy
     * @returns {string[]} - Array of body parts
     */
    calculateBody: function(role, energy) {
        // Use cached body if available
        const cacheKey = `${role}_${energy}`;
        if (this.bodyCache[cacheKey]) {
            return this.bodyCache[cacheKey];
        }
        
        // Minimum viable creep costs 250 energy (1 WORK, 1 CARRY, 1 MOVE)
        if (energy < 250) return [];
        
        let body;
        
        switch (role) {
            case 'harvester':
                // Prioritize WORK parts for harvesters
                body = this.createBalancedBody(energy, 2, 1, 1); // 2:1:1 ratio of WORK:CARRY:MOVE
                break;
                
            case 'hauler':
                // Prioritize CARRY and MOVE for haulers
                body = this.createBalancedBody(energy, 0, 2, 2); // 0:2:2 ratio of WORK:CARRY:MOVE
                // Add one WORK part for haulers to help with construction
                if (energy >= 250 && body.length > 0) {
                    body.unshift(WORK);
                }
                break;
                
            case 'upgrader':
                // Balanced body for upgraders
                body = this.createBalancedBody(energy, 1, 1, 1); // 1:1:1 ratio of WORK:CARRY:MOVE
                break;
                
            case 'builder':
                // Slightly more WORK parts for builders to speed up construction
                body = this.createBalancedBody(energy, 2, 2, 2); // 2:2:2 ratio of WORK:CARRY:MOVE
                break;
        }
        
        // Ensure we have at least one of each essential part
        if (!body || body.length === 0) {
            // Fallback to minimum viable creep
            if (role === 'hauler') {
                body = [CARRY, CARRY, MOVE];
            } else {
                body = [WORK, CARRY, MOVE];
            }
        }
        
        // Cache the result
        this.bodyCache[cacheKey] = body;
        
        return body;
    },
    
    /**
     * Create a balanced body with the given ratio of parts
     * @param {number} energy - Available energy
     * @param {number} workRatio - Ratio of WORK parts
     * @param {number} carryRatio - Ratio of CARRY parts
     * @param {number} moveRatio - Ratio of MOVE parts
     * @returns {string[]} - Array of body parts
     */
    createBalancedBody: function(energy, workRatio, carryRatio, moveRatio) {
        // Calculate costs
        const workCost = 100;
        const carryCost = 50;
        const moveCost = 50;
        
        // Calculate cost per set of parts
        const setCost = (workRatio * workCost) + (carryRatio * carryCost) + (moveRatio * moveCost);
        if (setCost === 0) return [];
        
        // Calculate how many complete sets we can afford
        const sets = Math.floor(energy / setCost);
        if (sets === 0) return [];
        
        // Cap at 50 parts total (game limit)
        const totalPartsPerSet = workRatio + carryRatio + moveRatio;
        const maxSets = Math.floor(50 / totalPartsPerSet);
        const actualSets = Math.min(sets, maxSets);
        
        // Create the body array
        const body = [];
        
        // Add parts in the right order (most important first)
        // WORK parts first for efficiency
        for (let i = 0; i < actualSets * workRatio; i++) {
            body.push(WORK);
        }
        
        // CARRY parts next
        for (let i = 0; i < actualSets * carryRatio; i++) {
            body.push(CARRY);
        }
        
        // MOVE parts last
        for (let i = 0; i < actualSets * moveRatio; i++) {
            body.push(MOVE);
        }
        
        return body;
    },
    
    /**
     * Reset the body cache when global reset happens
     */
    resetCache: function() {
        this.bodyCache = {};
    }
};

module.exports = spawnManager;