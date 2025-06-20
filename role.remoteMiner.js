/**
 * Remote Miner Role - Harvests energy from sources in remote rooms
 */
const movementManager = require('movementManager');

const roleRemoteMiner = {
    run: function(creep) {
        // If not in target room, travel there
        if (creep.memory.targetRoom && creep.room.name !== creep.memory.targetRoom) {
            const exit = creep.room.findExitTo(creep.memory.targetRoom);
            const exitPos = creep.pos.findClosestByRange(exit);
            movementManager.moveToTarget(creep, exitPos);
            return;
        }
        
        // If in target room, mine source
        if (!creep.memory.sourceId) {
            this.findSource(creep);
        }
        
        const source = Game.getObjectById(creep.memory.sourceId);
        if (!source) return;
        
        // Check for hostiles before mining
        if (this.checkForHostiles(creep)) return;
        
        // Mine the source
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            movementManager.moveToTarget(creep, source);
            creep.say('🏃');
        } else {
            creep.say('⛏️');
            
            // If we have a container, drop energy into it
            if (creep.memory.containerId) {
                const container = Game.getObjectById(creep.memory.containerId);
                if (container && creep.pos.isEqualTo(container.pos)) {
                    // We're on the container, just keep harvesting
                    return;
                }
            }
            
            // If we're full, drop the energy
            if (creep.store.getFreeCapacity() === 0) {
                creep.drop(RESOURCE_ENERGY);
            }
        }
    },
    
    findSource: function(creep) {
        // Check if we have assigned sources in room data
        if (Memory.remoteOps && 
            Memory.remoteOps.rooms[creep.room.name] && 
            Memory.remoteOps.rooms[creep.room.name].sourcePositions) {
            
            const sourcePositions = Memory.remoteOps.rooms[creep.room.name].sourcePositions;
            
            // Find which sources already have miners
            const assignedSources = {};
            for (const name in Game.creeps) {
                const c = Game.creeps[name];
                if (c.memory.role === 'remoteMiner' && 
                    c.memory.targetRoom === creep.room.name && 
                    c.memory.sourceId && 
                    c.id !== creep.id) {
                    assignedSources[c.memory.sourceId] = true;
                }
            }
            
            // Find an unassigned source
            for (const sourcePos of sourcePositions) {
                if (!assignedSources[sourcePos.id]) {
                    creep.memory.sourceId = sourcePos.id;
                    
                    // Look for container near source
                    const source = Game.getObjectById(sourcePos.id);
                    if (source) {
                        const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                            filter: s => s.structureType === STRUCTURE_CONTAINER
                        });
                        
                        if (containers.length > 0) {
                            creep.memory.containerId = containers[0].id;
                        }
                    }
                    
                    return;
                }
            }
            
            // If all sources have miners, pick the first one
            if (sourcePositions.length > 0) {
                creep.memory.sourceId = sourcePositions[0].id;
            }
        } else {
            // Fallback to finding sources directly
            const sources = creep.room.find(FIND_SOURCES);
            if (sources.length > 0) {
                creep.memory.sourceId = sources[0].id;
            }
        }
    },
    
    checkForHostiles: function(creep) {
        // Check for hostiles near the creep
        const hostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 5);
        
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

module.exports = roleRemoteMiner;