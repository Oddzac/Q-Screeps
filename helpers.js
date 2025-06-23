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
    },
    
    /**
     * Check if a position is safe from source keepers
     * @param {RoomPosition} pos - Position to check
     * @param {number} safeDistance - Safe distance from keepers (default: 5)
     * @returns {boolean} - True if position is safe
     */
    isSafeFromKeepers: function(pos, safeDistance = 5) {
        if (!pos || !pos.roomName) return false;
        
        const room = Game.rooms[pos.roomName];
        if (!room) return true; // Assume safe if room not visible
        
        // Check if this is a source keeper room
        if (!room.name.match(/^[WE][0-9]+[NS][0-9]+$/) || 
            (Math.abs(parseInt(room.name.match(/[WE]([0-9]+)/)[1]) % 10) >= 4 && 
             Math.abs(parseInt(room.name.match(/[NS]([0-9]+)/)[1]) % 10) >= 4)) {
            // Not a source keeper room
            return true;
        }
        
        // Find all source keeper lairs
        const keeperLairs = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_KEEPER_LAIR
        });
        
        if (keeperLairs.length === 0) return true;
        
        // Check distance to each keeper lair
        for (const lair of keeperLairs) {
            const distance = Math.max(
                Math.abs(lair.pos.x - pos.x),
                Math.abs(lair.pos.y - pos.y)
            );
            
            if (distance <= safeDistance) {
                return false;
            }
        }
        
        return true;
    }
};