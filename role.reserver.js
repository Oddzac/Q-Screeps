/**
 * Reserver Role - Reserves controllers in remote rooms
 */
const movementManager = require('movementManager');

const roleReserver = {
    run: function(creep) {
        // If not in target room, travel there
        if (creep.memory.targetRoom && creep.room.name !== creep.memory.targetRoom) {
            const exit = creep.room.findExitTo(creep.memory.targetRoom);
            const exitPos = creep.pos.findClosestByRange(exit);
            movementManager.moveToTarget(creep, exitPos);
            return;
        }
        
        // If in target room, reserve controller
        if (creep.room.controller) {
            // Update room data
            if (Memory.remoteOps && Memory.remoteOps.rooms[creep.room.name]) {
                Memory.remoteOps.rooms[creep.room.name].reserved = true;
                Memory.remoteOps.rooms[creep.room.name].lastReserve = Game.time;
            }
            
            // Reserve controller
            const result = creep.reserveController(creep.room.controller);
            if (result === ERR_NOT_IN_RANGE) {
                movementManager.moveToTarget(creep, creep.room.controller);
                creep.say('🏃');
            } else if (result === OK) {
                creep.say('🔒');
            } else if (result === ERR_INVALID_TARGET) {
                // Controller is owned or reserved by someone else
                creep.say('❌');
                
                // Attack controller if reserved by enemy
                if (creep.room.controller.reservation && 
                    creep.room.controller.reservation.username !== creep.owner.username) {
                    creep.attackController(creep.room.controller);
                }
            }
        }
    }
};

module.exports = roleReserver;