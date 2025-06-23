/**
 * Check the planning status of a room
 */
module.exports = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    let output = `Planning Status for ${roomName} (RCL ${room.controller.level}):\n`;
    
    // Check if we have a room plan
    const hasRoomPlan = room.memory.roomPlan !== undefined;
    output += `Room Plan: ${hasRoomPlan ? 'EXISTS' : 'MISSING'}\n`;
    
    // Check construction memory
    const hasConstructionMemory = room.memory.construction !== undefined;
    output += `Construction Memory: ${hasConstructionMemory ? 'EXISTS' : 'MISSING'}\n`;
    
    if (hasConstructionMemory) {
        // Check individual structure plans
        const construction = room.memory.construction;
        
        // Define structure types by RCL
        const structuresByRCL = {
            1: ['roads', 'containers'],
            2: ['roads', 'containers', 'extensions'],
            3: ['roads', 'containers', 'extensions', 'towers'],
            4: ['roads', 'containers', 'extensions', 'towers', 'storage'],
            5: ['roads', 'containers', 'extensions', 'towers', 'storage', 'links'],
            6: ['roads', 'containers', 'extensions', 'towers', 'storage', 'links', 'terminal'],
            7: ['roads', 'containers', 'extensions', 'towers', 'storage', 'links', 'terminal', 'labs'],
            8: ['roads', 'containers', 'extensions', 'towers', 'storage', 'links', 'terminal', 'labs', 'observer', 'powerSpawn', 'nuker']
        };
        
        // Get structures for current RCL
        const relevantStructures = structuresByRCL[room.controller.level] || [];
        
        output += `\nStructure Planning Status:\n`;
        for (const structureType of relevantStructures) {
            const isPlanned = construction[structureType] && construction[structureType].planned;
            output += `- ${structureType}: ${isPlanned ? 'Planned' : 'Not Planned'}`;
            
            // Add count for countable structures
            if (['extensions', 'towers', 'links'].includes(structureType) && construction[structureType]) {
                output += ` (Count: ${construction[structureType].count || 0})`;
            }
            
            // Add position count for structures with positions
            if (construction[structureType] && construction[structureType].positions) {
                output += ` (Positions: ${construction[structureType].positions.length})`;
            }
            
            output += `\n`;
        }
        
        // Check for misaligned structures
        if (construction.misaligned && construction.misaligned.length > 0) {
            output += `\nMisaligned Structures: ${construction.misaligned.length}\n`;
            
            // Group by type
            const byType = {};
            for (const misaligned of construction.misaligned) {
                byType[misaligned.type] = (byType[misaligned.type] || 0) + 1;
            }
            
            for (const type in byType) {
                output += `- ${type}: ${byType[type]}\n`;
            }
        }
        
        // Check construction sites
        const sites = room.find(FIND_CONSTRUCTION_SITES);
        output += `\nConstruction Sites: ${sites.length}\n`;
        
        // Group by type
        const sitesByType = _.groupBy(sites, site => site.structureType);
        for (const type in sitesByType) {
            output += `- ${type}: ${sitesByType[type].length}\n`;
        }
        
        // Check next planned sites
        const constructionManager = require('constructionManager');
        const nextSites = constructionManager.getNextConstructionSites(room, 5);
        
        if (nextSites.length > 0) {
            output += `\nNext Planned Sites:\n`;
            for (const site of nextSites) {
                output += `- ${site.type} at (${site.x},${site.y})\n`;
            }
        }
    }
    
    return output;
};