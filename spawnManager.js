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
            if (room.energyAvailable < 200) { // Minimum viable creep is 200 energy (1W+1C+1M)
                if (Game.time % 50 === 0) {
                    console.log(`Room ${room.name} spawn blocked: insufficient energy (${room.energyAvailable}/200)`);
                }
                return;
            }
            
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
            
            // Debug logging for creep counts
            if (Game.time % 50 === 0) {
                console.log(`Room ${room.name} current counts: H:${counts.harvester} Ha:${counts.hauler} U:${counts.upgrader} B:${counts.builder} T:${counts.total}`);
            }
            
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
                if (spawn.spawning) {
                    if (Game.time % 50 === 0) {
                        console.log(`Room ${room.name} spawn blocked: spawn ${spawn.name} is busy (${spawn.spawning.remainingTime} ticks)`);
                    }
                    continue;
                }
                
                // Emergency recovery - if no harvesters, spawn one immediately (no delay)
                if (counts.harvester === 0) {
                    console.log(`Room ${room.name} emergency spawning harvester (0 harvesters)`);
                    this.spawnCreep(spawn, 'harvester', room.energyAvailable);
                    // Clear any spawn delay data
                    room.memory.spawnDelay = null;
                    return;
                }
                
                // Emergency recovery - if no haulers but we have harvesters, spawn hauler
                if (counts.harvester > 0 && counts.hauler === 0) {
                    // For haulers, we might want to wait a bit for more energy if we're below 80%
                    const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
                    const shouldDelay = energyRatio < 0.8 && counts.total >= 2; // Only delay if we have at least 2 creeps
                    
                    // Initialize or update emergency hauler spawn delay
                    if (shouldDelay) {
                        if (!room.memory.emergencyHaulerDelay) {
                            room.memory.emergencyHaulerDelay = {
                                startTick: Game.time
                            };
                            console.log(`Room ${room.name} delaying emergency hauler spawn to accumulate energy (${Math.round(energyRatio * 100)}% of capacity)`);
                            return;
                        } else if (Game.time - room.memory.emergencyHaulerDelay.startTick < 20) { // Shorter delay (20 ticks) for emergency hauler
                            if (Game.time % 10 === 0) {
                                console.log(`Room ${room.name} still delaying emergency hauler spawn (${Math.round(energyRatio * 100)}% of capacity, ${20 - (Game.time - room.memory.emergencyHaulerDelay.startTick)} ticks remaining)`);
                            }
                            return;
                        }
                    }
                    
                    // Spawn hauler after delay or immediately if not delaying
                    console.log(`Room ${room.name} emergency spawning hauler (${counts.harvester} harvesters, 0 haulers)`);
                    this.spawnCreep(spawn, 'hauler', room.energyAvailable);
                    // Clear delay data
                    room.memory.emergencyHaulerDelay = null;
                    room.memory.spawnDelay = null;
                    return;
                }
                
                // Clear emergency hauler delay if we have haulers
                if (room.memory.emergencyHaulerDelay && counts.hauler > 0) {
                    room.memory.emergencyHaulerDelay = null;
                }
                
                // Normal spawning - only if CPU conditions allow
                if (utils.shouldExecute('medium')) {
                    // Determine what role we need most
                    const neededRole = this.getNeededRole(room, counts);
                    if (neededRole) {
                        // Check if we should delay spawning to accumulate more energy
                        const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
                        const shouldDelay = !criticalCollapse && energyRatio < 0.8;
                        
                        // Initialize or update spawn delay tracking
                        if (!room.memory.spawnDelay) {
                            room.memory.spawnDelay = {
                                role: neededRole,
                                startTick: Game.time,
                                waiting: shouldDelay
                            };
                        } else if (room.memory.spawnDelay.role !== neededRole) {
                            // Role changed, reset delay
                            room.memory.spawnDelay = {
                                role: neededRole,
                                startTick: Game.time,
                                waiting: shouldDelay
                            };
                        }
                        
                        // Check if we should spawn now
                        const delayElapsed = Game.time - room.memory.spawnDelay.startTick >= 30;
                        const spawnNow = !shouldDelay || delayElapsed || criticalCollapse;
                        
                        if (spawnNow) {
                            // In emergency mode, spawn smaller creeps to save energy
                            const energyToUse = global.emergencyMode ? 
                                Math.min(room.energyAvailable, room.energyCapacityAvailable * 0.7) : 
                                room.energyAvailable;
                                
                            // Spawn the appropriate creep
                            this.spawnCreep(spawn, neededRole, energyToUse);
                            
                            // Reset delay after spawning
                            room.memory.spawnDelay = null;
                        } else if (Game.time % 10 === 0) {
                            // Log that we're waiting for more energy
                            console.log(`Room ${room.name} delaying spawn of ${neededRole}: waiting for energy (${Math.round(energyRatio * 100)}% of capacity, ${30 - (Game.time - room.memory.spawnDelay.startTick)} ticks remaining)`);
                        }
                    } else if (Game.time % 50 === 0) {
                        console.log(`Room ${room.name} spawn blocked: no needed role determined`);
                        // Clear delay data when no role is needed
                        room.memory.spawnDelay = null;
                    }
                } else if (Game.time % 50 === 0) {
                    console.log(`Room ${room.name} spawn blocked: CPU conditions (shouldExecute medium = false)`);
                }
            }
        } catch (error) {
            console.log(`Error in spawnManager.run for room ${room.name}: ${error}`);
            
            // Emergency recovery - try to spawn a basic harvester if we have any spawn available
            const spawn = room.find(FIND_MY_SPAWNS)[0];
            if (spawn && !spawn.spawning && room.energyAvailable >= 200) {
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
        // Get current counts and optimal counts
        const roomManager = require('roomManager');
        const counts = roomManager.getRoomData(spawn.room.name, 'creepCounts') || {
            harvester: 0,
            hauler: 0,
            upgrader: 0,
            builder: 0,
            total: 0
        };
        const optimalCounts = roomManager.analyzeRoomNeeds(spawn.room);
        
        // For harvesters, check if we're already at or above optimal count
        // If so, only spawn if we can make a reasonably sized creep (at least 2 WORK parts)
        if (role === 'harvester' && counts.harvester >= optimalCounts.harvester) {
            // If we're already at optimal count, require at least 350 energy (2W+1C+1M)
            if (energy < 350) {
                console.log(`Skipping underpowered harvester spawn: already at optimal count (${counts.harvester}/${optimalCounts.harvester}) and energy too low (${energy})`);
                return false;
            }
        }
        
        // Calculate the best body based on available energy
        const body = this.calculateBody(role, energy);
        
        console.log(`Attempting to spawn ${role} with energy ${energy}, body: [${body.join(',')}]`);
        
        if (body.length === 0) {
            console.log(`Failed to spawn ${role}: empty body calculated`);
            return false;
        }
        
        // Create a unique name
        const name = role + Game.time;
        
        // Spawn the creep with minimal memory
        const result = spawn.spawnCreep(body, name, {
            memory: {
                role: role,
                homeRoom: spawn.room.name
            }
        });
        
        console.log(`Spawn result for ${role}: ${result} (${this.getSpawnErrorText(result)})`);
        
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
     * Get human readable spawn error text
     * @param {number} errorCode - The spawn error code
     * @returns {string} - Human readable error text
     */
    getSpawnErrorText: function(errorCode) {
        const errors = {
            [OK]: 'OK',
            [ERR_NOT_OWNER]: 'NOT_OWNER',
            [ERR_NAME_EXISTS]: 'NAME_EXISTS', 
            [ERR_BUSY]: 'BUSY',
            [ERR_NOT_ENOUGH_ENERGY]: 'NOT_ENOUGH_ENERGY',
            [ERR_INVALID_ARGS]: 'INVALID_ARGS',
            [ERR_RCL_NOT_ENOUGH]: 'RCL_NOT_ENOUGH'
        };
        return errors[errorCode] || `UNKNOWN_ERROR_${errorCode}`;
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
        
        // Minimum viable creep costs 200 energy (1 WORK, 1 CARRY, 1 MOVE)
        if (energy < 200) return [];
        
        let body = [];
        
        switch (role) {
            case 'harvester':
                // Check if we have enough energy for at least one set
                if (energy >= 250) {
                    // Harvester: 2 WORK per MOVE for efficiency, 1 CARRY for pickup
                    // Pattern: 2W + 1C + 1M = 250 energy per set
                    const harvesterSets = Math.min(Math.floor(energy / 250), 12); // Max 48 parts
                    const workParts = harvesterSets * 2;
                    const carryParts = harvesterSets;
                    const moveParts = harvesterSets;
                    
                    // Optimal order: WORK parts first, then CARRY, then MOVE
                    for (let i = 0; i < workParts; i++) body.push(WORK);
                    for (let i = 0; i < carryParts; i++) body.push(CARRY);
                    for (let i = 0; i < moveParts; i++) body.push(MOVE);
                } else if (energy >= 200) {
                    // Fallback to minimum viable harvester if we can't afford a full set
                    body = [WORK, CARRY, MOVE]; // 200 energy
                }
                break;
                
            case 'hauler':
                // Hauler: Pure transport, no WORK needed for efficiency
                // Pattern: 2C + 1M = 150 energy per set (2:1 carry to move ratio)
                const haulerSets = Math.min(Math.floor(energy / 150), 16); // Max 48 parts
                const haulerCarry = haulerSets * 2;
                const haulerMove = haulerSets;
                
                // Optimal order: CARRY parts first, then MOVE
                for (let i = 0; i < haulerCarry; i++) body.push(CARRY);
                for (let i = 0; i < haulerMove; i++) body.push(MOVE);
                
                if (body.length === 0) body = [CARRY, CARRY, MOVE];
                break;
                
            case 'upgrader':
                // Upgrader: Balanced WORK/CARRY for continuous upgrading
                // Pattern: 1W + 1C + 1M = 200 energy per set
                const upgraderSets = Math.min(Math.floor(energy / 200), 16); // Max 48 parts
                const upgraderWork = upgraderSets;
                const upgraderCarry = upgraderSets;
                const upgraderMove = upgraderSets;
                
                // Optimal order: WORK first, then CARRY, then MOVE
                for (let i = 0; i < upgraderWork; i++) body.push(WORK);
                for (let i = 0; i < upgraderCarry; i++) body.push(CARRY);
                for (let i = 0; i < upgraderMove; i++) body.push(MOVE);
                
                if (body.length === 0) body = [WORK, CARRY, MOVE];
                break;
                
            case 'builder':
                // Builder: Balanced for construction and repair
                // Pattern: 1W + 1C + 1M = 200 energy per set
                const builderSets = Math.min(Math.floor(energy / 200), 16); // Max 48 parts
                const builderWork = builderSets;
                const builderCarry = builderSets;
                const builderMove = builderSets;
                
                // Optimal order: WORK first, then CARRY, then MOVE
                for (let i = 0; i < builderWork; i++) body.push(WORK);
                for (let i = 0; i < builderCarry; i++) body.push(CARRY);
                for (let i = 0; i < builderMove; i++) body.push(MOVE);
                
                if (body.length === 0) body = [WORK, CARRY, MOVE];
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
        
        // Validate body doesn't exceed 50 parts (game limit)
        if (body.length > 50) {
            body = body.slice(0, 50);
        }
        
        // Verify we don't exceed energy limit
        const actualCost = body.reduce((cost, part) => {
            return cost + (part === WORK ? 100 : 50);
        }, 0);
        
        if (actualCost > energy) {
            console.log(`Warning: Body cost ${actualCost} exceeds available energy ${energy}`);
            
            // Instead of defaulting to a minimum body that might still be too expensive,
            // calculate the largest body we can actually afford
            if (role === 'hauler') {
                // For haulers: try to get as many CARRY+MOVE pairs as possible
                const affordablePairs = Math.floor(energy / 100); // 50+50 per pair
                if (affordablePairs >= 1) {
                    body = [];
                    for (let i = 0; i < affordablePairs; i++) {
                        body.push(CARRY);
                    }
                    for (let i = 0; i < affordablePairs; i++) {
                        body.push(MOVE);
                    }
                } else {
                    // Can't even afford one pair
                    return [];
                }
            } else {
                // For other roles: check if we can afford the minimum viable creep
                if (energy >= 200) { // 100+50+50 for WORK+CARRY+MOVE
                    body = [WORK, CARRY, MOVE];
                } else {
                    // Can't afford minimum viable creep
                    return [];
                }
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