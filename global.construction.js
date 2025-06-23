/**
 * Global construction utility functions
 */
const construction = require('construction');

// Export global functions for construction operations
module.exports = {
    /**
     * Check next planned construction sites
     * @param {string} roomName - Name of the room to check
     * @param {number} limit - Maximum number of sites to return
     * @returns {string} - List of next planned sites
     */
    checkNextConstructionSites: function(roomName, limit = 10) {
        const room = Game.rooms[roomName];
        if (!room) {
            return `No visibility in room ${roomName}`;
        }
        
        const nextSites = construction.getNextConstructionSites(room, limit);
        
        let output = `Next planned construction sites for ${roomName}:\n`;
        if (nextSites.length === 0) {
            output += "No pending construction sites found.\n";
            return output;
        }
        
        // Count road sites separately to avoid excessive output
        const roadSites = nextSites.filter(site => site.type === 'road');
        const nonRoadSites = nextSites.filter(site => site.type !== 'road');
        
        // Show non-road sites first
        for (const site of nonRoadSites) {
            output += `- ${site.type} at (${site.x},${site.y})\n`;
        }
        
        // Show limited road sites
        const roadLimit = Math.min(5, roadSites.length);
        for (let i = 0; i < roadLimit; i++) {
            const site = roadSites[i];
            output += `- Road at (${site.x},${site.y})\n`;
        }
        
        // Show count of remaining roads
        if (roadSites.length > roadLimit) {
            output += `- ... and ${roadSites.length - roadLimit} more roads\n`;
        }
        
        return output;
    },
    
    /**
     * Check planning status for a room
     * @param {string} roomName - Name of the room to check
     * @returns {string} - Planning status report
     */
    checkPlanningStatus: function(roomName) {
        const room = Game.rooms[roomName];
        if (!room) {
            return `No visibility in room ${roomName}`;
        }
        
        return construction.checkPlanningStatus(room);
    },
    
    /**
     * Diagnose construction issues in a room
     * @param {string} roomName - Name of the room to diagnose
     * @returns {string} - Diagnostic report
     */
    diagnosisConstruction: function(roomName) {
        const room = Game.rooms[roomName];
        if (!room) {
            return `No visibility in room ${roomName}`;
        }
        
        return construction.diagnosisConstruction(room);
    },
    
    /**
     * Analyze room plan alignment
     * @param {string} roomName - Name of the room to analyze
     * @returns {Object|string} - Analysis results or error message
     */
    analyzeRoomPlanAlignment: function(roomName) {
        const room = Game.rooms[roomName];
        if (!room) {
            return `No visibility in room ${roomName}`;
        }
        
        const result = construction.analyzeRoomPlanAlignment(room);
        console.log(result.summary);
        return result;
    },
    
    /**
     * Force construction site creation
     * @param {string} roomName - Name of the room
     * @param {number} count - Number of sites to create
     * @returns {string} - Result message
     */
    forceConstruction: function(roomName, count = 1) {
        const room = Game.rooms[roomName];
        if (!room) {
            return `No visibility in room ${roomName}`;
        }
        
        const sites = room.find(FIND_CONSTRUCTION_SITES);
        console.log(`Room ${roomName} currently has ${sites.length} construction sites`);
        
        // Force create construction sites
        const created = construction.forceConstructionSite(room, count);
        
        // Count how many sites were created
        const newSites = room.find(FIND_CONSTRUCTION_SITES);
        return `Force created ${created} construction sites in ${roomName}. Sites before: ${sites.length}, after: ${newSites.length}`;
    },
    
    /**
     * Generate a complete room plan
     * @param {string} roomName - Name of the room
     * @returns {string} - Result message
     */
    generateRoomPlan: function(roomName) {
        const room = Game.rooms[roomName];
        if (!room) {
            return `No visibility in room ${roomName}`;
        }
        
        if (!room.controller || !room.controller.my) {
            return `You don't control room ${roomName}`;
        }
        
        const success = construction.generateRoomPlan(room);
        
        if (success) {
            // Visualize the plan
            construction.visualizeRoomPlan(room);
            return `Generated and visualized complete room plan for ${roomName}`;
        } else {
            return `Failed to generate room plan for ${roomName}`;
        }
    },
    
    /**
     * Visualize room plan with toggle functionality
     * @param {string} roomName - Name of the room
     * @param {number} rcl - RCL level to visualize (0 for all levels)
     * @returns {string} - Result message
     */
    visualizeRoomPlan: function(roomName, rcl = 0) {
        const room = Game.rooms[roomName];
        if (!room) {
            return `No visibility in room ${roomName}`;
        }
        
        if (!room.memory.roomPlan) {
            return `No room plan exists for ${roomName}. Generate a plan first with global.generateRoomPlan('${roomName}')`;
        }
        
        // Toggle visualization state
        if (!Memory.visualizePlans) Memory.visualizePlans = {};
        
        if (Memory.visualizePlans[roomName]) {
            // Turn off visualization
            delete Memory.visualizePlans[roomName];
            room.visual.clear();
            return `Room plan visualization for ${roomName} turned OFF`;
        } else {
            // Turn on visualization
            Memory.visualizePlans[roomName] = { rcl: rcl, lastUpdated: Game.time };
            construction.visualizeRoomPlan(room, rcl);
            return `Room plan visualization for ${roomName}${rcl > 0 ? ` at RCL ${rcl}` : ' (all RCLs)'} turned ON`;
        }
    }
};