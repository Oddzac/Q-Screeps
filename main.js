/**
 * Main game loop - CPU optimized
 */
const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleBuilder = require('role.builder');
const roleHauler = require('role.hauler');
const roomManager = require('roomManager');
const spawnManager = require('spawnManager');
const constructionManager = require('constructionManager');
const defenseManager = require('defenseManager');
const remoteManager = require('remoteManager');
const movementManager = require('movementManager');
const utils = require('utils');

// Global performance tracking
global.stats = {
    cpu: {
        total: 0,
        roomManagement: 0,
        creepActions: 0,
        spawning: 0,
        construction: 0,
        memoryCleanup: 0,
        ticks: 0
    }
};

// Global utility functions
global.utils = utils;

// Debug function to check builder status
global.checkBuilders = function() {
    let builders = _.filter(Game.creeps, creep => creep.memory.role === 'builder');
    console.log(`Found ${builders.length} builders`);
    
    for (let builder of builders) {
        console.log(`Builder ${builder.name}: 
            - Energy: ${builder.store[RESOURCE_ENERGY]}/${builder.store.getCapacity()}
            - Building mode: ${builder.memory.building ? 'YES' : 'NO'}
            - Target: ${builder.memory.targetId || 'none'}
            - Energy source: ${builder.memory.energySourceId || 'none'}
        `);
    }
    
    // Check construction sites
    for (let roomName in Game.rooms) {
        const sites = Game.rooms[roomName].find(FIND_CONSTRUCTION_SITES);
        console.log(`Room ${roomName} has ${sites.length} construction sites:`);
        for (let site of sites) {
            console.log(`- ${site.structureType} at ${site.pos.x},${site.pos.y}: ${site.progress}/${site.progressTotal}`);
        }
    }
    
    return "Builder status check complete";
};

// Special function for simulation rooms
global.simConstruction = function() {
    for (const roomName in Game.rooms) {
        if (roomName.startsWith('sim')) {
            console.log(`Forcing construction planning in simulation room ${roomName}`);
            
            // Reset construction plans
            if (!Memory.rooms[roomName].construction) {
                Memory.rooms[roomName].construction = {};
            }
            
            Memory.rooms[roomName].construction.roads = { planned: false };
            Memory.rooms[roomName].construction.extensions = { planned: false, count: 0 };
            Memory.rooms[roomName].construction.containers = { planned: false };
            
            // Force run the construction manager
            constructionManager.run(Game.rooms[roomName], true);
        }
    }
    
    return 'Simulation construction planning triggered';
};

// Global construction trigger function
global.planConstruction = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        console.log(`Room ${roomName} not found or not visible`);
        return;
    }
    
    if (!room.controller || !room.controller.my) {
        console.log(`You don't control room ${roomName}`);
        return;
    }
    
    // Reset construction plans to force replanning
    if (!room.memory.construction) {
        room.memory.construction = {};
    }
    
    room.memory.construction.roads = { planned: false };
    room.memory.construction.extensions = { planned: false, count: 0 };
    room.memory.construction.containers = { planned: false };
    room.memory.construction.storage = { planned: false };
    room.memory.construction.towers = { planned: false, count: 0 };
    
    // Force run the construction manager
    console.log(`Forcing construction planning in room ${roomName}`);
    constructionManager.run(room, true);
    
    return `Construction planning triggered for room ${roomName}`;
};

// Global function to set creep limits for a room
global.setCreepLimits = function(roomName, role, limit) {
    if (!Memory.rooms[roomName]) {
        return `Room ${roomName} not found in memory`;
    }
    
    if (!Memory.rooms[roomName].creepLimits) {
        Memory.rooms[roomName].creepLimits = {};
    }
    
    // Validate role
    const validRoles = ['harvester', 'hauler', 'upgrader', 'builder', 'total'];
    if (!validRoles.includes(role)) {
        return `Invalid role. Must be one of: ${validRoles.join(', ')}`;
    }
    
    // Set the limit
    Memory.rooms[roomName].creepLimits[role] = limit;
    console.log(`Set ${role} limit for room ${roomName} to ${limit}`);
    
    return `Set ${role} limit for room ${roomName} to ${limit}`;
};

