/**
 * Construction System - Unified module for all construction-related functionality
 * CPU optimized for maximum efficiency
 */
const utils = require('utils');
const helpers = require('helpers');

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
        helpers.initializeRoomMemory(room);
        
        // Skip if we don't own the controller
        if (!room.controller || !room.controller.my) return;
        
        // Run more frequently in simulation rooms and early RCL, less frequently in higher RCL rooms
        const interval = isSimulation ? 5 : // Every 5 ticks in simulation
            (room.controller.level <= 2 ? 20 : // More frequent for early RCL
            (global.emergencyMode ? 
                (global.emergencyMode.level === 'critical' ? 1000 : 200) : 100));
            
        if (!force && Game.time % interval !== 0) return;
        
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
            const siteCache = this.optimizer.getCachedConstructionSites(room);
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
        
        // Plan links if not already planned and we're at RCL 5+
        if ((!room.memory.construction.links || !room.memory.construction.links.planned) && room.controller.level >= 5) {
            this.planLinks(room);
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
     * Plan links for the room
     * @param {Room} room - The room to plan links for
     */
    planLinks: function(room) {
        // Skip if below RCL 5
        if (room.controller.level < 5) return;
        
        // Find spawn
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        
        const spawn = spawns[0];
        const terrain = room.getTerrain();
        
        // Calculate how many links we can build at current RCL
        const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK][room.controller.level];
        const links = [];
        
        // First link: near storage or spawn
        let storagePos = null;
        if (room.storage) {
            storagePos = room.storage.pos;
        } else if (room.memory.construction.storage && room.memory.construction.storage.position) {
            storagePos = room.memory.construction.storage.position;
        }
        
        if (storagePos) {
            // Find a position near storage
            const firstLinkPos = this.findLinkPosition(room, storagePos, 1, 2);
            if (firstLinkPos) {
                links.push(firstLinkPos);
            }
        } else {
            // Find a position near spawn
            const firstLinkPos = this.findLinkPosition(room, spawn.pos, 2, 3);
            if (firstLinkPos) {
                links.push(firstLinkPos);
            }
        }
        
        // Second link: near controller
        if (maxLinks >= 2) {
            const controllerLinkPos = this.findLinkPosition(room, room.controller.pos, 1, 3);
            if (controllerLinkPos) {
                links.push(controllerLinkPos);
            }
        }
        
        // Additional links: near sources
        if (maxLinks >= 3) {
            const sources = room.find(FIND_SOURCES);
            for (const source of sources) {
                if (links.length >= maxLinks) break;
                
                const sourceLinkPos = this.findLinkPosition(room, source.pos, 1, 2);
                if (sourceLinkPos) {
                    links.push(sourceLinkPos);
                }
            }
        }
        
        // Save link plan to memory
        room.memory.construction.links = {
            planned: true,
            positions: links,
            count: 0
        };
        
        console.log(`Planned ${links.length} link positions in room ${room.name}`);
    },
    
    /**
     * Find a good position for a link
     * @param {Room} room - The room to check
     * @param {RoomPosition|Object} anchorPos - Position to search around
     * @param {number} minRange - Minimum range from anchor
     * @param {number} maxRange - Maximum range from anchor
     * @returns {Object|null} - Position object or null if no valid position
     */
    findLinkPosition: function(room, anchorPos, minRange, maxRange) {
        return helpers.findBestPosition(room, anchorPos, minRange, maxRange);
    },
    
    /**
     * Get the next construction sites that would be built
     * @param {Room} room - The room to check
     * @param {number} limit - Maximum number of sites to return
     * @returns {Array} - Array of next construction sites
     */
    getNextConstructionSites: function(room, limit = 10) {
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
        
        // Check towers
        if (room.memory.construction.towers && 
            room.memory.construction.towers.planned && 
            room.memory.construction.towers.positions) {
            
            for (const pos of room.memory.construction.towers.positions) {
                if (nextSites.length >= limit) break;
                
                // Check if already built
                const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
                
                if (!structures.some(s => s.structureType === STRUCTURE_TOWER) && 
                    !sites.some(s => s.structureType === STRUCTURE_TOWER)) {
                    nextSites.push({ type: 'tower', x: pos.x, y: pos.y });
                }
            }
        }
        
        // Check storage
        if (room.memory.construction.storage && 
            room.memory.construction.storage.planned && 
            room.memory.construction.storage.position) {
            
            const pos = room.memory.construction.storage.position;
            
            // Check if already built
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            
            if (!structures.some(s => s.structureType === STRUCTURE_STORAGE) && 
                !sites.some(s => s.structureType === STRUCTURE_STORAGE) && 
                nextSites.length < limit) {
                nextSites.push({ type: 'storage', x: pos.x, y: pos.y });
            }
        }
        
        // Check links
        if (room.memory.construction.links && 
            room.memory.construction.links.planned && 
            room.memory.construction.links.positions) {
            
            for (const pos of room.memory.construction.links.positions) {
                if (nextSites.length >= limit) break;
                
                // Check if already built
                const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
                
                if (!structures.some(s => s.structureType === STRUCTURE_LINK) && 
                    !sites.some(s => s.structureType === STRUCTURE_LINK)) {
                    nextSites.push({ type: 'link', x: pos.x, y: pos.y });
                }
            }
        }
        
        // Check roads (limited to avoid excessive output)
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
    },
    
    /**
     * Analyzes the alignment between actual structures and the room plan
     * @param {Room} room - The room to analyze
     * @returns {Object} - Analysis results
     */
    analyzeRoomPlanAlignment: function(room) {
        if (!room.memory.roomPlan) {
            return { aligned: false, summary: `No room plan exists for ${room.name}` };
        }
        
        // Get current RCL plan
        const rcl = room.controller.level;
        const rclPlan = room.memory.roomPlan.rcl[rcl];
        if (!rclPlan) {
            return { aligned: false, summary: `No plan exists for RCL ${rcl} in room ${room.name}` };
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
        let summary = `Room Plan Alignment for ${room.name} (RCL ${rcl}):\n`;
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
        return result;
    },
    
    /**
     * Check the planning status of a room
     * @param {Room} room - The room to check
     * @returns {string} - Status report
     */
    checkPlanningStatus: function(room) {
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
            const nextSites = this.getNextConstructionSites(room, 5);
            
            if (nextSites.length > 0) {
                output += `\nNext Planned Sites:\n`;
                for (const site of nextSites) {
                    output += `- ${site.type} at (${site.x},${site.y})\n`;
                }
            }
        }
        
        return output;
    },
    
    /**
     * Diagnose construction issues in a room
     * @param {Room} room - The room to diagnose
     * @returns {string} - Diagnostic report
     */
    diagnosisConstruction: function(room) {
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
        const nextSites = this.getNextConstructionSites(room, 10);
        
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
            output += `- Generate a room plan: global.generateRoomPlan('${room.name}')\n`;
        }
        
        if (nextSites.length > 0 && sites.length < 5) {
            output += `- Force construction site creation: global.forceConstruction('${room.name}', ${5 - sites.length})\n`;
        }
        
        if (actualExtensions + extensionSites !== storedExtensionCount) {
            output += `- Fix extension count: Memory.rooms['${room.name}'].construction.extensions.count = ${actualExtensions + extensionSites}\n`;
        }
        
        return output;
    },
    
    // Include the optimizer as a sub-module
    optimizer: {
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
    }
};

// Add the original constructionManager methods to the construction module
// This preserves all the existing functionality while consolidating the files
const constructionManager = require('constructionManager');
for (const key in constructionManager) {
    if (typeof constructionManager[key] === 'function' && !construction[key]) {
        construction[key] = constructionManager[key];
    }
}

// Export the consolidated module
module.exports = construction;