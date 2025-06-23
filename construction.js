/**
 * Construction System - Unified module for all construction-related functionality
 */
const utils = require('utils');
const optimizer = require('roomOptimizer');

// Main construction module
const construction = {
    /**
     * Run the construction manager for a room
     * @param {Room} room - The room to manage construction for
     * @param {boolean} force - Force run regardless of interval
     */
    run: function(room, force = false) {
        // Check if we're in a simulation room
        const isSimulation = room.name.startsWith('sim');
        
        // Initialize room memory if needed
        if (!room.memory) {
            room.memory = {};
        }
        
        // Initialize construction memory if needed
        if (!room.memory.construction) {
            room.memory.construction = {
                roads: { planned: false },
                extensions: { planned: false, count: 0 },
                containers: { planned: false },
                storage: { planned: false },
                towers: { planned: false, count: 0 },
                lastUpdate: 0
            };
        }
        
        // Run more frequently in simulation rooms and early RCL, less frequently in higher RCL rooms
        const interval = isSimulation ? 5 : // Every 5 ticks in simulation
            (room.controller.level <= 2 ? 20 : // More frequent for early RCL
            (global.emergencyMode ? 
                (global.emergencyMode.level === 'critical' ? 1000 : 200) : 100));
            
        if (!force && Game.time % interval !== 0) return;
        
        // Skip if we don't own the controller
        if (!room.controller || !room.controller.my) return;
        
        // Skip if CPU conditions don't allow for construction tasks
        if (!utils.shouldExecute(room.controller.level <= 2 ? 'medium' : 'low')) return;
        
        // Update construction site count only when needed
        const sitesNeedUpdate = !room.memory.constructionSites || 
                              Game.time - (room.memory._lastSiteCount || 0) > (room.controller.level <= 2 ? 20 : 50);
        if (force || sitesNeedUpdate) {
            this.updateConstructionSiteCount(room);
            room.memory._lastSiteCount = Game.time;
        }
        
        // Sync structure counts periodically (more frequently at low RCL)
        if (force || Game.time % (room.controller.level <= 2 ? 100 : 500) === 0) {
            this.syncStructureCounts(room);
        }
        
        // Check if room has evolved and needs plan updates
        if (force || room.controller.level !== (room.memory.construction.lastRCL || 0)) {
            this.checkRoomEvolution(room);
        }
        
        // Prioritize structures based on RCL
        if (this.prioritizeEarlyGameStructures(room)) {
            return; // Exit if we planned something
        }
        
        // Check if we need to generate a complete room plan
        // Generate plan immediately for new rooms or when forced
        if (!room.memory.roomPlan && (force || Game.time % 100 === 0 || room.controller.level <= 2)) {
            console.log(`Generating complete room plan for ${room.name}`);
            this.generateRoomPlan(room);
            // Visualize the plan
            this.visualizeRoomPlan(room);
            return; // Only do one major planning operation per tick
        }
        
        // If we have a room plan, use it for construction
        if (room.memory.roomPlan) {
            // Only create sites if we have fewer than target
            const siteCache = optimizer.getCachedConstructionSites(room);
            if (siteCache.count < 5 || force) {
                // Create construction sites based on the room plan
                this.createConstructionSitesFromPlan(room);
                
                // Update timestamp
                room.memory.construction.lastUpdate = Game.time;
            }
            
            // Periodically visualize the plan (much less frequently)
            if (Game.time % 500 === 0) { // Reduced frequency from 200 to 500
                this.visualizeRoomPlan(room, room.controller.level);
            }
            
            return;
        }
        
        // If we don't have a room plan yet, generate one
        if (force) {
            console.log(`Forcing room plan generation for ${room.name}`);
            this.generateRoomPlan(room);
            return;
        }
        
        // Legacy planning logic for rooms without a complete plan
        // Ensure all required construction memory properties exist
        if (!room.memory.construction.roads) room.memory.construction.roads = { planned: false };
        if (!room.memory.construction.extensions) room.memory.construction.extensions = { planned: false, count: 0 };
        if (!room.memory.construction.containers) room.memory.construction.containers = { planned: false };
        if (!room.memory.construction.storage) room.memory.construction.storage = { planned: false };
        if (!room.memory.construction.towers) room.memory.construction.towers = { planned: false, count: 0 };
        
        // Plan roads if not already planned
        if (!room.memory.construction.roads || !room.memory.construction.roads.planned) {
            console.log(`Planning roads in room ${room.name}`);
            this.planRoads(room);
            return; // Only do one major planning operation per tick
        }
        
        // Plan containers if not already planned
        if (!room.memory.construction.containers || !room.memory.construction.containers.planned) {
            console.log(`Planning containers in room ${room.name}`);
            this.planContainers(room);
            return; // Only do one major planning operation per tick
        }
        
        // Plan extensions if not already planned and we're at RCL 2+
        if ((!room.memory.construction.extensions || !room.memory.construction.extensions.planned) && room.controller.level >= 2) {
            console.log(`Planning extensions in room ${room.name} (RCL: ${room.controller.level})`);
            this.planExtensions(room);
            return; // Only do one major planning operation per tick
        }
        
        // Plan towers if not already planned and we're at RCL 3+
        if ((!room.memory.construction.towers || !room.memory.construction.towers.planned) && room.controller.level >= 3) {
            this.planTowers(room);
            return; // Only do one major planning operation per tick
        }
        
        // Plan storage if not already planned and we're at RCL 4+
        if ((!room.memory.construction.storage || !room.memory.construction.storage.planned) && room.controller.level >= 4) {
            this.planStorage(room);
            return; // Only do one major planning operation per tick
        }
        
        // Update construction sites
        this.createConstructionSites(room);
        
        // Update timestamp
        room.memory.construction.lastUpdate = Game.time;
        
        // Log construction status
        if (force || Game.time % (isSimulation ? 20 : 100) === 0) {
            console.log(`Construction status for ${room.name}: ` +
                `Roads: ${room.memory.construction.roads.planned ? 'Planned' : 'Not Planned'}, ` +
                `Extensions: ${room.memory.construction.extensions.planned ? 'Planned' : 'Not Planned'}, ` +
                `Containers: ${room.memory.construction.containers && room.memory.construction.containers.planned ? 'Planned' : 'Not Planned'}, ` +
                `RCL: ${room.controller.level}`
            );
            
            // In simulation, log more detailed information
            if (isSimulation) {
                console.log(`Simulation construction details: ` +
                    `Tick: ${Game.time}, ` +
                    `CPU Bucket: ${Game.cpu.bucket}, ` +
                    `shouldExecute('low'): ${utils.shouldExecute('low')}, ` +
                    `Construction sites: ${room.find(FIND_CONSTRUCTION_SITES).length}`
                );
            }
        }
    },
    
    /**
     * Plan roads for the room
     * @param {Room} room - The room to plan roads for
     */
    planRoads: function(room) {
        // Find spawn
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        
        const spawn = spawns[0];
        
        // Find sources
        const sources = room.find(FIND_SOURCES);
        if (sources.length === 0) return;
        
        const roads = new Set();
        const terrain = room.getTerrain();
        
        // Create exclusion set for sources and minerals
        const exclusions = new Set();
        sources.forEach(s => exclusions.add(`${s.pos.x},${s.pos.y}`));
        room.find(FIND_MINERALS).forEach(m => exclusions.add(`${m.pos.x},${m.pos.y}`));
        
        // Path options optimized for road planning
        const pathOptions = {
            ignoreCreeps: true,
            swampCost: 2,
            plainCost: 1,
            maxOps: 2000,
            serialize: false
        };
        
        for (const source of sources) {
            // Find path from spawn to near source (not on source)
            const nearSourcePos = this.findBestSourceAccessPoint(room, source);
            const path = room.findPath(spawn.pos, nearSourcePos, pathOptions);
            
            // Add road positions excluding sources
            for (const step of path) {
                const posKey = `${step.x},${step.y}`;
                if (!exclusions.has(posKey)) {
                    roads.add(posKey);
                }
            }
            
            // Add strategic road near source if surrounded by walls
            const sourceRoad = this.planSourceAccessRoad(room, source);
            if (sourceRoad) {
                roads.add(`${sourceRoad.x},${sourceRoad.y}`);
            }
        }
        
        // Plan road from spawn to controller
        const controllerPath = room.findPath(spawn.pos, room.controller.pos, pathOptions);
        for (const step of controllerPath) {
            const posKey = `${step.x},${step.y}`;
            if (!exclusions.has(posKey)) {
                roads.add(posKey);
            }
        }
        
        // Convert Set back to array of positions
        const roadPositions = [];
        for (const posKey of roads) {
            const [x, y] = posKey.split(',').map(Number);
            roadPositions.push({ x, y });
        }
        
        // Save road plan to memory
        room.memory.construction.roads = {
            planned: true,
            positions: roadPositions
        };
        
        console.log(`Planned ${roadPositions.length} road positions in room ${room.name}`);
    },
    
    /**
     * Find best access point near a source
     * @param {Room} room - The room
     * @param {Source} source - The source
     * @returns {RoomPosition} - Best access position
     */
    findBestSourceAccessPoint: function(room, source) {
        const terrain = room.getTerrain();
        let bestPos = source.pos;
        let bestScore = -1;
        
        // Check positions around source
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                
                const x = source.pos.x + dx;
                const y = source.pos.y + dy;
                
                if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
                
                // Score based on adjacent walkable tiles
                let score = 0;
                for (let ndx = -1; ndx <= 1; ndx++) {
                    for (let ndy = -1; ndy <= 1; ndy++) {
                        const nx = x + ndx;
                        const ny = y + ndy;
                        if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && 
                            terrain.get(nx, ny) !== TERRAIN_MASK_WALL) {
                            score++;
                        }
                    }
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPos = new RoomPosition(x, y, room.name);
                }
            }
        }
        
        return bestPos;
    },
    
    /**
     * Plan strategic road placement near source if surrounded by walls
     * @param {Room} room - The room
     * @param {Source} source - The source
     * @returns {Object|null} - Road position or null
     */
    planSourceAccessRoad: function(room, source) {
        const terrain = room.getTerrain();
        let bestPos = null;
        let bestScore = -1;
        
        // Check positions around source for wall tiles adjacent to plains
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                
                const x = source.pos.x + dx;
                const y = source.pos.y + dy;
                
                if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                
                // Must be a wall tile adjacent to source
                if (terrain.get(x, y) !== TERRAIN_MASK_WALL) continue;
                
                // Count adjacent plains tiles
                let plainsCount = 0;
                for (let ndx = -1; ndx <= 1; ndx++) {
                    for (let ndy = -1; ndy <= 1; ndy++) {
                        const nx = x + ndx;
                        const ny = y + ndy;
                        if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50) {
                            const terrainType = terrain.get(nx, ny);
                            if (terrainType === 0) { // Plains
                                plainsCount++;
                            }
                        }
                    }
                }
                
                // Prefer positions with more adjacent plains
                if (plainsCount > bestScore) {
                    bestScore = plainsCount;
                    bestPos = { x, y };
                }
            }
        }
        
        return bestPos;
    },
    
    // Include the optimizer as a sub-module
    optimizer: optimizer
};

