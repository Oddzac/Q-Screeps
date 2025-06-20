/**
 * Remote Hauler Role - Collects energy from remote rooms and brings it back
 */
const movementManager = require('movementManager');

const roleRemoteHauler = {
    run: function(creep) {
        // State switching with minimal operations
        if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
            creep.memory.working = false;
        } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
        }
        
        // Execute current state
        if (creep.memory.working) {
            this.deliverResources(creep);
        } else {
            this.collectResources(creep);
        }
    },
    
    collectResources: function(creep) {
        // If not in target room, travel there
        if (creep.memory.targetRoom && creep.room.name !== creep.memory.targetRoom) {
            // Check for hostiles before entering
            if (this.checkForHostiles(creep)) return;
            
            const exit = creep.room.findExitTo(creep.memory.targetRoom);
            const exitPos = creep.pos.findClosestByRange(exit);
            movementManager.moveToTarget(creep, exitPos);
            return;
        }
        
        // Check for hostiles in target room
        if (this.checkForHostiles(creep)) return;
        
        // Find energy to collect
        let target = null;
        
        // First priority: Dropped resources
        const droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50
        });
        
        if (droppedResources.length > 0) {
            target = creep.pos.findClosestByRange(droppedResources);
            if (target) {
                if (creep.pickup(target) === ERR_NOT_IN_RANGE) {
                    movementManager.moveToTarget(creep, target);
                    creep.say('🏃');
                }
                return;
            }
        }
        
        // Second priority: Containers
        const containers = creep.room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && 
                      s.store[RESOURCE_ENERGY] > creep.store.getFreeCapacity() * 0.5
        });
        
        if (containers.length > 0) {
            target = creep.pos.findClosestByRange(containers);
            if (target) {
                if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    movementManager.moveToTarget(creep, target);
                    creep.say('🏃');
                }
                return;
            }
        }
        
        // If no energy found, move to source positions to wait for miners
        if (Memory.remoteOps && 
            Memory.remoteOps.rooms[creep.room.name] && 
            Memory.remoteOps.rooms[creep.room.name].sourcePositions) {
            
            const sourcePositions = Memory.remoteOps.rooms[creep.room.name].sourcePositions;
            if (sourcePositions.length > 0) {
                const sourcePos = new RoomPosition(
                    sourcePositions[0].x,
                    sourcePositions[0].y,
                    creep.room.name
                );
                
                movementManager.moveToTarget(creep, sourcePos, { range: 3 });
                creep.say('⏳');
            }
        }
    },
    
    deliverResources: function(creep) {
        // Return to home room
        if (creep.room.name !== creep.memory.homeRoom) {
            const exit = creep.room.findExitTo(creep.memory.homeRoom);
            const exitPos = creep.pos.findClosestByRange(exit);
            movementManager.moveToTarget(creep, exitPos);
            return;
        }
        
        // Find storage or container to deliver to
        let target = null;
        
        // First priority: Storage
        if (creep.room.storage) {
            target = creep.room.storage;
        } else {
            // Second priority: Containers near spawn
            const spawns = creep.room.find(FIND_MY_SPAWNS);
            if (spawns.length > 0) {
                const containers = spawns[0].pos.findInRange(FIND_STRUCTURES, 5, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER && 
                              s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                });
                
                if (containers.length > 0) {
                    target = containers[0];
                }
            }
            
            // Third priority: Spawn or extensions
            if (!target) {
                const structures = creep.room.find(FIND_STRUCTURES, {
                    filter: s => (s.structureType === STRUCTURE_SPAWN || 
                               s.structureType === STRUCTURE_EXTENSION) && 
                               s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                });
                
                if (structures.length > 0) {
                    target = creep.pos.findClosestByRange(structures);
                }
            }
        }
        
        // Transfer energy to target
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                movementManager.moveToTarget(creep, target);
                creep.say('🏃');
            }
        } else {
            // If no valid target, move to spawn
            const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
            if (spawn) {
                movementManager.moveToTarget(creep, spawn, { range: 3 });
            }
        }
    },
    
    checkForHostiles: function(creep) {
        // Skip if we're in our home room
        if (creep.room.name === creep.memory.homeRoom) return false;
        
        // Check for hostiles in the room
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
        
        if (hostiles.length > 0) {
            // Flee from hostiles
            creep.say('🚨');
            
            // Move back to home room
            const exitDir = Game.map.findExit(creep.room, creep.memory.homeRoom);
            const exit = creep.pos.findClosestByRange(exitDir);
            movementManager.moveToTarget(creep, exit);
            
            // Update room data
            if (Memory.remoteOps && Memory.remoteOps.rooms[creep.room.name]) {
                Memory.remoteOps.rooms[creep.room.name].hostiles = true;
                Memory.remoteOps.rooms[creep.room.name].lastHostile = Game.time;
            }
            
            return true;
        }
        
        return false;
    }
};

module.exports = roleRemoteHauler;