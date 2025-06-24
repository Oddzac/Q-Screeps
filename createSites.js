/**
 * Global function to directly create construction sites from room plan
 */
const construction = require('construction');

module.exports = function(roomName, count = 5) {
    const room = Game.rooms[roomName];
    if (!room) return `No visibility in room ${roomName}`;
    
    if (!room.memory.roomPlan) {
        return `No room plan exists for ${roomName}. Generate a plan first with global.generateRoomPlan('${roomName}')`;
    }
    
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    console.log(`Room ${roomName} currently has ${sites.length} construction sites`);
    
    // Directly call createConstructionSitesFromPlan
    const created = construction.createConstructionSitesFromPlan(room);
    
    const newSites = room.find(FIND_CONSTRUCTION_SITES);
    return `Created ${created} construction sites in ${roomName}. Sites before: ${sites.length}, after: ${newSites.length}`;
};