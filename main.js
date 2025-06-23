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
const construction = require('construction'); // Updated to use consolidated construction module
const defenseManager = require('defenseManager');
const remoteManager = require('remoteManager');
const movementManager = require('movementManager');
const recoveryManager = require('recoveryManager');
const utils = require('utils');
const helpers = require('helpers');
const memoryManager = require('memoryManager');

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

// Global construction functions
const globalConstruction = require('global.construction');
global.checkNextConstructionSites = globalConstruction.checkNextConstructionSites;
global.diagnosisConstruction = globalConstruction.diagnosisConstruction;
global.analyzeRoomPlanAlignment = globalConstruction.analyzeRoomPlanAlignment;
global.checkPlanningStatus = globalConstruction.checkPlanningStatus;
global.forceConstruction = globalConstruction.forceConstruction;
global.generateRoomPlan = globalConstruction.generateRoomPlan;
global.visualizeRoomPlan = globalConstruction.visualizeRoomPlan;

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
            construction.run(Game.rooms[roomName], true);
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
    construction.run(room, true);
    
    return `Construction planning triggered for room ${roomName}`;
};

// Global function to sync structure counts with memory
global.syncStructureCounts = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    construction.syncStructureCounts(room);
    return `Synced structure counts for room ${roomName}`;
};

// Global function to replace a misaligned structure
global.replaceMisalignedStructure = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    if (!room.memory.roomPlan) {
        return `No room plan exists for ${roomName}`;
    }
    
    // First check for misaligned structures
    room.memory._forcePlanCheck = true;
    construction.checkPlanAlignment(room);
    
    // Then try to replace one
    const result = construction.replaceSuboptimalStructure(room);
    
    if (result) {
        return `Successfully removed a misaligned structure in ${roomName}`;  
    } else {
        return `No misaligned structures found in ${roomName}`;  
    }
};

// Global function to clear room optimizer caches
global.clearRoomCaches = function() {
    construction.optimizer.clearCaches();
    
    // Clear global caches
    global._structureCache = {};
    global._siteCache = {};
    global._lookAtCache = {};
    global._roomCache = {
        structures: {},
        sites: {},
        lookAt: {},
        lastCleanup: Game.time
    };
    
    return 'All room caches cleared';
};

// Global function to force planning for a room based on RCL
global.forcePlanning = function(roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
        return `No visibility in room ${roomName}`;
    }
    
    // First generate a complete room plan if needed
    if (!room.memory.roomPlan) {
        console.log(`Generating complete room plan for ${roomName}`);
        construction.generateRoomPlan(room);
    }
    
    // Then plan structures based on RCL
    let planned = construction.prioritizeEarlyGameStructures(room);
    
    // Force construction site creation
    const sitesToPlace = room.controller.level <= 2 ? 10 : 5;
    const sitesCreated = construction.forceConstructionSite(room, sitesToPlace);
    
    return `Force planned structures for ${roomName} at RCL ${room.controller.level}. Created ${sitesCreated} construction sites.`;
};

// Alias for backward compatibility
global.forceEarlyPlanning = global.forcePlanning;

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

// Initialize CPU history tracking if not already done
if (!global.cpuHistory) {
    global.cpuHistory = Array(10).fill(0.5); // Initialize with reasonable values
}

module.exports.loop = function() {
    try {
    // Start CPU tracking
    const cpuStart = Game.cpu.getUsed();
    const currentTick = Game.time;
    
    // Initialize memory structures at game start
    if (!global.initialized) {
        memoryManager.initialize();
        global.initialized = true;
    }
    
    // Memory cleanup and validation - only run every 20 ticks to save CPU
    if (currentTick % 20 === 0) {
        const memStart = Game.cpu.getUsed();
        
        // Use the memory manager for cleanup
        memoryManager.cleanup();
        
        // Track CPU usage for memory cleanup
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
                construction.run(room);
            } catch (error) {
                console.log(`CRITICAL ERROR in construction.run for room ${room.name}:`);
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
        for (const roomName in Memory.visualizePlans) {
            const room = Game.rooms[roomName];
            if (room && room.memory.roomPlan) {
                const planConfig = Memory.visualizePlans[roomName];
                construction.visualizeRoomPlan(room, planConfig.rcl);
            }
        }
    }
    
    // Update CPU statistics
    const totalCpuUsed = Game.cpu.getUsed() - cpuStart;
    global.stats.cpu.total += totalCpuUsed; // Changed from = to += to accumulate
    global.stats.cpu.ticks++;
    
    // Track CPU usage with memory manager
    memoryManager.trackCpuUsage();
    
    // Update CPU history for tracking
    global.cpuHistory.push(totalCpuUsed / (Game.cpu.limit || 20));
    if (global.cpuHistory.length > 10) {
        global.cpuHistory.shift();
    }
    
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
        
        // Log memory statistics
        memoryManager.logMemoryStats();
    }
    } catch (error) {
        errorHandler(error);
    }
};