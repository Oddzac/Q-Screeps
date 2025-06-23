/**
 * Shared Helper Functions - Common utilities used across modules
 */
const helpers = {
    /**
     * Initialize room memory with default structure
     * @param {Room} room - The room to initialize
     */
    initializeRoomMemory: function(room) {
        if (!room.memory) {
            room.memory = {};
        }
        
        // Initialize construction memory
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
        
        // Initialize sources memory
        if (!room.memory.sources) {
            room.memory.sources = {};
        }
        
        // Initialize energy requests
        if (!room.memory.energyRequests) {
            room.memory.energyRequests = {};
        }
    },
    
    /**
     * Calculate position score based on adjacent walkable tiles
     * @param {RoomTerrain} terrain - Room terrain
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {number} - Position score
     */
    calculatePositionScore: function(terrain, x, y) {
        let score = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && 
                    terrain.get(nx, ny) !== TERRAIN_MASK_WALL) {
                    score++;
                }
            }
        }
        return score;
    },
    
    /**
     * Create a map of planned positions for each structure type
     * @param {Object} rclPlan - Room plan for current RCL
     * @param {Array} relevantTypes - Optional array of structure types to include
     * @returns {Object} - Map of structure types to sets of position strings
     */
    createPlannedPositionsMap: function(rclPlan, relevantTypes = null) {
        const plannedPositions = {};
        const typesToProcess = relevantTypes || Object.keys(rclPlan.structures);
        
        for (const structureType of typesToProcess) {
            if (rclPlan.structures[structureType]) {
                plannedPositions[structureType] = new Set();
                for (const pos of rclPlan.structures[structureType]) {
                    plannedPositions[structureType].add(`${pos.x},${pos.y}`);
                }
            }
        }
        
        return plannedPositions;
    },
    
    /**
     * Get structure priority order based on RCL and room needs
     * @param {Room} room - The room to check
     * @param {Object} structuresByType - Existing structures grouped by type
     * @returns {Array} - Array of structure types in priority order
     */
    getStructurePriorityOrder: function(room, structuresByType) {
        let structurePriority;
        
        // Different priorities based on RCL
        if (room.controller.level <= 2) {
            // RCL 1-2: Focus on containers, extensions, then roads
            structurePriority = [
                STRUCTURE_SPAWN,
                STRUCTURE_CONTAINER, // Containers first for early resource collection
                STRUCTURE_EXTENSION, // Extensions for more energy capacity
                STRUCTURE_ROAD,      // Roads last
                STRUCTURE_TOWER,
                STRUCTURE_STORAGE,
                STRUCTURE_LINK,
                STRUCTURE_TERMINAL,
                STRUCTURE_LAB,
                STRUCTURE_FACTORY,
                STRUCTURE_OBSERVER,
                STRUCTURE_POWER_SPAWN,
                STRUCTURE_NUKER
            ];
        } else if (room.controller.level <= 4) {
            // RCL 3-4: Focus on towers, extensions, containers, then roads
            structurePriority = [
                STRUCTURE_SPAWN,
                STRUCTURE_TOWER,     // Towers for defense
                STRUCTURE_EXTENSION, // Extensions for more energy
                STRUCTURE_CONTAINER, // Containers for resource collection
                STRUCTURE_STORAGE,   // Storage at RCL 4
                STRUCTURE_ROAD,      // Roads last
                STRUCTURE_LINK,
                STRUCTURE_TERMINAL,
                STRUCTURE_LAB,
                STRUCTURE_FACTORY,
                STRUCTURE_OBSERVER,
                STRUCTURE_POWER_SPAWN,
                STRUCTURE_NUKER
            ];
        } else {
            // RCL 5+: Standard priority
            structurePriority = [
                STRUCTURE_SPAWN,
                STRUCTURE_EXTENSION,
                STRUCTURE_TOWER,
                STRUCTURE_STORAGE,
                STRUCTURE_LINK,
                STRUCTURE_TERMINAL,
                STRUCTURE_CONTAINER,
                STRUCTURE_LAB,
                STRUCTURE_FACTORY,
                STRUCTURE_OBSERVER,
                STRUCTURE_ROAD,
                STRUCTURE_POWER_SPAWN,
                STRUCTURE_NUKER
            ];
        }
        
        // Further adjust priority based on specific needs
        if (room.controller.level <= 3) {
            // Early game: check if we need more extensions or containers
            const extensionCount = (structuresByType[STRUCTURE_EXTENSION] || []).length;
            const containerCount = (structuresByType[STRUCTURE_CONTAINER] || []).length;
            
            // If we have enough containers but few extensions, prioritize extensions
            if (containerCount >= 2 && extensionCount < 5 && room.controller.level >= 2) {
                // Move extensions up in priority
                const extensionIndex = structurePriority.indexOf(STRUCTURE_EXTENSION);
                if (extensionIndex > 0) {
                    structurePriority.splice(extensionIndex, 1);
                    structurePriority.unshift(STRUCTURE_EXTENSION);
                }
            }
        }
        
        return structurePriority;
    },
    
    /**
     * Find best position for a structure near an anchor point
     * @param {Room} room - The room to check
     * @param {RoomPosition|Object} anchorPos - Position to search around
     * @param {number} minRange - Minimum range from anchor
     * @param {number} maxRange - Maximum range from anchor
     * @param {Array} existingPositions - Positions to avoid
     * @returns {Object|null} - Position object or null if no valid position
     */
    findBestPosition: function(room, anchorPos, minRange, maxRange, existingPositions = []) {
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
                
                // Skip if too close to existing positions
                let tooClose = false;
                for (const pos of existingPositions) {
                    if (Math.abs(pos.x - x) + Math.abs(pos.y - y) < 2) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;
                
                // Calculate score based on open space and distance
                let score = 0;
                
                // Prefer positions with open space around them
                score += this.calculatePositionScore(terrain, x, y);
                
                // Adjust score based on distance (prefer middle of range)
                const distanceScore = maxRange - Math.abs(distance - (minRange + maxRange) / 2);
                score += distanceScore;
                
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
        
        // Check for keeper lairs
        const keeperLairs = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_KEEPER_LAIR
        });
        
        if (keeperLairs.length === 0) return true;
        
        // Check distance to each keeper lair
        for (const lair of keeperLairs) {
            const distance = Math.abs(lair.pos.x - pos.x) + Math.abs(lair.pos.y - pos.y);
            if (distance <= safeDistance) {
                return false;
            }
        }
        
        return true;
    },
    
    /**
     * Log error with rate limiting
     * @param {string} key - Error identifier
     * @param {string} message - Error message
     * @param {number} interval - How often to log this error (in ticks)
     */
    logError: function(key, message, interval = 100) {
        if (!global.errorLog) global.errorLog = {};
        
        const now = Game.time;
        const lastLogged = global.errorLog[key] || 0;
        
        if (now - lastLogged >= interval) {
            console.log(`ERROR [${key}]: ${message}`);
            global.errorLog[key] = now;
        }
    }
};

module.exports = helpers;