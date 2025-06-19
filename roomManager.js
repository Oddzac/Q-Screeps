/**
 * Room Manager - Centralized room intelligence with CPU optimization
 */
const roomManager = {
    // Cache for room data to avoid memory reads
    cache: {},
    
    /**
     * Updates and caches room data for efficient access
     * @param {Room} room - The room to analyze
     */
    updateRoomData: function(room) {
        const utils = require('utils');
        
        try {
            // Skip if we've already processed this room this tick
            const roomTickKey = `${room.name}_processed`;
            if (this.cache[roomTickKey] === Game.time) return;
            this.cache[roomTickKey] = Game.time;
            
            // Initialize cache for this room if needed
            if (!this.cache[room.name]) {
                this.cache[room.name] = {};
            }
            
            // Initialize room memory if needed
            if (!room.memory.sources) {
                room.memory.sources = {};
                room.memory.lastUpdate = 0;
            }
            
            // Determine update frequency based on CPU conditions - cache this calculation
            const updateFreqKey = 'updateFreq';
            let fullUpdateInterval;
            
            if (this.cache[updateFreqKey] && this.cache[updateFreqKey].time === Game.time) {
                fullUpdateInterval = this.cache[updateFreqKey].value;
            } else {
                fullUpdateInterval = 20; // Default interval
                
                // Adjust interval based on emergency mode
                if (global.emergencyMode) {
                    fullUpdateInterval = global.emergencyMode.level === 'critical' ? 100 : 50;
                } else if (Game.cpu.bucket < 3000) {
                    fullUpdateInterval = 40;
                }
                
                this.cache[updateFreqKey] = {
                    time: Game.time,
                    value: fullUpdateInterval
                };
            }
            
            const needsFullUpdate = Game.time - room.memory.lastUpdate >= fullUpdateInterval;
            
            // Always update these critical values every tick
            this.cache[room.name].energyAvailable = room.energyAvailable;
            this.cache[room.name].energyCapacityAvailable = room.energyCapacityAvailable;
            
            // Count creeps by role (only once per tick)
            if (!this.cache.creepCounts || Game.time !== (this.cache.creepCountsTime || 0)) {
                this.cache.creepCounts = this.countCreepsByRole();
                this.cache.creepCountsTime = Game.time;
            }
            
            // Get creep counts for this room
            this.cache[room.name].creepCounts = this.cache.creepCounts[room.name] || {
                harvester: 0, hauler: 0, upgrader: 0, builder: 0, total: 0
            };
            
            // Calculate energy needs - always needed for proper functioning
            this.calculateEnergyNeeds(room);
            
            // Perform full update when needed and CPU allows
            if (needsFullUpdate && utils.shouldExecute('medium')) {
                this.performFullUpdate(room);
            }
        } catch (error) {
            console.log(`Error in roomManager.updateRoomData for room ${room.name}: ${error}`);
            // Ensure we have at least basic data in cache
            if (!this.cache[room.name]) {
                this.cache[room.name] = {
                    energyAvailable: room.energyAvailable,
                    energyCapacityAvailable: room.energyCapacityAvailable,
                    creepCounts: { harvester: 0, hauler: 0, upgrader: 0, builder: 0, total: 0 }
                };
            }
        }
        
        // Write critical data to memory at the end of the tick
        // This reduces memory operations which are CPU intensive
        if (!this.cache.memoryUpdateScheduled) {
            this.cache.memoryUpdateScheduled = true;
            
            // Schedule memory update at the end of the tick
            this.scheduleMemoryUpdate();
        }
    },
    
    /**
     * Schedule memory update at the end of the tick
     */
    scheduleMemoryUpdate: function() {
        // Use post-tick callback if available
        if (typeof Game.cpu.setPostTickCallback === 'function') {
            Game.cpu.setPostTickCallback(() => this.updateMemory());
        } else {
            // Fallback to immediate update
            this.updateMemory();
        }
    },
    
    /**
     * Update memory from cache
     */
    updateMemory: function() {
        for (const roomName in this.cache) {
            if (roomName === 'creepCounts' || roomName === 'creepCountsTime' || roomName === 'memoryUpdateScheduled') continue;
            
            const roomCache = this.cache[roomName];
            const roomMemory = Memory.rooms[roomName] = Memory.rooms[roomName] || {};
            
            // Update critical values
            roomMemory.energyAvailable = roomCache.energyAvailable;
            roomMemory.energyCapacityAvailable = roomCache.energyCapacityAvailable;
            roomMemory.creepCounts = roomCache.creepCounts;
            roomMemory.priorities = roomCache.priorities;
            
            // Update construction data
            if (roomCache.constructionSites !== undefined) {
                roomMemory.constructionSites = roomCache.constructionSites;
            }
            if (roomCache.constructionSiteIds) {
                roomMemory.constructionSiteIds = roomCache.constructionSiteIds;
            }
            if (roomCache.sitesByType) {
                roomMemory.sitesByType = roomCache.sitesByType;
            }
            
            // Update energy source data
            if (roomCache.energySources) {
                roomMemory.energySources = roomCache.energySources;
            }
            if (roomCache.energySourcesTime) {
                roomMemory.energySourcesTime = roomCache.energySourcesTime;
            }
            
            // Update active sources data
            if (roomCache.activeSources) {
                roomMemory.activeSources = roomCache.activeSources;
            }
            if (roomCache.activeSourcesTime) {
                roomMemory.activeSourcesTime = roomCache.activeSourcesTime;
            }
        }
        
        this.cache.memoryUpdateScheduled = false;
    },
    
    /**
     * Perform a full update of room data
     * @param {Room} room - The room to update
     */
    performFullUpdate: function(room) {
        const utils = require('utils');
        
        // Find and cache sources - use cached find to reduce CPU
        const sources = utils.cachedFind(room, FIND_SOURCES, {}, 500); // Sources don't change often
        
        // Track active sources
        const activeSources = sources.filter(source => source.energy > 0).map(source => source.id);
        this.cache[room.name].activeSources = activeSources;
        this.cache[room.name].activeSourcesTime = Game.time;
        
        // Initialize energy request registry if it doesn't exist
        if (!room.memory.energyRequests) {
            room.memory.energyRequests = {};
        }
        
        // Clean up stale energy requests - only do this every 10 ticks to save CPU
        if (Game.time % 10 === 0) {
            this.cleanupEnergyRequests(room);
        }
        
        // Process sources that don't have data yet
        const unprocessedSources = sources.filter(source => !room.memory.sources[source.id]);
        if (unprocessedSources.length > 0) {
            const terrain = room.getTerrain();
            
            for (const source of unprocessedSources) {
                let availableSpots = 0;
                
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        
                        const x = source.pos.x + dx;
                        const y = source.pos.y + dy;
                        
                        if (x >= 0 && y >= 0 && x < 50 && y < 50 && 
                            terrain.get(x, y) !== TERRAIN_MASK_WALL) {
                            availableSpots++;
                        }
                    }
                }
                
                room.memory.sources[source.id] = {
                    pos: {x: source.pos.x, y: source.pos.y},
                    availableSpots: availableSpots,
                    assignedHarvesters: 0
                };
            }
        }
        
        // Batch find operations to reduce CPU usage - use cached find
        const structures = utils.cachedFind(room, FIND_STRUCTURES, {}, 20);
        
        // Find and cache construction sites
        const sites = utils.cachedFind(room, FIND_CONSTRUCTION_SITES, {}, 10);
        this.cache[room.name].constructionSites = sites.length;
        
        // Cache construction site IDs and details for builders
        if (sites.length > 0) {
            this.cache[room.name].constructionSiteIds = sites.map(s => s.id);
            
            // Group by type for prioritization - use cached calculation if available
            const sitesByTypeKey = `sitesByType_${room.name}`;
            if (!this.cache[sitesByTypeKey] || this.cache[sitesByTypeKey].time !== Game.time) {
                const sitesByType = _.groupBy(sites, site => site.structureType);
                this.cache[sitesByTypeKey] = {
                    time: Game.time,
                    value: Object.keys(sitesByType).map(type => ({
                        type: type,
                        count: sitesByType[type].length
                    }))
                };
            }
            
            this.cache[room.name].sitesByType = this.cache[sitesByTypeKey].value;
            
            // Log construction activity
            if (Game.time % 50 === 0 || !room.memory.lastConstructionLog || 
                Game.time - room.memory.lastConstructionLog > 100) {
                console.log(`Room ${room.name} construction: ${sites.length} sites - ` + 
                    this.cache[room.name].sitesByType.map(site => 
                        `${site.count} ${site.type}`
                    ).join(', '));
                room.memory.lastConstructionLog = Game.time;
            }
        } else {
            this.cache[room.name].constructionSiteIds = [];
            this.cache[room.name].sitesByType = [];
        }
        
        // Find structures needing repair - cache this calculation
        const repairCacheKey = `repairTargets_${room.name}`;
        if (!this.cache[repairCacheKey] || this.cache[repairCacheKey].time !== Game.time) {
            this.cache[repairCacheKey] = {
                time: Game.time,
                value: _.filter(structures, s => 
                    s.hits < s.hitsMax && s.hits < 10000
                ).length
            };
        }
        
        this.cache[room.name].repairTargets = this.cache[repairCacheKey].value;
        
        // Cache energy structures for haulers - cache this calculation
        const energyStructuresCacheKey = `energyStructures_${room.name}`;
        if (!this.cache[energyStructuresCacheKey] || this.cache[energyStructuresCacheKey].time !== Game.time) {
            this.cache[energyStructuresCacheKey] = {
                time: Game.time,
                value: _.filter(structures, s => 
                    (s.structureType === STRUCTURE_EXTENSION || 
                     s.structureType === STRUCTURE_SPAWN || 
                     s.structureType === STRUCTURE_TOWER)
                ).map(s => s.id)
            };
        }
        
        this.cache[room.name].energyStructures = this.cache[energyStructuresCacheKey].value;
        
        // Update timestamp
        room.memory.lastUpdate = Game.time;
    },
    
    /**
     * Count creeps by role for all rooms
     * @returns {Object} - Count of creeps by role per room
     */
    countCreepsByRole: function() {
        // Use cached result if we've already calculated this tick
        const cacheKey = 'creepCounts';
        if (this.cache[cacheKey] && this.cache[cacheKey].time === Game.time) {
            return this.cache[cacheKey].value;
        }
        
        const counts = {};
        
        // Initialize counts for each room
        for (const roomName in Game.rooms) {
            if (Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) {
                counts[roomName] = {
                    harvester: 0,
                    hauler: 0,
                    upgrader: 0,
                    builder: 0,
                    total: 0
                };
            }
        }
        
        // Count all creeps in one pass
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            const homeRoom = creep.memory.homeRoom;
            
            if (counts[homeRoom]) {
                const role = creep.memory.role;
                if (counts[homeRoom][role] !== undefined) {
                    counts[homeRoom][role]++;
                }
                counts[homeRoom].total++;
            }
        }
        
        // Cache the result for this tick
        this.cache[cacheKey] = {
            time: Game.time,
            value: counts
        };
        return counts;
    },
    
    /**
     * Calculate energy needs for the room
     * @param {Room} room - The room to analyze
     */
    calculateEnergyNeeds: function(room) {
        // Controller upgrading priority
        const controllerLevel = room.controller.level;
        const controllerProgress = room.controller.progress;
        const controllerNextLevel = room.controller.progressTotal;
        const controllerRatio = controllerNextLevel ? controllerProgress / controllerNextLevel : 0;
        
        // Construction priority
        const constructionSites = this.cache[room.name].constructionSites || 0;
        
        // Repair priority
        const repairTargets = this.cache[room.name].repairTargets || 0;
        
        // Calculate priorities
        this.cache[room.name].priorities = {
            upgrade: controllerLevel < 2 || controllerRatio > 0.8 ? 'high' : 'medium',
            build: constructionSites > 0 ? 'high' : 'low',
            repair: repairTargets > 0 ? 'medium' : 'low'
        };
    },
    
    /**
     * Get the best source for a harvester to mine
     * @param {Room} room - The room to check
     * @returns {Source|null} - The best source or null if none available
     */
    getBestSource: function(room) {
        // Safety check for room memory
        if (!room || !room.memory || !room.memory.sources) {
            return null;
        }
        
        // First, verify and clean up source assignments
        this.validateSourceAssignments(room);
        
        // Find source with the lowest harvester-to-capacity ratio
        let bestSourceId = null;
        let lowestRatio = Infinity;
        let highestEnergy = 0;
        let highestEnergyId = null;
        
        for (const sourceId in room.memory.sources) {
            const sourceMemory = room.memory.sources[sourceId];
            if (!sourceMemory || !sourceMemory.availableSpots) continue;
            
            // Skip sources that are already at capacity
            if (sourceMemory.assignedHarvesters >= sourceMemory.availableSpots) continue;
            
            // Skip sources near source keepers
            if (sourceMemory.nearKeeper === true) continue;
            
            // Get the actual source object to check energy
            const source = Game.getObjectById(sourceId);
            if (!source) {
                delete room.memory.sources[sourceId];
                continue;
            }
            
            // Track source with highest energy
            if (source.energy > highestEnergy) {
                highestEnergy = source.energy;
                highestEnergyId = sourceId;
            }
            
            // Calculate ratio of assigned harvesters to available spots
            const ratio = sourceMemory.assignedHarvesters / sourceMemory.availableSpots;
            
            // Choose source with lowest ratio (most available capacity)
            if (ratio < lowestRatio) {
                lowestRatio = ratio;
                bestSourceId = sourceId;
            }
        }
        
        // If all sources have same ratio but one has more energy, prefer that one
        if (lowestRatio === 0 && highestEnergyId) {
            bestSourceId = highestEnergyId;
        }
        
        // Assign harvester to the best source
        if (bestSourceId) {
            const source = Game.getObjectById(bestSourceId);
            if (source) {
                // Log assignment for debugging
                if (Game.time % 100 === 0 || !room.memory.sources[bestSourceId].lastAssignmentLog || 
                    Game.time - room.memory.sources[bestSourceId].lastAssignmentLog > 100) {
                    console.log(`Assigning harvester to source ${bestSourceId} in room ${room.name} ` +
                                `(${room.memory.sources[bestSourceId].assignedHarvesters + 1}/${room.memory.sources[bestSourceId].availableSpots} harvesters, ` +
                                `${source.energy}/${source.energyCapacity} energy)`);
                    room.memory.sources[bestSourceId].lastAssignmentLog = Game.time;
                }
                
                room.memory.sources[bestSourceId].assignedHarvesters++;
                return source;
            } else {
                // Source no longer exists, clean up memory
                delete room.memory.sources[bestSourceId];
            }
        }
        
        return null;
    },
    
    /**
     * Validate and clean up source assignments
     * @param {Room} room - The room to check
     */
    validateSourceAssignments: function(room) {
        // Only run this check occasionally to save CPU
        if (Game.time % 50 !== 0) return;
        
        // Count actual harvesters assigned to each source
        const actualAssignments = {};
        
        // Initialize counts for each source
        for (const sourceId in room.memory.sources) {
            actualAssignments[sourceId] = 0;
        }
        
        // Count harvesters by their assigned source
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory.role === 'harvester' && creep.memory.sourceId && 
                creep.memory.homeRoom === room.name) {
                if (actualAssignments[creep.memory.sourceId] !== undefined) {
                    actualAssignments[creep.memory.sourceId]++;
                }
            }
        }
        
        // Update source assignments in memory
        let correctionsMade = false;
        for (const sourceId in room.memory.sources) {
            const remembered = room.memory.sources[sourceId].assignedHarvesters || 0;
            const actual = actualAssignments[sourceId] || 0;
            
            if (remembered !== actual) {
                room.memory.sources[sourceId].assignedHarvesters = actual;
                correctionsMade = true;
            }
        }
        
        // Log if corrections were made
        if (correctionsMade) {
            console.log(`Corrected harvester assignments in room ${room.name}`);
        }
    },
    
    /**
     * Release a source assignment when a harvester dies or switches sources
     * @param {string} sourceId - ID of the source
     * @param {string} roomName - Name of the room
     * @param {boolean} logRelease - Whether to log the release (default: false)
     */
    releaseSource: function(sourceId, roomName, logRelease = false) {
        const room = Game.rooms[roomName];
        if (room && room.memory.sources && room.memory.sources[sourceId]) {
            const oldCount = room.memory.sources[sourceId].assignedHarvesters || 0;
            room.memory.sources[sourceId].assignedHarvesters = 
                Math.max(0, oldCount - 1);
                
            // Log release if requested or periodically
            if (logRelease || (Game.time % 100 === 0 && oldCount > 0)) {
                const source = Game.getObjectById(sourceId);
                const energyInfo = source ? `${source.energy}/${source.energyCapacity} energy` : 'unknown energy';
                console.log(`Released harvester from source ${sourceId} in room ${roomName} ` +
                            `(${room.memory.sources[sourceId].assignedHarvesters}/${room.memory.sources[sourceId].availableSpots} harvesters, ${energyInfo})`);
            }
        }
    },
    
    /**
     * Clean up stale energy requests
     * @param {Room} room - The room to clean up requests for
     */
    cleanupEnergyRequests: function(room) {
        if (!room.memory.energyRequests) return;
        
        // Only process a subset of requests each tick to distribute CPU load
        const currentTime = Game.time;
        const requestIds = Object.keys(room.memory.energyRequests);
        
        // Process at most 10 requests per call
        const startIdx = currentTime % Math.max(1, Math.ceil(requestIds.length / 10));
        const endIdx = Math.min(startIdx + 10, requestIds.length);
        const requestsToProcess = requestIds.slice(startIdx, endIdx);
        
        const requestsToDelete = [];
        
        for (const requestId of requestsToProcess) {
            const request = room.memory.energyRequests[requestId];
            
            // Check if the request is stale (older than 50 ticks)
            if (request.timestamp && currentTime - request.timestamp > 50) {
                requestsToDelete.push(requestId);
                continue;
            }
            
            // Check if the target creep still exists
            const targetCreep = Game.getObjectById(requestId);
            if (!targetCreep) {
                requestsToDelete.push(requestId);
                continue;
            }
            
            // Check if the target creep still needs energy
            if (targetCreep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                requestsToDelete.push(requestId);
                continue;
            }
            
            // Check if the assigned hauler still exists and is still assigned
            if (request.assignedHaulerId) {
                const hauler = Game.getObjectById(request.assignedHaulerId);
                if (!hauler || hauler.memory.assignedRequestId !== requestId) {
                    delete request.assignedHaulerId;
                }
            }
        }
        
        // Delete all identified stale requests
        for (const requestId of requestsToDelete) {
            delete room.memory.energyRequests[requestId];
        }
    },
    
    /**
     * Get cached room data
     * @param {string} roomName - Name of the room
     * @param {string} key - Data key to retrieve
     * @returns {*} - The requested data or undefined if not found
     */
    getRoomData: function(roomName, key) {
        if (this.cache[roomName] && this.cache[roomName][key] !== undefined) {
            return this.cache[roomName][key];
        }
        
        // Fallback to memory if not in cache
        if (Memory.rooms[roomName] && Memory.rooms[roomName][key] !== undefined) {
            return Memory.rooms[roomName][key];
        }
        
        return undefined;
    },
    
    /**
     * Clean up the cache to prevent memory bloat
     */
    cleanCache: function() {
        // Get current tick for reference
        const currentTick = Game.time;
        
        // Clean up time-based cache entries
        for (const key in this.cache) {
            // Skip room data caches
            if (Game.rooms[key]) continue;
            
            // Clean up time-value pairs older than current tick
            if (this.cache[key] && typeof this.cache[key] === 'object' && this.cache[key].time !== undefined) {
                if (this.cache[key].time !== currentTick) {
                    delete this.cache[key];
                }
            }
        }
    },
    
    /**
     * Analyze and cache energy sources in a room
     * @param {Room} room - The room to analyze
     * @returns {Object} - Categorized energy sources
     */
    analyzeEnergySources: function(room) {
        // Cache for 5 ticks since these change frequently
        const cacheKey = `energySources_${room.name}`;
        if (this.cache[cacheKey] && Game.time - this.cache[cacheKey].time < 5) {
            return this.cache[cacheKey].value;
        }

        const droppedResources = room.find(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50
        });
        
        const tombstones = room.find(FIND_TOMBSTONES, {
            filter: t => t.store[RESOURCE_ENERGY] > 0
        });
        
        // Find and categorize containers
        const containers = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && 
                      s.store[RESOURCE_ENERGY] > 0
        });
        
        const sourceContainers = containers.filter(c => 
            room.find(FIND_SOURCES, {
                filter: source => source.pos.inRangeTo(c, 2)
            }).length > 0
        );
        
        const otherContainers = containers.filter(c => !sourceContainers.includes(c));
        
        // Sort source containers by energy content
        sourceContainers.sort((a, b) => b.store[RESOURCE_ENERGY] - a.store[RESOURCE_ENERGY]);
        
        const result = {
            droppedResources,
            tombstones,
            sourceContainers,
            otherContainers,
            storage: room.storage && room.storage.store[RESOURCE_ENERGY] > 0 ? room.storage : null
        };
        
        this.cache[cacheKey] = {
            time: Game.time,
            value: result
        };
        
        return result;
    },
    
    /**
     * Analyze and cache energy delivery targets in a room
     * @param {Room} room - The room to analyze
     * @returns {Object} - Categorized energy targets
     */
    analyzeEnergyTargets: function(room) {
        // Cache for 3 ticks since spawn/extension energy changes frequently
        const cacheKey = `energyTargets_${room.name}`;
        if (this.cache[cacheKey] && Game.time - this.cache[cacheKey].time < 3) {
            return this.cache[cacheKey].value;
        }

        const spawnsAndExtensions = room.find(FIND_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_EXTENSION || 
                         s.structureType === STRUCTURE_SPAWN) && 
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });

        const towers = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER && 
                      s.store.getFreeCapacity(RESOURCE_ENERGY) > s.store.getCapacity(RESOURCE_ENERGY) * 0.2
        }).sort((a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY]);

        const controllerContainers = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && 
                      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                      s.pos.inRangeTo(room.controller, 3)
        }).sort((a, b) => b.store.getFreeCapacity(RESOURCE_ENERGY) - a.store.getFreeCapacity(RESOURCE_ENERGY));

        const result = {
            spawnsAndExtensions,
            towers,
            controllerContainers,
            storage: room.storage && room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0 ? room.storage : null
        };

        this.cache[cacheKey] = {
            time: Game.time,
            value: result
        };

        return result;
    },
    
    /**
     * Analyze room infrastructure to determine optimal creep counts
     * @param {Room} room - The room to analyze
     * @returns {Object} - Recommended creep counts
     */
    analyzeRoomNeeds: function(room) {
        if (!room || !room.controller) return null;
        
        const rcl = room.controller.level;
        const sourceCount = Object.keys(room.memory.sources || {}).length || 1;
        
        // Count important structures
        const containers = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        });
        
        // Separate source containers from controller containers
        const sourceContainers = containers.filter(c => 
            room.find(FIND_SOURCES, {
                filter: source => source.pos.inRangeTo(c, 2)
            }).length > 0
        ).length;
        
        const controllerContainers = containers.filter(c => 
            c.pos.inRangeTo(room.controller, 3)
        ).length;
        
        const storage = room.storage ? 1 : 0;
        
        // Calculate energy transport needs
        // Base energy production: 10 energy per source per tick
        const energyPerTick = sourceCount * 10;
        
        // Calculate transport distance factor
        // Longer distances between sources and destinations require more haulers
        let distanceFactor = 1.0;
        
        // If we have sources and spawns, calculate average distance
        const sources = room.find(FIND_SOURCES);
        const spawns = room.find(FIND_MY_SPAWNS);
        
        if (sources.length > 0 && spawns.length > 0) {
            let totalDistance = 0;
            let pathCount = 0;
            
            for (const source of sources) {
                for (const spawn of spawns) {
                    // Use simple Manhattan distance as approximation
                    const distance = Math.abs(source.pos.x - spawn.pos.x) + 
                                    Math.abs(source.pos.y - spawn.pos.y);
                    totalDistance += distance;
                    pathCount++;
                }
            }
            
            // Average distance affects hauler needs
            if (pathCount > 0) {
                const avgDistance = totalDistance / pathCount;
                // Longer distances need more haulers
                distanceFactor = Math.max(1.0, avgDistance / 15); // Normalize to 1.0 at distance 15
            }
        }
        
        // Calculate requirements in priority order: Harvester -> Hauler -> Builder -> Upgrader
        
        // 1. Harvesters: Calculate based on energy capacity and harvesting efficiency
        const harvesterCount = this.calculateOptimalHarvesters(room, sourceCount);
        
        // 2. Haulers: Based on energy production and infrastructure needs
        const haulerBase = Math.ceil(energyPerTick / 50);
        const haulerDistance = Math.ceil(haulerBase * distanceFactor);
        const haulerInfra = sourceCount + storage + Math.min(1, controllerContainers);
        const rclFactor = rcl <= 2 ? 1.0 : (rcl <= 4 ? 1.2 : 1.5);
        const haulerCount = Math.ceil(Math.max(haulerDistance, haulerInfra) * rclFactor);
        
        // 3. Builders: Based on construction and repair needs
        const constructionSites = room.find(FIND_CONSTRUCTION_SITES).length;
        const builderCount = constructionSites > 0 ? 3 : 1; // 1 repairer + 2 builders when construction exists
        
        // 4. Upgraders: Minimal count, only 1 needed
        const upgraderCount = 1;
        
        // Calculate total based on actual needs
        const calculatedTotal = harvesterCount + haulerCount + builderCount + upgraderCount;
        
        const result = {
            harvester: harvesterCount,
            hauler: haulerCount,
            upgrader: upgraderCount,
            builder: builderCount,
            total: calculatedTotal
        };
        
        // Apply manual limits if set
        if (room.memory.creepLimits) {
            if (room.memory.creepLimits.harvester !== undefined) {
                result.harvester = room.memory.creepLimits.harvester;
            }
            if (room.memory.creepLimits.hauler !== undefined) {
                result.hauler = room.memory.creepLimits.hauler;
            }
            if (room.memory.creepLimits.upgrader !== undefined) {
                result.upgrader = room.memory.creepLimits.upgrader;
            }
            if (room.memory.creepLimits.builder !== undefined) {
                result.builder = room.memory.creepLimits.builder;
            }
        }
        
        // Apply manual limits if set
        if (room.memory.creepLimits) {
            if (room.memory.creepLimits.harvester !== undefined) {
                result.harvester = room.memory.creepLimits.harvester;
            }
            if (room.memory.creepLimits.hauler !== undefined) {
                result.hauler = room.memory.creepLimits.hauler;
            }
            if (room.memory.creepLimits.upgrader !== undefined) {
                result.upgrader = room.memory.creepLimits.upgrader;
            }
            if (room.memory.creepLimits.builder !== undefined) {
                result.builder = room.memory.creepLimits.builder;
            }
            if (room.memory.creepLimits.total !== undefined) {
                result.total = room.memory.creepLimits.total;
            } else {
                // Recalculate total if individual limits were changed
                result.total = result.harvester + result.hauler + result.upgrader + result.builder;
            }
        }
        
        // Cache the result
        this.cache[`roomNeeds_${room.name}`] = {
            time: Game.time,
            value: result
        };
        
        return result;
    },
    
    /**
     * Calculate optimal harvester count based on current and potential energy capacity
     * @param {Room} room - The room to analyze
     * @param {number} sourceCount - Number of sources in the room
     * @returns {number} - Optimal harvester count
     */
    calculateOptimalHarvesters: function(room, sourceCount) {
        // Get current harvesters and their actual work parts
        const currentHarvesters = _.filter(Game.creeps, c => 
            c.memory.role === 'harvester' && c.memory.homeRoom === room.name);
        
        let currentWorkParts = 0;
        for (const harvester of currentHarvesters) {
            currentWorkParts += harvester.body.filter(part => part.type === WORK).length;
        }
        
        // Calculate current harvest rate (2 energy per WORK part per tick)
        const currentHarvestRate = currentWorkParts * 2;
        
        // Source regenerates 10 energy per tick per source
        const totalSourceRegen = sourceCount * 10;
        
        // If current harvesters can't keep up with regen, we need more
        if (currentHarvestRate < totalSourceRegen) {
            // Calculate optimal work parts needed
            const workPartsNeeded = Math.ceil(totalSourceRegen / 2);
            
            // Calculate what new harvesters would have (based on current energy capacity)
            const energyCapacity = room.energyCapacityAvailable;
            const harvesterSets = Math.floor(energyCapacity / 250);
            const newHarvesterWorkParts = Math.min(harvesterSets * 2, 32);
            
            // Calculate how many more harvesters we need
            const workPartsDeficit = workPartsNeeded - currentWorkParts;
            const additionalHarvesters = Math.ceil(workPartsDeficit / newHarvesterWorkParts);
            
            return Math.min(currentHarvesters.length + additionalHarvesters, 6);
        }
        
        // If we have enough harvest capacity, maintain current count but allow natural reduction
        return Math.max(sourceCount, currentHarvesters.length);
    },
    
    /**
     * Analyze and cache repair targets in a room
     * @param {Room} room - The room to analyze
     * @returns {Array} - Prioritized repair targets
     */
    analyzeRepairTargets: function(room) {
        const cacheKey = `repairTargets_${room.name}`;
        if (this.cache[cacheKey] && Game.time - this.cache[cacheKey].time < 10) {
            return this.cache[cacheKey].value;
        }

        const repairTargets = room.find(FIND_STRUCTURES, {
            filter: s => s.hits < s.hitsMax * 0.8 && 
                      (s.structureType === STRUCTURE_CONTAINER || 
                       s.structureType === STRUCTURE_SPAWN ||
                       s.structureType === STRUCTURE_EXTENSION ||
                       s.structureType === STRUCTURE_TOWER ||
                       s.structureType === STRUCTURE_ROAD)
        });

        // Sort by priority: critical structures first, then by damage percentage
        repairTargets.sort((a, b) => {
            const priorityOrder = {
                [STRUCTURE_SPAWN]: 1,
                [STRUCTURE_EXTENSION]: 2,
                [STRUCTURE_TOWER]: 3,
                [STRUCTURE_CONTAINER]: 4,
                [STRUCTURE_ROAD]: 5
            };
            
            const aPriority = priorityOrder[a.structureType] || 6;
            const bPriority = priorityOrder[b.structureType] || 6;
            
            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }
            
            // Same priority, sort by damage percentage (most damaged first)
            return (a.hits / a.hitsMax) - (b.hits / b.hitsMax);
        });

        const result = repairTargets.map(s => s.id);
        
        this.cache[cacheKey] = {
            time: Game.time,
            value: result
        };
        
        // Store in room memory for builders
        room.memory.repairTargets = result;
        room.memory.repairTargetsTime = Game.time;
        
        return result;
    }
};

module.exports = roomManager;