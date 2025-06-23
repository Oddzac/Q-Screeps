/**
 * Global function to check next planned construction sites
 */
module.exports = function(roomName, limit = 10) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    if (!room.memory.construction) {
        return `No construction plans for room ${roomName}`;
    }
    
    let output = `Next planned construction sites for ${roomName}:\n`;
    let count = 0;
    
    // Check containers
    if (room.memory.construction.containers && 
        room.memory.construction.containers.planned && 
        room.memory.construction.containers.positions) {
        
        for (const pos of room.memory.construction.containers.positions) {
            if (count >= limit) break;
            
            // Check if already built
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            
            if (!structures.some(s => s.structureType === STRUCTURE_CONTAINER) && 
                !sites.some(s => s.structureType === STRUCTURE_CONTAINER)) {
                output += `- Container at (${pos.x},${pos.y})\n`;
                count++;
            }
        }
    }
    
    // Check extensions
    if (room.memory.construction.extensions && 
        room.memory.construction.extensions.planned && 
        room.memory.construction.extensions.positions) {
        
        for (const pos of room.memory.construction.extensions.positions) {
            if (count >= limit) break;
            
            // Check if already built
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            
            if (!structures.some(s => s.structureType === STRUCTURE_EXTENSION) && 
                !sites.some(s => s.structureType === STRUCTURE_EXTENSION)) {
                output += `- Extension at (${pos.x},${pos.y})\n`;
                count++;
            }
        }
    }
    
    // Check towers
    if (room.memory.construction.towers && 
        room.memory.construction.towers.planned && 
        room.memory.construction.towers.positions) {
        
        for (const pos of room.memory.construction.towers.positions) {
            if (count >= limit) break;
            
            // Check if already built
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            
            if (!structures.some(s => s.structureType === STRUCTURE_TOWER) && 
                !sites.some(s => s.structureType === STRUCTURE_TOWER)) {
                output += `- Tower at (${pos.x},${pos.y})\n`;
                count++;
            }
        }
    }
    
    // Check storage
    if (room.memory.construction.storage && 
        room.memory.construction.storage.planned && 
        room.memory.construction.storage.position) {
        
        const pos = room.memory.construction.storage.position;
        
        // Check if already built
        const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
        const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
        
        if (!structures.some(s => s.structureType === STRUCTURE_STORAGE) && 
            !sites.some(s => s.structureType === STRUCTURE_STORAGE) && 
            count < limit) {
            output += `- Storage at (${pos.x},${pos.y})\n`;
            count++;
        }
    }
    
    // Check roads (limited to avoid excessive output)
    if (room.memory.construction.roads && 
        room.memory.construction.roads.planned && 
        room.memory.construction.roads.positions) {
        
        let roadCount = 0;
        for (const pos of room.memory.construction.roads.positions) {
            if (count >= limit) break;
            
            // Check if already built
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            
            if (!structures.some(s => s.structureType === STRUCTURE_ROAD) && 
                !sites.some(s => s.structureType === STRUCTURE_ROAD)) {
                roadCount++;
                if (roadCount <= 5) { // Only show first 5 roads
                    output += `- Road at (${pos.x},${pos.y})\n`;
                    count++;
                }
            }
        }
        
        if (roadCount > 5) {
            output += `- ... and ${roadCount - 5} more roads\n`;
        }
    }
    
    if (count === 0) {
        output += "No pending construction sites found.\n";
    }
    
    return output;
};