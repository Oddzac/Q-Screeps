/**
 * Scout Role - Explores adjacent rooms and gathers intel
 */
const movementManager = require('movementManager');

const roleScout = {
    run: function(creep) {
        // If not in target room, travel there
        if (creep.memory.targetRoom && creep.room.name !== creep.memory.targetRoom) {
            const exit = creep.room.findExitTo(creep.memory.targetRoom);
            const exitPos = creep.pos.findClosestByRange(exit);
            movementManager.moveToTarget(creep, exitPos);
            return;
        }
        
        // If in target room, gather intel
        this.gatherRoomIntel(creep);
        
        // Move to next room if done
        if (creep.memory.roomComplete) {
            this.selectNextRoom(creep);
        }
    },
    
    gatherRoomIntel: function(creep) {
        // Skip if already completed
        if (creep.memory.roomComplete) return;
        
        // Store essential room data in memory
        if (!Memory.remoteOps) Memory.remoteOps = { rooms: {} };
        if (!Memory.remoteOps.rooms[creep.room.name]) {
            Memory.remoteOps.rooms[creep.room.name] = {};
        }
        
        const roomData = Memory.remoteOps.rooms[creep.room.name];
        
        // Update basic info
        roomData.lastScout = Game.time;
        roomData.baseRoom = creep.memory.homeRoom;
        
        // Count sources
        const sources = creep.room.find(FIND_SOURCES);
        roomData.sources = sources.length;
        
        // Store source positions
        if (!roomData.sourcePositions && sources.length > 0) {
            roomData.sourcePositions = sources.map(source => ({
                id: source.id,
                x: source.pos.x,
                y: source.pos.y
            }));
        }
        
        // Check for hostiles
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
        roomData.hostiles = hostiles.length > 0;
        
        // Check controller status
        if (creep.room.controller) {
            roomData.controller = true;
            
            if (creep.room.controller.owner) {
                roomData.owner = creep.room.controller.owner.username;
            } else if (creep.room.controller.reservation) {
                roomData.reservation = {
                    username: creep.room.controller.reservation.username,
                    ticksToEnd: creep.room.controller.reservation.ticksToEnd
                };
            } else {
                roomData.reservation = null;
            }
        } else {
            roomData.controller = false;
        }
        
        // Calculate room score for remote mining
        roomData.score = this.calculateRoomScore(creep.room, creep.memory.homeRoom);
        
        // Mark room as complete
        creep.memory.roomComplete = true;
        creep.say('📝');
    },
    
    calculateRoomScore: function(room, homeRoomName) {
        let score = 0;
        
        // Source count is most important
        const sources = room.find(FIND_SOURCES);
        score += sources.length * 50;
        
        // Subtract for distance from home room
        const route = Game.map.findRoute(room.name, homeRoomName);
        if (route !== ERR_NO_PATH) {
            score -= route.length * 10;
        } else {
            score -= 100; // Heavy penalty if no path
        }
        
        // Subtract for hostiles
        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        score -= hostiles.length * 20;
        
        // Bonus for unowned controller
        if (room.controller && !room.controller.owner && !room.controller.reservation) {
            score += 20;
        }
        
        return score;
    },
    
    selectNextRoom: function(creep) {
        // Get exits from current room
        const exits = Game.map.describeExits(creep.room.name);
        const exitKeys = Object.keys(exits);
        
        // Filter out rooms we've recently visited or that are owned
        const unvisitedExits = exitKeys.filter(key => {
            const roomName = exits[key];
            
            // Skip rooms we own
            if (Game.rooms[roomName] && 
                Game.rooms[roomName].controller && 
                Game.rooms[roomName].controller.my) {
                return false;
            }
            
            // Skip recently scouted rooms
            if (Memory.remoteOps && 
                Memory.remoteOps.rooms[roomName] && 
                Game.time - Memory.remoteOps.rooms[roomName].lastScout < 1000) {
                return false;
            }
            
            return true;
        });
        
        if (unvisitedExits.length > 0) {
            // Pick a random unvisited exit
            const exitKey = unvisitedExits[Math.floor(Math.random() * unvisitedExits.length)];
            creep.memory.targetRoom = exits[exitKey];
            creep.memory.roomComplete = false;
            creep.say('🔍');
        } else {
            // Return to home room if all adjacent rooms are scouted
            creep.memory.targetRoom = creep.memory.homeRoom;
            creep.memory.roomComplete = false;
            creep.say('🏠');
        }
    }
};

module.exports = roleScout;