// Copy all methods from constructionManager
const constructionManager = require('constructionManager');
for (const key in constructionManager) {
    if (typeof constructionManager[key] === 'function' && !construction[key]) {
        construction[key] = constructionManager[key];
    }
}

// Add missing methods for analysis
construction.getNextConstructionSites = function(room, limit = 10) {
    const nextSites = [];
    
    // Check containers
    if (room.memory.construction.containers && 
        room.memory.construction.containers.planned && 
        room.memory.construction.containers.positions) {
        
        for (const pos of room.memory.construction.containers.positions) {
            if (nextSites.length >= limit) break;
            
            // Check if already built
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            
            if (!structures.some(s => s.structureType === STRUCTURE_CONTAINER) && 
                !sites.some(s => s.structureType === STRUCTURE_CONTAINER)) {
                nextSites.push({ type: 'container', x: pos.x, y: pos.y });
            }
        }
    }
    
    // Check extensions
    if (room.memory.construction.extensions && 
        room.memory.construction.extensions.planned && 
        room.memory.construction.extensions.positions) {
        
        for (const pos of room.memory.construction.extensions.positions) {
            if (nextSites.length >= limit) break;
            
            // Check if already built
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            
            if (!structures.some(s => s.structureType === STRUCTURE_EXTENSION) && 
                !sites.some(s => s.structureType === STRUCTURE_EXTENSION)) {
                nextSites.push({ type: 'extension', x: pos.x, y: pos.y });
            }
        }
    }
    
    // Check roads
    if (room.memory.construction.roads && 
        room.memory.construction.roads.planned && 
        room.memory.construction.roads.positions) {
        
        for (const pos of room.memory.construction.roads.positions) {
            if (nextSites.length >= limit) break;
            
            // Check if already built
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            
            if (!structures.some(s => s.structureType === STRUCTURE_ROAD) && 
                !sites.some(s => s.structureType === STRUCTURE_ROAD)) {
                nextSites.push({ type: 'road', x: pos.x, y: pos.y });
            }
        }
    }
    
    return nextSites;
};