// Global function to toggle traffic visualization
global.toggleTrafficVisualization = function() {
    if (!Memory.visualizeTraffic) {
        Memory.visualizeTraffic = true;
        return "Traffic visualization enabled";
    } else {
        Memory.visualizeTraffic = false;
        return "Traffic visualization disabled";
    }
};

// Global function to analyze traffic in a room
global.analyzeTraffic = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    const creeps = room.find(FIND_MY_CREEPS);
    const creepsByRole = _.groupBy(creeps, c => c.memory.role);
    
    let output = `Traffic Analysis for Room ${roomName}:\n`;
    output += `Total creeps: ${creeps.length}\n`;
    
    // Count creeps by role
    for (const role in creepsByRole) {
        output += `${role}: ${creepsByRole[role].length}\n`;
    }
    
    // Find traffic hotspots
    const positions = {};
    for (const creep of creeps) {
        const key = `${creep.pos.x},${creep.pos.y}`;
        positions[key] = (positions[key] || 0) + 1;
    }
    
    // Find positions with multiple creeps
    const hotspots = Object.entries(positions)
        .filter(([_, count]) => count > 1)
        .sort(([_, countA], [__, countB]) => countB - countA);
    
    if (hotspots.length > 0) {
        output += `\nTraffic hotspots:\n`;
        for (const [pos, count] of hotspots) {
            const [x, y] = pos.split(',');
            output += `Position (${x},${y}): ${count} creeps\n`;
            
            // Visualize hotspots
            room.visual.circle(parseInt(x), parseInt(y), {
                radius: 0.5,
                fill: 'red',
                opacity: 0.7
            });
        }
    } else {
        output += `\nNo traffic hotspots detected.`;
    }
    
    // Enable traffic visualization
    Memory.visualizeTraffic = true;
    
    return output;
};

// Global function to show creep counts and limits
global.showCreeps = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `Room ${roomName} not found or not visible`;
    }
    
    const roomManager = require('roomManager');
    
    // Get current counts
    const counts = roomManager.getRoomData(roomName, 'creepCounts') || {
        harvester: 0,
        hauler: 0,
        upgrader: 0,
        builder: 0,
        total: 0
    };
    
    // Get recommended limits
    let limits;
    const cacheKey = `roomNeeds_${roomName}`;
    if (roomManager.cache[cacheKey] && Game.time - roomManager.cache[cacheKey].time < 20) {
        limits = roomManager.cache[cacheKey].value;
    } else {
        limits = roomManager.analyzeRoomNeeds(room);
    }
    
    // Get manual limits
    const manualLimits = room.memory.creepLimits || {};
    
    // Format output
    let output = `Creep Status for Room ${roomName} (RCL ${room.controller.level}):\n`;
    output += `Role       | Current | Auto Limit | Manual Limit\n`;
    output += `-----------|---------|-----------|-------------\n`;
    output += `Harvester  | ${counts.harvester.toString().padEnd(7)} | ${limits.harvester.toString().padEnd(9)} | ${(manualLimits.harvester !== undefined ? manualLimits.harvester : '-').toString().padEnd(11)}\n`;
    output += `Hauler     | ${counts.hauler.toString().padEnd(7)} | ${limits.hauler.toString().padEnd(9)} | ${(manualLimits.hauler !== undefined ? manualLimits.hauler : '-').toString().padEnd(11)}\n`;
    output += `Upgrader   | ${counts.upgrader.toString().padEnd(7)} | ${limits.upgrader.toString().padEnd(9)} | ${(manualLimits.upgrader !== undefined ? manualLimits.upgrader : '-').toString().padEnd(11)}\n`;
    output += `Builder    | ${counts.builder.toString().padEnd(7)} | ${limits.builder.toString().padEnd(9)} | ${(manualLimits.builder !== undefined ? manualLimits.builder : '-').toString().padEnd(11)}\n`;
    output += `-----------|---------|-----------|-------------\n`;
    output += `Total      | ${counts.total.toString().padEnd(7)} | ${limits.total.toString().padEnd(9)} | ${(manualLimits.total !== undefined ? manualLimits.total : '-').toString().padEnd(11)}\n`;
    
    return output;
};

