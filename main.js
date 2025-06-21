/**
 * Main game loop - CPU optimized
 */
const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleBuilder = require('role.builder');
const roleHauler = require('role.hauler');
const roleScout = require('role.scout');
const roleReserver = require('role.reserver');
const roleRemoteMiner = require('role.remoteMiner');
const roleRemoteHauler = require('role.remoteHauler');
const roomManager = require('roomManager');
const spawnManager = require('spawnManager');
const constructionManager = require('constructionManager');
const defenseManager = require('defenseManager');
const remoteManager = require('remoteManager');
const movementManager = require('movementManager');
const recoveryManager = require('recoveryManager');
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
    const validRoles = ['harvester', 'hauler', 'upgrader', 'builder', 'scout', 'reserver', 'remoteMiner', 'remoteHauler', 'total'];
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

// Global function to check CPU recovery status
global.checkRecovery = function() {
    // Get detailed status from recovery manager
    const status = recoveryManager.getStatus();
};

// Global function to manage remote operations
global.manageRemotes = function(roomName, action, targetRoom) {
    // Validate room
    const room = Game.rooms[roomName];
    if (!room || !room.controller || !room.controller.my) {
        return `Room ${roomName} not found or not owned by you`;
    }
    
    // Initialize remote ops memory if needed
    if (!Memory.remoteOps) {
        Memory.remoteOps = {
            rooms: {},
            activeRemotes: {}
        };
    }
    
    // Initialize active remotes for this room
    if (!Memory.remoteOps.activeRemotes[roomName]) {
        Memory.remoteOps.activeRemotes[roomName] = [];
    }
    
    switch(action) {
        case 'list':
            // List active remote rooms
            const activeRemotes = Memory.remoteOps.activeRemotes[roomName] || [];
            if (activeRemotes.length === 0) {
                return `Room ${roomName} has no active remote operations`;
            }
            
            let output = `Active remote operations for ${roomName}:\n`;
            for (const remoteName of activeRemotes) {
                const remoteData = Memory.remoteOps.rooms[remoteName] || {};
                output += `- ${remoteName}: ${remoteData.sources || 0} sources`;
                if (remoteData.hostiles) output += `, HOSTILES PRESENT`;
                if (remoteData.reservation) {
                    output += `, reserved by ${remoteData.reservation.username} (${remoteData.reservation.ticksToEnd} ticks)`;
                }
                output += '\n';
            }
            return output;
            
        case 'add':
            // Add a remote room
            if (!targetRoom) {
                return `Must specify a target room to add`;
            }
            
            // Check if already active
            if (Memory.remoteOps.activeRemotes[roomName].includes(targetRoom)) {
                return `Room ${targetRoom} is already an active remote for ${roomName}`;
            }
            
            // Add to active remotes
            Memory.remoteOps.activeRemotes[roomName].push(targetRoom);
            
            // Initialize remote room data if needed
            if (!Memory.remoteOps.rooms[targetRoom]) {
                Memory.remoteOps.rooms[targetRoom] = {
                    baseRoom: roomName,
                    lastScout: 0,
                    sources: 0,
                    hostiles: false,
                    mining: true
                };
            } else {
                Memory.remoteOps.rooms[targetRoom].mining = true;
                Memory.remoteOps.rooms[targetRoom].baseRoom = roomName;
            }
            
            return `Added ${targetRoom} as remote operation for ${roomName}`;
            
        case 'remove':
            // Remove a remote room
            if (!targetRoom) {
                return `Must specify a target room to remove`;
            }
            
            // Check if active
            const index = Memory.remoteOps.activeRemotes[roomName].indexOf(targetRoom);
            if (index === -1) {
                return `Room ${targetRoom} is not an active remote for ${roomName}`;
            }
            
            // Remove from active remotes
            Memory.remoteOps.activeRemotes[roomName].splice(index, 1);
            
            // Update remote room data
            if (Memory.remoteOps.rooms[targetRoom]) {
                Memory.remoteOps.rooms[targetRoom].mining = false;
            }
            
            return `Removed ${targetRoom} as remote operation for ${roomName}`;
            
        case 'status':
            // Show detailed status of remote operations
            return remoteManager.getDetailedStatus(roomName);
            
        default:
            return `Unknown action: ${action}. Valid actions are: list, add, remove, status`;
    }
};

