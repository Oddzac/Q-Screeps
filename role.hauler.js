/**
 * Hauler Role - Energy transport
 * Optimized for CPU efficiency
 */
const movementManager = require('movementManager');

const roleHauler = {
    run: function(creep) {
        // Check if we need to move aside for other creeps
        movementManager.checkAndGiveWay(creep);
        
        // Check and clean up builder assignments if needed
        this.checkBuilderAssignments(creep);
        
        // State switching with minimal operations
        if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
            creep.memory.working = false;
            // Clear any builder assignments when empty
            if (creep.memory.assignedRequestId) {
                this.clearBuilderAssignment(creep);
            }
        } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
            // Pre-calculate target when switching to delivery mode
            this.findDeliveryTarget(creep);
        }
        
        // Execute current state
        if (creep.memory.working) {
            this.deliverResources(creep);
        } else {
            this.collectEnergy(creep);
        }
    },
    
    /**
     * Check and clean up builder assignments if needed
     * @param {Creep} creep - The hauler creep
     */
    checkBuilderAssignments: function(creep) {
        // If we have an assigned builder request, validate it
        if (creep.memory.assignedRequestId) {
            const builder = Game.getObjectById(creep.memory.assignedRequestId);
            const request = creep.room.memory.energyRequests && 
                           creep.room.memory.energyRequests[creep.memory.assignedRequestId];
            
            // Clear assignment if builder or request no longer exists
            if (!builder || !request) {
                this.clearBuilderAssignment(creep);
                return;
            }
            
            // Clear assignment if builder is full
            if (builder.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                this.clearBuilderAssignment(creep);
                return;
            }
            
            // Clear assignment if we're empty and not working
            if (!creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
                this.clearBuilderAssignment(creep);
                return;
            }
        }
    },
    
    /**
     * Clear a builder assignment
     * @param {Creep} creep - The hauler creep
     */
    clearBuilderAssignment: function(creep) {
        if (creep.memory.assignedRequestId && 
            creep.room.memory.energyRequests && 
            creep.room.memory.energyRequests[creep.memory.assignedRequestId]) {
            
            // Clear the hauler assignment from the request
            if (creep.room.memory.energyRequests[creep.memory.assignedRequestId].assignedHaulerId === creep.id) {
                delete creep.room.memory.energyRequests[creep.memory.assignedRequestId].assignedHaulerId;
            }
        }
        
        // Clear the assignment from the hauler's memory
        delete creep.memory.assignedRequestId;
    },
    
    findDeliveryTarget: function(creep) {
        const room = creep.room;
        const roomManager = require('roomManager');
        
        // Get cached energy targets from room manager
        const targets = roomManager.analyzeEnergyTargets(room);
        
        // First check if spawns or extensions need energy (highest priority)
        if (targets.spawnsAndExtensions.length > 0) {
            const closest = targets.spawnsAndExtensions.reduce((closest, structure) => {
                const distance = creep.pos.getRangeTo(structure);
                return !closest || distance < creep.pos.getRangeTo(closest) ? structure : closest;
            }, null);
            
            if (closest) {
                creep.memory.targetId = closest.id;
                return;
            }
        }
        
        // Check for builder energy requests (second priority)
        if (room.memory.energyRequests && Object.keys(room.memory.energyRequests).length > 0) {
            // Find the highest priority builder request we can fulfill in time
            let bestRequest = null;
            let bestScore = Infinity;
            
            for (const requestId in room.memory.energyRequests) {
                const request = room.memory.energyRequests[requestId];
                
                // Skip if already assigned to another hauler
                if (request.assignedHaulerId && request.assignedHaulerId !== creep.id) {
                    continue;
                }
                
                // Skip repair requests (they don't need energy delivery)
                if (request.task === 'repairing') {
                    continue;
                }
                
                const builder = Game.getObjectById(requestId);
                if (!builder) {
                    // Clean up invalid requests
                    delete room.memory.energyRequests[requestId];
                    continue;
                }
                
                // Calculate travel time to builder
                const distance = creep.pos.getRangeTo(builder);
                const travelTime = Math.ceil(distance / 2); // Assume 2 tiles per tick movement
                
                // Calculate request timeout (30 ticks from wait start)
                const waitTime = Game.time - (request.waitStartTime || request.timestamp);
                const timeUntilTimeout = 30 - waitTime;
                
                // Skip if we can't arrive before timeout
                if (travelTime >= timeUntilTimeout) {
                    continue;
                }
                
                // Calculate score (lower is better)
                const waitFactor = Math.max(0, 20 - waitTime) * 2;
                const score = request.priority + (distance * 0.5) - waitFactor;
                
                if (score < bestScore) {
                    bestScore = score;
                    bestRequest = request;
                }
            }
            
            // If we found a suitable request, assign ourselves to it
            if (bestRequest) {
                const builderId = Object.keys(room.memory.energyRequests).find(id => 
                    room.memory.energyRequests[id] === bestRequest);
                room.memory.energyRequests[builderId].assignedHaulerId = creep.id;
                creep.memory.assignedRequestId = builderId;
                creep.memory.targetId = builderId;
                return;
            }
        }
        

        
        // Towers (third priority)
        if (targets.towers.length > 0) {
            creep.memory.targetId = targets.towers[0].id;
            return;
        }
        
        // Controller container (fourth priority)
        if (targets.controllerContainers.length > 0) {
            // Make sure we're not trying to deliver to the same container we're withdrawing from
            if (creep.memory.sourceId !== targets.controllerContainers[0].id) {
                creep.memory.targetId = targets.controllerContainers[0].id;
                return;
            }
        }
        
        // Storage (fifth priority)
        if (targets.storage) {
            // Make sure we're not trying to deliver to the same storage we're withdrawing from
            if (creep.memory.sourceId !== targets.storage.id) {
                creep.memory.targetId = targets.storage.id;
                return;
            }
        }
        
        // Controller as fallback
        creep.memory.targetId = room.controller.id;
    },
    
    deliverResources: function(creep) {
        // Handle non-energy resources first
        const nonEnergyResources = Object.keys(creep.store).filter(r => r !== RESOURCE_ENERGY && creep.store[r] > 0);
        if (nonEnergyResources.length > 0) {
            this.deliverNonEnergyResources(creep, nonEnergyResources[0]);
            return;
        }
        // Check if we're assigned to a builder request
        if (creep.memory.assignedRequestId) {
            const builder = Game.getObjectById(creep.memory.assignedRequestId);
            const request = creep.room.memory.energyRequests && 
                           creep.room.memory.energyRequests[creep.memory.assignedRequestId];
            
            // Validate builder and request still exist
            if (!builder || !request) {
                delete creep.memory.assignedRequestId;
                delete creep.memory.targetId;
                this.findDeliveryTarget(creep);
                return;
            }
            
            // Check if builder still needs energy
            if (builder.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                // Builder is full, clear request and find new target
                delete creep.room.memory.energyRequests[creep.memory.assignedRequestId];
                delete creep.memory.assignedRequestId;
                delete creep.memory.targetId;
                this.findDeliveryTarget(creep);
                return;
            }
            
            // If builder has a target site, try to meet them there
            let meetingPoint = null;
            if (request.targetSite) {
                const site = Game.getObjectById(request.targetSite.id);
                if (site) {
                    meetingPoint = site.pos;
                }
            }
            
            // If no meeting point, use builder's position
            if (!meetingPoint) {
                meetingPoint = builder.pos;
            }
            
            // If we're adjacent to the builder, transfer energy
            if (creep.pos.isNearTo(builder)) {
                const result = creep.transfer(builder, RESOURCE_ENERGY);
                if (result === OK) {
                    // Successfully delivered energy
                    creep.say('🔋');
                    
                    // Clear assignment if builder is now full
                    if (builder.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                        delete creep.room.memory.energyRequests[creep.memory.assignedRequestId];
                    } else {
                        // Just clear our assignment but leave request for others
                        delete creep.room.memory.energyRequests[creep.memory.assignedRequestId].assignedHaulerId;
                    }
                    
                    delete creep.memory.assignedRequestId;
                    delete creep.memory.targetId;
                }
            } else {
                // Move to the builder or meeting point
                movementManager.moveToTarget(creep, meetingPoint, { 
                    reusePath: 10,
                    visualizePathStyle: {stroke: '#ffaa00'}
                });
                creep.say('🚚');
            }
            
            return;
        }
        
        // Regular energy delivery logic
        let target = creep.memory.targetId ? Game.getObjectById(creep.memory.targetId) : null;
        
        // Validate target still needs energy
        if (!target || (target.store && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0)) {
            this.findDeliveryTarget(creep);
            target = creep.memory.targetId ? Game.getObjectById(creep.memory.targetId) : null;
        }
        
        if (target) {
            // Handle controller separately
            if (target.structureType === STRUCTURE_CONTROLLER) {
                // Check for builder requests every tick when working with controller
                if (creep.room.memory.energyRequests && 
                    Object.keys(creep.room.memory.energyRequests).length > 0) {
                    // If there are builder requests, prioritize them over controller
                    delete creep.memory.targetId;
                    this.findDeliveryTarget(creep);
                    return;
                }
                
                if (creep.upgradeController(target) === ERR_NOT_IN_RANGE) {
                    movementManager.moveToTarget(creep, target, { 
                        reusePath: 10,
                        visualizePathStyle: {stroke: '#ffffff'}
                    });
                }
            } else {
                // Transfer energy to structure
                if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    movementManager.moveToTarget(creep, target, { 
                        reusePath: 10,
                        visualizePathStyle: {stroke: '#ffffff'}
                    });
                }
            }
        }
    },
    
    collectEnergy: function(creep) {
        // Check for non-energy resources first (higher priority)
        const nonEnergySource = this.findNonEnergyResources(creep);
        if (nonEnergySource) {
            this.collectNonEnergyResources(creep, nonEnergySource);
            return;
        }
        
        // Use cached source if available and still valid
        let source = creep.memory.sourceId ? Game.getObjectById(creep.memory.sourceId) : null;
        
        // Validate source still has energy
        if (!source || 
            (source.amount !== undefined && source.amount < 50) || 
            (source.store && source.store[RESOURCE_ENERGY] === 0)) {
            source = null;
            creep.memory.sourceId = null;
        }
        
        if (!source) {
            // Get cached energy sources from room manager
            const roomManager = require('roomManager');
            const sources = roomManager.analyzeEnergySources(creep.room);
            
            // Create prioritized list of sources
            const allSources = [];
            
            // Add sources in priority order: Dropped > Tombstones > Containers > Storage
            allSources.push(...sources.droppedResources);
            allSources.push(...sources.tombstones);
            allSources.push(...sources.sourceContainers);
            allSources.push(...sources.otherContainers);
            // Storage is lowest priority and only if it has surplus
            if (sources.storage && sources.storage.store[RESOURCE_ENERGY] > 100) {
                allSources.push(sources.storage);
            }
        
            if (allSources.length > 0) {
                // Find closest source of highest priority
                let bestSource = null;
                let bestScore = Infinity;
                
                for (const s of allSources) {
                    // Skip controller containers - they should never be energy sources for haulers
                    if (s.structureType === STRUCTURE_CONTAINER && 
                        sources.containerTypes && 
                        sources.containerTypes.controller.includes(s.id)) {
                        continue;
                    }
                    
                    // Calculate priority score (lower is better)
                    let typeScore;
                    
                    // Priority: Dropped > Tombstone > Source Container > Other Container > Storage
                    if (s.amount !== undefined) typeScore = 0; // Dropped resource
                    else if (s.store && !s.structureType) typeScore = 1; // Tombstone
                    else if (sources.sourceContainers.includes(s)) typeScore = 2; // Source container
                    else if (sources.otherContainers.includes(s)) typeScore = 3; // Other container
                    else typeScore = 4; // Storage
                    
                    // Factor in distance (less important than type)
                    const distance = creep.pos.getRangeTo(s);
                    const score = (typeScore * 100) + distance;
                    
                    if (score < bestScore) {
                        bestScore = score;
                        bestSource = s;
                    }
                }
                
                if (bestSource) {
                    source = bestSource;
                    creep.memory.sourceId = bestSource.id;
                }
            }
        }
        
        // Double-check that we're not using a controller container as a source
        if (source && source.structureType === STRUCTURE_CONTAINER) {
            const roomManager = require('roomManager');
            const sources = roomManager.analyzeEnergySources(creep.room);
            if (sources.containerTypes && sources.containerTypes.controller.includes(source.id)) {
                // We've selected a controller container - clear it and try again next tick
                creep.memory.sourceId = null;
                return;
            }
        }
        
        if (source) {
            // Interact with the source based on its type
            let actionResult;
            
            if (source.amount !== undefined) {
                actionResult = creep.pickup(source);
            } else {
                actionResult = creep.withdraw(source, RESOURCE_ENERGY);
            }
            
            if (actionResult === ERR_NOT_IN_RANGE) {
                movementManager.moveToTarget(creep, source, { reusePath: 10 });
            }
        } else {
            // If no energy sources, wait near spawn
            const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
            if (spawn) {
                movementManager.moveToTarget(creep, spawn, { range: 3, reusePath: 20 });
            }
        }
    },
    
    /**
     * Find non-energy resources in dropped resources, tombstones and containers
     * @param {Creep} creep - The hauler creep
     * @returns {Object|null} - Source with non-energy resources or null
     */
    findNonEnergyResources: function(creep) {
        // Find dropped non-energy resources (highest priority)
        const droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType !== RESOURCE_ENERGY && r.amount > 0
        });
        
        // Find tombstones with non-energy resources
        const tombstones = creep.room.find(FIND_TOMBSTONES, {
            filter: t => {
                for (const resourceType in t.store) {
                    if (resourceType !== RESOURCE_ENERGY && t.store[resourceType] > 0) {
                        return true;
                    }
                }
                return false;
            }
        });
        
        // Find containers with non-energy resources
        const containers = creep.room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && 
                      Object.keys(s.store).some(r => r !== RESOURCE_ENERGY && s.store[r] > 0)
        });
        
        // Combine in priority order: dropped > tombstones > containers
        const allSources = [...droppedResources, ...tombstones, ...containers];
        if (allSources.length > 0) {
            return creep.pos.findClosestByRange(allSources);
        }
        
        return null;
    },
    
    /**
     * Collect non-energy resources from source
     * @param {Creep} creep - The hauler creep
     * @param {Object} source - The source to collect from
     */
    collectNonEnergyResources: function(creep, source) {
        // Find the first non-energy resource type
        let resourceType = null;
        for (const type in source.store) {
            if (type !== RESOURCE_ENERGY && source.store[type] > 0) {
                resourceType = type;
                break;
            }
        }
        
        if (resourceType) {
            const result = creep.withdraw(source, resourceType);
            if (result === ERR_NOT_IN_RANGE) {
                movementManager.moveToTarget(creep, source, { reusePath: 10 });
                creep.say('🔍');
            } else if (result === OK) {
                creep.say('📦');
            }
        }
    },
    
    /**
     * Deliver non-energy resources to storage or terminal
     * @param {Creep} creep - The hauler creep
     * @param {string} resourceType - The resource type to deliver
     */
    deliverNonEnergyResources: function(creep, resourceType) {
        // Priority: Storage > Terminal > Controller (drop)
        let target = creep.room.storage;
        
        if (!target || target.store.getFreeCapacity() === 0) {
            target = creep.room.terminal;
        }
        
        if (!target || target.store.getFreeCapacity() === 0) {
            // Drop near controller as last resort
            target = creep.room.controller;
        }
        
        if (target) {
            let result;
            if (target.structureType === STRUCTURE_CONTROLLER) {
                // Drop the resource near controller
                result = creep.drop(resourceType);
                if (result === OK) {
                    creep.say('📤');
                }
            } else {
                // Transfer to storage/terminal
                result = creep.transfer(target, resourceType);
                if (result === ERR_NOT_IN_RANGE) {
                    movementManager.moveToTarget(creep, target, { reusePath: 10 });
                    creep.say('📦');
                } else if (result === OK) {
                    creep.say('📥');
                }
            }
        }
    }
};

module.exports = roleHauler;