/**
 * Helper functions for construction system
 */
module.exports = {
    /**
     * Initialize room memory
     * @param {Room} room - The room to initialize
     */
    initializeRoomMemory: function(room) {
        if (!room.memory) {
            room.memory = {};
        }
        
        if (!room.memory.construction) {
            room.memory.construction = {
                roads: { planned: false },
                extensions: { planned: false, count: 0 },
                containers: { planned: false },
                storage: { planned: false },
                towers: { planned: false, count: 0 },
                lastUpdate: 0
            };
        }
    },
    
    /**
     * Find best position for a structure
     * @param {Room} room - The room to check
     * @param {RoomPosition|Object} anchorPos - Position to search around
     * @param {number} minRange - Minimum range from anchor
     * @param {number} maxRange - Maximum range from anchor
     * @returns {Object|null} - Position object or null if no valid position
     */
    findBestPosition: function(room, anchorPos, minRange, maxRange) {
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
    }
};