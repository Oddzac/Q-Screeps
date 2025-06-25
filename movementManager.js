/**
 * Movement Manager - CPU optimized movement with path caching
 */
const helpers = require('helpers');

const movementManager = {
    // Cache for path finding operations
    pathCache: {},
    
    /**
     * Move a creep to a target with path caching
     * @param {Creep} creep - The creep to move
     * @param {Object|RoomPosition} target - The target to move to
     * @param {Object} options - Movement options
     * @returns {number} - Result of the move operation
     */
    moveToTarget: function(creep, target, options = {}) {
        // Default options
        options.reusePath = options.reusePath || 20;
        options.visualizePathStyle = options.visualizePathStyle || {stroke: '#ffffff'};
        options.range = options.range || 1;
        
        // Generate a unique key for this path
        const targetPos = target.pos || target;
        if (!targetPos) return ERR_INVALID_TARGET;
        
        const pathKey = `${creep.pos.roomName}_${creep.pos.x},${creep.pos.y}_${targetPos.roomName}_${targetPos.x},${targetPos.y}_${options.range}`;
        
        // Check if we're already at the target
        if (creep.pos.inRangeTo(targetPos, options.range)) {
            return OK;
        }
        
        // Check for cached path
        const currentTick = Game.time;
        const shouldRecomputePath = !this.pathCache[pathKey] || 
                                   this.pathCache[pathKey].time + 50 < currentTick ||
                                   this.pathCache[pathKey].incomplete ||
                                   currentTick % 20 === creep.id.charCodeAt(0) % 20; // Occasional recompute to avoid traffic jams
        
        // If we have a valid cached path, use it
        if (!shouldRecomputePath) {
            const result = creep.moveByPath(this.pathCache[pathKey].path);
            
            // If movement failed, invalidate the cache
            if (result !== OK && result !== ERR_TIRED) {
                this.pathCache[pathKey].incomplete = true;
            }
            
            return result;
        }
        
        // No valid cache, compute a new path
        options.costCallback = (roomName, costMatrix) => {
            // Avoid other creeps when pathfinding
            const room = Game.rooms[roomName];
            if (!room) return costMatrix;
            
            // Add creeps as obstacles
            room.find(FIND_CREEPS).forEach(otherCreep => {
                // Don't avoid self
                if (otherCreep.id === creep.id) return;
                
                // Add high cost for creep positions
                costMatrix.set(otherCreep.pos.x, otherCreep.pos.y, 255);
            });
            
            return costMatrix;
        };
        
        // Find a new path
        const result = creep.moveTo(targetPos, options);
        
        // Cache the path if successful
        if (result === OK || result === ERR_TIRED) {
            // Get the path from the creep's memory
            if (creep._move && creep._move.path) {
                this.pathCache[pathKey] = {
                    path: creep._move.path,
                    time: currentTick,
                    incomplete: false
                };
            }
        }
        
        return result;
    },
    
    /**
     * Check if a creep is blocking others and should move aside
     * @param {Creep} creep - The creep to check
     * @returns {boolean} - True if the creep moved aside
     */
    /**
     * Clean the path cache periodically
     */
    cleanCache: function() {
        const currentTick = Game.time;
        const maxAge = 100; // Cache entries older than this will be removed
        
        for (const key in this.pathCache) {
            if (this.pathCache[key].time + maxAge < currentTick) {
                delete this.pathCache[key];
            }
        }
    },
    
    checkAndGiveWay: function(creep) {
        // Don't move if fatigued or already moved this tick
        if (creep.fatigue > 0 || creep._moved) return false;
        
        // Check for creeps that might be blocked by this one
        const adjacentPositions = [
            [0, -1], [1, -1], [1, 0], [1, 1],
            [0, 1], [-1, 1], [-1, 0], [-1, -1]
        ];
        
        // Check if we're in a traffic jam (multiple creeps around us)
        const surroundingCreeps = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
            filter: c => c.id !== creep.id
        });
        
        // If we're not in a traffic jam, no need to move
        if (surroundingCreeps.length < 2) return false;
        
        // If we're working on something important, don't move unless severe traffic
        if (creep.memory.working && surroundingCreeps.length < 3) return false;
        
        // Find a direction to move that's not blocked
        for (let i = 0; i < adjacentPositions.length; i++) {
            const [dx, dy] = adjacentPositions[i];
            const x = creep.pos.x + dx;
            const y = creep.pos.y + dy;
            
            // Skip if out of bounds
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            
            // Check if the position is walkable
            const pos = new RoomPosition(x, y, creep.room.name);
            const objects = creep.room.lookAt(pos);
            
            let isWalkable = true;
            for (const obj of objects) {
                if (obj.type === 'creep') {
                    isWalkable = false;
                    break;
                }
                if (obj.type === 'terrain' && obj.terrain === 'wall') {
                    isWalkable = false;
                    break;
                }
                if (obj.type === 'structure' && 
                    obj.structure.structureType !== STRUCTURE_ROAD && 
                    obj.structure.structureType !== STRUCTURE_CONTAINER && 
                    (obj.structure.structureType !== STRUCTURE_RAMPART || !obj.structure.my)) {
                    isWalkable = false;
                    break;
                }
            }
            
            // If we found a walkable position, move there
            if (isWalkable) {
                creep.move(i + 1); // Direction constants start at 1
                creep._moved = true;
                return true;
            }
        }
        
        return false;
    },
    
    /**
     * Clean up the path cache to prevent memory bloat
     */
    cleanCache: function() {
        const currentTick = Game.time;
        
        // Remove old paths
        for (const key in this.pathCache) {
            if (this.pathCache[key].time + 100 < currentTick) {
                delete this.pathCache[key];
            }
        }
    }
};

module.exports = movementManager;