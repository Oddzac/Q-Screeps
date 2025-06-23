/**
 * Global function to diagnose construction issues
 */
module.exports = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    let output = `Construction Diagnosis for ${roomName}:\n`;
    
    // Check RCL
    output += `Room Control Level: ${room.controller.level}\n`;
    
    // Check if we have a room plan
    const hasRoomPlan = room.memory.roomPlan !== undefined;
    output += `Room Plan: ${hasRoomPlan ? 'EXISTS' : 'MISSING'}\n`;
    
    // Check construction memory
    const hasConstructionMemory = room.memory.construction !== undefined;
    output += `Construction Memory: ${hasConstructionMemory ? 'EXISTS' : 'MISSING'}\n`;
    
    if (hasConstructionMemory) {
        // Check individual structure plans
        const construction = room.memory.construction;
        output += `- Roads: ${construction.roads && construction.roads.planned ? 'Planned' : 'Not Planned'}\n`;
        output += `- Extensions: ${construction.extensions && construction.extensions.planned ? 'Planned' : 'Not Planned'}\n`;
        output += `  Extension Count: ${construction.extensions ? construction.extensions.count || 0 : 0}\n`;
        output += `- Containers: ${construction.containers && construction.containers.planned ? 'Planned' : 'Not Planned'}\n`;
        output += `- Towers: ${construction.towers && construction.towers.planned ? 'Planned' : 'Not Planned'}\n`;
        output += `  Tower Count: ${construction.towers ? construction.towers.count || 0 : 0}\n`;
        output += `- Storage: ${construction.storage && construction.storage.planned ? 'Planned' : 'Not Planned'}\n`;
        output += `Last Update: ${construction.lastUpdate ? Game.time - construction.lastUpdate : 'Never'} ticks ago\n`;
        output += `Last Non-Road Tick: ${construction.lastNonRoadTick ? Game.time - construction.lastNonRoadTick : 'Never'} ticks ago\n`;
        output += `Last Structure Type: ${construction.lastStructureType || 'None'}\n`;
    }
    
    // Check existing structures
    const structures = room.find(FIND_STRUCTURES);
    const structuresByType = _.groupBy(structures, s => s.structureType);
    
    output += `\nExisting Structures:\n`;
    for (const type in CONTROLLER_STRUCTURES) {
        const count = (structuresByType[type] || []).length;
        const max = CONTROLLER_STRUCTURES[type][room.controller.level] || 0;
        output += `- ${type}: ${count}/${max}\n`;
    }
    
    // Check construction sites
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    const sitesByType = _.groupBy(sites, s => s.structureType);
    
    output += `\nConstruction Sites (${sites.length}):\n`;
    for (const type in sitesByType) {
        output += `- ${type}: ${sitesByType[type].length}\n`;
    }
    
    // Check next planned sites
    const constructionManager = require('constructionManager');
    const nextSites = constructionManager.getNextConstructionSites(room, 10);
    
    output += `\nNext Planned Sites (${nextSites.length}):\n`;
    for (const site of nextSites) {
        output += `- ${site.type} at (${site.x},${site.y})\n`;
    }
    
    // Check for issues
    output += `\nPotential Issues:\n`;
    
    // Check if we're at the structure limit for any type
    for (const type in CONTROLLER_STRUCTURES) {
        const count = (structuresByType[type] || []).length;
        const max = CONTROLLER_STRUCTURES[type][room.controller.level] || 0;
        if (count >= max && max > 0) {
            output += `- LIMIT REACHED: ${type} (${count}/${max})\n`;
        }
    }
    
    // Check if we have too many construction sites
    if (sites.length >= 100) {
        output += `- TOO MANY SITES: Global limit of 100 construction sites reached\n`;
    } else if (sites.length >= 5) {
        output += `- SITE LIMIT: Room has reached target of 5 construction sites\n`;
    }
    
    // Check for extension count mismatch
    const actualExtensions = (structuresByType[STRUCTURE_EXTENSION] || []).length;
    const extensionSites = (sitesByType[STRUCTURE_EXTENSION] || []).length;
    const storedExtensionCount = hasConstructionMemory && room.memory.construction.extensions ? 
        room.memory.construction.extensions.count || 0 : 0;
    
    if (actualExtensions + extensionSites !== storedExtensionCount) {
        output += `- COUNT MISMATCH: Extensions in memory (${storedExtensionCount}) doesn't match actual (${actualExtensions}) + sites (${extensionSites})\n`;
    }
    
    // Check if we're at RCL limit for extensions
    const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller.level] || 0;
    if (actualExtensions + extensionSites >= maxExtensions) {
        output += `- EXTENSION LIMIT: All ${maxExtensions} extensions for RCL ${room.controller.level} are built or under construction\n`;
    }
    
    // Check if construction manager hasn't run recently
    if (hasConstructionMemory && room.memory.construction.lastUpdate && 
        Game.time - room.memory.construction.lastUpdate > 100) {
        output += `- STALE: Construction manager hasn't run in ${Game.time - room.memory.construction.lastUpdate} ticks\n`;
    }
    
    // Check if we have no next sites
    if (nextSites.length === 0) {
        output += `- NO SITES: No pending construction sites found\n`;
    }
    
    // Provide recommendations
    output += `\nRecommendations:\n`;
    
    if (!hasRoomPlan) {
        output += `- Generate a room plan: global.generateRoomPlan('${roomName}')\n`;
    }
    
    if (nextSites.length > 0 && sites.length < 5) {
        output += `- Force construction site creation: global.forceConstruction('${roomName}', ${5 - sites.length})\n`;
    }
    
    if (actualExtensions + extensionSites !== storedExtensionCount) {
        output += `- Fix extension count: Memory.rooms['${roomName}'].construction.extensions.count = ${actualExtensions + extensionSites}\n`;
    }
    
    return output;
};