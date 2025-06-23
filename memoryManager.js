/**
 * Memory Manager - Optimized memory operations and cleanup
 */
const utils = require('utils');
const helpers = require('helpers');

const memoryManager = {
    /**
     * Initialize memory structures at game start
     */
    initialize: function() {
        // Initialize global memory structures if they don't exist
        if (!Memory.rooms) Memory.rooms = {};
        if (!Memory.creeps) Memory.creeps = {};
        if (!Memory.flags) Memory.flags = {};
        if (!Memory.spawns) Memory.spawns = {};
        if (!Memory.stats) Memory.stats = {};
        
        // Initialize CPU tracking
        if (!global.cpuHistory) global.cpuHistory = [];
        
        // Initialize error tracking
        if (!global.errors) global.errors = [];
        if (!global.errorLog) global.errorLog = {};
    },
    
    /**
     * Clean up memory at the end of each tick
     */
    cleanup: function() {
        // Clean up memory for non-existent creeps
        this.cleanupCreepMemory();
        
        // Clean up memory for non-existent flags
        this.cleanupFlagMemory();
        
        // Clean up memory for non-existent spawns
        this.cleanupSpawnMemory();
        
        // Clean up room memory for rooms we no longer have visibility of
        this.cleanupRoomMemory();
        
        // Clean up cached data
        this.cleanupCachedData();
    },
    
    /**
     * Clean up memory for non-existent creeps
     */
    cleanupCreepMemory: function() {
        // Only run this occasionally to save CPU
        if (Game.time % 20 !== 0) return;
        
        // Clean up memory for non-existent creeps
        for (const name in Memory.creeps) {
            if (!Game.creeps[name]) {
                // If the creep had a source assigned, release it
                if (Memory.creeps[name].sourceId && Memory.creeps[name].homeRoom) {
                    try {
                        const roomManager = require('roomManager');
                        roomManager.releaseSource(Memory.creeps[name].sourceId, Memory.creeps[name].homeRoom);
                    } catch (e) {
                        helpers.logError('memory_cleanup', `Failed to release source for dead creep ${name}: ${e}`, 100);
                    }
                }
                
                // Delete the creep's memory
                delete Memory.creeps[name];
            }
        }
    },
    
    /**
     * Clean up memory for non-existent flags
     */
    cleanupFlagMemory: function() {
        // Only run this occasionally to save CPU
        if (Game.time % 100 !== 0) return;
        
        // Clean up memory for non-existent flags
        for (const name in Memory.flags) {
            if (!Game.flags[name]) {
                delete Memory.flags[name];
            }
        }
    },
    
    /**
     * Clean up memory for non-existent spawns
     */
    cleanupSpawnMemory: function() {
        // Only run this occasionally to save CPU
        if (Game.time % 100 !== 0) return;
        
        // Clean up memory for non-existent spawns
        for (const name in Memory.spawns) {
            if (!Game.spawns[name]) {
                delete Memory.spawns[name];
            }
        }
    },
    
    /**
     * Clean up room memory for rooms we no longer have visibility of
     */
    cleanupRoomMemory: function() {
        // Only run this occasionally to save CPU
        if (Game.time % 200 !== 0) return;
        
        // Get list of rooms we have visibility of
        const visibleRooms = new Set(Object.keys(Game.rooms));
        
        // Clean up memory for rooms we no longer have visibility of
        for (const name in Memory.rooms) {
            // Skip rooms we have visibility of
            if (visibleRooms.has(name)) continue;
            
            // Skip rooms with our controller
            if (Memory.rooms[name].controller && Memory.rooms[name].controller.my) continue;
            
            // Skip rooms with important data we want to keep
            if (Memory.rooms[name].important) continue;
            
            // Clean up temporary data for rooms we don't have visibility of
            if (Memory.rooms[name].temp) {
                delete Memory.rooms[name].temp;
            }
            
            // Clean up scout data older than 10000 ticks
            if (Memory.rooms[name].lastScout && Game.time - Memory.rooms[name].lastScout > 10000) {
                delete Memory.rooms[name];
            }
        }
    },
    
    /**
     * Clean up cached data
     */
    cleanupCachedData: function() {
        // Clean up CPU history
        if (global.cpuHistory && global.cpuHistory.length > 100) {
            global.cpuHistory = global.cpuHistory.slice(-100);
        }
        
        // Clean up error log
        if (global.errors && global.errors.length > 20) {
            global.errors = global.errors.slice(-20);
        }
        
        // Clean up old error log entries
        const currentTick = Game.time;
        for (const key in global.errorLog) {
            if (currentTick - global.errorLog[key] > 10000) {
                delete global.errorLog[key];
            }
        }
        
        // Clean up utils cache
        if (utils.cleanCache) {
            utils.cleanCache();
        }
        
        // Clean up movement manager cache
        const movementManager = require('movementManager');
        if (movementManager.cleanCache) {
            movementManager.cleanCache();
        }
        
        // Clean up room manager cache
        const roomManager = require('roomManager');
        if (roomManager.cleanCache) {
            roomManager.cleanCache();
        }
    },
    
    /**
     * Track CPU usage
     */
    trackCpuUsage: function() {
        // Track CPU usage
        const cpuUsed = Game.cpu.getUsed();
        
        // Add to history
        if (global.cpuHistory) {
            global.cpuHistory.push(cpuUsed);
            
            // Keep history at a reasonable size
            if (global.cpuHistory.length > 100) {
                global.cpuHistory.shift();
            }
        }
        
        // Update stats
        if (Memory.stats) {
            Memory.stats.cpu = Memory.stats.cpu || {};
            Memory.stats.cpu.used = cpuUsed;
            Memory.stats.cpu.bucket = Game.cpu.bucket;
            Memory.stats.cpu.limit = Game.cpu.limit;
            
            // Calculate average CPU usage
            if (global.cpuHistory && global.cpuHistory.length > 0) {
                Memory.stats.cpu.average = global.cpuHistory.reduce((sum, val) => sum + val, 0) / global.cpuHistory.length;
            }
        }
    },
    
    /**
     * Get memory statistics
     * @returns {Object} - Memory statistics
     */
    getMemoryStats: function() {
        // Calculate memory usage
        const memorySize = RawMemory.get().length;
        
        // Calculate sizes of different memory sections
        const creepsSize = JSON.stringify(Memory.creeps).length;
        const roomsSize = JSON.stringify(Memory.rooms).length;
        const flagsSize = JSON.stringify(Memory.flags).length;
        const spawnsSize = JSON.stringify(Memory.spawns).length;
        const statsSize = JSON.stringify(Memory.stats).length;
        
        return {
            total: memorySize,
            creeps: creepsSize,
            rooms: roomsSize,
            flags: flagsSize,
            spawns: spawnsSize,
            stats: statsSize,
            other: memorySize - (creepsSize + roomsSize + flagsSize + spawnsSize + statsSize)
        };
    },
    
    /**
     * Log memory statistics
     */
    logMemoryStats: function() {
        // Only run this occasionally to save CPU
        if (Game.time % 100 !== 0) return;
        
        // Get memory statistics
        const stats = this.getMemoryStats();
        
        // Log memory statistics
        console.log(`Memory usage: ${(stats.total / 1024).toFixed(2)} KB total, ` +
            `${(stats.creeps / 1024).toFixed(2)} KB creeps, ` +
            `${(stats.rooms / 1024).toFixed(2)} KB rooms, ` +
            `${(stats.flags / 1024).toFixed(2)} KB flags, ` +
            `${(stats.spawns / 1024).toFixed(2)} KB spawns, ` +
            `${(stats.stats / 1024).toFixed(2)} KB stats, ` +
            `${(stats.other / 1024).toFixed(2)} KB other`);
    },
    
    /**
     * Compress room memory to save space
     * @param {string} roomName - Name of the room to compress
     */
    compressRoomMemory: function(roomName) {
        // Skip if room memory doesn't exist
        if (!Memory.rooms[roomName]) return;
        
        // Get room memory
        const roomMemory = Memory.rooms[roomName];
        
        // Compress construction data
        if (roomMemory.construction) {
            // Compress road positions
            if (roomMemory.construction.roads && 
                roomMemory.construction.roads.positions && 
                roomMemory.construction.roads.positions.length > 0) {
                
                // Convert positions to compressed format
                const compressedPositions = roomMemory.construction.roads.positions.map(pos => [pos.x, pos.y]);
                roomMemory.construction.roads.positions = compressedPositions;
            }
            
            // Compress extension positions
            if (roomMemory.construction.extensions && 
                roomMemory.construction.extensions.positions && 
                roomMemory.construction.extensions.positions.length > 0) {
                
                // Convert positions to compressed format
                const compressedPositions = roomMemory.construction.extensions.positions.map(pos => [pos.x, pos.y]);
                roomMemory.construction.extensions.positions = compressedPositions;
            }
            
            // Compress container positions
            if (roomMemory.construction.containers && 
                roomMemory.construction.containers.positions && 
                roomMemory.construction.containers.positions.length > 0) {
                
                // Convert positions to compressed format
                const compressedPositions = roomMemory.construction.containers.positions.map(pos => [pos.x, pos.y]);
                roomMemory.construction.containers.positions = compressedPositions;
            }
            
            // Compress tower positions
            if (roomMemory.construction.towers && 
                roomMemory.construction.towers.positions && 
                roomMemory.construction.towers.positions.length > 0) {
                
                // Convert positions to compressed format
                const compressedPositions = roomMemory.construction.towers.positions.map(pos => [pos.x, pos.y]);
                roomMemory.construction.towers.positions = compressedPositions;
            }
        }
    },
    
    /**
     * Decompress room memory
     * @param {string} roomName - Name of the room to decompress
     */
    decompressRoomMemory: function(roomName) {
        // Skip if room memory doesn't exist
        if (!Memory.rooms[roomName]) return;
        
        // Get room memory
        const roomMemory = Memory.rooms[roomName];
        
        // Decompress construction data
        if (roomMemory.construction) {
            // Decompress road positions
            if (roomMemory.construction.roads && 
                roomMemory.construction.roads.positions && 
                roomMemory.construction.roads.positions.length > 0 &&
                Array.isArray(roomMemory.construction.roads.positions[0])) {
                
                // Convert positions to expanded format
                const expandedPositions = roomMemory.construction.roads.positions.map(pos => ({ x: pos[0], y: pos[1] }));
                roomMemory.construction.roads.positions = expandedPositions;
            }
            
            // Decompress extension positions
            if (roomMemory.construction.extensions && 
                roomMemory.construction.extensions.positions && 
                roomMemory.construction.extensions.positions.length > 0 &&
                Array.isArray(roomMemory.construction.extensions.positions[0])) {
                
                // Convert positions to expanded format
                const expandedPositions = roomMemory.construction.extensions.positions.map(pos => ({ x: pos[0], y: pos[1] }));
                roomMemory.construction.extensions.positions = expandedPositions;
            }
            
            // Decompress container positions
            if (roomMemory.construction.containers && 
                roomMemory.construction.containers.positions && 
                roomMemory.construction.containers.positions.length > 0 &&
                Array.isArray(roomMemory.construction.containers.positions[0])) {
                
                // Convert positions to expanded format
                const expandedPositions = roomMemory.construction.containers.positions.map(pos => ({ x: pos[0], y: pos[1] }));
                roomMemory.construction.containers.positions = expandedPositions;
            }
            
            // Decompress tower positions
            if (roomMemory.construction.towers && 
                roomMemory.construction.towers.positions && 
                roomMemory.construction.towers.positions.length > 0 &&
                Array.isArray(roomMemory.construction.towers.positions[0])) {
                
                // Convert positions to expanded format
                const expandedPositions = roomMemory.construction.towers.positions.map(pos => ({ x: pos[0], y: pos[1] }));
                roomMemory.construction.towers.positions = expandedPositions;
            }
        }
    }
};

module.exports = memoryManager;