/**
 * Harvester Role - Static source mining
 * CPU optimized for maximum efficiency
 */
const roomManager = require('roomManager');
const utils = require('utils');
const helpers = require('helpers');

const roleHarvester = {
    /**
     * Run the harvester role
     * @param {Creep} creep - The creep to run the role for
     */
    run: function(creep) {
        const movementManager = require('movementManager');
        
        // If creep is dying, release its source
        if (creep.ticksToLive < 30 && creep.memory.sourceId) {
            try {
                roomManager.releaseSource(creep.memory.sourceId, creep.memory.homeRoom);
            } catch (e) {
                helpers.logError(`harvester_release_${creep.name}`, `Failed to release source: ${e}`, 50);
            }
            creep.memory.sourceId = null;
        }
        
        // Periodic source validation - check every 50 ticks if source still exists
        if (creep.memory.sourceId && Game.time % 50 === 0) {
            const source = Game.getObjectById(creep.memory.sourceId);
            if (!source) {
                helpers.logError(`harvester_invalid_source_${creep.name}`, 
                    `Source ${creep.memory.sourceId} no longer exists, reassigning`, 100);
                creep.memory.sourceId = null;
            }
        }
        
        // Periodically check if source is depleted and consider switching
        if (creep.memory.sourceId && Game.time % 20 === 0) {
            const source = Game.getObjectById(creep.memory.sourceId);
            if (source && source.energy === 0) {
                // Check if there are other sources with energy
                const otherSources = creep.room.find(FIND_SOURCES, {
                    filter: s => s.id !== creep.memory.sourceId && s.energy > 0
                });
                
                // If there are other sources with energy and we're not too far from spawn time,
                // consider switching to a better source
                if (otherSources.length > 0 && creep.ticksToLive > 100) {
                    // Release current source
                    roomManager.releaseSource(creep.memory.sourceId, creep.memory.homeRoom);
                    creep.memory.sourceId = null;
                    creep.say('⚡ Switch');
                }
            }
        }
        
        // If creep doesn't have a source assigned, get one
        if (!creep.memory.sourceId) {
            // Try to get a source from room manager
            let source = null;
            try {
                source = roomManager.getBestSource(creep.room);
            } catch (e) {
                helpers.logError(`harvester_getsource_${creep.name}`, `Failed to get source: ${e}`, 50);
            }
            
            if (source) {
                creep.memory.sourceId = source.id;
                // Cache the source position to avoid pathfinding
                creep.memory.sourcePos = {x: source.pos.x, y: source.pos.y, roomName: source.pos.roomName};
                
                // Reset container cache when source changes
                creep.memory.containerId = null;
            } else {
                // Fallback: try to find any source if room manager failed
                if (!source && Game.time % 10 === 0) { // Only try occasionally to save CPU
                    const sources = creep.room.find(FIND_SOURCES);
                    if (sources.length > 0) {
                        // Use the first available source as fallback
                        if (sources.length > 0) {
                            source = sources[0];
                            creep.memory.sourceId = source.id;
                            creep.memory.sourcePos = {x: source.pos.x, y: source.pos.y, roomName: source.pos.roomName};
                            helpers.logError(`harvester_fallback_${creep.name}`, 
                                `Using fallback source assignment: ${source.id}`, 100);
                        }
                    }
                }
                
                // No available source, try to help with other tasks
                if (creep.store[RESOURCE_ENERGY] > 0) {
                    this.deliverEnergy(creep);
                } else {
                    // Move to a waiting area near spawn
                    if (!creep.memory.idlePos) {
                        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
                        if (spawn) {
                            creep.memory.idlePos = {x: spawn.pos.x + 3, y: spawn.pos.y, roomName: spawn.pos.roomName};
                        }
                    }
                    
                    if (creep.memory.idlePos) {
                        try {
                            const movementManager = require('movementManager');
                            const idlePos = new RoomPosition(
                                creep.memory.idlePos.x,
                                creep.memory.idlePos.y,
                                creep.memory.idlePos.roomName
                            );
                            movementManager.moveToTarget(creep, idlePos, { reusePath: 20 });
                        } catch (e) {
                            // If movement fails, try to move to spawn directly
                            const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
                            if (spawn) creep.moveTo(spawn);
                        }
                    }
                }
                return;
            }
        }
        
        // Get the assigned source or mineral
        const source = Game.getObjectById(creep.memory.sourceId);
        if (!source) {
            creep.memory.sourceId = null;
            return;
        }
        
        // Check if this is a mineral
        const isMineral = source.mineralType !== undefined;
        
        // Cache container near source/mineral
        if (!creep.memory.containerId && creep.store.getFreeCapacity() === 0) {
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: s => s.structureType === STRUCTURE_CONTAINER
            });
            
            if (containers.length > 0) {
                creep.memory.containerId = containers[0].id;
            } else {
                creep.memory.containerId = 'none';
            }
        }
        
        // If creep is full, drop energy or transfer to nearby container/link
        if (creep.store.getFreeCapacity() === 0) {
            if (creep.memory.containerId && creep.memory.containerId !== 'none') {
                const container = Game.getObjectById(creep.memory.containerId);
                if (container) {
                    if (creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(container, { reusePath: 5 });
                    }
                } else {
                    // Container was destroyed, reset cache
                    creep.memory.containerId = null;
                    creep.drop(RESOURCE_ENERGY);
                }
            } else {
                // Drop energy for haulers to pick up
                creep.drop(RESOURCE_ENERGY);
            }
            return;
        }
        
        // Check for source keepers near the source - use cached check
        if (Game.time % 10 === 0) { // Only check occasionally to save CPU
            // Use cached result if available
            const safetyKey = `source_safety_${source.id}_${Math.floor(Game.time/100)}`;
            let isSafe;
            
            if (global.sourceCache && global.sourceCache[safetyKey] !== undefined) {
                isSafe = global.sourceCache[safetyKey];
            } else {
                // Initialize cache if needed
                if (!global.sourceCache) global.sourceCache = {};
                
                const sourcePos = new RoomPosition(
                    source.pos.x, 
                    source.pos.y, 
                    source.pos.roomName
                );
                
                isSafe = helpers.isSafeFromKeepers(sourcePos);
                
                // Cache result for 100 ticks
                global.sourceCache[safetyKey] = isSafe;
            }
            
            if (!isSafe) {
                // Source is near a keeper, release it and find a new one
                helpers.logError(`harvester_keeper_${creep.name}`, 
                    `Source ${source.id} is near a Source Keeper, abandoning`, 200);
                    
                roomManager.releaseSource(creep.memory.sourceId, creep.memory.homeRoom);
                creep.memory.sourceId = null;
                
                // Move to safety
                const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
                if (spawn) creep.moveTo(spawn, { reusePath: 5 });
                return;
            }
        }
        
        // Check if we need to move aside for other creeps
        if (creep.store.getFreeCapacity() === 0) {
            // If we're full, check if we're blocking other creeps
            movementManager.checkAndGiveWay(creep);
        }
        
        // Move to source/mineral and harvest
        let harvestResult;
        if (isMineral) {
            // Check if extractor exists
            const extractor = source.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_EXTRACTOR);
            if (!extractor) {
                // No extractor, can't harvest
                if (Game.time % 50 === 0) {
                    creep.say('⚠️ No extractor');
                }
                return;
            }
            
            // Harvest mineral
            harvestResult = creep.harvest(source);
            if (harvestResult === OK) {
                creep.say('⛏️' + source.mineralType);
            }
        } else {
            // Harvest energy source
            harvestResult = creep.harvest(source);
        }
        
        if (harvestResult === ERR_NOT_IN_RANGE) {
            // Check if path to source is safe
            if (creep.memory.sourcePos) {
                const targetPos = new RoomPosition(
                    creep.memory.sourcePos.x,
                    creep.memory.sourcePos.y,
                    creep.memory.sourcePos.roomName
                );
                
                const movementManager = require('movementManager');
                movementManager.moveToTarget(creep, targetPos, { 
                    reusePath: 30, // Reuse path for longer since harvesters are static
                    visualizePathStyle: {stroke: '#ffaa00'}
                });
            } else {
                const movementManager = require('movementManager');
                movementManager.moveToTarget(creep, source, { 
                    reusePath: 30,
                    visualizePathStyle: {stroke: '#ffaa00'}
                });
            }
        }
    },
    
    /**
     * Deliver energy to structures when no source is available
     * @param {Creep} creep - The creep to deliver energy
     */
    deliverEnergy: function(creep) {
        // Use cached target if available
        let target = creep.memory.deliveryTargetId ? Game.getObjectById(creep.memory.deliveryTargetId) : null;
        
        // Validate target still needs energy
        if (!target || (target.store && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0)) {
            // Use room's cached energy structures if available
            const energyStructures = roomManager.getRoomData(creep.room.name, 'energyStructures');
            
            if (energyStructures) {
                for (const id of energyStructures) {
                    const structure = Game.getObjectById(id);
                    if (structure && structure.store && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                        target = structure;
                        creep.memory.deliveryTargetId = id;
                        break;
                    }
                }
            } else {
                // Fallback to finding closest structure
                target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                    filter: s => (
                        (s.structureType === STRUCTURE_EXTENSION || 
                         s.structureType === STRUCTURE_SPAWN || 
                         s.structureType === STRUCTURE_TOWER) && 
                        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                    )
                });
                
                if (target) {
                    creep.memory.deliveryTargetId = target.id;
                }
            }
        }
        
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                const movementManager = require('movementManager');
                movementManager.moveToTarget(creep, target, { reusePath: 10 });
            }
        } else {
            // If no structures need energy, upgrade controller
            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                const movementManager = require('movementManager');
                movementManager.moveToTarget(creep, creep.room.controller, { reusePath: 10 });
            }
        }
    }
};

module.exports = roleHarvester;