global.checkRecovery = function() {
    // Get detailed status from recovery manager
    const status = recoveryManager.getStatus();
    
    let output = status;
    
    // Add emergency mode info
    if (global.emergencyMode) {
        output += `\nEmergency Mode:\n`;
        output += `- Level: ${global.emergencyMode.level}\n`;
        output += `- Type: ${global.emergencyMode.isRecovery ? 'adaptive recovery' : 'normal'}\n`;
        output += `- Duration: ${Game.time - global.emergencyMode.startTime} ticks\n`;
        output += `- Recovery Factor: ${global.emergencyMode.recoveryFactor ? 
                 (global.emergencyMode.recoveryFactor * 100).toFixed(0) : 'N/A'}%\n`;
    } else {
        output += `\nEmergency Mode: off\n`;
    }
    
    // Add CPU usage info
    const avgCpuUsage = global.cpuHistory && global.cpuHistory.length > 0 ? 
                      global.cpuHistory.reduce((sum, val) => sum + val, 0) / global.cpuHistory.length : 0;
    
    output += `\nCPU Usage:\n`;
    output += `- Current: ${Game.cpu.getUsed().toFixed(2)}\n`;
    output += `- Average: ${(avgCpuUsage * 100).toFixed(1)}%\n`;
    output += `- Limit: ${Game.cpu.limit}\n`;
    
    return output;
};

// Global function to control recovery manager
global.setRecovery = function(action, value) {
    const recoveryManager = require('recoveryManager');
    
    switch(action) {
        case 'start':
            recoveryManager.startRecovery(Game.cpu.bucket);
            return `Started manual recovery at bucket ${Game.cpu.bucket}`;
        
        case 'stop':
            if (recoveryManager.isRecovering) {
                const duration = Game.time - recoveryManager.recoveryStartTime;
                recoveryManager.isRecovering = false;
                return `Stopped recovery after ${duration} ticks`;
            } else {
                return `Not in recovery mode`;
            }
            
        case 'rate':
            if (!isNaN(value)) {
                recoveryManager.recoveryRate = Number(value);
                return `Set recovery rate to ${value}`;
            } else {
                return `Current recovery rate: ${recoveryManager.recoveryRate}`;
            }
            
        default:
            return `Unknown action. Use: start, stop, or rate`;
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

// Global function to refresh construction sites
global.refreshConstructionSites = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    const roomManager = require('roomManager');
    roomManager.refreshConstructionSites(room);
    
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    return `Refreshed construction sites in ${roomName}. Found ${sites.length} sites.`;
};

// Global function to fix stuck builders
global.fixStuckBuilders = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    const builders = _.filter(Game.creeps, c => 
        c.memory.role === 'builder' && 
        c.memory.homeRoom === roomName
    );
    
    let fixed = 0;
    const roleBuilder = require('role.builder');
    
    for (const builder of builders) {
        // Check if this builder is stuck
        if (builder.memory.targetId === room.controller.id || builder.memory.errorCount > 0) {
            // Reset the builder using our improved function
            roleBuilder.resetStuckBuilder(builder);
            fixed++;
        }
    }
    
    return `Fixed ${fixed} stuck builders in room ${roomName}`;
};

