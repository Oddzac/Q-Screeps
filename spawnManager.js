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
        // Use roomManager's analysis for optimal creep counts
        let optimalCounts;
        const cacheKey = `roomNeeds_${room.name}`;
        
        if (roomManager.cache[cacheKey] && Game.time - roomManager.cache[cacheKey].time < 20) {
            // Use cached analysis if recent
            optimalCounts = roomManager.cache[cacheKey].value;
        } else {
            // Get fresh analysis
            optimalCounts = roomManager.analyzeRoomNeeds(room);
        }
        
        // Get source count from room memory
        const sourceCount = Object.keys(room.memory.sources || {}).length || 1;
        
        // Get construction site count
        const constructionSites = roomManager.getRoomData(room.name, 'constructionSites') || 0;
        const repairTargets = roomManager.getRoomData(room.name, 'repairTargets') || 0;
        
        // Calculate RCL-based values
        const rcl = room.controller.level;
        
        // Calculate approximate energy production per tick for fallback
        const energyPerTick = sourceCount * 10;
        
        // Use optimal counts from room analysis, with fallbacks aligned with analyzeRoomNeeds
        const maxHarvesters = optimalCounts ? optimalCounts.harvester : Math.min(sourceCount*2, 4); // Allow up to 4 harvesters for multiple sources
        const maxHaulers = optimalCounts ? optimalCounts.hauler : Math.min(Math.ceil(energyPerTick / 50), sourceCount + 2); // Scale with energy production
        const maxUpgraders = optimalCounts ? optimalCounts.upgrader : Math.min(2, rcl <= 2 ? 1 : 2); // At least 1 upgrader, max 2 at higher RCL
        const maxBuilders = optimalCounts ? optimalCounts.builder : (constructionSites > 0 ? Math.min(3, Math.max(1, Math.floor(constructionSites / 5))) : 0); // More gradual scaling
        
        // Minimum requirements
        const minHarvesters = Math.min(maxHarvesters, 1); // At least 1 harvester
        const minHaulers = maxHarvesters > 0 ? Math.min(maxHaulers, 1) : 0; // At least 1 hauler if we have harvesters
        const minUpgraders = Math.min(maxUpgraders, 1); // At least 1 upgrader
        const minBuilders = Math.min(maxBuilders, 1); // Always at least 1 builder for repairs
        
        // Total creep cap based on RCL - more flexible limits
        const maxTotalCreeps = optimalCounts ? optimalCounts.total : Math.min(sourceCount * 4, rcl <= 2 ? 8 : (rcl <= 4 ? 10 : 12)); 
        
        // Check if we're at total creep capacity - enforce strict limit
        if (counts.total >= maxTotalCreeps) {
            return null;
        }
        
        // Log current creep counts for monitoring
        if (Game.time % 100 === 0) {
            console.log(`Room ${room.name} creep counts: H:${counts.harvester}/${maxHarvesters}, ` +
                `Ha:${counts.hauler}/${maxHaulers}, U:${counts.upgrader}/${maxUpgraders}, ` +
                `B:${counts.builder}/${maxBuilders}, Total:${counts.total}/${maxTotalCreeps}`);
        }
        
        // Check minimum requirements in priority order
        if (counts.harvester < minHarvesters) return 'harvester';
        if (counts.hauler < minHaulers) return 'hauler';
        if (counts.upgrader < minUpgraders) return 'upgrader';
        if (counts.builder < minBuilders) return 'builder';
        
        // Enforce strict role caps - don't spawn more than max for each role
        if (counts.harvester >= maxHarvesters) {
            //console.log(`Room ${room.name} at max harvesters (${counts.harvester}/${maxHarvesters})`);
        }
        if (counts.hauler >= maxHaulers) {
            //console.log(`Room ${room.name} at max haulers (${counts.hauler}/${maxHaulers})`);
        }
        if (counts.upgrader >= maxUpgraders) {
            //console.log(`Room ${room.name} at max upgraders (${counts.upgrader}/${maxUpgraders})`);
        }
        if (counts.builder >= maxBuilders) {
            //console.log(`Room ${room.name} at max builders (${counts.builder}/${maxBuilders})`);
        }
        
        // Don't spawn more than max for each role
        if (counts.harvester >= maxHarvesters && 
            counts.hauler >= maxHaulers && 
            counts.upgrader >= maxUpgraders && 
            counts.builder >= maxBuilders) {
            return null;
        }
        
        // Calculate percentage deficits rather than absolute numbers
        // This gives more balanced priorities
        const harvesterDeficit = maxHarvesters > 0 ? 
            ((maxHarvesters - counts.harvester) / maxHarvesters) * 100 : 0;
        
        const haulerDeficit = maxHaulers > 0 ? 
            ((maxHaulers - counts.hauler) / maxHaulers) * 100 : 0;
        
        const upgraderDeficit = maxUpgraders > 0 ? 
            ((maxUpgraders - counts.upgrader) / maxUpgraders) * 100 : 0;
        
        const builderDeficit = maxBuilders > 0 ? 
            ((maxBuilders - counts.builder) / maxBuilders) * 100 : 0;
        
        // Create a priority queue based on percentage deficits
        const priorities = [
            { role: 'harvester', deficit: harvesterDeficit, max: maxHarvesters, current: counts.harvester },
            { role: 'hauler', deficit: haulerDeficit, max: maxHaulers, current: counts.hauler },
            { role: 'builder', deficit: builderDeficit, max: maxBuilders, current: counts.builder }, // Always consider builders for repairs
            { role: 'upgrader', deficit: upgraderDeficit, max: maxUpgraders, current: counts.upgrader }
        ];
        
        // Apply priority modifiers based on RCL and construction needs
        for (const priority of priorities) {
            // Critical roles get priority boosts
            if (priority.role === 'harvester') {
                priority.deficit *= 1.5; // Harvesters are most important
            }
            
            if (priority.role === 'hauler' && counts.harvester > 0) {
                priority.deficit *= 1.3; // Haulers are important once we have harvesters
            }
            
            // Boost builder priority when we have construction sites or repair needs
            if (priority.role === 'builder') {
                // Always ensure we have at least one builder for repairs
                if (counts.builder === 0) {
                    priority.deficit = Math.max(priority.deficit, 50); // High priority for first builder
                }
                
                // Check if we have extensions or containers being built (critical infrastructure)
                if (constructionSites > 0) {
                    const criticalSites = room.find(FIND_CONSTRUCTION_SITES, {
                        filter: site => site.structureType === STRUCTURE_EXTENSION || 
                                      site.structureType === STRUCTURE_CONTAINER
                    }).length;
                    
                    if (criticalSites > 0 && rcl <= 3) {
                        priority.deficit *= 1.4; // Critical infrastructure at low RCL
                    }
                }
                
                // Boost priority if there are repair targets
                if (repairTargets > 0) {
                    priority.deficit *= 1.2; // Increase priority for repairs
                }
            }
            
            // Adjust upgrader priority based on RCL
            if (priority.role === 'upgrader') {
                // Lower upgrader priority when we have construction sites at low RCL
                if (constructionSites > 0 && rcl <= 3) {
                    priority.deficit *= 0.7;
                }
                // Boost upgrader priority at RCL 7 to reach RCL 8 faster
                else if (rcl === 7) {
                    priority.deficit *= 1.2;
                }
            }
        }
        
        // Sort by deficit (highest first) and filter out roles at max capacity
        priorities.sort((a, b) => b.deficit - a.deficit)
                 .filter(p => p.current < p.max && p.deficit > 0);
        
        // Return the role with the highest deficit
        return priorities.length > 0 ? priorities[0].role : null;
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
            // Special message for builders when there are no construction sites (repair-focused)
            if (role === 'builder' && spawn.room.find(FIND_CONSTRUCTION_SITES).length === 0) {
                console.log(`Spawning repair-focused ${role}: ${body.length} parts`);
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