construction.diagnosisConstruction = function(room) {
    let output = `Construction Diagnosis for ${room.name}:\n`;
    
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
    }
    
    // Check construction sites
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    output += `\nConstruction Sites (${sites.length}):\n`;
    
    // Group by type
    const sitesByType = _.groupBy(sites, s => s.structureType);
    for (const type in sitesByType) {
        output += `- ${type}: ${sitesByType[type].length}\n`;
    }
    
    // Check next planned sites
    const nextSites = this.getNextConstructionSites(room, 5);
    
    if (nextSites.length > 0) {
        output += `\nNext Planned Sites:\n`;
        for (const site of nextSites) {
            output += `- ${site.type} at (${site.x},${site.y})\n`;
        }
    }
    
    return output;
};

construction.checkPlanningStatus = function(room) {
    let output = `Planning Status for ${room.name} (RCL ${room.controller.level}):\n`;
    
    // Check if we have a room plan
    const hasRoomPlan = room.memory.roomPlan !== undefined;
    output += `Room Plan: ${hasRoomPlan ? 'EXISTS' : 'MISSING'}\n`;
    
    // Check construction memory
    const hasConstructionMemory = room.memory.construction !== undefined;
    output += `Construction Memory: ${hasConstructionMemory ? 'EXISTS' : 'MISSING'}\n`;
    
    if (hasConstructionMemory) {
        // Check individual structure plans
        const construction = room.memory.construction;
        
        output += `\nStructure Planning Status:\n`;
        output += `- Roads: ${construction.roads && construction.roads.planned ? 'Planned' : 'Not Planned'}\n`;
        output += `- Extensions: ${construction.extensions && construction.extensions.planned ? 'Planned' : 'Not Planned'}\n`;
        output += `- Containers: ${construction.containers && construction.containers.planned ? 'Planned' : 'Not Planned'}\n`;
        output += `- Towers: ${construction.towers && construction.towers.planned ? 'Planned' : 'Not Planned'}\n`;
        output += `- Storage: ${construction.storage && construction.storage.planned ? 'Planned' : 'Not Planned'}\n`;
        
        // Check construction sites
        const sites = room.find(FIND_CONSTRUCTION_SITES);
        output += `\nConstruction Sites: ${sites.length}\n`;
        
        // Group by type
        const sitesByType = _.groupBy(sites, site => site.structureType);
        for (const type in sitesByType) {
            output += `- ${type}: ${sitesByType[type].length}\n`;
        }
    }
    
    return output;
};

// Export the consolidated module
module.exports = construction;