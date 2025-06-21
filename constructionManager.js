/**
 * Construction Manager - Handles structure placement and construction planning
 * CPU optimized for maximum efficiency
 */
const utils = require('utils');

// Original module implementation
const constructionManagerImpl = {
    /**
     * Run the construction manager for a room
     * @param {Room} room - The room to manage construction for
     * @param {boolean} force - Force run regardless of interval
     */
    run: function(room, force = false) {
        const utils = require('utils');
        
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
        
        // Always update construction site count for roomManager
        this.updateConstructionSiteCount(room);
        
        // Run more frequently in simulation rooms
        const interval = isSimulation ? 5 : // Every 5 ticks in simulation
            (global.emergencyMode ? 
                (global.emergencyMode.level === 'critical' ? 500 : 100) : 25);
            
        if (!force && Game.time % interval !== 0) return;
        
        // Skip if we don't own the controller
        if (!room.controller || !room.controller.my) return;
        
        // Skip if CPU conditions don't allow for construction tasks
        if (!utils.shouldExecute('low')) return;
        
        // Check if room has evolved and needs plan updates
        this.checkRoomEvolution(room);
        
        // Check if we need to generate a complete room plan
        if (!room.memory.roomPlan && (force || Game.time % 500 === 0)) {
            console.log(`Generating complete room plan for ${room.name}`);
            this.generateRoomPlan(room);
            // Visualize the plan
            this.visualizeRoomPlan(room);
            return; // Only do one major planning operation per tick
        }
        
        // If we have a room plan, use it for construction
        if (room.memory.roomPlan) {
            // Create construction sites based on the room plan
            this.createConstructionSitesFromPlan(room);
            
            // Update timestamp
            room.memory.construction.lastUpdate = Game.time;
            
            // Periodically visualize the plan
            if (Game.time % 100 === 0) {
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
    
    /**
     * Plan containers for the room
     * @param {Room} room - The room to plan containers for
     */
    planContainers: function(room) {
        // Find sources
        const sources = room.find(FIND_SOURCES);
        if (sources.length === 0) return;
        
        const containers = [];
        const terrain = room.getTerrain();
        
        // Plan container near each source
        for (const source of sources) {
            // Skip sources near source keeper lairs
            if (!this.isSafeFromSourceKeepers(room, source.pos, 5)) {
                console.log(`Skipping container planning for source at (${source.pos.x},${source.pos.y}) - too close to source keeper lair`);
                continue;
            }
            
            // Find the best position for a container near the source
            let bestPos = null;
            let bestScore = -1;
            
            // Check positions around the source
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    // Skip the source position itself
                    if (dx === 0 && dy === 0) continue;
                    
                    const x = source.pos.x + dx;
                    const y = source.pos.y + dy;
                    
                    // Skip if out of bounds or on a wall
                    if (x <= 0 || y <= 0 || x >= 49 || y >= 49 || 
                        terrain.get(x, y) === TERRAIN_MASK_WALL) {
                        continue;
                    }
                    
                    // Calculate score based on adjacent walkable tiles
                    let score = 0;
                    for (let nx = -1; nx <= 1; nx++) {
                        for (let ny = -1; ny <= 1; ny++) {
                            const ax = x + nx;
                            const ay = y + ny;
                            if (ax >= 0 && ay >= 0 && ax < 50 && ay < 50 && 
                                terrain.get(ax, ay) !== TERRAIN_MASK_WALL) {
                                score++;
                            }
                        }
                    }
                    
                    // Higher score means more accessible position
                    if (score > bestScore) {
                        bestScore = score;
                        bestPos = { x, y };
                    }
                }
            }
            
            // Add the best position if found
            if (bestPos) {
                containers.push(bestPos);
            }
        }
        
        // Plan container near controller
        const controllerContainer = this.findControllerContainerPosition(room);
        if (controllerContainer) {
            containers.push(controllerContainer);
        }
        
        // Save container plan to memory
        room.memory.construction.containers = {
            planned: true,
            positions: containers
        };
        
        console.log(`Planned ${containers.length} container positions in room ${room.name}`);
    },
    
    /**
     * Check if a position is safe from source keepers
     * @param {Room} room - The room to check
     * @param {RoomPosition|Object} pos - Position to check
     * @param {number} safeDistance - Safe distance from keeper lairs
     * @returns {boolean} - True if position is safe
     */
    isSafeFromSourceKeepers: function(room, pos, safeDistance = 5) {
        // Find all source keeper lairs in the room
        const keeperLairs = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_KEEPER_LAIR
        });
        
        // If no keeper lairs, position is safe
        if (keeperLairs.length === 0) return true;
        
        // Check distance to each keeper lair
        for (const lair of keeperLairs) {
            const distance = Math.abs(lair.pos.x - pos.x) + Math.abs(lair.pos.y - pos.y);
            if (distance <= safeDistance) {
                return false; // Too close to a keeper lair
            }
        }
        
        return true; // Safe from all keeper lairs
    },
    
    /**
     * Find the best position for a container near the controller
     * @param {Room} room - The room to check
     * @returns {Object|null} - Position object or null if no valid position
     */
    findControllerContainerPosition: function(room) {
        const controller = room.controller;
        if (!controller) return null;
        
        const terrain = room.getTerrain();
        let bestPos = null;
        let bestScore = -1;
        
        // Check positions around the controller
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                // Skip positions too close or too far
                const dist = Math.abs(dx) + Math.abs(dy);
                if (dist < 1 || dist > 3) continue;
                
                const x = controller.pos.x + dx;
                const y = controller.pos.y + dy;
                
                // Skip if out of bounds or on a wall
                if (x <= 0 || y <= 0 || x >= 49 || y >= 49 || 
                    terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    continue;
                }
                
                // Calculate score based on distance and adjacent walkable tiles
                let score = 4 - dist; // Prefer closer positions
                
                // Add score for adjacent walkable tiles
                for (let nx = -1; nx <= 1; nx++) {
                    for (let ny = -1; ny <= 1; ny++) {
                        const ax = x + nx;
                        const ay = y + ny;
                        if (ax >= 0 && ay >= 0 && ax < 50 && ay < 50 && 
                            terrain.get(ax, ay) !== TERRAIN_MASK_WALL) {
                            score++;
                        }
                    }
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPos = { x, y };
                }
            }
        }
        
        return bestPos;
    },
    
    /**
     * Plan towers for the room
     * @param {Room} room - The room to plan towers for
     */
    planTowers: function(room) {
        // Skip if below RCL 3
        if (room.controller.level < 3) return;
        
        // Find spawn
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        
        const spawn = spawns[0];
        const terrain = room.getTerrain();
        
        // Calculate how many towers we can build at current RCL
        const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][room.controller.level];
        const towers = [];
        
        // First tower: close to spawn for early defense
        const firstTowerPos = this.findTowerPosition(room, spawn.pos, 3, 5);
        if (firstTowerPos) {
            towers.push(firstTowerPos);
        }
        
        // Additional towers: strategic positions if RCL allows
        if (maxTowers >= 2 && room.controller.level >= 5) {
            // Second tower: near room center for better coverage
            const centerX = 25;
            const centerY = 25;
            const centerPos = new RoomPosition(centerX, centerY, room.name);
            const secondTowerPos = this.findTowerPosition(room, centerPos, 5, 10, towers);
            
            if (secondTowerPos) {
                towers.push(secondTowerPos);
            }
        }
        
        // Save tower plan to memory
        room.memory.construction.towers = {
            planned: true,
            positions: towers,
            count: 0
        };
        
        console.log(`Planned ${towers.length} tower positions in room ${room.name}`);
    },
    
    /**
     * Find a good position for a tower
     * @param {Room} room - The room to check
     * @param {RoomPosition} anchorPos - Position to search around
     * @param {number} minRange - Minimum range from anchor
     * @param {number} maxRange - Maximum range from anchor
     * @param {Array} existingPositions - Positions to avoid
     * @returns {Object|null} - Position object or null if no valid position
     */
    findTowerPosition: function(room, anchorPos, minRange, maxRange, existingPositions = []) {
        const terrain = room.getTerrain();
        let bestPos = null;
        let bestScore = -1;
        
        // Check positions in a square around the anchor
        for (let dx = -maxRange; dx <= maxRange; dx++) {
            for (let dy = -maxRange; dy <= maxRange; dy++) {
                const x = anchorPos.x + dx;
                const y = anchorPos.y + dy;
                
                // Skip if out of bounds or on a wall
                if (x <= 2 || y <= 2 || x >= 47 || y >= 47 || 
                    terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    continue;
                }
                
                // Calculate Manhattan distance
                const distance = Math.abs(dx) + Math.abs(dy);
                
                // Skip if too close or too far
                if (distance < minRange || distance > maxRange) {
                    continue;
                }
                
                // Skip if too close to existing positions
                let tooClose = false;
                for (const pos of existingPositions) {
                    if (Math.abs(pos.x - x) + Math.abs(pos.y - y) < 3) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;
                
                // Calculate score based on open space and distance
                let score = 0;
                
                // Prefer positions with open space around them
                for (let nx = -1; nx <= 1; nx++) {
                    for (let ny = -1; ny <= 1; ny++) {
                        const ax = x + nx;
                        const ay = y + ny;
                        if (ax >= 0 && ay >= 0 && ax < 50 && ay < 50 && 
                            terrain.get(ax, ay) !== TERRAIN_MASK_WALL) {
                            score++;
                        }
                    }
                }
                
                // Adjust score based on distance (prefer middle of range)
                const distanceScore = maxRange - Math.abs(distance - (minRange + maxRange) / 2);
                score += distanceScore;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPos = { x, y };
                }
            }
        }
        
        return bestPos;
    },
    
    /**
     * Plan extensions for the room
     * @param {Room} room - The room to plan extensions for
     */
    planExtensions: function(room) {
        // Find spawn
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        
        const spawn = spawns[0];
        
        // Calculate how many extensions we can build at current RCL
        const maxExtensions = CONTROLLER_STRUCTURES.extension[room.controller.level];
        
        // Plan extension positions
        const extensions = [];
        const terrain = room.getTerrain();
        
        // Create a Set of road positions for faster lookups
        const roadPositions = new Set();
        if (room.memory.construction.roads && room.memory.construction.roads.positions) {
            for (const road of room.memory.construction.roads.positions) {
                roadPositions.add(`${road.x},${road.y}`);
            }
        }
        
        // Find existing structures to avoid
        const existingStructures = room.find(FIND_STRUCTURES);
        const structurePositions = new Set();
        for (const structure of existingStructures) {
            structurePositions.add(`${structure.pos.x},${structure.pos.y}`);
        }
        
        // Find sources and minerals to avoid
        const sources = room.find(FIND_SOURCES);
        const minerals = room.find(FIND_MINERALS);
        const avoidPositions = [...sources, ...minerals].map(s => s.pos);
        
        // Find the room center for scoring
        const roomCenterX = 25;
        const roomCenterY = 25;
        
        // Create a cost matrix for pathfinding
        const costMatrix = new PathFinder.CostMatrix();
        
        // Mark all walls as unwalkable
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    costMatrix.set(x, y, 255);
                }
            }
        }
        
        // Mark existing structures as unwalkable
        for (const structure of existingStructures) {
            if (structure.structureType !== STRUCTURE_ROAD) {
                costMatrix.set(structure.pos.x, structure.pos.y, 255);
            }
        }
        
        // Mark areas around sources and minerals as unwalkable
        for (const pos of avoidPositions) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const x = pos.x + dx;
                    const y = pos.y + dy;
                    if (x >= 0 && x < 50 && y >= 0 && y < 50) {
                        costMatrix.set(x, y, 255);
                    }
                }
            }
        }
        
        // Generate candidate positions
        const candidates = [];
        
        // Try multiple strategies for extension placement
        
        // Strategy 1: Cluster around spawn
        this.generateClusterCandidates(spawn.pos, 2, 8, candidates, costMatrix, roadPositions);
        
        // Strategy 2: Place along roads
        this.generateRoadAdjacentCandidates(room, roadPositions, candidates, costMatrix);
        
        // Strategy 3: Find open areas
        this.generateOpenAreaCandidates(room, spawn.pos, candidates, costMatrix, roadPositions);
        
        // Score and sort candidates
        for (const candidate of candidates) {
            // Base score - prefer positions closer to spawn but not too close
            const distToSpawn = Math.abs(candidate.x - spawn.pos.x) + Math.abs(candidate.y - spawn.pos.y);
            candidate.score = 100 - Math.min(distToSpawn, 20);
            
            // Bonus for being near roads but not on them
            let nearRoad = false;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const roadKey = `${candidate.x + dx},${candidate.y + dy}`;
                    if (roadPositions.has(roadKey)) {
                        nearRoad = true;
                        break;
                    }
                }
            }
            if (nearRoad) candidate.score += 20;
            
            // Penalty for being far from center
            const distToCenter = Math.abs(candidate.x - roomCenterX) + Math.abs(candidate.y - roomCenterY);
            candidate.score -= Math.min(distToCenter / 2, 15);
            
            // Bonus for being near other extensions (clustering)
            let nearbyExtensions = 0;
            for (const ext of extensions) {
                const dist = Math.abs(candidate.x - ext.x) + Math.abs(candidate.y - ext.y);
                if (dist <= 2) nearbyExtensions++;
            }
            candidate.score += nearbyExtensions * 5;
        }
        
        // Sort by score (highest first)
        candidates.sort((a, b) => b.score - a.score);
        
        // Take the best positions up to maxExtensions
        for (let i = 0; i < candidates.length && extensions.length < maxExtensions; i++) {
            const pos = candidates[i];
            
            // Final validation
            if (pos.x >= 2 && pos.x <= 47 && pos.y >= 2 && pos.y <= 47 && 
                terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL &&
                !roadPositions.has(`${pos.x},${pos.y}`) &&
                !structurePositions.has(`${pos.x},${pos.y}`)) {
                
                extensions.push({ x: pos.x, y: pos.y });
                
                // Mark this position as taken
                structurePositions.add(`${pos.x},${pos.y}`);
            }
        }
        
        // If we still don't have enough extensions, fall back to spiral pattern
        if (extensions.length < maxExtensions) {
            this.planExtensionsSpiral(room, spawn, extensions, maxExtensions, roadPositions, structurePositions);
        }
        
        // Save extension plan to memory
        room.memory.construction.extensions = {
            planned: true,
            positions: extensions,
            count: 0
        };
        
        console.log(`Planned ${extensions.length} extension positions in room ${room.name}`);
    },
    
    /**
     * Generate candidate positions in clusters around a point
     */
    generateClusterCandidates: function(centerPos, minRange, maxRange, candidates, costMatrix, roadPositions) {
        for (let dx = -maxRange; dx <= maxRange; dx++) {
            for (let dy = -maxRange; dy <= maxRange; dy++) {
                const dist = Math.abs(dx) + Math.abs(dy);
                if (dist < minRange || dist > maxRange) continue;
                
                const x = centerPos.x + dx;
                const y = centerPos.y + dy;
                
                // Skip if out of bounds or unwalkable
                if (x < 2 || x > 47 || y < 2 || y > 47 || costMatrix.get(x, y) === 255) continue;
                
                // Skip if on a road
                if (roadPositions.has(`${x},${y}`)) continue;
                
                // Add as candidate
                candidates.push({ x, y });
            }
        }
    },
    
    /**
     * Generate candidate positions adjacent to roads
     */
    generateRoadAdjacentCandidates: function(room, roadPositions, candidates, costMatrix) {
        // Check positions adjacent to roads
        for (const roadPosKey of roadPositions) {
            const [roadX, roadY] = roadPosKey.split(',').map(Number);
            
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue; // Skip the road itself
                    
                    const x = roadX + dx;
                    const y = roadY + dy;
                    
                    // Skip if out of bounds or unwalkable
                    if (x < 2 || x > 47 || y < 2 || y > 47 || costMatrix.get(x, y) === 255) continue;
                    
                    // Skip if on another road
                    if (roadPositions.has(`${x},${y}`)) continue;
                    
                    // Add as candidate
                    candidates.push({ x, y });
                }
            }
        }
    },
    
    /**
     * Generate candidate positions in open areas
     */
    generateOpenAreaCandidates: function(room, centerPos, candidates, costMatrix, roadPositions) {
        // Find open areas with good connectivity
        for (let x = 5; x < 45; x += 2) {
            for (let y = 5; y < 45; y += 2) {
                // Skip if unwalkable
                if (costMatrix.get(x, y) === 255) continue;
                
                // Skip if on a road
                if (roadPositions.has(`${x},${y}`)) continue;
                
                // Check open space around this position
                let openSpace = 0;
                for (let dx = -2; dx <= 2; dx++) {
                    for (let dy = -2; dy <= 2; dy++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && costMatrix.get(nx, ny) !== 255) {
                            openSpace++;
                        }
                    }
                }
                
                // Only consider positions with good open space
                if (openSpace >= 15) {
                    candidates.push({ x, y });
                }
            }
        }
    },
    
    /**
     * Fall back to spiral pattern for extension placement
     */
    planExtensionsSpiral: function(room, spawn, extensions, maxExtensions, roadPositions, structurePositions) {
        const terrain = room.getTerrain();
        
        // Start with a small offset from spawn
        const startX = spawn.pos.x + 2;
        const startY = spawn.pos.y + 2;
        
        // Spiral pattern variables
        let x = startX;
        let y = startY;
        let dx = 0;
        let dy = -1;
        let maxSteps = 20; // Limit search radius
        let steps = 0;
        
        // Generate positions in a spiral
        while (extensions.length < maxExtensions && steps < maxSteps * maxSteps) {
            // Check if position is valid for an extension
            if (x >= 2 && x <= 47 && y >= 2 && y <= 47 && 
                terrain.get(x, y) !== TERRAIN_MASK_WALL &&
                !roadPositions.has(`${x},${y}`) &&
                !structurePositions.has(`${x},${y}`)) {
                
                // Don't place too close to sources or minerals
                let validPos = true;
                const nearbyObjects = room.lookForAtArea(LOOK_SOURCES, y-1, x-1, y+1, x+1, true);
                if (nearbyObjects.length > 0) {
                    validPos = false;
                }
                
                if (validPos) {
                    extensions.push({ x, y });
                    structurePositions.add(`${x},${y}`);
                }
            }
            
            // Move to next position in spiral
            if (x === y || (x < 0 && x === -y) || (x > 0 && x === 1-y)) {
                // Change direction
                const temp = dx;
                dx = -dy;
                dy = temp;
            }
            
            x += dx;
            y += dy;
            steps++;
        }
    },
    
    /**
     * Plan storage placement for the room
     * @param {Room} room - The room to plan storage for
     */
    planStorage: function(room) {
        // Skip if below RCL 4
        if (room.controller.level < 4) return;
        
        // Find spawn
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        
        const spawn = spawns[0];
        const terrain = room.getTerrain();
        
        // Find a good position for storage near spawn
        let storagePos = null;
        let bestScore = -1;
        
        // Check positions in a radius around spawn
        for (let dx = -5; dx <= 5; dx++) {
            for (let dy = -5; dy <= 5; dy++) {
                // Skip positions too close or too far
                const dist = Math.abs(dx) + Math.abs(dy);
                if (dist < 2 || dist > 6) continue;
                
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                
                // Skip if out of bounds or on a wall
                if (x <= 2 || y <= 2 || x >= 47 || y >= 47 || 
                    terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    continue;
                }
                
                // Calculate score based on open space and distance
                let score = 10 - dist; // Prefer closer positions
                
                // Add score for adjacent walkable tiles
                for (let nx = -1; nx <= 1; nx++) {
                    for (let ny = -1; ny <= 1; ny++) {
                        const ax = x + nx;
                        const ay = y + ny;
                        if (ax >= 0 && ay >= 0 && ax < 50 && ay < 50 && 
                            terrain.get(ax, ay) !== TERRAIN_MASK_WALL) {
                            score++;
                        }
                    }
                }
                
                // Check if position is on a road or near planned extensions
                const lookResult = room.lookAt(x, y);
                for (const item of lookResult) {
                    if (item.type === LOOK_STRUCTURES && 
                        (item.structure.structureType === STRUCTURE_ROAD || 
                         item.structure.structureType === STRUCTURE_EXTENSION)) {
                        score -= 5; // Penalize positions on roads or near extensions
                    }
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    storagePos = { x, y };
                }
            }
        }
        
        // Save storage plan to memory
        room.memory.construction.storage = {
            planned: true,
            position: storagePos
        };
        
        if (storagePos) {
            console.log(`Planned storage position at (${storagePos.x},${storagePos.y}) in room ${room.name}`);
        } else {
            console.log(`Could not find suitable storage position in room ${room.name}`);
        }
    },
    
    /**
     * Create construction sites based on plans
     * @param {Room} room - The room to create construction sites in
     */
    createConstructionSites: function(room) {
        // Check for global construction site limit
        const globalSiteCount = Object.keys(Game.constructionSites).length;
        const TARGET_SITES_PER_ROOM = 5; // We want to maintain 5 sites at all times
        const MAX_GLOBAL_SITES = 100; // Game limit is 100
        
        if (globalSiteCount >= MAX_GLOBAL_SITES) return;
        
        // Count existing construction sites in this room
        const existingSites = room.find(FIND_CONSTRUCTION_SITES);
        
        // If we already have enough sites, no need to create more
        if (existingSites.length >= TARGET_SITES_PER_ROOM) {
            // Update room memory with current construction site count and IDs
            room.memory.constructionSites = existingSites.length;
            room.memory.constructionSiteIds = existingSites.map(site => site.id);
            return;
        }
        
        // How many more sites we need to place to reach our target
        const sitesToPlace = Math.min(
            TARGET_SITES_PER_ROOM - existingSites.length,
            MAX_GLOBAL_SITES - globalSiteCount
        );
        
        // Track what types of construction sites we already have
        const existingSiteTypes = {};
        for (const site of existingSites) {
            existingSiteTypes[site.structureType] = (existingSiteTypes[site.structureType] || 0) + 1;
        }
        
        // Create a map of existing structures for faster lookups
        const structureMap = new Map();
        const structures = room.find(FIND_STRUCTURES);
        for (const structure of structures) {
            const key = `${structure.pos.x},${structure.pos.y},${structure.structureType}`;
            structureMap.set(key, true);
        }
        
        // Create a map of existing construction sites for faster lookups
        const siteMap = new Map();
        for (const site of existingSites) {
            const key = `${site.pos.x},${site.pos.y},${site.structureType}`;
            siteMap.set(key, true);
        }
        
        // Define the order of structure creation based on our prioritization logic
        if (!room.memory.construction.lastNonRoadTick) {
            room.memory.construction.lastNonRoadTick = Game.time;
        }
        
        // Track the last structure type we attempted to place
        if (!room.memory.construction.lastStructureType) {
            room.memory.construction.lastStructureType = 'containers';
        }
        
        // Initialize tracking for sites placed by type
        let sitesPlaced = 0;
        let sitesPlacedForRoads = 0;
        let sitesPlacedForContainers = 0;
        let sitesPlacedForExtensions = 0;
        let sitesPlacedForTowers = 0;
        let sitesPlacedForStorage = 0;
        
        // Determine if we should prioritize non-road structures
        const roadSites = existingSiteTypes[STRUCTURE_ROAD] || 0;
        const prioritizeNonRoads = roadSites > 0 && roadSites / existingSites.length > 0.5;
        const forceNonRoads = Game.time - (room.memory.construction.lastNonRoadTick || 0) > 100;
        
        // Define the base structure order
        const baseStructureOrder = prioritizeNonRoads || forceNonRoads ? 
            ['containers', 'extensions', 'towers', 'storage', 'roads'] : 
            ['containers', 'extensions', 'roads', 'towers', 'storage'];
            
        // Rotate the structure order to start with the next type after the last one we tried
        const lastIndex = baseStructureOrder.indexOf(room.memory.construction.lastStructureType);
        const structureOrder = lastIndex >= 0 ? 
            [...baseStructureOrder.slice(lastIndex + 1), ...baseStructureOrder.slice(0, lastIndex + 1)] :
            baseStructureOrder;
            
        // Process each structure type in order
        let structureIndex = 0;
        while (structureIndex < structureOrder.length && sitesPlaced < sitesToPlace) {
            const structureType = structureOrder[structureIndex];
            const previousRoadSites = sitesPlacedForRoads;
            const previousContainerSites = sitesPlacedForContainers;
            const previousExtensionSites = sitesPlacedForExtensions;
            const previousTowerSites = sitesPlacedForTowers;
            const previousStorageSites = sitesPlacedForStorage;
            
            // Place structures based on type
            if (structureType === 'containers' && 
                room.memory.construction.containers && 
                room.memory.construction.containers.planned) {
                // Place container construction sites
                // Implementation details omitted for brevity
                structureIndex++;
            } else if (structureType === 'extensions' && 
                room.controller.level >= 2 && 
                room.memory.construction.extensions && 
                room.memory.construction.extensions.planned) {
                // Place extension construction sites
                // Implementation details omitted for brevity
                structureIndex++;
            } else if (structureType === 'roads' && 
                room.memory.construction.roads && 
                room.memory.construction.roads.planned) {
                // Place road construction sites
                // Implementation details omitted for brevity
                structureIndex++;
            } else if (structureType === 'towers' && 
                room.controller.level >= 3 && 
                room.memory.construction.towers && 
                room.memory.construction.towers.planned) {
                // Place tower construction sites
                // Implementation details omitted for brevity
                structureIndex++;
            } else if (structureType === 'storage' && 
                room.controller.level >= 4 && 
                room.memory.construction.storage && 
                room.memory.construction.storage.planned) {
                // Place storage construction sites
                // Implementation details omitted for brevity
                structureIndex++;
            } else {
                structureIndex++;
            }
        }
        
        // Update room memory with current construction site count and IDs
        const updatedSites = room.find(FIND_CONSTRUCTION_SITES);
        room.memory.constructionSites = updatedSites.length;
        room.memory.constructionSiteIds = updatedSites.map(site => site.id);
        
        // Update the last attempted structure type
        if (structureOrder.length > 0) {
            room.memory.construction.lastStructureType = structureOrder[0];
        }
    },
    
    /**
     * Generate a complete room plan using the room planner
     * @param {Room} room - The room to plan
     */
    generateRoomPlan: function(room) {
        const roomPlanner = require('roomPlanner');
        
        // Generate the complete room plan
        const plan = roomPlanner.generateRoomPlan(room);
        
        if (!plan) {
            console.log(`Failed to generate room plan for ${room.name}`);
            return false;
        }
        
        // Store the plan in room memory
        room.memory.roomPlan = plan;
        
        // Mark all structure types as planned
        room.memory.construction = room.memory.construction || {};
        room.memory.construction.planned = true;
        room.memory.construction.lastRCL = room.controller.level;
        room.memory.construction.lastUpdate = Game.time;
        
        console.log(`Generated complete room plan for ${room.name} from RCL 1 to 8`);
        return true;
    },
    
    /**
     * Visualize the room plan
     * @param {Room} room - The room to visualize
     * @param {number} rcl - RCL level to visualize (0 for all levels)
     */
    visualizeRoomPlan: function(room, rcl = 0) {
        const roomPlanner = require('roomPlanner');
        
        if (!room.memory.roomPlan) {
            console.log(`No room plan exists for ${room.name}. Generate a plan first.`);
            return false;
        }
        
        // Output next construction sites to console
        const nextSites = this.getNextConstructionSites(room, 10);
        if (nextSites.length > 0) {
            console.log(`Next planned construction sites for ${room.name}:`);
            for (const site of nextSites) {
                console.log(`- ${site.type} at (${site.x},${site.y})`);
            }
        } else {
            console.log(`No pending construction sites found in ${room.name}.`);
        }
        
        roomPlanner.visualize(room, room.memory.roomPlan, rcl);
        return true;
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
     * Check if room has evolved and needs plan updates
     * @param {Room} room - The room to check
     */
    checkRoomEvolution: function(room) {
        // Skip if no construction memory
        if (!room.memory.construction) return;
        
        // Track the last RCL we planned for
        if (!room.memory.construction.lastRCL) {
            room.memory.construction.lastRCL = room.controller.level;
        }
        
        // If RCL has increased, update construction plans
        if (room.controller.level > room.memory.construction.lastRCL) {
            console.log(`Room ${room.name} evolved from RCL ${room.memory.construction.lastRCL} to ${room.controller.level}, updating construction plans`);
            
            // If we have a room plan, we don't need to replan individual structures
            if (room.memory.roomPlan) {
                // Just update the RCL level
                room.memory.construction.lastRCL = room.controller.level;
                return;
            }
            
            // Legacy planning logic for rooms without a complete plan
            // Reset extension planning when reaching RCL 2, 3, 4, etc.
            if ((room.controller.level >= 2 && room.memory.construction.lastRCL < 2) ||
                (room.controller.level >= 3 && room.memory.construction.lastRCL < 3) ||
                (room.controller.level >= 4 && room.memory.construction.lastRCL < 4)) {
                room.memory.construction.extensions.planned = false;
            }
            
            // Reset tower planning when reaching RCL 3, 5, 7
            if ((room.controller.level >= 3 && room.memory.construction.lastRCL < 3) ||
                (room.controller.level >= 5 && room.memory.construction.lastRCL < 5) ||
                (room.controller.level >= 7 && room.memory.construction.lastRCL < 7)) {
                room.memory.construction.towers.planned = false;
            }
            
            // Update the last RCL
            room.memory.construction.lastRCL = room.controller.level;
        }
        
        // Periodically check if we need to replan roads (every 1000 ticks)
        if (Game.time % 1000 === 0 && room.memory.construction.roads && room.memory.construction.roads.planned) {
            // Count existing roads
            const roads = room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_ROAD
            });
            
            // If we have very few roads compared to plan, something might be wrong
            if (roads.length < room.memory.construction.roads.positions.length * 0.5) {
                console.log(`Room ${room.name} has fewer roads than expected, replanning roads`);
                room.memory.construction.roads.planned = false;
            }
        }
    },
    
    /**
     * Update the construction site count in room memory
     * @param {Room} room - The room to update
     */
    updateConstructionSiteCount: function(room) {
        // Find all construction sites in the room
        const sites = room.find(FIND_CONSTRUCTION_SITES);
        
        // Update room memory
        room.memory.constructionSites = sites.length;
        room.memory.constructionSiteIds = sites.map(site => site.id);
        
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
        
        // Check if we need to create more sites
        const TARGET_SITES_PER_ROOM = 5;
        if (sites.length < TARGET_SITES_PER_ROOM) {
            // If we have a room plan and CPU is available, try to create sites immediately
            if (room.memory.roomPlan && Game.cpu.bucket > 1000) {
                this.createConstructionSitesFromPlan(room);
            } else if (!room.memory.construction.lastUpdate || Game.time - room.memory.construction.lastUpdate >= 20) {
                // Otherwise, schedule for next tick
                room.memory.construction.lastUpdate = Game.time - 95; // Will trigger in 5 ticks
            }
        }
    },
    
    /**
     * Create construction sites based on the room plan
     * @param {Room} room - The room to create construction sites in
     */
    createConstructionSitesFromPlan: function(room) {
        // Check for global construction site limit
        const globalSiteCount = Object.keys(Game.constructionSites).length;
        const TARGET_SITES_PER_ROOM = 5; // We want to maintain 5 sites at all times
        const MAX_GLOBAL_SITES = 100; // Game limit is 100
        
        if (globalSiteCount >= MAX_GLOBAL_SITES) return;
        
        // Count existing construction sites in this room
        const existingSites = room.find(FIND_CONSTRUCTION_SITES);
        
        // If we already have enough sites, check if we should replace suboptimal structures
        if (existingSites.length >= TARGET_SITES_PER_ROOM) {
            // Update room memory with current construction site count and IDs
            room.memory.constructionSites = existingSites.length;
            room.memory.constructionSiteIds = existingSites.map(site => site.id);
            return;
        }
        
        // Check if we should replace a suboptimal structure
        if (existingSites.length < TARGET_SITES_PER_ROOM && Game.time % 50 === 0) {
            if (this.replaceSuboptimalStructure(room)) {
                // We replaced a structure, wait until next time to place more sites
                return;
            }
        }
        
        // How many more sites we need to place to reach our target
        const sitesToPlace = Math.min(
            TARGET_SITES_PER_ROOM - existingSites.length,
            MAX_GLOBAL_SITES - globalSiteCount
        );
        
        // Get the room plan for the current RCL
        const plan = room.memory.roomPlan;
        if (!plan || !plan.rcl || !plan.rcl[room.controller.level]) return;
        
        const rclPlan = plan.rcl[room.controller.level];
        
        // Create a map of existing structures for faster lookups
        const structureMap = new Map();
        const structures = room.find(FIND_STRUCTURES);
        for (const structure of structures) {
            const key = `${structure.pos.x},${structure.pos.y},${structure.structureType}`;
            structureMap.set(key, true);
        }
        
        // Create a map of existing construction sites for faster lookups
        const siteMap = new Map();
        for (const site of existingSites) {
            const key = `${site.pos.x},${site.pos.y},${site.structureType}`;
            siteMap.set(key, true);
        }
        
        // Define priority order for structure types
        // Prioritize critical infrastructure first
        const structurePriority = [
            STRUCTURE_SPAWN,
            STRUCTURE_EXTENSION,
            STRUCTURE_CONTAINER,
            STRUCTURE_TOWER,
            STRUCTURE_STORAGE,
            STRUCTURE_ROAD,
            STRUCTURE_LINK,
            STRUCTURE_TERMINAL,
            STRUCTURE_LAB,
            STRUCTURE_FACTORY,
            STRUCTURE_OBSERVER,
            STRUCTURE_POWER_SPAWN,
            STRUCTURE_NUKER
        ];
        
        // Adjust priority based on RCL and existing structures
        if (room.controller.level <= 3) {
            // Early game: prioritize extensions and containers over roads
            const extensionCount = _.filter(structures, s => s.structureType === STRUCTURE_EXTENSION).length;
            const containerCount = _.filter(structures, s => s.structureType === STRUCTURE_CONTAINER).length;
            
            if (extensionCount < 5 || containerCount < 2) {
                // Move roads down in priority if we need more critical structures
                const roadIndex = structurePriority.indexOf(STRUCTURE_ROAD);
                if (roadIndex > 0) {
                    structurePriority.splice(roadIndex, 1);
                    structurePriority.push(STRUCTURE_ROAD);
                }
            }
        }
        
        let sitesPlaced = 0;
        
        // Process each structure type in priority order
        for (const structureType of structurePriority) {
            // Skip if we've placed enough sites
            if (sitesPlaced >= sitesToPlace) break;
            
            // Skip if this structure type isn't in the plan
            if (!rclPlan.structures[structureType] || rclPlan.structures[structureType].length === 0) continue;
            
            // Get the maximum allowed structures of this type
            const maxStructures = rclPlan.maxStructures[structureType] || 0;
            if (maxStructures === 0) continue;
            
            // Count existing structures of this type
            const existingCount = _.filter(structures, s => s.structureType === structureType).length;
            
            // Skip if we've already built all allowed structures of this type
            if (existingCount >= maxStructures) continue;
            
            // Get planned positions for this structure type
            const positions = rclPlan.structures[structureType];
            
            // Try to place construction sites for this structure type
            for (let i = 0; i < positions.length && sitesPlaced < sitesToPlace; i++) {
                const pos = positions[i];
                
                // Skip if out of bounds
                if (pos.x < 0 || pos.x > 49 || pos.y < 0 || pos.y > 49) continue;
                
                // Check if there's already a structure or construction site here
                const structureKey = `${pos.x},${pos.y},${structureType}`;
                const hasStructure = structureMap.has(structureKey);
                const hasSite = siteMap.has(structureKey);
                
                // Skip if already built or under construction
                if (hasStructure || hasSite) continue;
                
                // Check for any other structures at this position
                const lookResult = room.lookAt(pos.x, pos.y);
                let hasOtherStructure = false;
                
                for (const item of lookResult) {
                    if (item.type === LOOK_STRUCTURES && 
                        (structureType !== STRUCTURE_ROAD || item.structure.structureType !== STRUCTURE_RAMPART)) {
                        hasOtherStructure = true;
                        break;
                    }
                }
                
                if (hasOtherStructure) continue;
                
                // Create construction site
                const result = room.createConstructionSite(pos.x, pos.y, structureType);
                if (result === OK) {
                    sitesPlaced++;
                    console.log(`Created ${structureType} construction site at (${pos.x},${pos.y})`);
                    
                    // Add to site map to prevent duplicates
                    siteMap.set(structureKey, true);
                } else if (result !== ERR_FULL) {
                    console.log(`Failed to create ${structureType} construction site at (${pos.x},${pos.y}), result: ${result}`);
                }
            }
        }
        
        // Update room memory with current construction site count and IDs
        const updatedSites = room.find(FIND_CONSTRUCTION_SITES);
        room.memory.constructionSites = updatedSites.length;
        room.memory.constructionSiteIds = updatedSites.map(site => site.id);
        
        // Log if we created new sites
        if (sitesPlaced > 0) {
            // Count sites by type for better reporting
            const siteTypes = {};
            for (const site of updatedSites) {
                siteTypes[site.structureType] = (siteTypes[site.structureType] || 0) + 1;
            }
            
            // Create a summary string
            const typeSummary = Object.entries(siteTypes)
                .map(([type, count]) => `${count} ${type}`)
                .join(', ');
                
            console.log(`Room ${room.name}: Created ${sitesPlaced} construction sites from room plan, total now: ${updatedSites.length} (${typeSummary})`);
        }
        
        // If we still don't have enough sites, run again next tick
        if (updatedSites.length < TARGET_SITES_PER_ROOM) {
            // Force more frequent checks until we reach our target
            room.memory.construction.lastUpdate = Game.time - 95; // Will trigger again in 5 ticks
        }
    },
    
    /**
     * Replace a suboptimal structure with one that aligns with the room plan
     * @param {Room} room - The room to check
     * @returns {boolean} - True if a structure was replaced
     */
    replaceSuboptimalStructure: function(room) {
        // Skip if we don't have a room plan
        if (!room.memory.roomPlan) return false;
        
        // Get the room plan for the current RCL
        const plan = room.memory.roomPlan;
        if (!plan || !plan.rcl || !plan.rcl[room.controller.level]) return false;
        
        const rclPlan = plan.rcl[room.controller.level];
        
        // Find all structures in the room
        const structures = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType !== STRUCTURE_CONTROLLER && 
                       s.structureType !== STRUCTURE_SPAWN && // Don't remove spawns
                       s.structureType !== STRUCTURE_STORAGE && // Don't remove storage
                       s.structureType !== STRUCTURE_TERMINAL // Don't remove terminal
        });
        
        // Create a map of planned positions for each structure type
        const plannedPositions = {};
        for (const structureType in rclPlan.structures) {
            plannedPositions[structureType] = new Set();
            for (const pos of rclPlan.structures[structureType]) {
                plannedPositions[structureType].add(`${pos.x},${pos.y}`);
            }
        }
        
        // Find structures that are not in the plan
        const suboptimalStructures = [];
        for (const structure of structures) {
            const posKey = `${structure.pos.x},${structure.pos.y}`;
            const structureType = structure.structureType;
            
            // Skip if this structure type isn't in the plan
            if (!plannedPositions[structureType]) continue;
            
            // Check if this structure is in the planned position for its type
            if (!plannedPositions[structureType].has(posKey)) {
                suboptimalStructures.push(structure);
            }
        }
        
        // If we found suboptimal structures, remove one
        if (suboptimalStructures.length > 0) {
            // Prioritize removing roads first, then extensions, then containers
            const priorityOrder = {
                [STRUCTURE_ROAD]: 1,
                [STRUCTURE_EXTENSION]: 2,
                [STRUCTURE_CONTAINER]: 3,
                [STRUCTURE_TOWER]: 4
            };
            
            // Sort by priority
            suboptimalStructures.sort((a, b) => {
                const priorityA = priorityOrder[a.structureType] || 99;
                const priorityB = priorityOrder[b.structureType] || 99;
                return priorityA - priorityB;
            });
            
            // Remove the first structure
            const structureToRemove = suboptimalStructures[0];
            structureToRemove.destroy();
            console.log(`Removed suboptimal ${structureToRemove.structureType} at (${structureToRemove.pos.x},${structureToRemove.pos.y}) to align with room plan`);
            return true;
        }
        
        return false;
    }
};

// Wrap the module with error handling
const constructionManager = utils.wrapModule(constructionManagerImpl, 'constructionManager');

// Add debugging helper
constructionManager.debugLastError = function() {
    if (global.errors && global.errors.length > 0) {
        const lastError = global.errors[global.errors.length - 1];
        console.log(`Last error at tick ${lastError.time}:`);
        console.log(`${lastError.module}.${lastError.method}: ${lastError.message}`);
        console.log(`Stack: ${lastError.stack}`);
        return lastError;
    }
    return 'No errors recorded';
};

// Check for missing methods that might be referenced
const requiredMethods = [
    'run', 'updateConstructionSiteCount', 'checkRoomEvolution', 
    'planRoads', 'planContainers', 'planExtensions', 'planTowers', 'planStorage',
    'findTowerPosition', 'findControllerContainerPosition', 'createConstructionSites',
    'generateRoomPlan', 'visualizeRoomPlan', 'createConstructionSitesFromPlan'
];

for (const method of requiredMethods) {
    if (typeof constructionManagerImpl[method] !== 'function') {
        console.log(`WARNING: constructionManager is missing method: ${method}`);
    }
}

module.exports = constructionManager;