// Global function to check builder/repairer status
global.checkBuilders = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    const builders = _.filter(Game.creeps, c => 
        c.memory.role === 'builder' && 
        c.memory.homeRoom === roomName
    );
    
    const repairers = builders.filter(c => c.memory.isRepairer === true);
    const constructors = builders.filter(c => c.memory.isRepairer === false);
    
    let output = `Builder Status for Room ${roomName}:\n`;
    output += `Total builders: ${builders.length}\n`;
    output += `- Repairers: ${repairers.length}\n`;
    output += `- Constructors: ${constructors.length}\n\n`;
    
    // Show repair targets
    const repairTargets = room.find(FIND_STRUCTURES, {
        filter: s => s.hits < s.hitsMax * 0.5 && 
                  s.hits < 10000 && 
                  (s.structureType === STRUCTURE_CONTAINER || 
                   s.structureType === STRUCTURE_SPAWN ||
                   s.structureType === STRUCTURE_EXTENSION ||
                   s.structureType === STRUCTURE_TOWER ||
                   s.structureType === STRUCTURE_ROAD)
    });
    
    output += `Repair targets: ${repairTargets.length}\n`;
    
    // Show construction sites
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    output += `Construction sites: ${sites.length}\n`;
    
    return output;
};

// Global function to show creep counts and limits
global.showCreeps = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `Room ${roomName} not found or not visible`;
    }
    
    const roomManager = require('roomManager');
    const spawnManager = require('spawnManager');
    
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
    
    // Room overview
    const sources = Object.keys(room.memory.sources || {}).length;
    const constructionSites = room.find(FIND_CONSTRUCTION_SITES).length;
    const repairTargets = roomManager.getRoomData(roomName, 'repairTargets') || 0;
    const energyRequests = Object.keys(room.memory.energyRequests || {}).length;
    
    // Spawn status
    const spawns = room.find(FIND_MY_SPAWNS);
    const busySpawns = spawns.filter(s => s.spawning).length;
    
    // Get next spawn intent
    const neededRole = spawnManager.getNeededRole(room, counts);

    
    // Format output
    let output = `=== Room ${roomName} Overview (RCL ${room.controller.level}) ===\n`;
    output += `Energy: ${room.energyAvailable}/${room.energyCapacityAvailable} | Sources: ${sources} | Construction: ${constructionSites} | Repairs: ${repairTargets}\n`;
    output += `Energy Requests: ${energyRequests} | Spawns: ${spawns.length - busySpawns}/${spawns.length} available\n`;
    if (neededRole) {
        output += `Next Spawn: ${neededRole}\n`;
    } else if (counts.total >= limits.total) {
        output += `Next Spawn: At capacity\n`;
    } else {
        output += `Next Spawn: No priority role identified\n`;
    }
    output += `\n`;
    
    // Creep counts table
    output += `Role       | Current | Auto Limit | Manual Limit | Status\n`;
    output += `-----------|---------|-----------|-------------|--------\n`;
    
    const roles = ['harvester', 'hauler', 'upgrader', 'builder'];
    for (const role of roles) {
        const current = counts[role];
        const autoLimit = limits[role];
        const manualLimit = manualLimits[role] !== undefined ? manualLimits[role] : '-';
        
        let status = '';
        if (current === 0) status = 'CRITICAL';
        else if (current < autoLimit * 0.5) status = 'LOW';
        else if (current >= autoLimit) status = 'FULL';
        else status = 'OK';
        
        const roleName = role.charAt(0).toUpperCase() + role.slice(1);
        output += `${roleName.padEnd(10)} | ${current.toString().padEnd(7)} | ${autoLimit.toString().padEnd(9)} | ${manualLimit.toString().padEnd(11)} | ${status}\n`;
    }
    
    output += `-----------|---------|-----------|-------------|--------\n`;
    output += `Total      | ${counts.total.toString().padEnd(7)} | ${limits.total.toString().padEnd(9)} | ${(manualLimits.total !== undefined ? manualLimits.total : '-').toString().padEnd(11)} | ${counts.total >= limits.total ? 'FULL' : 'OK'}\n`;
    
    // Individual creep details
    const creeps = _.filter(Game.creeps, c => c.memory.homeRoom === roomName);
    if (creeps.length > 0) {
        output += `\n=== Individual Creeps ===\n`;
        const creepsByRole = _.groupBy(creeps, c => c.memory.role);
        
        for (const role of roles) {
            if (creepsByRole[role]) {
                output += `\n${role.toUpperCase()}S (${creepsByRole[role].length}):\n`;
                for (const creep of creepsByRole[role]) {
                    const energy = `${creep.store[RESOURCE_ENERGY]}/${creep.store.getCapacity()}`;
                    const parts = creep.body.length;
                    const age = Game.time - (creep.memory.spawnTime || Game.time);
                    const ttl = creep.ticksToLive || 'N/A';
                    
                    let status = '';
                    if (role === 'harvester' && creep.memory.sourceId) {
                        status = `Source: ${creep.memory.sourceId.slice(-3)}`;
                    } else if (role === 'hauler' && creep.memory.assignedRequestId) {
                        status = `Assigned: ${creep.memory.assignedRequestId.slice(-3)}`;
                    } else if (role === 'builder') {
                        const task = creep.memory.task || 'none';
                        const isRepairer = creep.memory.isRepairer ? ' (R)' : '';
                        status = `${task}${isRepairer}`;
                    } else if (role === 'upgrader') {
                        status = creep.memory.working ? 'upgrading' : 'collecting';
                    }
                    
                    output += `  ${creep.name}: ${energy} energy, ${parts} parts, TTL:${ttl}, ${status}\n`;
                }
            }
        }
    }
    
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

