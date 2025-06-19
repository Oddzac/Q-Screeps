/**
 * Upgrader Role - Controller upgrading
 * CPU optimized for maximum efficiency
 */
const movementManager = require('movementManager');

const roleUpgrader = {
    /**
     * Run the upgrader role
     * @param {Creep} creep - The creep to run the role for
     */
    run: function(creep) {
        // Check if we need to move aside for other creeps
        movementManager.checkAndGiveWay(creep);
        
        // Initialize upgrading state if not set
        if (creep.memory.upgrading === undefined) {
            creep.memory.upgrading = false;
        }
        
        // Generate pixel if CPU bucket is full
        if (Game.time % 25 === 0) {
            if (Game.cpu.bucket === 10000) {
                this.genPix(creep);
            }
        }
        
        // State switching with minimal operations
        if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.upgrading = false;
            creep.say('🔄');
            // Clear target cache when switching states
            delete creep.memory.energySourceId;
            delete creep.memory.sourcePos;
        }
        if (!creep.memory.upgrading && creep.store.getFreeCapacity() === 0) {
            creep.memory.upgrading = true;
            creep.say('⚡');
            // Cache controller position when switching to upgrading
            if (!creep.memory.controllerPos) {
                creep.memory.controllerPos = {
                    x: creep.room.controller.pos.x,
                    y: creep.room.controller.pos.y,
                    roomName: creep.room.name
                };
            }
        }
        
        if (creep.memory.upgrading) {
            // Find controller container for optimal positioning
            const controllerContainer = this.findControllerContainer(creep);
            
            // Upgrade the controller
            const upgradeResult = creep.upgradeController(creep.room.controller);
            
            if (upgradeResult === ERR_NOT_IN_RANGE) {
                // If we have a controller container, position next to it
                if (controllerContainer) {
                    // Find a position adjacent to both the container and controller if possible
                    const targetPos = this.findOptimalUpgradePosition(creep, controllerContainer);
                    
                    movementManager.moveToTarget(creep, targetPos, { 
                        reusePath: 20, // Reuse path for longer since positions are static
                        visualizePathStyle: {stroke: '#ffffff'}
                    });
                } 
                // Otherwise use cached controller position
                else if (creep.memory.controllerPos) {
                    const controllerPos = new RoomPosition(
                        creep.memory.controllerPos.x,
                        creep.memory.controllerPos.y,
                        creep.memory.controllerPos.roomName
                    );
                    movementManager.moveToTarget(creep, controllerPos, { 
                        reusePath: 20,
                        visualizePathStyle: {stroke: '#ffffff'}
                    });
                } 
                // Fallback to moving directly to controller
                else {
                    movementManager.moveToTarget(creep, creep.room.controller, { 
                        reusePath: 20,
                        visualizePathStyle: {stroke: '#ffffff'}
                    });
                }
            } else if (upgradeResult !== OK) {
                console.log(`Upgrader ${creep.name} error: ${upgradeResult} when upgrading controller`);
            }
        } else {
            // Get energy from the most efficient source
            this.getEnergy(creep);
        }
    },
    
    /**
     * Find optimal position for upgrading (adjacent to both container and controller if possible)
     * @param {Creep} creep - The upgrader creep
     * @param {Structure} container - The controller container
     * @returns {RoomPosition} - The optimal position for upgrading
     */
    findOptimalUpgradePosition: function(creep, container) {
        // If we've already cached an optimal position, use it
        if (creep.memory.optimalPos) {
            return new RoomPosition(
                creep.memory.optimalPos.x,
                creep.memory.optimalPos.y,
                creep.memory.optimalPos.roomName
            );
        }
        
        // Try to find a position adjacent to both container and controller
        const controller = creep.room.controller;
        
        // Simple approach: use the container position
        // This works because controller containers are already positioned near the controller
        const optimalPos = container.pos;
        
        // Cache the position
        creep.memory.optimalPos = {
            x: optimalPos.x,
            y: optimalPos.y,
            roomName: optimalPos.roomName
        };
        
        return optimalPos;
    },

    /**
     * Generate a pixel if the CPU bucket is full
     * @param {Creep} creep - The creep to generate the pixel for
     */
    genPix: function() {
        if (Game.cpu.bucket >= 10000) { // Ensure there is enough CPU in the bucket
            const result = Game.cpu.generatePixel();
            if (result === OK) {
                console.log('Pixel generated successfully!');
            } else {
                console.log('Failed to generate pixel:', result);
            }
        } else {
            console.log('Not enough CPU in the bucket to generate a pixel.');
        }
    },
    
    /**
     * Find the closest controller container
     * @param {Creep} creep - The upgrader creep
     * @returns {Structure|null} - The closest controller container or null if none found
     */
    findControllerContainer: function(creep) {
        // Check if we've already cached the controller container
        if (creep.memory.controllerContainerId) {
            const container = Game.getObjectById(creep.memory.controllerContainerId);
            if (container) return container;
            delete creep.memory.controllerContainerId;
        }
        
        // Use room manager to get controller containers
        const roomManager = require('roomManager');
        const containerTypes = roomManager.classifyContainers(creep.room);
        
        if (containerTypes && containerTypes.controllerContainers.length > 0) {
            // Find closest controller container
            const closestContainer = creep.pos.findClosestByRange(containerTypes.controllerContainers);
            if (closestContainer) {
                // Cache the container ID
                creep.memory.controllerContainerId = closestContainer.id;
                return closestContainer;
            }
        }
        
        return null;
    },
    
    /**
     * Get energy from the most efficient source
     * @param {Creep} creep - The creep to get energy for
     */
    getEnergy: function(creep) {
        const roomManager = require('roomManager');
        
        // Use cached energy source if available
        let source = creep.memory.energySourceId ? Game.getObjectById(creep.memory.energySourceId) : null;
        
        // Validate source still has energy
        if (source) {
            if ((source.amount !== undefined && source.amount < 50) || 
                (source.store && source.store[RESOURCE_ENERGY] === 0)) {
                source = null;
                delete creep.memory.energySourceId;
            }
        }
        
        // Find new energy source if needed
        if (!source) {
            // First check for controller containers using our new classification system
            const containerTypes = roomManager.classifyContainers(creep.room);
            
            if (containerTypes && containerTypes.controllerContainers.length > 0) {
                // Find controller container with most energy
                const controllerContainers = containerTypes.controllerContainers
                    .filter(c => c.store[RESOURCE_ENERGY] > 0)
                    .sort((a, b) => b.store[RESOURCE_ENERGY] - a.store[RESOURCE_ENERGY]);
                
                if (controllerContainers.length > 0) {
                    source = controllerContainers[0];
                    creep.memory.energySourceId = source.id;
                    
                    // If we found a controller container, use it and skip other checks
                    if (source) {
                        creep.say('🔋');
                        return;
                    }
                }
            }
            
            // Fallback to checking for containers near controller
            if (!source) {
                const nearbyContainers = creep.pos.findInRange(FIND_STRUCTURES, 3, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER && 
                              s.store[RESOURCE_ENERGY] > 0
                });
                if (nearbyContainers.length > 0) {
                    source = nearbyContainers[0];
                    creep.memory.energySourceId = source.id;
                }
            }
            
            // Check for storage
            if (!source && creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
                source = creep.room.storage;
                creep.memory.energySourceId = source.id;
            }
            
            // If no container or storage, use room's cached energy sources from room manager
            if (!source) {
                const energySources = roomManager.analyzeEnergySources(creep.room);
                
                // Check dropped resources first
                if (energySources.droppedResources.length > 0) {
                    // Find closest dropped resource
                    source = creep.pos.findClosestByRange(energySources.droppedResources);
                    if (source) {
                        creep.memory.energySourceId = source.id;
                    }
                }
                
                // Then check tombstones
                if (!source && energySources.tombstones.length > 0) {
                    source = creep.pos.findClosestByRange(energySources.tombstones);
                    if (source) {
                        creep.memory.energySourceId = source.id;
                    }
                }
                
                // Last resort - find active source
                if (!source) {
                    // Use room manager's active sources if available
                    const activeSources = roomManager.getRoomData(creep.room.name, 'activeSources');
                    
                    if (activeSources && activeSources.length > 0) {
                        // Find closest source
                        source = creep.pos.findClosestByRange(
                            activeSources.map(id => Game.getObjectById(id)).filter(s => s)
                        );
                        if (source) {
                            creep.memory.energySourceId = source.id;
                        }
                    } else {
                        // Limit expensive searches
                        if (!creep.memory.lastSourceSearch || Game.time - creep.memory.lastSourceSearch > 10) {
                            const activeSources = creep.room.find(FIND_SOURCES_ACTIVE);
                            if (activeSources.length > 0) {
                                source = creep.pos.findClosestByRange(activeSources);
                                if (source) {
                                    creep.memory.energySourceId = source.id;
                                }
                            }
                            creep.memory.lastSourceSearch = Game.time;
                        }
                    }
                }
            }
        }
        
        // Interact with the source if found
        if (source) {
            let actionResult;
            
            // Cache source position for more efficient movement
            if (!creep.memory.sourcePos) {
                creep.memory.sourcePos = {
                    x: source.pos.x,
                    y: source.pos.y,
                    roomName: source.pos.roomName
                };
            }
            
            // Check if this is a controller container and mark it in memory
            if (source.structureType === STRUCTURE_CONTAINER) {
                const roomManager = require('roomManager');
                const containerTypes = roomManager.classifyContainers(creep.room);
                if (containerTypes && containerTypes.containerIds.controller.includes(source.id)) {
                    creep.memory.usingControllerContainer = true;
                } else {
                    creep.memory.usingControllerContainer = false;
                }
            } else {
                creep.memory.usingControllerContainer = false;
            }
            
            if (source.amount !== undefined) {
                actionResult = creep.pickup(source);
            } else if (source.energy !== undefined) {
                actionResult = creep.harvest(source);
            } else {
                actionResult = creep.withdraw(source, RESOURCE_ENERGY);
            }
            
            if (actionResult === ERR_NOT_IN_RANGE) {
                // Use cached position for movement
                const sourcePos = new RoomPosition(
                    creep.memory.sourcePos.x,
                    creep.memory.sourcePos.y,
                    creep.memory.sourcePos.roomName
                );
                movementManager.moveToTarget(creep, sourcePos, { 
                    reusePath: 15,
                    visualizePathStyle: {stroke: '#ffaa00'}
                });
            } else if (actionResult === OK) {
                // If we successfully withdrew from a controller container, indicate this
                if (creep.memory.usingControllerContainer) {
                    creep.say('⚡');
                }
            } else if (actionResult !== OK) {
                // If there was an error, clear the source and try again next tick
                delete creep.memory.energySourceId;
                delete creep.memory.sourcePos;
            }
        } else {
            // If no energy source found, move to controller area to wait
            if (creep.memory.controllerPos) {
                const waitPos = new RoomPosition(
                    creep.memory.controllerPos.x + 2,
                    creep.memory.controllerPos.y + 2,
                    creep.memory.controllerPos.roomName
                );
                movementManager.moveToTarget(creep, waitPos, { reusePath: 20 });
            }
        }
    }
};

module.exports = roleUpgrader;