// Force construction site creation
global.forceConstruction = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    const constructionManager = require('constructionManager');
    
    // Force run the construction manager with debug mode
    console.log(`Forcing construction site creation in room ${roomName}`);
    
    // First check if we have any construction plans
    if (!room.memory.construction || 
        !room.memory.construction.roads || 
        !room.memory.construction.roads.planned) {
        console.log(`Room ${roomName} has no construction plans. Planning roads first...`);
        constructionManager.planRoads(room);
        return `Created road plans for room ${roomName}. Run this command again to create sites.`;
    }
    
    // Force create construction sites
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    console.log(`Room ${roomName} currently has ${sites.length} construction sites`);
    
    // Force run the construction manager
    constructionManager.run(room, true);
    
    // Count how many sites were created
    const newSites = room.find(FIND_CONSTRUCTION_SITES);
    return `Force created construction sites in ${roomName}. Sites before: ${sites.length}, after: ${newSites.length}`;
};

// Global error handler
const errorHandler = function(error) {
    console.log(`UNCAUGHT EXCEPTION: ${error.stack || error}`);
    
    // Activate emergency mode
    global.emergencyMode = {
        active: true,
        startTime: Game.time,
        level: 'critical',
        reason: 'uncaught_exception'
    };
};

module.exports.loop = function() {
    try {
    // Start CPU tracking
    const cpuStart = Game.cpu.getUsed();
    const currentTick = Game.time;
    
    // Memory cleanup and validation - only run every 20 ticks to save CPU
    if (currentTick % 20 === 0) {
        const memStart = Game.cpu.getUsed();
        
        // Process memory cleanup in chunks to distribute CPU load
        if (!global.memoryCleanupState) {
            global.memoryCleanupState = {
                phase: 'creeps',
                creepNames: Object.keys(Memory.creeps),
                roomNames: Object.keys(Memory.rooms),
                creepIndex: 0,
                roomIndex: 0
            };
        }
        
        const state = global.memoryCleanupState;
        const ITEMS_PER_BATCH = 10;
        
        if (state.phase === 'creeps') {
            // Process a batch of creeps
            const endIdx = Math.min(state.creepIndex + ITEMS_PER_BATCH, state.creepNames.length);
            
            for (let i = state.creepIndex; i < endIdx; i++) {
                const name = state.creepNames[i];
                if (!Game.creeps[name]) {
                    // If creep had a source assigned, release it
                    if (Memory.creeps[name].sourceId && Memory.creeps[name].homeRoom) {
                        try {
                            roomManager.releaseSource(Memory.creeps[name].sourceId, Memory.creeps[name].homeRoom);
                        } catch (e) {
                            console.log(`Error releasing source for dead creep ${name}: ${e}`);
                        }
                    }
                    delete Memory.creeps[name];
                }
            }
            
            state.creepIndex = endIdx;
            
            // If we've processed all creeps, move to rooms phase
            if (state.creepIndex >= state.creepNames.length) {
                state.phase = 'rooms';
                state.creepIndex = 0;
            }
        } else if (state.phase === 'rooms') {
            // Process a batch of rooms
            const endIdx = Math.min(state.roomIndex + ITEMS_PER_BATCH, state.roomNames.length);
            
            for (let i = state.roomIndex; i < endIdx; i++) {
                const roomName = state.roomNames[i];
                if (!Game.rooms[roomName] || !Game.rooms[roomName].controller || !Game.rooms[roomName].controller.my) {
                    // Room is not visible or not owned, keep minimal data
                    if (Memory.rooms[roomName]) {
                        const reservationStatus = Memory.rooms[roomName].reservation;
                        Memory.rooms[roomName] = { 
                            lastSeen: Game.time,
                            reservation: reservationStatus
                        };
                    }
                } else {
                    // Ensure critical memory structures exist
                    if (!Memory.rooms[roomName].sources) Memory.rooms[roomName].sources = {};
                    if (!Memory.rooms[roomName].construction) {
                        Memory.rooms[roomName].construction = {
                            roads: { planned: false },
                            extensions: { planned: false, count: 0 },
                            lastUpdate: 0
                        };
                    }
                }
            }
            
            state.roomIndex = endIdx;
            
            // If we've processed all rooms, reset state for next time
            if (state.roomIndex >= state.roomNames.length) {
                global.memoryCleanupState = null;
            }
        }
        
        global.stats.cpu.memoryCleanup = Game.cpu.getUsed() - memStart;
    }
    
    // Reset creep movement tracking for this tick
    for (const name in Game.creeps) {
        delete Game.creeps[name]._moved;
    }
    
    // Clean movement cache periodically
    if (currentTick % 100 === 0) {
        movementManager.cleanCache();
    }
    
    // Process each room we control - distribute CPU load across ticks
    const myRooms = Object.values(Game.rooms).filter(room => room.controller && room.controller.my);
    
    // Process rooms in different order each tick to distribute CPU load
    const roomsToProcess = [...myRooms];
    if (currentTick % 2 === 0) {
        roomsToProcess.reverse();
    }
    
    // Track CPU usage per room
    if (!global.roomCpuUsage) global.roomCpuUsage = {};
    
    for (const room of roomsToProcess) {
        const roomStart = Game.cpu.getUsed();
        
        // Update room intelligence once per tick
        roomManager.updateRoomData(room);
        
        // Run defense manager - this is critical for survival
        try {
            const defenseStart = Game.cpu.getUsed();
            defenseManager.run(room);
            
            // Track defense CPU usage
            if (!global.stats.cpu.defense) global.stats.cpu.defense = 0;
            global.stats.cpu.defense += Game.cpu.getUsed() - defenseStart;
        } catch (error) {
            console.log(`Error in defenseManager for room ${room.name}: ${error}`);
        }
        
        // Distribute CPU-intensive operations across ticks based on room name hash
        const roomHash = room.name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        const roomOffset = roomHash % 5; // Distribute across 5 ticks
        
        // Handle spawning logic - throttle based on available CPU and distribute by room
        if (Game.cpu.bucket > 3000 || (currentTick + roomOffset) % 3 === 0) {
            const spawnStart = Game.cpu.getUsed();
            spawnManager.run(room);
            global.stats.cpu.spawning += Game.cpu.getUsed() - spawnStart;
        }
        
        // Handle construction planning - run periodically and distribute by room
        if (Game.cpu.bucket > 3000 || (currentTick + roomOffset) % 10 === 0) {
            const constructionStart = Game.cpu.getUsed();
            try {
                constructionManager.run(room);
            } catch (error) {
                console.log(`CRITICAL ERROR in constructionManager.run for room ${room.name}:`);
                console.log(`Message: ${error.message || error}`);
                console.log(`Stack: ${error.stack || 'No stack trace'}`);
                
                // Store detailed information about the room state for debugging
                if (!global.debugInfo) global.debugInfo = {};
                global.debugInfo.lastErrorRoom = {
                    name: room.name,
                    controller: room.controller ? {
                        level: room.controller.level,
                        my: room.controller.my
                    } : null,
                    memory: JSON.stringify(room.memory).substring(0, 1000),
                    constructionMemory: room.memory.construction ? 
                        JSON.stringify(room.memory.construction).substring(0, 500) : 'undefined',
                    time: Game.time
                };
            }
            global.stats.cpu.construction += Game.cpu.getUsed() - constructionStart;
        }
        
        // Track CPU usage per room
        const roomCpuUsed = Game.cpu.getUsed() - roomStart;
        global.stats.cpu.roomManagement += roomCpuUsed;
        
        if (!global.roomCpuUsage[room.name]) {
            global.roomCpuUsage[room.name] = { total: 0, ticks: 0 };
        }
        global.roomCpuUsage[room.name].total += roomCpuUsed;
        global.roomCpuUsage[room.name].ticks++;
        
        // Log room CPU usage every 100 ticks
        if (currentTick % 100 === 0) {
            const avgCpu = global.roomCpuUsage[room.name].total / global.roomCpuUsage[room.name].ticks;
            console.log(`Room ${room.name} avg CPU: ${avgCpu.toFixed(2)}`);
            global.roomCpuUsage[room.name] = { total: 0, ticks: 0 };
        }
    }
    
    // Run remote operations manager if CPU allows
    if (utils.shouldExecute('low')) {
        try {
            remoteManager.run();
        } catch (error) {
            console.log(`Error in remoteManager: ${error}`);
        }
    }
    
    // Process creeps by type for better CPU batching
    const creepStart = Game.cpu.getUsed();
    
    // Use cached creep grouping if available for this tick
    let creepsByRole;
    
    if (global.creepGroupCache && global.creepGroupCache.tick === Game.time) {
        creepsByRole = global.creepGroupCache.groups;
    } else {
        // Group creeps by role for more efficient processing
        creepsByRole = {
            harvester: [],
            hauler: [],
            upgrader: [],
            builder: []
        };
        
        // Sort creeps by role
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creepsByRole[creep.memory.role]) {
                creepsByRole[creep.memory.role].push(creep);
            }
        }
        
        // Cache the grouping for this tick
        global.creepGroupCache = {
            tick: Game.time,
            groups: creepsByRole
        };
    }
    
    // Process creeps by role - this allows for better CPU batching
    
    // In emergency mode, process fewer creeps per tick
    const processCreepRole = function(creeps, roleFunction, priority) {
        // Skip non-critical roles in critical emergency mode
        if (global.emergencyMode && 
            global.emergencyMode.level === 'critical' && 
            priority !== 'critical') {
            return;
        }
        
        // Skip low priority roles when CPU is constrained
        if (!utils.shouldExecute(priority)) return;
        
        // In emergency mode, process only a subset of creeps
        let creepsToProcess = creeps;
        if (global.emergencyMode && creeps.length > 3) {
            // Process only 1/3 of creeps each tick in emergency mode
            const startIdx = Game.time % 3;
            creepsToProcess = creeps.filter((_, idx) => idx % 3 === startIdx);
        } else if (creeps.length > 10) {
            // Even in normal mode, distribute very large numbers of creeps across ticks
            const startIdx = Game.time % 2;
            creepsToProcess = creeps.filter((_, idx) => idx % 2 === startIdx);
        }
        
        // Track CPU usage per role
        const roleCpuStart = Game.cpu.getUsed();
        
        // Process the creeps with error handling
        for (const creep of creepsToProcess) {
            try {
                roleFunction.run(creep);
            } catch (error) {
                console.log(`Error running ${creep.memory.role} ${creep.name}: ${error}`);
                // Basic fallback behavior - move to spawn if error
                if (Game.time % 10 === 0) { // Only try occasionally to save CPU
                    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
                    if (spawn) creep.moveTo(spawn);
                }
            }
        }
        
        // Log CPU usage per role
        const roleCpuUsed = Game.cpu.getUsed() - roleCpuStart;
        if (!global.roleCpuUsage) global.roleCpuUsage = {};
        if (!global.roleCpuUsage[priority]) {
            global.roleCpuUsage[priority] = { total: 0, ticks: 0, creeps: 0 };
        }
        global.roleCpuUsage[priority].total += roleCpuUsed;
        global.roleCpuUsage[priority].ticks++;
        global.roleCpuUsage[priority].creeps += creepsToProcess.length;
    };
    
    // Process harvesters first as they're the foundation of the economy
    processCreepRole(creepsByRole.harvester, roleHarvester, 'critical');
    
    // Process haulers next to move the energy
    processCreepRole(creepsByRole.hauler, roleHauler, 'high');
    
    // Process upgraders to maintain controller level
    processCreepRole(creepsByRole.upgrader, roleUpgrader, 'medium');
    
    // Process builders last as they're less critical
    processCreepRole(creepsByRole.builder, roleBuilder, 'low');
    
    global.stats.cpu.creepActions = Game.cpu.getUsed() - creepStart;
    
    // Visualize traffic if enabled
    if (Memory.visualizeTraffic) {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            const visual = room.visual;
            
            // Get all creeps in the room
            const creeps = room.find(FIND_MY_CREEPS);
            
            // Create a heatmap of creep positions
            const heatmap = {};
            
            for (const creep of creeps) {
                const key = `${creep.pos.x},${creep.pos.y}`;
                heatmap[key] = (heatmap[key] || 0) + 1;
            }
            
            // Visualize the heatmap
            for (const key in heatmap) {
                const [x, y] = key.split(',').map(Number);
                const intensity = Math.min(heatmap[key] * 0.2, 1);
                visual.circle(x, y, {
                    radius: 0.5,
                    fill: `rgba(255, 0, 0, ${intensity})`,
                    opacity: 0.5
                });
            }
        }
    }
    
    // Update CPU statistics
    const totalCpuUsed = Game.cpu.getUsed() - cpuStart;
    global.stats.cpu.total = totalCpuUsed;
    global.stats.cpu.ticks++;
    
    // CPU emergency recovery mode
    const cpuLimit = Game.cpu.limit || 20;
    const cpuPercentage = totalCpuUsed / cpuLimit;
    
    // Track CPU usage trend
    if (!global.cpuHistory) global.cpuHistory = [];
    global.cpuHistory.push(cpuPercentage);
    if (global.cpuHistory.length > 10) global.cpuHistory.shift();
    
    // Calculate average CPU usage over last 10 ticks
    const avgCpuUsage = global.cpuHistory.reduce((sum, val) => sum + val, 0) / global.cpuHistory.length;
    
    // Enter emergency mode if CPU usage is consistently high or bucket is critically low
    if (avgCpuUsage > 0.9 || Game.cpu.bucket < 1000) {
        if (!global.emergencyMode) {
            global.emergencyMode = {
                active: true,
                startTime: Game.time,
                level: Game.cpu.bucket < 500 ? 'critical' : 'high'
            };
            console.log(`⚠️ ENTERING EMERGENCY CPU MODE (${global.emergencyMode.level}): CPU usage ${(avgCpuUsage*100).toFixed(1)}%, bucket ${Game.cpu.bucket}`);
        }
    } else if (global.emergencyMode && (avgCpuUsage < 0.7 && Game.cpu.bucket > 3000)) {
        console.log(`✓ Exiting emergency CPU mode after ${Game.time - global.emergencyMode.startTime} ticks`);
        global.emergencyMode = null;
    }
    
    // Log performance stats every 100 ticks
    if (currentTick % 100 === 0) {
        utils.logCPUStats({
            total: global.stats.cpu.total / global.stats.cpu.ticks,
            roomManagement: global.stats.cpu.roomManagement / global.stats.cpu.ticks,
            creepActions: global.stats.cpu.creepActions / global.stats.cpu.ticks,
            spawning: global.stats.cpu.spawning / global.stats.cpu.ticks,
            construction: global.stats.cpu.construction / global.stats.cpu.ticks,
            defense: (global.stats.cpu.defense || 0) / global.stats.cpu.ticks,
            memoryCleanup: global.stats.cpu.memoryCleanup / global.stats.cpu.ticks,
            emergencyMode: global.emergencyMode ? global.emergencyMode.level : 'off',
            bucket: Game.cpu.bucket
        });
            
        // Reset stats
        for (const key in global.stats.cpu) {
            if (key !== 'ticks') {
                global.stats.cpu[key] = 0;
            }
        }
        
        // Clear caches periodically to prevent memory leaks
        utils.clearCache();
        spawnManager.resetCache();
        roomManager.cleanCache();
        
        // Clean up any cache keys that were accidentally stored in Memory
        utils.cleanupMemoryCache();
    }
    } catch (error) {
        errorHandler(error);
    }
};