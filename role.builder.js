/**
 * Builder Role - Construction and repair
 * CPU optimized for maximum efficiency
 */
const movementManager = require('movementManager');

const roleBuilder = {
    /**
     * Run the builder role
     * @param {Creep} creep - The creep to run the role for
     */
    run: function(creep) {
        // Check if we need to move aside for other creeps
        movementManager.checkAndGiveWay(creep);
        
        // Initialize building state if not set
        if (creep.memory.building === undefined) {
            creep.memory.building = false;
        }
        
        // Assign task based on room needs
        if (!creep.memory.task) {
            this.assignTask(creep);
        }
        
        // State switching with minimal operations
        if (creep.memory.building && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.building = false;
            creep.say('🔄');
            // Clear target cache when switching states
            delete creep.memory.targetId;
            delete creep.memory.targetPos;
            // Reset harvesting flags to ensure wait timer starts fresh
            delete creep.memory.harvestingStarted;
            delete creep.memory.waitStartTime;
            // Register energy request when switching to harvesting (but not for repair tasks)
            if (creep.memory.task !== 'repairing') {
                this.registerEnergyRequest(creep);
            }
        }
        if (!creep.memory.building && creep.store.getFreeCapacity() === 0) {
            creep.memory.building = true;
            creep.say('🚧');
            // Clear target cache when switching states
            delete creep.memory.energySourceId;
            delete creep.memory.sourcePos;
            delete creep.memory.harvestingStarted; // Reset harvesting flag
            delete creep.memory.waitStartTime; // Reset wait timer
            // Clear energy request when switching to building
            this.clearEnergyRequest(creep);
        }
        
        // Register energy request if below 70% capacity while building (but not repairing)
        if (creep.memory.building && creep.memory.task !== 'repairing' &&
            creep.store[RESOURCE_ENERGY] < creep.store.getCapacity() * 0.70) {
            this.registerEnergyRequest(creep);
        }
        
        if (creep.memory.building) {
            this.performTask(creep);
        } else {
            // Skip waiting for repairers since they don't generate energy requests
            if (creep.memory.task === 'repairing') {
                this.getEnergy(creep);
            } else {
                // When switching to harvesting mode, set a wait timer (only if not already harvesting)
                if (!creep.memory.waitStartTime && !creep.memory.harvestingStarted && creep.store[RESOURCE_ENERGY] === 0) {
                    creep.memory.waitStartTime = Game.time;
                    creep.say('⏳');
                }
                
                // Wait for haulers for 30 ticks before harvesting
                if (creep.memory.waitStartTime && Game.time - creep.memory.waitStartTime < 30) {
                    // Just wait in place
                    creep.say('⏳' + (30 - (Game.time - creep.memory.waitStartTime)));
                } else {
                    // Clear wait timer and proceed with harvesting
                    delete creep.memory.waitStartTime;
                    creep.memory.harvestingStarted = true; // Flag to prevent restarting the wait timer
                    this.getEnergy(creep);
                }
            }
        }
    },
    
    /**
     * Perform assigned task
     * @param {Creep} creep - The creep to perform task
     */
    performTask: function(creep) {
        // Check for higher priority tasks every 10 ticks
        if (Game.time % 10 === 0) {
            this.checkForBetterTask(creep);
        }
        
        // Clear target if we don't have one or if it's invalid
        if (!this.validateTarget(creep)) {
            delete creep.memory.targetId;
            delete creep.memory.targetPos;
        }
        
        // Find a target if we don't have one
        if (!creep.memory.targetId) {
            const target = this.findTarget(creep);
            if (target) {
                creep.memory.targetId = target.id;
                creep.memory.targetPos = {
                    x: target.pos.x,
                    y: target.pos.y,
                    roomName: target.pos.roomName
                };
            }
        }
        
        // Get the current target
        const target = creep.memory.targetId ? Game.getObjectById(creep.memory.targetId) : null;
        if (!target) return;
        
        // Perform action based on target type
        let actionResult;
        
        try {
            
            // Controller
            if (target.structureType === STRUCTURE_CONTROLLER) {
                actionResult = creep.upgradeController(target);
                creep.say('⚡');
            }
            // Construction site
            else if (target.progressTotal !== undefined) {
                actionResult = creep.build(target);
                creep.say('🏗️');
            }
            // Repair target
            else if (target.hits !== undefined && target.hitsMax !== undefined) {
                actionResult = creep.repair(target);
                creep.say('🔧');
            }
             
            
            // Reset error count on success
            if (actionResult === OK) {
                delete creep.memory.errorCount;
            }
            // Handle movement
            else if (actionResult === ERR_NOT_IN_RANGE) {
                // Special handling for controller
                if (target.structureType === STRUCTURE_CONTROLLER) {
                    const controllerContainer = this.findControllerContainer(creep);
                    if (controllerContainer) {
                        const targetPos = this.findOptimalUpgradePosition(creep, controllerContainer);
                        movementManager.moveToTarget(creep, targetPos, { 
                            reusePath: 20,
                            visualizePathStyle: {stroke: '#ffffff'}
                        });
                    } else {
                        movementManager.moveToTarget(creep, target, { 
                            reusePath: 20,
                            visualizePathStyle: {stroke: '#ffffff'}
                        });
                    }
                } else {
                    // Standard movement for other targets
                    movementManager.moveToTarget(creep, target, { 
                        reusePath: 10,
                        visualizePathStyle: {stroke: '#3333ff'}
                    });
                }
            }
            // Handle errors
            else if (actionResult === ERR_INVALID_TARGET) {
                creep.memory.errorCount = (creep.memory.errorCount || 0) + 1;
                console.log(`${creep.name} has invalid target (${target.id}), error #${creep.memory.errorCount}`);
                
                if (creep.memory.errorCount >= 2) {
                    delete creep.memory.targetId;
                    delete creep.memory.targetPos;
                    delete creep.memory.errorCount;
                }
            }
        } catch (e) {
            console.log(`${creep.name} exception: ${e}`);
            delete creep.memory.targetId;
            delete creep.memory.targetPos;
        }
    },
    
    /**
     * Check if current target is valid
     * @param {Creep} creep - The creep to check
     * @returns {boolean} - Whether the target is valid
     */
    validateTarget: function(creep) {
        const target = creep.memory.targetId ? Game.getObjectById(creep.memory.targetId) : null;
        if (!target) return false;
        
        // Construction site
        if (target.progressTotal !== undefined) {
            return target.progress < target.progressTotal;
        }
        // Controller
        else if (target.structureType === STRUCTURE_CONTROLLER) {
            return target.my;
        }
        // Repair target
        else if (target.hits !== undefined && target.hitsMax !== undefined) {
            return target.hits < target.hitsMax;
        }
        
        return false;
    },
    
    /**
     * Check for better tasks and switch if needed
     * @param {Creep} creep - The creep to check
     */
    checkForBetterTask: function(creep) {
        // Find repair targets
        const repairTargets = creep.room.find(FIND_STRUCTURES, {
            filter: s => s.hits < s.hitsMax * 0.8 && 
                      (s.structureType === STRUCTURE_CONTAINER || 
                       s.structureType === STRUCTURE_SPAWN ||
                       s.structureType === STRUCTURE_EXTENSION ||
                       s.structureType === STRUCTURE_TOWER ||
                       s.structureType === STRUCTURE_ROAD)
        });
        
        // Find construction sites
        const constructionSites = creep.room.find(FIND_CONSTRUCTION_SITES);
        
        // Determine best task based on role and available targets
        let bestTask = 'upgrading'; // Default
        
        if (creep.memory.isRepairer) {
            // Repairer priority: Repair > Construction > Upgrade
            if (repairTargets.length > 0) {
                bestTask = 'repairing';
            } else if (constructionSites.length > 0) {
                bestTask = 'building';
            }
        } else {
            // Builder priority: Construction > Upgrade
            if (constructionSites.length > 0) {
                bestTask = 'building';
            }
        }
        
        // Switch task if needed
        if (bestTask !== creep.memory.task) {
            console.log(`${creep.name} switching from ${creep.memory.task || 'none'} to ${bestTask}`);
            creep.memory.task = bestTask;
            delete creep.memory.targetId;
            delete creep.memory.targetPos;
        }
    },
    
    /**
     * Find a target based on current task
     * @param {Creep} creep - The creep to find a target for
     * @returns {Object} - The target
     */
    findTarget: function(creep) {
        if (creep.memory.task === 'repairing') {
            // Find repair targets
            const repairTargets = creep.room.find(FIND_STRUCTURES, {
                filter: s => s.hits < s.hitsMax * 0.8 && 
                          (s.structureType === STRUCTURE_CONTAINER || 
                           s.structureType === STRUCTURE_SPAWN ||
                           s.structureType === STRUCTURE_EXTENSION ||
                           s.structureType === STRUCTURE_TOWER ||
                           s.structureType === STRUCTURE_ROAD)
            });
            
            if (repairTargets.length > 0) {
                return creep.pos.findClosestByRange(repairTargets);
            }
        }
        
        if (creep.memory.task === 'building' || (creep.memory.task === 'repairing' && !creep.memory.isRepairer)) {
            // Find construction sites
            const constructionSites = creep.room.find(FIND_CONSTRUCTION_SITES);
            if (constructionSites.length > 0) {
                return creep.pos.findClosestByRange(constructionSites);
            }
        }
        
        // Default to controller
        creep.memory.task = 'upgrading';
        return creep.room.controller;
    },
    
    /**
     * Assign task based on room needs and creep specialization
     * @param {Creep} creep - The creep to assign task to
     */
    assignTask: function(creep) {
        // Assign repair role if not set
        if (creep.memory.isRepairer === undefined) {
            const builders = creep.room.find(FIND_MY_CREEPS, {
                filter: c => c.memory.role === 'builder'
            });
            const existingRepairer = builders.find(b => b.memory.isRepairer === true);
            creep.memory.isRepairer = !existingRepairer;
        }
        
        // Find repair targets
        const repairTargets = creep.room.find(FIND_STRUCTURES, {
            filter: s => s.hits < s.hitsMax * 0.8 && 
                      (s.structureType === STRUCTURE_CONTAINER || 
                       s.structureType === STRUCTURE_SPAWN ||
                       s.structureType === STRUCTURE_EXTENSION ||
                       s.structureType === STRUCTURE_TOWER ||
                       s.structureType === STRUCTURE_ROAD)
        });
        
        // Find construction sites
        const constructionSites = creep.room.find(FIND_CONSTRUCTION_SITES);
        
        // Task assignment logic
        if (creep.memory.isRepairer && repairTargets.length > 0) {
            creep.memory.task = 'repairing';
        } else if (constructionSites.length > 0) {
            creep.memory.task = 'building';
        } else if (repairTargets.length > 0) {
            creep.memory.task = 'repairing';
        } else {
            creep.memory.task = 'upgrading';
        }
    },
    

    
    /**
     * Check if a repairer should help with critical construction
     * @param {Creep} creep - The repairer creep
     * @returns {boolean} - Whether the repairer should help with construction
     */
    /**
     * Check if a repairer is in upgrading mode
     * @param {Creep} creep - The repairer creep
     * @returns {boolean} - Whether the repairer is in upgrading mode
     */
    isRepairerUpgrading: function(creep) {
        return creep.memory.task === 'upgrading' && 
               creep.memory.targetId === creep.room.controller.id;
    },
    
    shouldRepairerHelpConstruct: function(creep) {
        // If repairer is in forced upgrading mode, don't help with construction
        if (this.isRepairerUpgrading(creep)) {
            return false;
        }
        
        // Only check occasionally to save CPU
        if (!creep.memory.lastConstructCheck || Game.time - creep.memory.lastConstructCheck > 50) {
            creep.memory.lastConstructCheck = Game.time;
            
            // Check for critical repair needs first
            const criticalRepairs = creep.room.find(FIND_STRUCTURES, {
                filter: s => s.hits < s.hitsMax * 0.3 && // Severely damaged
                          (s.structureType === STRUCTURE_SPAWN ||
                           s.structureType === STRUCTURE_TOWER ||
                           s.structureType === STRUCTURE_CONTAINER)
            });
            
            // If there are critical repairs, don't help with construction
            if (criticalRepairs.length > 0) {
                creep.memory.helpConstruction = false;
                return false;
            }
            
            // Check for critical construction sites
            const criticalSites = creep.room.find(FIND_CONSTRUCTION_SITES, {
                filter: site => site.structureType === STRUCTURE_SPAWN || 
                              site.structureType === STRUCTURE_EXTENSION ||
                              site.structureType === STRUCTURE_TOWER
            });
            
            // If there are critical sites, help with construction
            if (criticalSites.length > 0) {
                creep.memory.helpConstruction = true;
                return true;
            }
            
            // Default to not helping with construction
            creep.memory.helpConstruction = false;
        }
        
        // Return cached result
        return creep.memory.helpConstruction === true;
    },
    
    /**
     * Find target based on current task
     * @param {Creep} creep - The creep to find a target for
     * @returns {Object} - The target object
     */
    findTaskTarget: function(creep) {
        if (creep.memory.task === 'repairing') {
            return this.findRepairTarget(creep);
        } else if (creep.memory.task === 'building') {
            return this.findConstructionTarget(creep);
        } else {
            return creep.room.controller;
        }
    },
    
    /**
     * Find construction target using cached data
     * @param {Creep} creep - The creep to find a target for
     * @returns {Object} - The target object
     */
    findConstructionTarget: function(creep) {
        const roomManager = require('roomManager');
        const constructionSiteIds = roomManager.getRoomData(creep.room.name, 'constructionSiteIds');
        
        // If we have cached construction site IDs, try to find a valid one
        if (constructionSiteIds && constructionSiteIds.length > 0) {
            // Keep track of invalid IDs to report back to room manager
            const invalidIds = [];
            
            for (const id of constructionSiteIds) {
                // Skip the site if it was previously causing errors
                if (creep.memory.errorCount && creep.memory.targetId === id) {
                    continue;
                }
                
                const site = Game.getObjectById(id);
                if (site && site.progressTotal !== undefined && site.progress < site.progressTotal) {
                    return site;
                } else {
                    // Track invalid IDs
                    invalidIds.push(id);
                }
            }
            
            // If we found invalid IDs, try to update the room manager's cache
            if (invalidIds.length > 0 && creep.room.memory.constructionSiteIds) {
                // Remove invalid IDs from room memory
                creep.room.memory.constructionSiteIds = creep.room.memory.constructionSiteIds
                    .filter(id => !invalidIds.includes(id));
                
                // If we've removed all IDs, force a refresh of construction sites
                if (creep.room.memory.constructionSiteIds.length === 0) {
                    // Find actual construction sites in the room
                    const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
                    if (sites.length > 0) {
                        creep.room.memory.constructionSiteIds = sites.map(s => s.id);
                        creep.room.memory.constructionSites = sites.length;
                        
                        // Return the first valid site
                        return sites[0];
                    }
                }
            }
        } else {
            // If no cached IDs, do a direct search
            const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
            if (sites.length > 0) {
                // Update room memory with fresh data
                creep.room.memory.constructionSiteIds = sites.map(s => s.id);
                creep.room.memory.constructionSites = sites.length;
                return sites[0];
            }
        }
        
        // If no valid construction sites found, default to controller
        return creep.room.controller;
    },
    
    /**
     * Find repair target using cached data
     * @param {Creep} creep - The creep to find a target for
     * @returns {Object} - The target object
     */
    findRepairTarget: function(creep) {
        // Use cached repair targets from room memory
        if (creep.room.memory.repairTargets && creep.room.memory.repairTargets.length > 0) {
            // Keep track of invalid IDs
            const invalidIds = [];
            
            for (const id of creep.room.memory.repairTargets) {
                // Skip the target if it was previously causing errors
                if (creep.memory.errorCount && creep.memory.targetId === id) {
                    continue;
                }
                
                const structure = Game.getObjectById(id);
                if (structure && structure.hits !== undefined && structure.hitsMax !== undefined && structure.hits < structure.hitsMax) {
                    return structure;
                } else {
                    // Track invalid IDs
                    invalidIds.push(id);
                }
            }
            
            // If we found invalid IDs, update the repair targets list
            if (invalidIds.length > 0) {
                creep.room.memory.repairTargets = creep.room.memory.repairTargets
                    .filter(id => !invalidIds.includes(id));
                
                // If we've removed all targets, refresh the repair targets list
                if (creep.room.memory.repairTargets.length === 0) {
                    const roomManager = require('roomManager');
                    roomManager.analyzeRepairTargets(creep.room);
                    
                    // Try again with the refreshed list
                    if (creep.room.memory.repairTargets && creep.room.memory.repairTargets.length > 0) {
                        const structure = Game.getObjectById(creep.room.memory.repairTargets[0]);
                        if (structure) return structure;
                    }
                }
            }
        }
        
        // If no valid repair targets found, default to controller
        return creep.room.controller;
    },
    
    /**
     * Find a build or repair target (legacy method)
     * @param {Creep} creep - The creep to find a target for
     * @returns {Object} - The target object
     */
    findBuildTarget: function(creep) {
        const roomManager = require('roomManager');
        let target = null;
        
        // If this is a repairer, look for repair targets first
        if (creep.memory.isRepairer === true) {
            // Look for repair targets
            const repairTargets = creep.room.find(FIND_STRUCTURES, {
                filter: s => s.hits < s.hitsMax * 0.8 && 
                          (s.structureType === STRUCTURE_CONTAINER || 
                           s.structureType === STRUCTURE_SPAWN ||
                           s.structureType === STRUCTURE_EXTENSION ||
                           s.structureType === STRUCTURE_TOWER ||
                           s.structureType === STRUCTURE_ROAD)
            });
            
            if (repairTargets.length > 0) {
                return this.findClosestByRange(creep, repairTargets);
            }
            
            // If no repair targets, check for critical construction sites
            const criticalSites = creep.room.find(FIND_CONSTRUCTION_SITES, {
                filter: site => site.structureType === STRUCTURE_SPAWN || 
                              site.structureType === STRUCTURE_EXTENSION ||
                              site.structureType === STRUCTURE_TOWER
            });
            
            if (criticalSites.length > 0) {
                return this.findClosestByRange(creep, criticalSites);
            }
            
            // If no critical sites, check for any construction sites
            const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
            if (sites.length > 0) {
                return this.findClosestByRange(creep, sites);
            }
            
            // If nothing to repair or build, find a spawn to move to
            const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
            if (spawn) {
                return spawn;
            }
            
            // Last resort - return controller
            return creep.room.controller;
        }
        
        // For builders, prioritize construction sites
        const constructionSiteIds = roomManager.getRoomData(creep.room.name, 'constructionSiteIds');
        
        // Check if there are construction sites
        if (constructionSiteIds && constructionSiteIds.length > 0) {
            // Convert IDs to actual objects
            const sites = [];
            for (const id of constructionSiteIds) {
                const site = Game.getObjectById(id);
                if (site && site.progress < site.progressTotal) {
                    sites.push(site);
                }
            }
            
            if (sites.length > 0) {
                // Prioritize certain structure types (containers before roads)
                const priorityOrder = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_CONTAINER, STRUCTURE_ROAD];
                
                // Sort sites by priority
                sites.sort((a, b) => {
                    const aPriority = priorityOrder.indexOf(a.structureType);
                    const bPriority = priorityOrder.indexOf(b.structureType);
                    
                    // If both have a priority, use it
                    if (aPriority !== -1 && bPriority !== -1) {
                        return aPriority - bPriority;
                    }
                    
                    // If only one has a priority, it comes first
                    if (aPriority !== -1) return -1;
                    if (bPriority !== -1) return 1;
                    
                    // Otherwise, sort by progress (prefer more complete structures)
                    return (b.progress / b.progressTotal) - (a.progress / a.progressTotal);
                });
                
                // Take the highest priority site that's closest
                const highestPriority = sites[0].structureType;
                const highPrioritySites = sites.filter(s => s.structureType === highestPriority);
                
                target = creep.pos.findClosestByRange(highPrioritySites);
                
                if (target) {
                    console.log(`Builder ${creep.name} found ${target.structureType} construction site at ${target.pos.x},${target.pos.y}`);
                    return target;
                }
            } else {
                // If we had IDs but no valid sites, update the room manager
                if (creep.room.memory.constructionSiteIds) {
                    creep.room.memory.constructionSiteIds = [];
                    creep.room.memory.constructionSites = 0;
                }
            }
        }
        
        // If no construction sites, default to controller
        return creep.room.controller;
    },
    
    /**
     * Find a repair target
     * @param {Creep} creep - The creep to find a repair target for
     * @returns {Object} - The repair target or fallback target
     */
    findRepairTarget: function(creep) {
        // Prioritize critical structures (containers over roads)
        const repairTargets = creep.room.find(FIND_STRUCTURES, {
            filter: s => s.hits < s.hitsMax * 0.5 && // Only repair if below 50%
                      s.hits < 10000 && // Don't repair walls/ramparts beyond this in early game
                      (s.structureType === STRUCTURE_CONTAINER || 
                       s.structureType === STRUCTURE_SPAWN ||
                       s.structureType === STRUCTURE_EXTENSION ||
                       s.structureType === STRUCTURE_TOWER ||
                       s.structureType === STRUCTURE_ROAD)
        });
        
        // Sort repair targets to prioritize containers over roads
        if (repairTargets.length > 0) {
            repairTargets.sort((a, b) => {
                // Prioritize by structure type
                const typeOrder = {
                    [STRUCTURE_SPAWN]: 1,
                    [STRUCTURE_EXTENSION]: 2,
                    [STRUCTURE_TOWER]: 3,
                    [STRUCTURE_CONTAINER]: 4,
                    [STRUCTURE_ROAD]: 5
                };
                
                const aOrder = typeOrder[a.structureType] || 6;
                const bOrder = typeOrder[b.structureType] || 6;
                
                if (aOrder !== bOrder) {
                    return aOrder - bOrder;
                }
                
                // If same type, prioritize by damage percentage
                return (a.hits / a.hitsMax) - (b.hits / b.hitsMax);
            });
            
            return this.findClosestByRange(creep, repairTargets);
        }
        
        // If no repair targets, check for any structures that need any repair at all
        const minorRepairTargets = creep.room.find(FIND_STRUCTURES, {
            filter: s => s.hits < s.hitsMax && // Any damage at all
                      (s.structureType === STRUCTURE_CONTAINER || 
                       s.structureType === STRUCTURE_SPAWN ||
                       s.structureType === STRUCTURE_EXTENSION ||
                       s.structureType === STRUCTURE_TOWER ||
                       s.structureType === STRUCTURE_ROAD)
        });
        
        if (minorRepairTargets.length > 0) {
            return this.findClosestByRange(creep, minorRepairTargets);
        }
        
        // If no structures need repair, check for construction sites
        const constructionSites = creep.room.find(FIND_CONSTRUCTION_SITES);
        if (constructionSites.length > 0) {
            // Help with construction if no repairs needed
            creep.say('🏗️');
            
            // Prioritize critical structures
            const priorityOrder = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_CONTAINER, STRUCTURE_ROAD];
            
            // Sort sites by priority
            constructionSites.sort((a, b) => {
                const aPriority = priorityOrder.indexOf(a.structureType);
                const bPriority = priorityOrder.indexOf(b.structureType);
                
                if (aPriority !== -1 && bPriority !== -1) {
                    return aPriority - bPriority;
                }
                
                if (aPriority !== -1) return -1;
                if (bPriority !== -1) return 1;
                
                return 0;
            });
            
            return constructionSites[0];
        }
        
        // If no repair targets and no construction sites, check for walls/ramparts to fortify
        // But only if we have enough energy in storage to spare
        if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 10000) {
            const fortifyTargets = creep.room.find(FIND_STRUCTURES, {
                filter: s => (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) &&
                          s.hits < 50000 // Cap at 50k hits in early game
            });
            
            if (fortifyTargets.length > 0) {
                // Sort by lowest hits
                fortifyTargets.sort((a, b) => a.hits - b.hits);
                creep.say('🧱');
                return fortifyTargets[0];
            }
        }
        
        // If nothing to repair or build, default to controller
        return creep.room.controller;
    },
    
    /**
     * Find closest object by range (CPU efficient)
     * @param {Creep} creep - The creep to measure distance from
     * @param {Array} objects - Array of objects to check
     * @returns {Object} - The closest object
     */
    findClosestByRange: function(creep, objects) {
        if (!objects.length) return null;
        
        let closest = objects[0];
        let minDistance = creep.pos.getRangeTo(closest);
        
        for (let i = 1; i < objects.length; i++) {
            const distance = creep.pos.getRangeTo(objects[i]);
            if (distance < minDistance) {
                closest = objects[i];
                minDistance = distance;
            }
        }
        
        return closest;
    },
    
    /**
     * Get energy from the most efficient source
     * @param {Creep} creep - The creep to get energy for
     */
    getEnergy: function(creep) {
        // Use cached energy source if available
        let source = creep.memory.energySourceId ? Game.getObjectById(creep.memory.energySourceId) : null;
        
        // Validate source still has energy
        if (source) {
            if ((source.amount !== undefined && source.amount < 50) || 
                (source.store && source.store[RESOURCE_ENERGY] === 0)) {
                source = null;
                delete creep.memory.energySourceId;
                delete creep.memory.sourcePos;
                delete creep.memory.energySourceType;
                // Force immediate search for new source
                creep.memory.lastSourceSearch = 0;
            }
        }
        
        // Find new energy source if needed
        if (!source) {
            source = this.findEnergySource(creep);
        }
        
        // Interact with the source if found
        if (source) {
            this.harvestEnergySource(creep, source);
        } else {
            // If no energy source found, move to a waiting area near spawn
            const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
            if (spawn) {
                movementManager.moveToTarget(creep, spawn, { range: 3, reusePath: 20 });
                creep.say('🔍');
            }
        }
    },
    
    /**
     * Find an energy source
     * @param {Creep} creep - The creep to find a source for
     * @returns {Object} - The energy source
     */
    findEnergySource: function(creep) {
        const roomManager = require('roomManager');
        let source = null;
        
        // Only search for new sources periodically to save CPU
        if (!creep.memory.lastSourceSearch || Game.time - creep.memory.lastSourceSearch > 10) {
            creep.memory.lastSourceSearch = Game.time;
            
            // Priority 1: Storage (if it has enough energy)
            if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
                source = creep.room.storage;
                creep.memory.energySourceId = source.id;
                creep.memory.energySourceType = 'storage';
                return source;
            }
            
            // Priority 2: Containers with weighted scoring (energy amount vs distance)
            const containers = creep.room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && 
                          s.store[RESOURCE_ENERGY] > Math.min(creep.store.getFreeCapacity() / 2, 100)
            });
            
            if (containers.length > 0) {
                // Use all containers - builders should use any available container
                const usableContainers = containers;
                
                if (usableContainers.length > 0) {
                    // Score containers based on energy amount and distance
                    let bestContainer = null;
                    let bestScore = -Infinity;
                    
                    for (const container of usableContainers) {
                        const distance = creep.pos.getRangeTo(container);
                        const energy = container.store[RESOURCE_ENERGY];
                        
                        // Score formula: energy amount is more important than distance
                        // Higher score is better
                        const score = energy - (distance * 10);
                        
                        if (score > bestScore) {
                            bestScore = score;
                            bestContainer = container;
                        }
                    }
                    
                    if (bestContainer) {
                        source = bestContainer;
                        creep.memory.energySourceId = source.id;
                        creep.memory.energySourceType = 'container';
                        return source;
                    }
                }
            }
            
            // Priority 3: Dropped resources with significant amount
            const droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, {
                filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 100
            });
            
            if (droppedResources.length > 0) {
                source = creep.pos.findClosestByRange(droppedResources);
                if (source) {
                    creep.memory.energySourceId = source.id;
                    creep.memory.energySourceType = 'dropped';
                    return source;
                }
            }
            
            // Priority 4: Active sources (last resort) - choose best by availability
            const activeSources = creep.room.find(FIND_SOURCES_ACTIVE);
            if (activeSources.length > 0) {
                // Filter out sources near source keepers
                const safeSources = activeSources.filter(source => {
                    // Check if source has been marked as near keeper in room memory
                    if (creep.room.memory.sources && 
                        creep.room.memory.sources[source.id] && 
                        creep.room.memory.sources[source.id].nearKeeper === true) {
                        return false;
                    }
                    return true;
                });
                
                if (safeSources.length > 0) {
                    const utils = require('utils');
                    source = utils.findBestSourceByAvailability(creep.room, safeSources);
                    if (source) {
                        creep.memory.energySourceId = source.id;
                        creep.memory.energySourceType = 'source';
                        return source;
                    }
                }
            }
        } else {
            // Use cached source if search cooldown hasn't expired
            if (creep.memory.energySourceId) {
                source = Game.getObjectById(creep.memory.energySourceId);
                
                // Validate source still has energy
                if (source) {
                    if ((source.amount !== undefined && source.amount < 50) || 
                        (source.store && source.store[RESOURCE_ENERGY] === 0)) {
                        // Source is depleted, clear cache and force new search
                        delete creep.memory.energySourceId;
                        delete creep.memory.energySourceType;
                        creep.memory.lastSourceSearch = 0;
                        return this.findEnergySource(creep);
                    }
                } else {
                    // Source no longer exists, clear cache and force new search
                    delete creep.memory.energySourceId;
                    delete creep.memory.energySourceType;
                    creep.memory.lastSourceSearch = 0;
                    return this.findEnergySource(creep);
                }
            }
        }
        
        return source;
    },
    
    /**
     * Check if a target is valid for builder interaction
     * @param {Object} target - The target to validate
     * @returns {boolean} - Whether the target is valid
     */
    isValidTarget: function(target) {
        if (!target) return false;
        
        // Check if target is a construction site
        if (target.progressTotal !== undefined) {
            // Valid if it's a construction site that's not complete
            return target.progress < target.progressTotal;
        }
        
        // Check if target is a controller
        if (target.structureType === STRUCTURE_CONTROLLER) {
            // Valid if it's a controller that we own
            return target.my;
        }
        
        // Check if target is a structure that needs repair
        if (target.hits !== undefined && target.hitsMax !== undefined) {
            // Valid if it's a structure that needs repair
            return target.hits < target.hitsMax;
        }
        
        // Not a valid target
        return false;
    },
    
    /**
     * Register an energy request for haulers to fulfill
     * @param {Creep} creep - The builder creep requesting energy
     */
    registerEnergyRequest: function(creep) {
        // Initialize the energy request registry if it doesn't exist
        if (!creep.room.memory.energyRequests) {
            creep.room.memory.energyRequests = {};
        }
        
        // Check if we already have a request and it's assigned to a hauler
        if (creep.room.memory.energyRequests[creep.id] && 
            creep.room.memory.energyRequests[creep.id].assignedHaulerId) {
            // A hauler is already coming, don't update the request
            return;
        }
        
        // Get target site information if available
        let targetSiteInfo = null;
        if (creep.memory.targetId) {
            const targetSite = Game.getObjectById(creep.memory.targetId);
            if (targetSite) {
                targetSiteInfo = {
                    id: targetSite.id,
                    pos: {
                        x: targetSite.pos.x,
                        y: targetSite.pos.y,
                        roomName: targetSite.pos.roomName
                    },
                    structureType: targetSite.structureType
                };
            }
        }
        
        // Set wait start time if not already set
        if (!creep.memory.waitStartTime) {
            creep.memory.waitStartTime = Game.time;
        }
        
        // Create or update request
        creep.room.memory.energyRequests[creep.id] = {
            id: creep.id,
            pos: {x: creep.pos.x, y: creep.pos.y, roomName: creep.room.name},
            amount: creep.store.getFreeCapacity(RESOURCE_ENERGY),
            timestamp: Game.time,
            waitStartTime: creep.memory.waitStartTime,
            targetSite: targetSiteInfo,
            task: creep.memory.task || 'unknown',
            priority: this.calculateRequestPriority(creep)
        };
    },
    
    /**
     * Clear an energy request when no longer needed
     * @param {Creep} creep - The builder creep clearing its request
     */
    clearEnergyRequest: function(creep) {
        // Clear the request when no longer needed
        if (creep.room.memory.energyRequests && 
            creep.room.memory.energyRequests[creep.id]) {
            delete creep.room.memory.energyRequests[creep.id];
        }
        
        // Reset wait timer and harvesting flags
        delete creep.memory.waitStartTime;
        delete creep.memory.harvestingStarted;
    },
    
    /**
     * Calculate priority for energy requests
     * @param {Creep} creep - The builder creep
     * @returns {number} - Priority score (lower is higher priority)
     */
    calculateRequestPriority: function(creep) {
        let priority = 50; // Base priority
        
        // Give repairers higher base priority
        if (creep.memory.isRepairer === true) {
            priority -= 10; // Repairers get higher priority
        }
        
        // If the builder has a target, adjust priority based on target type
        if (creep.memory.targetId) {
            const target = Game.getObjectById(creep.memory.targetId);
            if (target) {
                // Construction sites
                if (target.progressTotal !== undefined) {
                    // Prioritize by structure type
                    if (target.structureType === STRUCTURE_SPAWN) {
                        priority -= 30; // Highest priority
                    } else if (target.structureType === STRUCTURE_EXTENSION) {
                        priority -= 25;
                    } else if (target.structureType === STRUCTURE_TOWER) {
                        priority -= 20;
                    } else if (target.structureType === STRUCTURE_CONTAINER) {
                        priority -= 18; // Increased priority for containers
                    } else if (target.structureType === STRUCTURE_ROAD) {
                        priority -= 10;
                    }
                    
                    // Prioritize nearly complete structures
                    const progressPercent = target.progress / target.progressTotal;
                    if (progressPercent > 0.75) {
                        priority -= 10; // Almost done, higher priority
                    }
                }
                // Repair targets
                else if (target.hits !== undefined && target.hitsMax !== undefined) {
                    // Prioritize critical structures
                    if (target.structureType === STRUCTURE_SPAWN || 
                        target.structureType === STRUCTURE_TOWER) {
                        priority -= 15;
                    }
                    
                    // Prioritize severely damaged structures
                    const healthPercent = target.hits / target.hitsMax;
                    if (healthPercent < 0.25) {
                        priority -= 10; // Severely damaged, higher priority
                    }
                    
                    // Additional priority for repairers working on repairs
                    if (creep.memory.isRepairer === true) {
                        priority -= 5; // Extra priority for repairers doing their job
                    }
                }
                // Controller
                else if (target.structureType === STRUCTURE_CONTROLLER) {
                    // Lower priority for controller upgrading
                    priority += 10;
                }
            }
        }
        
        // Adjust priority based on builder's energy level
        const energyPercent = creep.store[RESOURCE_ENERGY] / creep.store.getCapacity();
        if (energyPercent < 0.1) {
            priority -= 15; // Almost empty, higher priority
        }
        
        return priority;
    },
    
    /**
     * Harvest energy from a source
     * @param {Creep} creep - The creep to harvest with
     * @param {Object} source - The energy source
     */
    /**
     * Reset a stuck builder
     * @param {Creep} creep - The creep to reset
     */
    resetStuckBuilder: function(creep) {
        // Clear all target-related memory
        delete creep.memory.targetId;
        delete creep.memory.targetPos;
        delete creep.memory.lastTargetSearch;
        delete creep.memory.forceUpgrade;
        delete creep.memory.errorCount;
        
        // For repairers, look for repair targets first
        if (creep.memory.isRepairer === true) {
            // Look for repair targets
            const repairTargets = creep.room.find(FIND_STRUCTURES, {
                filter: s => s.hits < s.hitsMax * 0.8 && 
                          (s.structureType === STRUCTURE_CONTAINER || 
                           s.structureType === STRUCTURE_SPAWN ||
                           s.structureType === STRUCTURE_EXTENSION ||
                           s.structureType === STRUCTURE_TOWER ||
                           s.structureType === STRUCTURE_ROAD)
            });
            
            if (repairTargets.length > 0) {
                // Find closest repair target
                const target = this.findClosestByRange(creep, repairTargets);
                creep.memory.targetId = target.id;
                creep.memory.targetPos = {
                    x: target.pos.x,
                    y: target.pos.y,
                    roomName: target.pos.roomName
                };
                creep.say('🔧');
                console.log(`Repairer ${creep.name} reset to repair target: ${target.id}`);
                return;
            }
            
            // If no repair targets, look for construction sites
            const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
            if (sites.length > 0) {
                // Filter out the previous target that caused issues
                const validSites = sites.filter(site => site.id !== creep.memory.targetId);
                
                // If we have other sites, use one of those
                const sitesToUse = validSites.length > 0 ? validSites : sites;
                const target = this.findClosestByRange(creep, sitesToUse);
                
                // Verify the target is valid before assigning
                if (target && target.id) {
                    creep.memory.targetId = target.id;
                    creep.memory.targetPos = {
                        x: target.pos.x,
                        y: target.pos.y,
                        roomName: target.pos.roomName
                    };
                    creep.say('🏗️');
                    console.log(`Repairer ${creep.name} reset to construction site: ${target.id}`);
                    return;
                }
            }
            
            // If nothing to repair or build, just move away from controller
            const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
            if (spawn) {
                creep.moveTo(spawn);
                creep.say('🏠');
                console.log(`Repairer ${creep.name} has no targets, moving to spawn`);
            }
        } else {
            // For regular builders, find a new target
            const target = this.findBuildTarget(creep);
            if (target) {
                creep.memory.targetId = target.id;
                creep.memory.targetPos = {
                    x: target.pos.x,
                    y: target.pos.y,
                    roomName: target.pos.roomName
                };
                console.log(`Reset builder ${creep.name}, new target: ${target.id}`);
            }
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
        
        if (containerTypes && containerTypes.controllerContainers && containerTypes.controllerContainers.length > 0) {
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
    

    
    harvestEnergySource: function(creep, source) {
        creep.memory.energySourceId = source.id;
        
        // Determine source type if not already set
        if (!creep.memory.energySourceType) {
            if (source.amount !== undefined) {
                creep.memory.energySourceType = 'dropped';
            } else if (source.energy !== undefined) {
                creep.memory.energySourceType = 'source';
            } else if (source.structureType === STRUCTURE_STORAGE) {
                creep.memory.energySourceType = 'storage';
            } else if (source.structureType === STRUCTURE_CONTAINER) {
                creep.memory.energySourceType = 'container';
            } else {
                creep.memory.energySourceType = 'unknown';
            }
        }
        
        // Cache source position for more efficient movement
        if (!creep.memory.sourcePos) {
            creep.memory.sourcePos = {
                x: source.pos.x,
                y: source.pos.y,
                roomName: source.pos.roomName
            };
        }
        
        let actionResult;
        
        if (source.amount !== undefined) {
            actionResult = creep.pickup(source);
        } else if (source.energy !== undefined) {
            actionResult = creep.harvest(source);
        } else {
            actionResult = creep.withdraw(source, RESOURCE_ENERGY);
        }
        
        if (actionResult === ERR_NOT_IN_RANGE) {
            const sourcePos = new RoomPosition(
                creep.memory.sourcePos.x,
                creep.memory.sourcePos.y,
                creep.memory.sourcePos.roomName
            );
            movementManager.moveToTarget(creep, sourcePos, { 
                reusePath: 10,
                visualizePathStyle: {stroke: '#ffaa00'}
            });
            
            // Show visual indicator of what we're going to collect
            const sourceType = creep.memory.energySourceType;
            if (sourceType === 'storage') {
                creep.say('🏦');
            } else if (sourceType === 'container') {
                creep.say('📦');
            } else if (sourceType === 'dropped') {
                creep.say('💎');
            } else if (sourceType === 'source') {
                creep.say('⛏️');
            }
        } else if (actionResult === OK) {
            // On successful collection, show what we collected
            const sourceType = creep.memory.energySourceType;
            if (sourceType === 'storage') {
                creep.say('🏦');
            } else if (sourceType === 'container') {
                creep.say('📦');
            } else if (sourceType === 'dropped') {
                creep.say('💎');
            } else if (sourceType === 'source') {
                creep.say('⛏️');
            }
        } else if (actionResult !== OK) {
            // If there was an error, clear the source and try again next tick
            delete creep.memory.energySourceId;
            delete creep.memory.sourcePos;
            delete creep.memory.energySourceType;
            creep.memory.lastSourceSearch = 0;
        }
    }
};

module.exports = roleBuilder;