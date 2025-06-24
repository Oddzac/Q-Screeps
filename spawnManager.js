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
            
            // In emergency mode, be more lenient with spawning
            if (global.emergencyMode && !criticalCollapse) {
                // Check CPU usage - if it's very low, allow spawning even in emergency mode
                const avgCpuUsage = global.cpuHistory && global.cpuHistory.length > 0 ?
                                  global.cpuHistory.reduce((sum, val) => sum + val, 0) / global.cpuHistory.length : 1.0;
                const veryLowCpuUsage = avgCpuUsage < 2.0;
                
                // In critical emergency, only spawn if CPU usage is very low
                if (global.emergencyMode.level === 'critical' && !veryLowCpuUsage) return;
                
                // In high emergency, allow more creeps when CPU usage is low
                const creepLimit = veryLowCpuUsage ? 10 : 5;
                if (counts.total > creepLimit) return;
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
                
                // Check CPU usage for adaptive spawning behavior
                const avgCpuUsage = global.cpuHistory && global.cpuHistory.length > 0 ?
                                  global.cpuHistory.reduce((sum, val) => sum + val, 0) / global.cpuHistory.length : 1.0;
                const veryLowCpuUsage = avgCpuUsage < 2.0;
                
                // Normal spawning - more lenient CPU conditions
                if (utils.shouldExecute('medium') || veryLowCpuUsage) {
                    // Determine what role we need most
                    const neededRole = this.getNeededRole(room, counts);
                    if (neededRole) {
                        // Check if we should delay spawning to accumulate more energy
                        const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
                        
                        // Get optimal counts from roomManager
                        const optimalCounts = roomManager.analyzeRoomNeeds(room);
                        
                        // Calculate role urgency (0-1) based on deficit percentage
                        const roleUrgency = this.calculateRoleUrgency(room, neededRole, counts, optimalCounts);
                        
                        // Adjust energy threshold based on role urgency and CPU usage
                        // Lower urgency = higher threshold (wait for more energy)
                        // Higher urgency = lower threshold (spawn sooner)
                        const baseThreshold = veryLowCpuUsage ? 0.6 : 0.8;
                        const energyThreshold = baseThreshold * (1 - (roleUrgency * 0.5)); // Scale between 50-100% of base threshold
                        
                        const shouldDelay = !criticalCollapse && energyRatio < energyThreshold;
                        
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
                        
                        // Check if we should spawn now - adjust delay based on role urgency
                        // Higher urgency = shorter delay
                        const baseDelay = veryLowCpuUsage ? 15 : 30;
                        const maxDelay = Math.round(baseDelay * (1 - (roleUrgency * 0.7))); // Scale between 30-90% of base delay
                        const delayElapsed = Game.time - room.memory.spawnDelay.startTick >= maxDelay;
                        const spawnNow = !shouldDelay || delayElapsed || criticalCollapse;
                        
                        if (Game.time % 10 === 0) {
                            console.log(`Role ${neededRole} urgency: ${(roleUrgency * 100).toFixed(0)}%, energy threshold: ${(energyThreshold * 100).toFixed(0)}%, max delay: ${maxDelay} ticks`);
                        }
                        
                        if (spawnNow) {
                            // In emergency mode, spawn smaller creeps to save energy
                            // But be more aggressive when CPU usage is low
                            const energyFactor = veryLowCpuUsage ? 0.9 : 0.7;
                            const energyToUse = global.emergencyMode ? 
                                Math.min(room.energyAvailable, room.energyCapacityAvailable * energyFactor) : 
                                room.energyAvailable;
                                
                            // Spawn the appropriate creep
                            this.spawnCreep(spawn, neededRole, energyToUse);
                            
                            // Reset delay after spawning
                            room.memory.spawnDelay = null;
                        } else if (Game.time % 10 === 0) {
                            // Log that we're waiting for more energy
                            console.log(`Room ${room.name} delaying spawn of ${neededRole}: waiting for energy (${Math.round(energyRatio * 100)}% of capacity, ${maxDelay - (Game.time - room.memory.spawnDelay.startTick)} ticks remaining)`);
                        }
                    } else if (Game.time % 50 === 0) {
                        console.log(`Room ${room.name} spawn blocked: no needed role determined`);
                        // Clear delay data when no role is needed
                        room.memory.spawnDelay = null;
                    }
                } else if (Game.time % 50 === 0) {
                    console.log(`Room ${room.name} spawn blocked: CPU conditions (shouldExecute medium = false and CPU usage not low enough)`);
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
     * Calculate the urgency of a role based on current vs optimal counts
     * @param {Room} room - The room to analyze
     * @param {string} role - The role to check
     * @param {Object} counts - Current creep counts
     * @param {Object} optimalCounts - Optimal creep counts
     * @returns {number} - Urgency factor between 0-1 (higher = more urgent)
     */
    calculateRoleUrgency: function(room, role, counts, optimalCounts) {
        if (!optimalCounts) return 0.5; // Default medium urgency
        
        // Get current count for this role
        const currentCount = counts[role] || 0;
        const optimalCount = optimalCounts[role] || 0;
        
        if (optimalCount === 0) return 0; // Role not needed
        if (currentCount === 0) return 1; // No creeps of this role - maximum urgency
        
        // Calculate deficit percentage
        const deficit = optimalCount - currentCount;
        const deficitPercentage = deficit / optimalCount;
        
        // Calculate remaining lifetime of existing creeps
        let averageRemainingLifetime = 1500; // Default assumption
        const roleCreeps = _.filter(Game.creeps, c => c.memory.role === role && c.memory.homeRoom === room.name);
        
        if (roleCreeps.length > 0) {
            const totalRemainingLife = _.sum(roleCreeps, c => c.ticksToLive || 1500);
            averageRemainingLifetime = totalRemainingLife / roleCreeps.length;
        }
        
        // Normalize remaining lifetime (0-1 scale, where 0 means about to die, 1 means full lifetime)
        const normalizedLifetime = Math.min(1, averageRemainingLifetime / 1500);
        
        // Factor in special conditions
        let urgencyModifier = 0;
        
        // Harvesters are critical for colony function
        if (role === 'harvester') urgencyModifier += 0.2;
        
        // Haulers are important once we have harvesters
        if (role === 'hauler' && counts.harvester > 0) urgencyModifier += 0.15;
        
        // Construction sites increase builder urgency
        if (role === 'builder' && room.find(FIND_CONSTRUCTION_SITES).length > 0) urgencyModifier += 0.1;
        
        // Calculate final urgency (weighted combination of factors)
        let urgency = (deficitPercentage * 0.6) + ((1 - normalizedLifetime) * 0.3) + urgencyModifier;
        
        // Ensure urgency is between 0 and 1
        return Math.max(0, Math.min(1, urgency));
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
        
        // Calculate role urgency
        const urgency = this.calculateRoleUrgency(spawn.room, role, counts, optimalCounts);
        
        // For non-urgent roles, require stronger creeps
        // The lower the urgency, the higher the minimum energy requirement
        const energyCapacity = spawn.room.energyCapacityAvailable;
        const minEnergyRatio = Math.max(0.3, 0.3 + ((1 - urgency) * 0.5)); // Between 30-80% of capacity based on urgency
        const minEnergy = Math.min(energyCapacity * minEnergyRatio, energy);
        
        // For harvesters, check if we're already at or above optimal count
        // If so, only spawn if we can make a reasonably sized creep
        if (role === 'harvester' && counts.harvester >= optimalCounts.harvester) {
            // If we're already at optimal count, require at least 350 energy (2W+1C+1M)
            if (energy < Math.max(350, minEnergy)) {
                console.log(`Skipping underpowered harvester spawn: already at optimal count (${counts.harvester}/${optimalCounts.harvester}) and energy too low (${energy} < ${Math.max(350, minEnergy)})`);
                return false;
            }
        }
        
        // For other roles, check against the calculated minimum energy
        if (energy < minEnergy && urgency < 0.8) { // Allow low energy spawns only for very urgent roles
            console.log(`Skipping underpowered ${role} spawn: urgency ${(urgency*100).toFixed(0)}% not high enough for available energy (${energy} < ${minEnergy})`);
            return false;
        }
        
        // Calculate the best body based on available energy and role urgency
        const body = this.calculateBody(role, energy, urgency);
        
        console.log(`Attempting to spawn ${role} with energy ${energy}, urgency: ${(urgency*100).toFixed(0)}%, body: [${body.join(',')}]`);
        
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
     * @param {number} urgency - Role urgency factor (0-1)
     * @returns {string[]} - Array of body parts
     */
    calculateBody: function(role, energy, urgency = 0.5) {
        // Use cached body if available - include urgency in cache key for different body compositions
        // Round urgency to nearest 0.1 to limit cache entries
        const roundedUrgency = Math.round(urgency * 10) / 10;
        const cacheKey = `${role}_${energy}_${roundedUrgency}`;
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
                    
                    // For high urgency, prioritize WORK parts over balanced body
                    let workParts, carryParts, moveParts;
                    
                    if (urgency > 0.8) {
                        // High urgency - maximize WORK parts for immediate impact
                        const workEnergy = Math.min(energy - 100, energy * 0.8); // Reserve some energy for CARRY and MOVE
                        workParts = Math.floor(workEnergy / 100);
                        carryParts = 1; // Minimum CARRY
                        moveParts = Math.max(1, Math.ceil(workParts / 4)); // At least 1 MOVE, more for larger creeps
                    } else {
                        // Normal urgency - balanced body
                        workParts = harvesterSets * 2;
                        carryParts = harvesterSets;
                        moveParts = harvesterSets;
                    }
                    
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
                
                // For high urgency haulers, prioritize MOVE parts for faster response
                let haulerCarry, haulerMove;
                
                if (urgency > 0.8) {
                    // High urgency - more balanced CARRY:MOVE ratio for faster movement
                    haulerCarry = Math.floor(haulerSets * 1.5);
                    haulerMove = Math.floor(haulerSets * 1.5);
                } else {
                    // Normal urgency - maximize CARRY capacity
                    haulerCarry = haulerSets * 2;
                    haulerMove = haulerSets;
                }
                
                // Optimal order: CARRY parts first, then MOVE
                for (let i = 0; i < haulerCarry; i++) body.push(CARRY);
                for (let i = 0; i < haulerMove; i++) body.push(MOVE);
                
                if (body.length === 0) body = [CARRY, CARRY, MOVE];
                break;
                
            case 'upgrader':
                // Upgrader: Balanced WORK/CARRY for continuous upgrading
                // Pattern: 1W + 1C + 1M = 200 energy per set
                const upgraderSets = Math.min(Math.floor(energy / 200), 16); // Max 48 parts
                
                // For high urgency, prioritize WORK parts
                let upgraderWork, upgraderCarry, upgraderMove;
                
                if (urgency > 0.8) {
                    // High urgency - more WORK parts
                    upgraderWork = Math.ceil(upgraderSets * 1.3);
                    upgraderCarry = Math.floor(upgraderSets * 0.8);
                    upgraderMove = Math.floor(upgraderSets * 0.9);
                } else {
                    // Normal urgency - balanced body
                    upgraderWork = upgraderSets;
                    upgraderCarry = upgraderSets;
                    upgraderMove = upgraderSets;
                }
                
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
                
                // For high urgency, prioritize WORK and CARRY
                let builderWork, builderCarry, builderMove;
                
                if (urgency > 0.8) {
                    // High urgency - more WORK and CARRY for faster building
                    builderWork = Math.ceil(builderSets * 1.2);
                    builderCarry = Math.ceil(builderSets * 1.2);
                    builderMove = Math.floor(builderSets * 0.8);
                } else {
                    // Normal urgency - balanced body
                    builderWork = builderSets;
                    builderCarry = builderSets;
                    builderMove = builderSets;
                }
                
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
        
        // Use the calculateBodyCost function to check energy limit
        const actualCost = this.calculateBodyCost(body);
        
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
        
        // Ensure we don't exceed energy limit
        const actualCost = this.calculateBodyCost(body);
        if (actualCost > energy) {
            // Recalculate with exact energy limit
            body = this.recalculateBodyForEnergy(role, energy, body);
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
     * Calculate the energy cost of a body
     * @param {string[]} body - Array of body parts
     * @returns {number} - Total energy cost
     */
    calculateBodyCost: function(body) {
        return body.reduce((cost, part) => {
            switch(part) {
                case WORK: return cost + 100;
                case CARRY: case MOVE: return cost + 50;
                case ATTACK: return cost + 80;
                case RANGED_ATTACK: return cost + 150;
                case HEAL: return cost + 250;
                case CLAIM: return cost + 600;
                case TOUGH: return cost + 10;
                default: return cost;
            }
        }, 0);
    },
    
    /**
     * Recalculate body to fit within energy limit
     * @param {string} role - Creep role
     * @param {number} energy - Available energy
     * @param {string[]} originalBody - Original body that exceeded energy limit
     * @returns {string[]} - Adjusted body that fits within energy limit
     */
    recalculateBodyForEnergy: function(role, energy, originalBody) {
        // Count parts by type
        const partCounts = {};
        for (const part of originalBody) {
            partCounts[part] = (partCounts[part] || 0) + 1;
        }
        
        // Determine part costs
        const partCosts = {
            [WORK]: 100,
            [CARRY]: 50,
            [MOVE]: 50,
            [ATTACK]: 80,
            [RANGED_ATTACK]: 150,
            [HEAL]: 250,
            [CLAIM]: 600,
            [TOUGH]: 10
        };
        
        // Determine part priorities (higher number = higher priority to keep)
        const partPriorities = {
            [WORK]: role === 'harvester' ? 3 : 2,
            [CARRY]: role === 'hauler' ? 3 : 2,
            [MOVE]: 1
        };
        
        // Create a new body by adding parts in priority order until we hit the energy limit
        let newBody = [];
        let remainingEnergy = energy;
        
        // Sort part types by priority
        const partTypes = Object.keys(partCounts).sort((a, b) => 
            (partPriorities[b] || 0) - (partPriorities[a] || 0)
        );
        
        // Add parts in priority order
        for (const partType of partTypes) {
            const partCost = partCosts[partType];
            const maxParts = Math.floor(remainingEnergy / partCost);
            const partsToAdd = Math.min(maxParts, partCounts[partType]);
            
            for (let i = 0; i < partsToAdd; i++) {
                newBody.push(partType);
                remainingEnergy -= partCost;
            }
        }
        
        // Ensure we have at least one of each essential part
        const hasWork = newBody.includes(WORK);
        const hasCarry = newBody.includes(CARRY);
        const hasMove = newBody.includes(MOVE);
        
        // For haulers, ensure at least CARRY and MOVE
        if (role === 'hauler') {
            if (!hasCarry && remainingEnergy >= 50) {
                newBody.push(CARRY);
                remainingEnergy -= 50;
            }
            if (!hasMove && remainingEnergy >= 50) {
                newBody.push(MOVE);
                remainingEnergy -= 50;
            }
        } 
        // For other roles, ensure at least WORK, CARRY, and MOVE
        else {
            if (!hasWork && remainingEnergy >= 100) {
                newBody.push(WORK);
                remainingEnergy -= 100;
            }
            if (!hasCarry && remainingEnergy >= 50) {
                newBody.push(CARRY);
                remainingEnergy -= 50;
            }
            if (!hasMove && remainingEnergy >= 50) {
                newBody.push(MOVE);
                remainingEnergy -= 50;
            }
        }
        
        return newBody;
    },
    
    /**
     * Reset the body cache when global reset happens
     */
    resetCache: function() {
        this.bodyCache = {};
    }
};

module.exports = spawnManager;