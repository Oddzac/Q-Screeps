/**
 * Room Optimizer - Optimizes room operations to reduce CPU usage
 */

const roomOptimizer = {
    /**
     * Initialize the optimizer
     */
    init: function() {
        if (!global._roomCache) {
            global._roomCache = {
                structures: {},
                sites: {},
                lookAt: {},
                structureMaps: {},
                siteMaps: {},
                lastCleanup: Game.time
            };
        }
        
        // Periodically clean up caches
        if (Game.time - global._roomCache.lastCleanup > 1000) {
            this.cleanupCaches();
            global._roomCache.lastCleanup = Game.time;
        }
    },
    
    /**
     * Clean up old cache entries
     */
    cleanupCaches: function() {
        // Clean up structure cache
        for (const roomName in global._roomCache.structures) {
            if (!Game.rooms[roomName] || Game.time - global._roomCache.structures[roomName].time > 500) {
                delete global._roomCache.structures[roomName];
            }
        }
        
        // Clean up site cache
        for (const roomName in global._roomCache.sites) {
            if (!Game.rooms[roomName] || Game.time - global._roomCache.sites[roomName].time > 100) {
                delete global._roomCache.sites[roomName];
            }
        }
        
        // Clean up lookAt cache
        for (const roomName in global._roomCache.lookAt) {
            if (!Game.rooms[roomName] || Game.time - global._roomCache.lookAt[roomName].time > 200) {
                delete global._roomCache.lookAt[roomName];
            }
        }
        
        // Clean up structure maps cache
        for (const roomName in global._roomCache.structureMaps) {
            if (!Game.rooms[roomName] || Game.time - global._roomCache.structureMaps[roomName].time > 100) {
                delete global._roomCache.structureMaps[roomName];
            }
        }
        
        // Clean up site maps cache
        for (const roomName in global._roomCache.siteMaps) {
            if (!Game.rooms[roomName] || Game.time - global._roomCache.siteMaps[roomName].time > 50) {
                delete global._roomCache.siteMaps[roomName];
            }
        }
    },
    
    /**
     * Get cached room objects by type
     * @param {Room} room - The room to get objects for
     * @param {string} findType - FIND_* constant
     * @param {function} [filter] - Optional filter function
     * @returns {Array} - Array of objects
     */
    getCachedObjects: function(room, findType, filter) {
        this.init();
        
        const cacheKey = `${findType}${filter ? '_filtered' : ''}`;
        
        if (!global._roomCache.structures[room.name]) {
            global._roomCache.structures[room.name] = {
                time: Game.time,
                objects: {}
            };
        }
        
        const cache = global._roomCache.structures[room.name];
        
        if (!cache.objects[cacheKey] || Game.time - cache.time > 50) {
            cache.time = Game.time;
            cache.objects[cacheKey] = room.find(findType, filter ? { filter } : undefined);
        }
        
        return cache.objects[cacheKey];
    },
    
    /**
     * Get cached structures by type
     * @param {Room} room - The room to get structures for
     * @returns {Object} - Structures grouped by type
     */
    getCachedStructuresByType: function(room) {
        this.init();
        
        if (!global._roomCache.structures[room.name] || 
            !global._roomCache.structures[room.name].byType ||
            Game.time - global._roomCache.structures[room.name].time > 50) {
            
            const structures = this.getCachedObjects(room, FIND_STRUCTURES);
            
            if (!global._roomCache.structures[room.name]) {
                global._roomCache.structures[room.name] = { time: Game.time };
            }
            
            global._roomCache.structures[room.name].byType = _.groupBy(structures, s => s.structureType);
            global._roomCache.structures[room.name].time = Game.time;
        }
        
        return global._roomCache.structures[room.name].byType;
    },
    
    /**
     * Get cached construction sites
     * @param {Room} room - The room to get sites for
     * @returns {Object} - Site cache object
     */
    getCachedConstructionSites: function(room) {
        this.init();
        
        if (!global._roomCache.sites[room.name] || Game.time - global._roomCache.sites[room.name].time > 20) {
            const sites = room.find(FIND_CONSTRUCTION_SITES);
            
            global._roomCache.sites[room.name] = {
                time: Game.time,
                sites: sites,
                count: sites.length,
                ids: sites.map(site => site.id),
                byType: _.groupBy(sites, s => s.structureType)
            };
        }
        
        return global._roomCache.sites[room.name];
    },
    
    /**
     * Get cached lookAt results
     * @param {Room} room - The room to look in
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Array} - lookAt results
     */
    getCachedLookAt: function(room, x, y) {
        this.init();
        
        if (!global._roomCache.lookAt[room.name]) {
            global._roomCache.lookAt[room.name] = {
                time: Game.time,
                positions: {}
            };
        }
        
        const posKey = `${x},${y}`;
        
        if (!global._roomCache.lookAt[room.name].positions[posKey]) {
            global._roomCache.lookAt[room.name].positions[posKey] = room.lookAt(x, y);
        }
        
        return global._roomCache.lookAt[room.name].positions[posKey];
    },
    
    /**
     * Check if a position has structures that would block placement
     * @param {Room} room - The room to check
     * @param {Object} pos - Position {x, y}
     * @param {string} structureType - Type of structure to place
     * @returns {boolean} - True if position has blocking structures
     */
    hasBlockingStructure: function(room, pos, structureType) {
        const lookResult = this.getCachedLookAt(room, pos.x, pos.y);
        
        for (const item of lookResult) {
            if (item.type === LOOK_STRUCTURES && 
                (structureType !== STRUCTURE_ROAD || item.structure.structureType !== STRUCTURE_RAMPART)) {
                return true;
            }
        }
        
        return false;
    },
    
    /**
     * Create a map of existing structures for faster lookups
     * @param {Room} room - The room to create the map for
     * @returns {Map} - Map with keys in format "x,y,structureType"
     */
    createStructureMap: function(room) {
        this.init();
        
        if (!global._roomCache.structureMaps[room.name] || 
            Game.time - global._roomCache.structureMaps[room.name].time > 20) {
            
            // Get structures from cache or find them
            const structures = this.getCachedObjects(room, FIND_STRUCTURES);
            
            // Create the map
            const structureMap = new Map();
            for (const structure of structures) {
                const key = `${structure.pos.x},${structure.pos.y},${structure.structureType}`;
                structureMap.set(key, true);
                
                // Also add a key without structure type for position-only checks
                const posKey = `${structure.pos.x},${structure.pos.y}`;
                structureMap.set(posKey, true);
            }
            
            // Cache the map
            global._roomCache.structureMaps[room.name] = {
                time: Game.time,
                map: structureMap
            };
        }
        
        return global._roomCache.structureMaps[room.name].map;
    },
    
    /**
     * Create a map of existing construction sites for faster lookups
     * @param {Room} room - The room to create the map for
     * @returns {Map} - Map with keys in format "x,y,structureType"
     */
    createSiteMap: function(room) {
        this.init();
        
        if (!global._roomCache.siteMaps[room.name] || 
            Game.time - global._roomCache.siteMaps[room.name].time > 10) {
            
            // Get sites from cache or find them
            const siteCache = this.getCachedConstructionSites(room);
            const sites = siteCache.sites;
            
            // Create the map
            const siteMap = new Map();
            for (const site of sites) {
                const key = `${site.pos.x},${site.pos.y},${site.structureType}`;
                siteMap.set(key, true);
                
                // Also add a key without structure type for position-only checks
                const posKey = `${site.pos.x},${site.pos.y}`;
                siteMap.set(posKey, true);
            }
            
            // Cache the map
            global._roomCache.siteMaps[room.name] = {
                time: Game.time,
                map: siteMap
            };
        }
        
        return global._roomCache.siteMaps[room.name].map;
    }
};

module.exports = roomOptimizer;