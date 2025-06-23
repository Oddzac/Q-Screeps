/**
 * Analyzes the alignment between actual structures and the room plan
 */
module.exports = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    if (!room.memory.roomPlan) {
        return `No room plan exists for ${roomName}`;
    }
    
    // Get current RCL plan
    const rcl = room.controller.level;
    const rclPlan = room.memory.roomPlan.rcl[rcl];
    if (!rclPlan) {
        return `No plan exists for RCL ${rcl} in room ${roomName}`;
    }
    
    // Initialize result object
    const result = {
        aligned: true,
        structureTypes: {},
        misalignedStructures: [],
        missingStructures: [],
        extraStructures: [],
        summary: ""
    };
    
    // Find all structures in the room
    const structures = room.find(FIND_STRUCTURES);
    const structuresByType = _.groupBy(structures, s => s.structureType);
    
    // Find all construction sites
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    const sitesByType = _.groupBy(sites, s => s.structureType);
    
    // Create position maps for planned structures
    const plannedPositions = {};
    for (const structureType in rclPlan.structures) {
        plannedPositions[structureType] = new Set();
        for (const pos of rclPlan.structures[structureType]) {
            plannedPositions[structureType].add(`${pos.x},${pos.y}`);
        }
    }
    
    // Check each structure type
    for (const structureType in CONTROLLER_STRUCTURES) {
        // Skip if this structure type isn't in the plan
        if (!rclPlan.structures[structureType]) continue;
        
        const planned = rclPlan.structures[structureType].length;
        const existing = (structuresByType[structureType] || []).length;
        const building = (sitesByType[structureType] || []).length;
        const total = existing + building;
        const max = CONTROLLER_STRUCTURES[structureType][rcl] || 0;
        
        result.structureTypes[structureType] = {
            planned,
            existing,
            building,
            total,
            max,
            aligned: true,
            misaligned: 0
        };
        
        // Check if each existing structure is in the plan
        if (structuresByType[structureType]) {
            for (const structure of structuresByType[structureType]) {
                const posKey = `${structure.pos.x},${structure.pos.y}`;
                if (!plannedPositions[structureType] || !plannedPositions[structureType].has(posKey)) {
                    result.aligned = false;
                    result.structureTypes[structureType].aligned = false;
                    result.structureTypes[structureType].misaligned++;
                    result.misalignedStructures.push({
                        type: structureType,
                        x: structure.pos.x,
                        y: structure.pos.y,
                        id: structure.id
                    });
                }
            }
        }
        
        // Check for missing planned structures
        if (plannedPositions[structureType] && total < planned && total < max) {
            // Find positions that don't have structures or sites
            for (const posKey of plannedPositions[structureType]) {
                const [x, y] = posKey.split(',').map(Number);
                
                // Check if there's a structure here
                const hasStructure = structuresByType[structureType] && 
                    structuresByType[structureType].some(s => s.pos.x === x && s.pos.y === y);
                
                // Check if there's a site here
                const hasSite = sitesByType[structureType] && 
                    sitesByType[structureType].some(s => s.pos.x === x && s.pos.y === y);
                
                if (!hasStructure && !hasSite) {
                    result.missingStructures.push({
                        type: structureType,
                        x,
                        y
                    });
                }
            }
        }
        
        // Check for extra structures beyond the plan
        if (total > planned) {
            result.extraStructures.push({
                type: structureType,
                count: total - planned
            });
        }
    }
    
    // Update construction memory with accurate counts
    if (!room.memory.construction) {
        room.memory.construction = {};
    }
    
    // Update extension count
    if (structuresByType[STRUCTURE_EXTENSION]) {
        if (!room.memory.construction.extensions) {
            room.memory.construction.extensions = { planned: true, count: 0 };
        }
        room.memory.construction.extensions.count = structuresByType[STRUCTURE_EXTENSION].length;
    }
    
    // Update tower count
    if (structuresByType[STRUCTURE_TOWER]) {
        if (!room.memory.construction.towers) {
            room.memory.construction.towers = { planned: true, count: 0 };
        }
        room.memory.construction.towers.count = structuresByType[STRUCTURE_TOWER].length;
    }
    
    // Create summary
    let summary = `Room Plan Alignment for ${roomName} (RCL ${rcl}):\n`;
    summary += `Overall alignment: ${result.aligned ? 'ALIGNED' : 'MISALIGNED'}\n\n`;
    
    summary += `Structure counts:\n`;
    for (const type in result.structureTypes) {
        const data = result.structureTypes[type];
        summary += `- ${type}: ${data.existing}/${data.planned} built, ${data.building} building, ${data.max} max\n`;
        if (!data.aligned) {
            summary += `  ⚠️ ${data.misaligned} misaligned\n`;
        }
    }
    
    if (result.misalignedStructures.length > 0) {
        summary += `\nMisaligned structures (${result.misalignedStructures.length}):\n`;
        for (const structure of result.misalignedStructures) {
            summary += `- ${structure.type} at (${structure.x},${structure.y})\n`;
        }
    }
    
    if (result.missingStructures.length > 0) {
        summary += `\nMissing structures (${result.missingStructures.length}):\n`;
        const byType = _.groupBy(result.missingStructures, s => s.type);
        for (const type in byType) {
            summary += `- ${type}: ${byType[type].length}\n`;
        }
    }
    
    if (result.extraStructures.length > 0) {
        summary += `\nExtra structures:\n`;
        for (const extra of result.extraStructures) {
            summary += `- ${extra.type}: ${extra.count} more than planned\n`;
        }
    }
    
    result.summary = summary;
    console.log(summary);
    
    return result;
};