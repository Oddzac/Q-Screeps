/**
 * Global construction functions
 */
const construction = require('construction');

module.exports = {
    checkNextConstructionSites: function(roomName, limit = 10) {
        const room = Game.rooms[roomName];
        if (!room) return `No visibility in room ${roomName}`;
        
        const nextSites = construction.getNextConstructionSites(room, limit);
        
        if (nextSites.length === 0) return `No pending construction sites found in ${roomName}`;
        
        let output = `Next ${nextSites.length} construction sites in ${roomName}:\n`;
        for (const site of nextSites) {
            output += `- ${site.type} at (${site.x},${site.y})\n`;
        }
        
        return output;
    },
    
    diagnosisConstruction: function(roomName) {
        const room = Game.rooms[roomName];
        if (!room) return `No visibility in room ${roomName}`;
        
        return construction.diagnosisConstruction(room);
    },
    
    analyzeRoomPlanAlignment: function(roomName) {
        const room = Game.rooms[roomName];
        if (!room) return `No visibility in room ${roomName}`;
        
        const result = construction.analyzeRoomPlanAlignment(room);
        return result.summary;
    },
    
    checkPlanningStatus: function(roomName) {
        const room = Game.rooms[roomName];
        if (!room) return `No visibility in room ${roomName}`;
        
        return construction.checkPlanningStatus(room);
    },
    
    forceConstruction: function(roomName, count = 5) {
        const room = Game.rooms[roomName];
        if (!room) return `No visibility in room ${roomName}`;
        
        if (room.memory.roomPlan) {
            const sites = room.find(FIND_CONSTRUCTION_SITES);
            console.log(`Room ${roomName} currently has ${sites.length} construction sites`);
            
            // Force create sites from the room plan
            const created = construction.createConstructionSitesFromPlan(room);
            
            const newSites = room.find(FIND_CONSTRUCTION_SITES);
            return `Force created ${created} construction sites in ${roomName}. Sites before: ${sites.length}, after: ${newSites.length}`;
        } else {
            // No room plan, try to generate one first
            console.log(`Room ${roomName} has no room plan. Generating one...`);
            const success = construction.generateRoomPlan(room);
            
            if (!success) {
                return `Failed to generate room plan for ${roomName}. Check console for errors.`;
            }
            
            // Now create sites from the new plan
            const sites = room.find(FIND_CONSTRUCTION_SITES);
            const created = construction.createConstructionSitesFromPlan(room);
            
            const newSites = room.find(FIND_CONSTRUCTION_SITES);
            return `Generated room plan and created ${created} construction sites in ${roomName}. Sites before: ${sites.length}, after: ${newSites.length}`;
        }
    },
    
    generateRoomPlan: function(roomName) {
        const room = Game.rooms[roomName];
        if (!room) return `No visibility in room ${roomName}`;
        
        if (!room.controller || !room.controller.my) return `You don't control room ${roomName}`;
        
        const success = construction.generateRoomPlan(room);
        
        if (success) {
            construction.visualizeRoomPlan(room);
            return `Generated and visualized complete room plan for ${roomName}`;
        } else {
            return `Failed to generate room plan for ${roomName}`;
        }
    },
    
    refreshRoomPlan: function(roomName) {
        const room = Game.rooms[roomName];
        if (!room) return `No visibility in room ${roomName}`;
        
        if (!room.controller || !room.controller.my) return `You don't control room ${roomName}`;
        
        // Delete the existing plan to force a complete regeneration
        delete room.memory.roomPlan;
        
        // Generate a new plan with the updated defensive structure logic
        const success = construction.generateRoomPlan(room);
        
        if (success) {
            construction.visualizeRoomPlan(room);
            return `Successfully refreshed and visualized room plan for ${roomName} with updated defensive structures`;
        } else {
            return `Failed to refresh room plan for ${roomName}`;
        }
    },
    
    visualizeRoomPlan: function(roomName, rcl = 0) {
        const room = Game.rooms[roomName];
        if (!room) return `No visibility in room ${roomName}`;
        
        if (!room.memory.roomPlan) {
            return `No room plan exists for ${roomName}. Generate a plan first with global.generateRoomPlan('${roomName}')`;
        }
        
        if (!Memory.visualizePlans) Memory.visualizePlans = {};
        
        if (Memory.visualizePlans[roomName]) {
            delete Memory.visualizePlans[roomName];
            room.visual.clear();
            return `Room plan visualization for ${roomName} turned OFF`;
        } else {
            Memory.visualizePlans[roomName] = { rcl: rcl, lastUpdated: Game.time };
            construction.visualizeRoomPlan(room, rcl);
            return `Room plan visualization for ${roomName}${rcl > 0 ? ` at RCL ${rcl}` : ' (all RCLs)'} turned ON`;
        }
    }
};