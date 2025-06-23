/**
 * Plan links for the room
 * @param {Room} room - The room to plan links for
 */
module.exports = function(room) {
    // Skip if below RCL 5
    if (room.controller.level < 5) return;
    
    // Find spawn
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0) return;
    
    const spawn = spawns[0];
    const terrain = room.getTerrain();
    
    // Calculate how many links we can build at current RCL
    const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK][room.controller.level];
    const links = [];
    
    // First link: near storage or spawn
    let storagePos = null;
    if (room.storage) {
        storagePos = room.storage.pos;
    } else if (room.memory.construction.storage && room.memory.construction.storage.position) {
        storagePos = room.memory.construction.storage.position;
    }
    
    if (storagePos) {
        // Find a position near storage
        const firstLinkPos = this.findLinkPosition(room, storagePos, 1, 2);
        if (firstLinkPos) {
            links.push(firstLinkPos);
        }
    } else {
        // Find a position near spawn
        const firstLinkPos = this.findLinkPosition(room, spawn.pos, 2, 3);
        if (firstLinkPos) {
            links.push(firstLinkPos);
        }
    }
    
    // Second link: near controller
    if (maxLinks >= 2) {
        const controllerLinkPos = this.findLinkPosition(room, room.controller.pos, 1, 3);
        if (controllerLinkPos) {
            links.push(controllerLinkPos);
        }
    }
    
    // Additional links: near sources
    if (maxLinks >= 3) {
        const sources = room.find(FIND_SOURCES);
        for (const source of sources) {
            if (links.length >= maxLinks) break;
            
            const sourceLinkPos = this.findLinkPosition(room, source.pos, 1, 2);
            if (sourceLinkPos) {
                links.push(sourceLinkPos);
            }
        }
    }
    
    // Save link plan to memory
    room.memory.construction.links = {
        planned: true,
        positions: links,
        count: 0
    };
    
    console.log(`Planned ${links.length} link positions in room ${room.name}`);
};

/**
 * Find a good position for a link
 * @param {Room} room - The room to check
 * @param {RoomPosition|Object} anchorPos - Position to search around
 * @param {number} minRange - Minimum range from anchor
 * @param {number} maxRange - Maximum range from anchor
 * @returns {Object|null} - Position object or null if no valid position
 */
module.exports.findLinkPosition = function(room, anchorPos, minRange, maxRange) {
    const terrain = room.getTerrain();
    let bestPos = null;
    let bestScore = -1;
    
    // Check positions in a square around the anchor
    for (let dx = -maxRange; dx <= maxRange; dx++) {
        for (let dy = -maxRange; dy <= maxRange; dy++) {
            const x = anchorPos.x + dx;
            const y = anchorPos.y + dy;
            
            // Skip if out of bounds or on a wall
            if (x <= 1 || y <= 1 || x >= 48 || y >= 48 || 
                terrain.get(x, y) === TERRAIN_MASK_WALL) {
                continue;
            }
            
            // Calculate Manhattan distance
            const distance = Math.abs(dx) + Math.abs(dy);
            
            // Skip if too close or too far
            if (distance < minRange || distance > maxRange) {
                continue;
            }
            
            // Check if position is already occupied
            const lookResult = room.lookAt(x, y);
            let hasStructure = false;
            
            for (const item of lookResult) {
                if (item.type === LOOK_STRUCTURES || 
                    item.type === LOOK_CONSTRUCTION_SITES) {
                    hasStructure = true;
                    break;
                }
            }
            
            if (hasStructure) continue;
            
            // Calculate score based on open space and distance
            let score = 0;
            
            // Prefer positions with open space around them
            for (let nx = -1; nx <= 1; nx++) {
                for (let ny = -1; ny <= 1; ny++) {
                    const ax = x + nx;
                    const ay = y + ny;
                    if (ax >= 0 && ay >= 0 && ax < 50 && ay < 50 && 
                        terrain.get(ax, ay) !== TERRAIN_MASK_WALL) {
                        score++;
                    }
                }
            }
            
            // Adjust score based on distance (prefer closer positions)
            score += (maxRange - distance);
            
            if (score > bestScore) {
                bestScore = score;
                bestPos = { x, y };
            }
        }
    }
    
    return bestPos;
};