// Generate a complete room plan
global.generateRoomPlan = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    if (!room.controller || !room.controller.my) {
        return `You don't control room ${roomName}`;
    }
    
    const constructionManager = require('constructionManager');
    const success = constructionManager.generateRoomPlan(room);
    
    if (success) {
        // Visualize the plan
        constructionManager.visualizeRoomPlan(room);
        return `Generated and visualized complete room plan for ${roomName}`;
    } else {
        return `Failed to generate room plan for ${roomName}`;
    }
};

// Visualize room plan with toggle functionality
global.visualizeRoomPlan = function(roomName, rcl = 0) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    const constructionManager = require('constructionManager');
    
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
        constructionManager.visualizeRoomPlan(room, rcl);
        return `Room plan visualization for ${roomName}${rcl > 0 ? ` at RCL ${rcl}` : ' (all RCLs)'} turned ON`;
    }
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
        
        // Update repair targets for builders
        roomManager.analyzeRepairTargets(room);
        
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
        // Use adaptive thresholds based on recovery factor
        const recoveryFactor = recoveryManager.getRecoveryFactor();
        const spawnThreshold = recoveryManager.isRecovering ? 
                             Math.max(300, 800 * recoveryFactor) : 800;
        
        // Check if this operation should run based on recovery status
        const shouldRunSpawning = !recoveryManager.isRecovering || 
                                recoveryManager.shouldRun('high');
        
        if ((shouldRunSpawning && Game.cpu.bucket > spawnThreshold) || 
            (currentTick + roomOffset) % 3 === 0) {
            const spawnStart = Game.cpu.getUsed();
            spawnManager.run(room);
            global.stats.cpu.spawning += Game.cpu.getUsed() - spawnStart;
        }
        
        // Handle construction planning - run periodically and distribute by room
        // Use adaptive thresholds based on recovery factor
        const constructionThreshold = recoveryManager.isRecovering ? 
                                    Math.max(500, 800 * recoveryFactor) : 800;
        
        // Check if this operation should run based on recovery status
        const shouldRunConstruction = !recoveryManager.isRecovering || 
                                    recoveryManager.shouldRun('medium');
        
        if ((shouldRunConstruction && Game.cpu.bucket > constructionThreshold) || 
            (currentTick + roomOffset) % 5 === 0) {
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
    /*if (utils.shouldExecute('low')) {
        try {
            remoteManager.run();
        } catch (error) {
            console.log(`Error in remoteManager: ${error}`);
        }
    }*/
    
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
            builder: [],
            scout: [],
            reserver: [],
            remoteMiner: [],
            remoteHauler: []
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
    
    // Process remote operation roles
    processCreepRole(creepsByRole.scout, roleScout, 'low');
    processCreepRole(creepsByRole.reserver, roleReserver, 'low');
    processCreepRole(creepsByRole.remoteMiner, roleRemoteMiner, 'low');
    processCreepRole(creepsByRole.remoteHauler, roleRemoteHauler, 'low');
    
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
    
    // Maintain room plan visualizations if enabled
    if (Memory.visualizePlans) {
        const constructionManager = require('constructionManager');
        for (const roomName in Memory.visualizePlans) {
            const room = Game.rooms[roomName];
            if (room && room.memory.roomPlan) {
                const planConfig = Memory.visualizePlans[roomName];
                constructionManager.visualizeRoomPlan(room, planConfig.rcl);
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
    
    // Update recovery manager
    recoveryManager.update();
    
    // Use recovery manager to determine if we're in recovery mode
    const inRecoveryPeriod = recoveryManager.isRecovering;
    
    // Get adaptive bucket threshold based on recovery status
    const recoveryFactor = recoveryManager.getRecoveryFactor();
    const bucketThreshold = inRecoveryPeriod ? 
                          Math.max(100, Math.min(800, 800 * (1 - recoveryFactor))) : 800;
    
    if (avgCpuUsage > 0.9 || Game.cpu.bucket < bucketThreshold) {
        if (!global.emergencyMode) {
            global.emergencyMode = {
                active: true,
                startTime: Game.time,
                level: Game.cpu.bucket < 300 ? 'critical' : 'high',
                isRecovery: inRecoveryPeriod,
                recoveryFactor: recoveryFactor
            };
            console.log(`⚠️ ENTERING ${inRecoveryPeriod ? 'ADAPTIVE RECOVERY' : 'EMERGENCY'} CPU MODE (${global.emergencyMode.level}): CPU usage ${(avgCpuUsage*100).toFixed(1)}%, bucket ${Game.cpu.bucket}`);
        } else {
            // Update recovery factor in emergency mode
            global.emergencyMode.recoveryFactor = recoveryFactor;
        }
    } else if (global.emergencyMode) {
        // Use adaptive exit conditions based on recovery factor
        const exitBucketThreshold = inRecoveryPeriod ? 
                                  Math.max(800, 2000 * recoveryFactor) : 2000;
        const exitCpuThreshold = inRecoveryPeriod ? 
                               Math.min(0.9, 0.7 + (0.2 * recoveryFactor)) : 0.8;
        
        // Exit emergency mode faster if CPU usage is very low
        const veryLowCpuUsage = avgCpuUsage < 0.3;
        const fastExitBucketThreshold = inRecoveryPeriod ? 
                                      Math.max(500, 800 * recoveryFactor) : 800;
        
        if ((avgCpuUsage < exitCpuThreshold && Game.cpu.bucket > exitBucketThreshold) || 
            (veryLowCpuUsage && Game.cpu.bucket > fastExitBucketThreshold)) {
            console.log(`✓ Exiting ${global.emergencyMode.isRecovery ? 'adaptive recovery' : 'emergency'} CPU mode after ${Game.time - global.emergencyMode.startTime} ticks`);
            console.log(`Final recovery factor: ${(recoveryFactor * 100).toFixed(0)}%, bucket: ${Game.cpu.bucket}, CPU usage: ${(avgCpuUsage*100).toFixed(1)}%`);
            global.emergencyMode = null;
        }
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
        roomManager.cleanCache();
        
        // Clean up any cache keys that were accidentally stored in Memory
        utils.cleanupMemoryCache();
    }
    } catch (error) {
        errorHandler(error);
    }
};