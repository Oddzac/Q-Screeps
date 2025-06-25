/**
 * Room Planner - Handles comprehensive room layout planning across all RCL levels
 * Uses a top-down approach: plan for RCL 8 first, then derive lower level plans
 */
const roomPlanner = {
    /**
     * Generate a complete room plan from RCL 8 down to RCL 1
     * @param {Room} room - The room to plan
     * @returns {Object} - Complete room plan
     */
    generateRoomPlan: function(room) {
        // Find the primary spawn as the anchor point
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return null;
        
        const spawn = spawns[0];
        const terrain = room.getTerrain();
        
        // Initialize the plan
        const plan = {
            rcl: {},  // Plans by RCL level
            anchor: {x: spawn.pos.x, y: spawn.pos.y},
            version: 2, // Increment version to indicate new planning approach
            timestamp: Game.time
        };
        
        // First generate the complete plan for RCL 8
        plan.rcl[8] = this.generateRCLPlan(room, spawn.pos, 8, terrain);
        
        // Then derive plans for lower RCL levels from the RCL 8 plan
        for (let rcl = 7; rcl >= 1; rcl--) {
            plan.rcl[rcl] = this.deriveRCLPlan(room, plan.rcl[8], rcl, terrain);
        }
        
        return plan;
    },
    
    /**
     * Generate plan for a specific RCL level
     * @param {Room} room - The room
     * @param {RoomPosition} anchor - Anchor position (usually spawn)
     * @param {number} rcl - RCL level to plan for
     * @param {RoomTerrain} terrain - Room terrain
     * @returns {Object} - Plan for this RCL level
     */
    generateRCLPlan: function(room, anchor, rcl, terrain) {
        const structures = {};
        
        // Add structures available at this RCL
        structures[STRUCTURE_SPAWN] = this.planSpawns(room, anchor, rcl, terrain);
        structures[STRUCTURE_EXTENSION] = this.planExtensions(room, anchor, rcl, terrain);
        structures[STRUCTURE_ROAD] = this.planRoads(room, anchor, rcl, terrain, structures);
        structures[STRUCTURE_CONTAINER] = this.planContainers(room, anchor, rcl, terrain);
        structures[STRUCTURE_TOWER] = this.planTowers(room, anchor, rcl, terrain);
        structures[STRUCTURE_STORAGE] = rcl >= 4 ? this.planStorage(room, anchor, terrain) : [];
        structures[STRUCTURE_LINK] = rcl >= 5 ? this.planLinks(room, anchor, rcl, terrain) : [];
        structures[STRUCTURE_TERMINAL] = rcl >= 6 ? this.planTerminal(room, anchor, terrain) : [];
        structures[STRUCTURE_LAB] = rcl >= 6 ? this.planLabs(room, anchor, rcl, terrain) : [];
        structures[STRUCTURE_FACTORY] = rcl >= 7 ? this.planFactory(room, anchor, terrain) : [];
        structures[STRUCTURE_OBSERVER] = rcl >= 8 ? this.planObserver(room, anchor, terrain) : [];
        structures[STRUCTURE_POWER_SPAWN] = rcl >= 8 ? this.planPowerSpawn(room, anchor, terrain) : [];
        structures[STRUCTURE_NUKER] = rcl >= 8 ? this.planNuker(room, anchor, terrain) : [];
        
        return {
            structures: structures,
            maxStructures: this.getMaxStructures(rcl)
        };
    },
    
    /**
     * Derive a plan for a lower RCL level from the RCL 8 plan
     * @param {Room} room - The room
     * @param {Object} rclMaxPlan - The RCL 8 plan to derive from
     * @param {number} targetRcl - Target RCL level to derive for
     * @param {RoomTerrain} terrain - Room terrain
     * @returns {Object} - Plan for the target RCL level
     */
    deriveRCLPlan: function(room, rclMaxPlan, targetRcl, terrain) {
        // Get maximum allowed structures for this RCL
        const maxStructures = this.getMaxStructures(targetRcl);
        const structures = {};
        
        // For each structure type in the RCL 8 plan
        for (const structureType in rclMaxPlan.structures) {
            // Get the maximum allowed count for this structure type at the target RCL
            const maxAllowed = maxStructures[structureType] || 0;
            
            // If none allowed at this RCL, set to empty array
            if (maxAllowed === 0) {
                structures[structureType] = [];
                continue;
            }
            
            // Get the positions from the RCL 8 plan
            const positions = rclMaxPlan.structures[structureType] || [];
            
            // Special handling for containers and links
            if (structureType === STRUCTURE_CONTAINER) {
                // At lower RCLs, we need containers where links would be at higher RCLs
                if (targetRcl < 5) {
                    // Get link positions from RCL 8 plan that should be containers at lower RCLs
                    const linkPositions = rclMaxPlan.structures[STRUCTURE_LINK] || [];
                    
                    // Create a set of existing container positions to avoid duplicates
                    const containerPositions = new Set(positions.map(pos => `${pos.x},${pos.y}`));
                    
                    // Add source link positions as containers for lower RCLs
                    // Skip the first link (usually storage link) and second link (usually controller link)
                    for (let i = 2; i < linkPositions.length && containerPositions.size < maxAllowed; i++) {
                        const linkPos = linkPositions[i];
                        const posKey = `${linkPos.x},${linkPos.y}`;
                        
                        if (!containerPositions.has(posKey)) {
                            containerPositions.add(posKey);
                            positions.push(linkPos);
                        }
                    }
                    
                    // Limit to max allowed
                    structures[structureType] = positions.slice(0, maxAllowed);
                } else {
                    // For RCL 5+, use only the original container positions (not source containers)
                    // Keep only the first 2 containers (usually controller and a buffer container)
                    structures[structureType] = positions.slice(0, Math.min(2, maxAllowed));
                }
            } else if (structureType === STRUCTURE_LINK) {
                // For links, prioritize storage link, then controller link, then source links
                structures[structureType] = positions.slice(0, maxAllowed);
            } else {
                // For all other structures, just take the first N positions allowed at this RCL
                structures[structureType] = positions.slice(0, maxAllowed);
            }
        }
        
        return {
            structures: structures,
            maxStructures: maxStructures
        };
    },
    
    /**
     * Get maximum allowed structures by RCL
     * @param {number} rcl - RCL level
     * @returns {Object} - Maximum structure counts
     */
    getMaxStructures: function(rcl) {
        const max = {};
        
        // Use CONTROLLER_STRUCTURES constants
        for (const structureType in CONTROLLER_STRUCTURES) {
            max[structureType] = CONTROLLER_STRUCTURES[structureType][rcl] || 0;
        }
        
        return max;
    },
    
    /**
     * Plan spawn positions
     */
    planSpawns: function(room, anchor, rcl, terrain) {
        const spawns = [];
        
        // First spawn is the anchor
        spawns.push({x: anchor.x, y: anchor.y});
        
        // Additional spawns at RCL 7+
        if (rcl >= 7) {
            // Place second spawn adjacent to first
            const pos = this.findBuildablePosition(room, anchor, 2, 3, terrain, spawns);
            if (pos) spawns.push(pos);
        }
        
        // Third spawn at RCL 8
        if (rcl >= 8) {
            const pos = this.findBuildablePosition(room, anchor, 2, 3, terrain, spawns);
            if (pos) spawns.push(pos);
        }
        
        return spawns;
    },
    
    /**
     * Plan extension positions
     */
    planExtensions: function(room, anchor, rcl, terrain) {
        const extensions = [];
        const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] || 0;
        
        if (maxExtensions === 0) return extensions;
        
        // Create a pattern of extensions around the spawn
        // Start with a small radius and expand outward
        let radius = 2;
        
        while (extensions.length < maxExtensions && radius < 10) {
            // Try to place extensions in a pattern around the anchor
            for (let x = -radius; x <= radius && extensions.length < maxExtensions; x++) {
                for (let y = -radius; y <= radius && extensions.length < maxExtensions; y++) {
                    // Skip positions that aren't on the edge of the radius
                    if (Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
                    
                    const posX = anchor.x + x;
                    const posY = anchor.y + y;
                    
                    // Skip if out of bounds or on a wall
                    if (posX < 2 || posX > 47 || posY < 2 || posY > 47 || 
                        terrain.get(posX, posY) === TERRAIN_MASK_WALL) {
                        continue;
                    }
                    
                    // Skip if too close to existing extensions
                    let tooClose = false;
                    for (const ext of extensions) {
                        if (Math.abs(ext.x - posX) + Math.abs(ext.y - posY) < 2) {
                            tooClose = true;
                            break;
                        }
                    }
                    
                    if (!tooClose) {
                        extensions.push({x: posX, y: posY});
                    }
                }
            }
            
            radius++;
        }
        
        // If we still need more extensions, use a spiral pattern
        if (extensions.length < maxExtensions) {
            this.fillExtensionsSpiral(room, anchor, extensions, maxExtensions, terrain);
        }
        
        return extensions;
    },
    
    /**
     * Fill remaining extensions using a spiral pattern
     */
    fillExtensionsSpiral: function(room, anchor, extensions, maxExtensions, terrain) {
        // Start with a small offset from anchor
        const startX = anchor.x + 4;
        const startY = anchor.y + 4;
        
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
                terrain.get(x, y) !== TERRAIN_MASK_WALL) {
                
                // Check if too close to existing extensions
                let tooClose = false;
                for (const ext of extensions) {
                    if (Math.abs(ext.x - x) + Math.abs(ext.y - y) < 2) {
                        tooClose = true;
                        break;
                    }
                }
                
                if (!tooClose) {
                    extensions.push({x, y});
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
     * Plan road positions
     */
    planRoads: function(room, anchor, rcl, terrain, structures) {
        const roads = [];
        
        // Skip if RCL too low
        if (rcl < 2) return roads;
        
        // Find sources
        const sources = room.find(FIND_SOURCES);
        
        // Create roads from spawn to sources
        for (const source of sources) {
            const path = this.findPath(room, anchor, source.pos, terrain);
            for (const step of path) {
                // Skip the source position itself
                if (step.x === source.pos.x && step.y === source.pos.y) continue;
                
                // Add road position if not already added
                const roadKey = `${step.x},${step.y}`;
                if (!roads.some(r => r.x === step.x && r.y === step.y)) {
                    roads.push({x: step.x, y: step.y});
                }
            }
        }
        
        // Create road to controller
        const controllerPath = this.findPath(room, anchor, room.controller.pos, terrain);
        for (const step of controllerPath) {
            // Skip the controller position itself
            if (step.x === room.controller.pos.x && step.y === room.controller.pos.y) continue;
            
            // Add road position if not already added
            if (!roads.some(r => r.x === step.x && r.y === step.y)) {
                roads.push({x: step.x, y: step.y});
            }
        }
        
        // Create roads around spawn and extensions
        if (rcl >= 3) {
            // Add roads around spawn
            this.addRoadsAround(anchor, roads, terrain);
            
            // Add roads around extensions
            const extensions = structures[STRUCTURE_EXTENSION] || [];
            for (const ext of extensions) {
                this.addRoadsAround({x: ext.x, y: ext.y}, roads, terrain);
            }
        }
        
        return roads;
    },
    
    /**
     * Add roads around a position
     */
    addRoadsAround: function(pos, roads, terrain) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue; // Skip the center
                
                const x = pos.x + dx;
                const y = pos.y + dy;
                
                // Skip if out of bounds or on a wall
                if (x < 2 || x > 47 || y < 2 || y > 47 || 
                    terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    continue;
                }
                
                // Add road if not already added
                if (!roads.some(r => r.x === x && r.y === y)) {
                    roads.push({x, y});
                }
            }
        }
    },
    
    /**
     * Find a path between two positions
     */
    findPath: function(room, fromPos, toPos, terrain) {
        // Use PathFinder for better paths
        const result = PathFinder.search(
            new RoomPosition(fromPos.x, fromPos.y, room.name),
            {pos: new RoomPosition(toPos.x, toPos.y, room.name), range: 1},
            {
                plainCost: 2,
                swampCost: 10,
                roomCallback: function() {
                    const costs = new PathFinder.CostMatrix();
                    
                    // Mark walls as unwalkable
                    for (let y = 0; y < 50; y++) {
                        for (let x = 0; x < 50; x++) {
                            if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                                costs.set(x, y, 255);
                            }
                        }
                    }
                    
                    return costs;
                }
            }
        );
        
        return result.path;
    },
    
    /**
     * Plan container positions
     */
    planContainers: function(room, anchor, rcl, terrain) {
        const containers = [];
        
        // Skip if RCL too low
        if (rcl < 2) return containers;
        
        // Find sources
        const sources = room.find(FIND_SOURCES);
        
        // Place container near controller at RCL 2+
        const controllerPos = this.findControllerContainerPosition(room, terrain);
        if (controllerPos) {
            containers.push(controllerPos);
        }
        
        // Place containers near sources (these will be replaced by links at higher RCLs)
        for (const source of sources) {
            const pos = this.findBestSourceContainerPosition(room, source, terrain);
            if (pos) {
                containers.push(pos);
            }
        }
        
        // Add a buffer container near storage position for RCL 4+
        if (rcl >= 4) {
            const storagePositions = this.planStorage(room, anchor, terrain);
            if (storagePositions.length > 0) {
                const storagePos = storagePositions[0];
                const bufferPos = this.findBuildablePosition(room, storagePos, 1, 2, terrain, containers);
                if (bufferPos) {
                    containers.push(bufferPos);
                }
            }
        }
        
        return containers;
    },
    
    /**
     * Find best position for a container near a source
     */
    findBestSourceContainerPosition: function(room, source, terrain) {
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
                    bestPos = {x, y};
                }
            }
        }
        
        return bestPos;
    },
    
    /**
     * Find position for a container near the controller
     */
    findControllerContainerPosition: function(room, terrain) {
        const controller = room.controller;
        if (!controller) return null;
        
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
                    bestPos = {x, y};
                }
            }
        }
        
        return bestPos;
    },
    
    /**
     * Plan tower positions
     */
    planTowers: function(room, anchor, rcl, terrain) {
        const towers = [];
        const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] || 0;
        
        if (maxTowers === 0) return towers;
        
        // First tower: close to spawn for early defense
        const firstTowerPos = this.findBuildablePosition(room, anchor, 2, 4, terrain);
        if (firstTowerPos) {
            towers.push(firstTowerPos);
        }
        
        // Additional towers: strategic positions
        if (maxTowers >= 2) {
            // Second tower: near room center for better coverage
            const centerX = 25;
            const centerY = 25;
            const centerPos = {x: centerX, y: centerY};
            const secondTowerPos = this.findBuildablePosition(room, centerPos, 5, 10, terrain, towers);
            
            if (secondTowerPos) {
                towers.push(secondTowerPos);
            }
        }
        
        // More towers at higher RCLs
        if (maxTowers >= 3) {
            for (let i = towers.length; i < maxTowers; i++) {
                // Place towers in a defensive pattern
                const pos = this.findBuildablePosition(room, anchor, 3, 6, terrain, towers);
                if (pos) {
                    towers.push(pos);
                }
            }
        }
        
        return towers;
    },
    
    /**
     * Plan storage position
     */
    planStorage: function(room, anchor, terrain) {
        if (!room.controller || room.controller.level < 4) return [];
        
        // Find a good position for storage near spawn
        const storagePos = this.findBuildablePosition(room, anchor, 2, 4, terrain);
        
        return storagePos ? [storagePos] : [];
    },
    
    /**
     * Plan link positions
     */
    planLinks: function(room, anchor, rcl, terrain) {
        const links = [];
        const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK][rcl] || 0;
        
        if (maxLinks === 0) return links;
        
        // First link: near storage
        const storagePositions = this.planStorage(room, anchor, terrain);
        if (storagePositions.length > 0) {
            const storagePos = storagePositions[0];
            const storageLink = this.findBuildablePosition(room, storagePos, 1, 2, terrain);
            if (storageLink) {
                links.push(storageLink);
            }
        } else {
            // Fallback: near spawn
            const spawnLink = this.findBuildablePosition(room, anchor, 2, 3, terrain);
            if (spawnLink) {
                links.push(spawnLink);
            }
        }
        
        // Second link: near controller
        if (maxLinks >= 2) {
            // Use the same position as the controller container
            const controllerPos = this.findControllerContainerPosition(room, terrain);
            if (controllerPos) {
                links.push(controllerPos);
            } else {
                // Fallback if no container position found
                const controllerLink = this.findBuildablePosition(room, room.controller.pos, 2, 3, terrain, links);
                if (controllerLink) {
                    links.push(controllerLink);
                }
            }
        }
        
        // Additional links: replace source containers
        if (maxLinks >= 3) {
            const sources = room.find(FIND_SOURCES);
            for (const source of sources) {
                if (links.length >= maxLinks) break;
                
                // Use the same position as the source container
                const containerPos = this.findBestSourceContainerPosition(room, source, terrain);
                if (containerPos) {
                    links.push(containerPos);
                } else {
                    // Fallback if no container position found
                    const sourceLink = this.findBuildablePosition(room, source.pos, 1, 2, terrain, links);
                    if (sourceLink) {
                        links.push(sourceLink);
                    }
                }
            }
        }
        
        return links;
    },
    
    /**
     * Plan terminal position
     */
    planTerminal: function(room, anchor, terrain) {
        if (!room.controller || room.controller.level < 6) return [];
        
        // Place terminal near storage if possible
        let referencePos = anchor;
        if (room.storage) {
            referencePos = {x: room.storage.pos.x, y: room.storage.pos.y};
        }
        
        const terminalPos = this.findBuildablePosition(room, referencePos, 1, 3, terrain);
        
        return terminalPos ? [terminalPos] : [];
    },
    
    /**
     * Plan lab positions
     */
    planLabs: function(room, anchor, rcl, terrain) {
        const labs = [];
        const maxLabs = CONTROLLER_STRUCTURES[STRUCTURE_LAB][rcl] || 0;
        
        if (maxLabs === 0) return labs;
        
        // Find a good area for labs
        let labAnchor = this.findBuildablePosition(room, anchor, 6, 10, terrain);
        if (!labAnchor) return labs;
        
        // Place labs in a compact pattern
        const labPositions = [
            {dx: 0, dy: 0},   // Center lab
            {dx: 1, dy: 0},   // Right
            {dx: 0, dy: 1},   // Bottom
            {dx: -1, dy: 0},  // Left
            {dx: 0, dy: -1},  // Top
            {dx: 1, dy: 1},   // Bottom-right
            {dx: -1, dy: 1},  // Bottom-left
            {dx: -1, dy: -1}, // Top-left
            {dx: 1, dy: -1},  // Top-right
            {dx: 2, dy: 0}    // Far right
        ];
        
        for (let i = 0; i < Math.min(maxLabs, labPositions.length); i++) {
            const pos = {
                x: labAnchor.x + labPositions[i].dx,
                y: labAnchor.y + labPositions[i].dy
            };
            
            // Verify position is valid
            if (pos.x >= 2 && pos.x <= 47 && pos.y >= 2 && pos.y <= 47 && 
                terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
                labs.push(pos);
            }
        }
        
        return labs;
    },
    
    /**
     * Plan factory position
     */
    planFactory: function(room, anchor, terrain) {
        if (!room.controller || room.controller.level < 7) return [];
        
        // Place factory near storage if possible
        let referencePos = anchor;
        if (room.storage) {
            referencePos = {x: room.storage.pos.x, y: room.storage.pos.y};
        }
        
        const factoryPos = this.findBuildablePosition(room, referencePos, 2, 4, terrain);
        
        return factoryPos ? [factoryPos] : [];
    },
    
    /**
     * Plan observer position
     */
    planObserver: function(room, anchor, terrain) {
        if (!room.controller || room.controller.level < 8) return [];
        
        // Place observer in a corner
        const observerPos = this.findBuildablePosition(room, {x: 10, y: 10}, 0, 40, terrain);
        
        return observerPos ? [observerPos] : [];
    },
    
    /**
     * Plan power spawn position
     */
    planPowerSpawn: function(room, anchor, terrain) {
        if (!room.controller || room.controller.level < 8) return [];
        
        // Place power spawn near storage if possible
        let referencePos = anchor;
        if (room.storage) {
            referencePos = {x: room.storage.pos.x, y: room.storage.pos.y};
        }
        
        const powerSpawnPos = this.findBuildablePosition(room, referencePos, 2, 5, terrain);
        
        return powerSpawnPos ? [powerSpawnPos] : [];
    },
    
    /**
     * Plan nuker position
     */
    planNuker: function(room, anchor, terrain) {
        if (!room.controller || room.controller.level < 8) return [];
        
        // Place nuker away from critical infrastructure
        const nukerPos = this.findBuildablePosition(room, anchor, 6, 10, terrain);
        
        return nukerPos ? [nukerPos] : [];
    },
    
    /**
     * Find a buildable position near a reference point
     */
    findBuildablePosition: function(room, refPos, minRange, maxRange, terrain, existingPositions = []) {
        // Check positions in a square around the reference point
        for (let range = minRange; range <= maxRange; range++) {
            const positions = [];
            
            // Top and bottom edges
            for (let dx = -range; dx <= range; dx++) {
                positions.push({x: refPos.x + dx, y: refPos.y - range}); // Top edge
                positions.push({x: refPos.x + dx, y: refPos.y + range}); // Bottom edge
            }
            
            // Left and right edges (excluding corners which are already added)
            for (let dy = -range + 1; dy <= range - 1; dy++) {
                positions.push({x: refPos.x - range, y: refPos.y + dy}); // Left edge
                positions.push({x: refPos.x + range, y: refPos.y + dy}); // Right edge
            }
            
            // Shuffle positions for more natural placement
            this.shuffleArray(positions);
            
            // Check each position
            for (const pos of positions) {
                // Skip if out of bounds or on a wall
                if (pos.x <= 1 || pos.y <= 1 || pos.x >= 48 || pos.y >= 48 || 
                    terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) {
                    continue;
                }
                
                // Skip if too close to existing positions
                let tooClose = false;
                for (const existingPos of existingPositions) {
                    if (Math.abs(existingPos.x - pos.x) + Math.abs(existingPos.y - pos.y) < 2) {
                        tooClose = true;
                        break;
                    }
                }
                
                if (!tooClose) {
                    return pos;
                }
            }
        }
        
        return null;
    },
    
    /**
     * Shuffle array in place
     */
    shuffleArray: function(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    },
    
    /**
     * Visualize the room plan
     * @param {Room} room - The room to visualize in
     * @param {Object} plan - The room plan to visualize
     * @param {number} rcl - RCL level to visualize (0 for all levels)
     */
    visualize: function(room, plan, rcl = 0) {
        if (!plan || !room) return;
        
        const visual = room.visual;
        
        // Clear previous visuals
        visual.clear();
        
        // Define colors for different structure types
        const colors = {
            [STRUCTURE_SPAWN]: '#ff0000',
            [STRUCTURE_EXTENSION]: '#ffaa00',
            [STRUCTURE_ROAD]: '#999999',
            [STRUCTURE_CONTAINER]: '#ffff00',
            [STRUCTURE_TOWER]: '#0000ff',
            [STRUCTURE_STORAGE]: '#006600',
            [STRUCTURE_LINK]: '#ff00ff',
            [STRUCTURE_TERMINAL]: '#00ffff',
            [STRUCTURE_LAB]: '#ff00aa',
            [STRUCTURE_FACTORY]: '#aa00ff',
            [STRUCTURE_OBSERVER]: '#00ffaa',
            [STRUCTURE_POWER_SPAWN]: '#aaff00',
            [STRUCTURE_NUKER]: '#ff0055',
            'rampart': '#00ff00',
            'wall': '#cccccc'
        };
        
        // Visualize anchor point
        visual.circle(plan.anchor.x, plan.anchor.y, {radius: 0.5, fill: '#ffffff', opacity: 0.8});
        
        // If specific RCL is requested, visualize only that level
        if (rcl > 0 && rcl <= 8) {
            this.visualizeRCL(visual, plan.rcl[rcl], colors);
            visual.text(`RCL ${rcl} Plan`, 25, 2, {align: 'center', color: '#ffffff'});
        } else {
            // Visualize all RCL levels with different opacities
            for (let level = 1; level <= 8; level++) {
                const opacity = 0.3 + (level / 10); // Higher RCL = more opaque
                this.visualizeRCL(visual, plan.rcl[level], colors, opacity);
            }
            visual.text('Complete Room Plan (All RCLs)', 25, 2, {align: 'center', color: '#ffffff'});
        }
        
        // Visualize defensive structures if available and showing RCL 8 or all RCLs
        if (plan.defenses && (rcl === 0 || rcl === 8)) {
            // Visualize ramparts
            for (const pos of plan.defenses.ramparts) {
                visual.rect(pos.x - 0.5, pos.y - 0.5, 1, 1, {
                    fill: colors['rampart'],
                    opacity: 0.3,
                    stroke: colors['rampart'],
                    strokeWidth: 0.1
                });
            }
            
            // Visualize walls
            for (const pos of plan.defenses.walls) {
                visual.rect(pos.x - 0.4, pos.y - 0.4, 0.8, 0.8, {
                    fill: colors['wall'],
                    opacity: 0.5
                });
            }
            
            // Add defense count to visualization
            visual.text(`Defenses: ${plan.defenses.ramparts.length} ramparts, ${plan.defenses.walls.length} walls`, 
                      25, 47, {align: 'center', color: '#ffffff'});
        }
        
        // Add legend
        let legendY = 4;
        for (const structureType in colors) {
            visual.rect(2, legendY, 1, 1, {fill: colors[structureType]});
            visual.text(structureType, 4, legendY + 0.5, {align: 'left', color: '#ffffff'});
            legendY += 1.5;
        }
    },
    
    /**
     * Visualize a specific RCL level
     */
    visualizeRCL: function(visual, rclPlan, colors, opacity = 0.7) {
        if (!rclPlan || !rclPlan.structures) return;
        
        for (const structureType in rclPlan.structures) {
            const positions = rclPlan.structures[structureType];
            const color = colors[structureType] || '#ffffff';
            
            for (const pos of positions) {
                if (structureType === STRUCTURE_ROAD) {
                    visual.circle(pos.x, pos.y, {radius: 0.3, fill: color, opacity: opacity * 0.8});
                } else {
                    visual.rect(pos.x - 0.4, pos.y - 0.4, 0.8, 0.8, {fill: color, opacity: opacity});
                }
            }
        }
    },
    
    /**
     * Plan defensive structures based on the final room footprint
     * @param {Room} room - The room to plan defenses for
     * @param {Object} roomPlan - The complete room plan
     * @returns {Object} - Defensive structure positions
     */
    planDefenses: function(room, roomPlan) {
        if (!roomPlan || !roomPlan.rcl || !roomPlan.rcl[8]) return null;
        
        const terrain = room.getTerrain();
        const rclMaxPlan = roomPlan.rcl[8];
        const defenses = {
            ramparts: [],
            walls: []
        };
        
        // Create a set of all structure positions to protect
        const protectedPositions = new Set();
        for (const structureType in rclMaxPlan.structures) {
            // Skip roads for rampart protection
            if (structureType === STRUCTURE_ROAD) continue;
            
            for (const pos of rclMaxPlan.structures[structureType]) {
                protectedPositions.add(`${pos.x},${pos.y}`);
            }
        }
        
        // Add ramparts on all important structures
        for (const posKey of protectedPositions) {
            const [x, y] = posKey.split(',').map(Number);
            defenses.ramparts.push({x, y});
        }
        
        // Find the outer perimeter for walls
        const roomBoundary = this.findRoomBoundary(room, protectedPositions, terrain);
        defenses.walls = roomBoundary.walls;
        defenses.ramparts = [...defenses.ramparts, ...roomBoundary.ramparts];
        
        return defenses;
    },
    
    /**
     * Find the room boundary for defensive structures
     * @param {Room} room - The room
     * @param {Set} protectedPositions - Set of positions to protect
     * @param {RoomTerrain} terrain - Room terrain
     * @returns {Object} - Wall and rampart positions
     */
    findRoomBoundary: function(room, protectedPositions, terrain) {
        const walls = [];
        const ramparts = [];
        
        // Create a grid representation of the room
        const grid = Array(50).fill().map(() => Array(50).fill(0));
        
        // Mark protected positions as 1
        for (const posKey of protectedPositions) {
            const [x, y] = posKey.split(',').map(Number);
            grid[y][x] = 1;
        }
        
        // Mark terrain walls as -1
        for (let y = 0; y < 50; y++) {
            for (let x = 0; x < 50; x++) {
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    grid[y][x] = -1;
                }
            }
        }
        
        // Find boundary positions (adjacent to protected positions but not protected themselves)
        for (let y = 1; y < 49; y++) {
            for (let x = 1; x < 49; x++) {
                // Skip if this is a protected position or terrain wall
                if (grid[y][x] !== 0) continue;
                
                // Check if adjacent to a protected position
                let isAdjacent = false;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        
                        if (grid[y + dy][x + dx] === 1) {
                            isAdjacent = true;
                            break;
                        }
                    }
                    if (isAdjacent) break;
                }
                
                // If adjacent to a protected position, add to boundary
                if (isAdjacent) {
                    // Use ramparts for exit tiles, walls for non-exit tiles
                    if (x === 0 || x === 49 || y === 0 || y === 49) {
                        ramparts.push({x, y});
                    } else {
                        walls.push({x, y});
                    }
                }
            }
        }
        
        return { walls, ramparts };
    }
};

module.exports = roomPlanner;