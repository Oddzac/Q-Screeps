/**
 * Construction Optimizer - Optimizes construction operations to reduce CPU usage
 */

const constructionOptimizer = {
    /**
     * Get cached structure data by type
     * @param {Room} room - The room to get structures for
     * @returns {Object} - Structures grouped by type
     */
    getCachedStructuresByType: function(room) {
        // Use global cache to avoid repeated lookups
        if (!global._structureCache) global._structureCache = {};
        if (!global._structureCache[room.name] || Game.time - (global._structureCache[room.name].time || 0) > 50) {
            // Cache for 50 ticks since structures don't change often
            const structures = room.find(FIND_STRUCTURES);
            global._structureCache[room.name] = {
                time: Game.time,
                data: _.groupBy(structures, s => s.structureType)
            };
        }
        return global._structureCache[room.name].data;
    },
    
    /**
     * Get cached construction site data
     * @param {Room} room - The room to get sites for
     * @returns {Array} - Construction sites in the room
     */
    getCachedConstructionSites: function(room) {
        // Use cached site data if available
        if (!global._siteCache) global._siteCache = {};
        if (!global._siteCache[room.name] || Game.time - global._siteCache[room.name].time >= 20) {
            // Find all construction sites in the room
            const sites = room.find(FIND_CONSTRUCTION_SITES);
            
            // Cache the results
            global._siteCache[room.name] = {
                time: Game.time,
                sites: sites,
                count: sites.length,
                ids: sites.map(site => site.id)
            };
        }
        return global._siteCache[room.name];
    },
    
    /**
     * Get cached lookAt results for a position
     * @param {Room} room - The room to look in
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Array} - lookAt results
     */
    getCachedLookAt: function(room, x, y) {
        const posKey = `${x},${y}`;
        if (!global._lookAtCache) global._lookAtCache = {};
        if (!global._lookAtCache[room.name]) global._lookAtCache[room.name] = {};
        
        if (!global._lookAtCache[room.name][posKey] || Game.time - (global._lookAtCache[room.name].time || 0) >= 100) {
            global._lookAtCache[room.name].time = Game.time;
            global._lookAtCache[room.name][posKey] = room.lookAt(x, y);
        }
        
        return global._lookAtCache[room.name][posKey];
    },
    
    /**
     * Clear all caches (use sparingly)
     */
    clearCaches: function() {
        global._structureCache = {};
        global._siteCache = {};
        global._lookAtCache = {};
        console.log('All construction caches cleared');
    },
    
    /**
     * Create a map of existing structures for faster lookups
     * @param {Room} room - The room to check
     * @returns {Map} - Map of structure positions
     */
    createStructureMap: function(room) {
        const structureMap = new Map();
        const structuresByType = this.getCachedStructuresByType(room);
        
        for (const type in structuresByType) {
            for (const structure of structuresByType[type]) {
                const key = `${structure.pos.x},${structure.pos.y},${structure.structureType}`;
                structureMap.set(key, true);
            }
        }
        
        return structureMap;
    },
    
    /**
     * Create a map of existing construction sites for faster lookups
     * @param {Room} room - The room to check
     * @returns {Map} - Map of site positions
     */
    createSiteMap: function(room) {
        const siteMap = new Map();
        const siteCache = this.getCachedConstructionSites(room);
        
        for (const site of siteCache.sites) {
            const key = `${site.pos.x},${site.pos.y},${site.structureType}`;
            siteMap.set(key, true);
        }
        
        return siteMap;
    },
    
    /**
     * Check if a position has any structures that would block placement
     * @param {Room} room - The room to check
     * @param {Object} pos - Position to check
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
    }
};

module.exports = constructionOptimizer;