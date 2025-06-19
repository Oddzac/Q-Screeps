/**
 * Utility functions for CPU optimization
 */
const utils = {
    /**
     * Cache for expensive operations
     */
    cache: {},
    
    /**
     * Run a function with caching based on a key
     * @param {string} key - Cache key
     * @param {function} fn - Function to run
     * @param {number} ttl - Time to live in ticks
     * @returns {*} - Result of the function
     */
    memoize: function(key, fn, ttl = 10) {
        // Check if we have a cached result that's still valid
        if (this.cache[key] && Game.time - this.cache[key].time < ttl) {
            return this.cache[key].result;
        }
        
        // Run the function and cache the result
        const result = fn();
        this.cache[key] = {
            time: Game.time,
            result: result
        };
        
        return result;
    },
    
    /**
     * Clear the cache
     * @param {boolean} preservePositions - Whether to preserve cached positions
     */
    clearCache: function(preservePositions = true) {
        const positions = preservePositions ? this.cache.positions : undefined;
        this.cache = {};
        if (preservePositions && positions) {
            this.cache.positions = positions;
        }
        
        // Clean up any cache keys that were accidentally stored in Memory
        this.cleanupMemoryCache();
    },
    
    /**
     * Clean up cache keys that were accidentally stored in Memory
     */
    cleanupMemoryCache: function() {
        // List of prefixes for cache keys that should not be in Memory
        const cacheKeyPrefixes = [
            'shouldExecute_', 
            'keepers_',
            'find_',
            '_processed_',
            'updateFreq_',
            'creepCounts_',
            'sitesByType_',
            'repairTargets_',
            'energyStructures_'
        ];
        
        // Check Memory for cache keys and remove them
        for (const key in Memory) {
            if (cacheKeyPrefixes.some(prefix => key.startsWith(prefix)) || 
                key.includes('_' + Game.time) || 
                /\d{4,}$/.test(key)) { // Keys ending with 4+ digits (likely tick numbers)
                delete Memory[key];
            }
        }
    },
    
    /**
     * Find closest object by range (CPU efficient)
     * @param {RoomPosition} pos - Position to measure distance from
     * @param {Array} objects - Array of objects to check
     * @returns {Object} - The closest object
     */
    findClosestByRange: function(pos, objects) {
        if (!objects.length) return null;
        
        let closest = objects[0];
        let minDistance = pos.getRangeTo(closest);
        
        for (let i = 1; i < objects.length; i++) {
            const distance = pos.getRangeTo(objects[i]);
            if (distance < minDistance) {
                closest = objects[i];
                minDistance = distance;
            }
        }
        
        return closest;
    },
    
    /**
     * Throttle a function to run only every N ticks
     * @param {function} fn - Function to throttle
     * @param {number} ticks - Number of ticks between runs
     * @param {*} context - Context to bind the function to
     * @returns {function} - Throttled function
     */
    throttle: function(fn, ticks, context) {
        let lastRun = 0;
        
        return function(...args) {
            if (Game.time - lastRun >= ticks) {
                lastRun = Game.time;
                return fn.apply(context || this, args);
            }
        };
    },
    
    /**
     * Run a function only if CPU bucket is above threshold
     * @param {function} fn - Function to run
     * @param {number} threshold - CPU bucket threshold
     * @param {*} context - Context to bind the function to
     * @returns {function} - CPU-aware function
     */
    cpuAware: function(fn, threshold, context) {
        return function(...args) {
            if (Game.cpu.bucket >= threshold) {
                return fn.apply(context || this, args);
            }
        };
    },
    
    /**
     * Cache room positions to avoid creating new objects
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {string} roomName - Room name
     * @returns {RoomPosition} - Cached room position
     */
    getCachedPosition: function(x, y, roomName) {
        const key = `${x},${y},${roomName}`;
        
        if (!this.cache.positions) {
            this.cache.positions = {};
        }
        
        if (!this.cache.positions[key]) {
            this.cache.positions[key] = new RoomPosition(x, y, roomName);
        }
        
        return this.cache.positions[key];
    },
    
    /**
     * Measure CPU usage of a function
     * @param {function} fn - Function to measure
     * @param {*} context - Context to bind the function to
     * @param {Array} args - Arguments to pass to the function
     * @returns {Object} - Result and CPU usage
     */
    measureCPU: function(fn, context, ...args) {
        const start = Game.cpu.getUsed();
        const result = fn.apply(context || this, args);
        const end = Game.cpu.getUsed();
        
        return {
            result: result,
            cpu: end - start
        };
    },
    
    /**
     * Log CPU usage statistics
     * @param {Object} stats - CPU statistics object
     */
    logCPUStats: function(stats) {
        console.log(`CPU Usage:
            Total: ${stats.total.toFixed(2)}
            Room Management: ${stats.roomManagement.toFixed(2)}
            Creep Actions: ${stats.creepActions.toFixed(2)}
            Defense: ${stats.defense ? stats.defense.toFixed(2) : '0.00'}
            Spawning: ${stats.spawning.toFixed(2)}
            Construction: ${stats.construction.toFixed(2)}
            Memory Cleanup: ${stats.memoryCleanup.toFixed(2)}
            Emergency Mode: ${stats.emergencyMode || 'off'}
            Bucket: ${stats.bucket}`);
    },
    
    /**
     * Check if an operation should be executed based on current CPU conditions
     * @param {string} priority - Priority level ('critical', 'high', 'medium', 'low')
     * @returns {boolean} - Whether the operation should proceed
     */
    shouldExecute: function(priority) {
        // Use cached result if available (valid for current tick)
        const cacheKey = `shouldExecute_${priority}_${Game.time}`;
        if (this.cache[cacheKey] !== undefined) {
            return this.cache[cacheKey];
        }
        
        // Always execute critical operations
        if (priority === 'critical') {
            this.cache[cacheKey] = true;
            return true;
        }
        
        // Cache simulation check (valid for entire tick)
        if (this.cache.isSimulation === undefined) {
            this.cache.isSimulation = Object.keys(Game.rooms).some(name => name.startsWith('sim'));
            this.cache.isSimulationTime = Game.time;
        }
        
        // Always allow all operations in simulation rooms
        if (this.cache.isSimulation) {
            this.cache[cacheKey] = true;
            return true;
        }
        
        // Get recovery manager if available
        const recoveryManager = require('recoveryManager');
        
        // In emergency mode, only run critical operations
        if (global.emergencyMode) {
            let result;
            
            // Check if we're in recovery mode (after pixel generation)
            const isRecovery = global.emergencyMode.isRecovery === true;
            
            // Get recovery factor if available
            const recoveryFactor = global.emergencyMode.recoveryFactor || 0.5;
            
            // Check if CPU usage is very low
            const veryLowCpuUsage = global.cpuHistory && 
                                  global.cpuHistory.length > 0 && 
                                  global.cpuHistory.reduce((sum, val) => sum + val, 0) / global.cpuHistory.length < 0.3;
            
            if (global.emergencyMode.level === 'critical') {
                // In critical mode, use adaptive thresholds based on recovery factor
                if (priority === 'critical') {
                    result = true; // Always run critical tasks
                } else if (priority === 'high') {
                    // For high priority, check recovery factor and bucket
                    const minBucket = isRecovery ? Math.max(100, 500 * recoveryFactor) : 500;
                    result = (isRecovery && recoveryFactor > 0.3 && Game.cpu.bucket > minBucket) || 
                            (veryLowCpuUsage && Game.cpu.bucket > 300);
                } else {
                    // For medium/low priority, be very strict
                    const minBucket = isRecovery ? Math.max(300, 1000 * recoveryFactor) : 1000;
                    result = (isRecovery && recoveryFactor > 0.7 && Game.cpu.bucket > minBucket) || 
                            (veryLowCpuUsage && Game.cpu.bucket > 500);
                }
            } else {
                // In high emergency mode, be more lenient
                if (['critical', 'high'].includes(priority)) {
                    result = true; // Always run critical and high tasks
                } else if (priority === 'medium') {
                    // For medium priority, check recovery factor and bucket
                    const minBucket = isRecovery ? Math.max(200, 800 * recoveryFactor) : 800;
                    result = (isRecovery && recoveryFactor > 0.4 && Game.cpu.bucket > minBucket) || 
                            (veryLowCpuUsage && Game.cpu.bucket > 400);
                } else {
                    // For low priority, be more strict
                    const minBucket = isRecovery ? Math.max(500, 1500 * recoveryFactor) : 1500;
                    result = (isRecovery && recoveryFactor > 0.6 && Game.cpu.bucket > minBucket) || 
                            (veryLowCpuUsage && Game.cpu.bucket > 800);
                }
            }
            
            this.cache[cacheKey] = result;
            return result;
        }
        
        // Normal mode - CPU bucket based throttling
        const bucket = Game.cpu.bucket;
        let result;
        
        // Check if we're in recovery mode (but not in emergency mode)
        const inRecoveryPeriod = recoveryManager && recoveryManager.isRecovering;
        const recoveryFactor = recoveryManager ? recoveryManager.getRecoveryFactor() : 1.0;
        
        // Check if CPU usage is very low
        const veryLowCpuUsage = global.cpuHistory && 
                              global.cpuHistory.length > 0 && 
                              global.cpuHistory.reduce((sum, val) => sum + val, 0) / global.cpuHistory.length < 0.3;
        
        if (inRecoveryPeriod) {
            // Use adaptive thresholds based on recovery factor
            if (priority === 'critical') {
                result = true; // Always run critical tasks
            } else if (priority === 'high') {
                result = recoveryFactor > 0.3 || bucket > Math.max(300, 800 * recoveryFactor);
            } else if (priority === 'medium') {
                result = recoveryFactor > 0.5 || bucket > Math.max(500, 1500 * recoveryFactor);
            } else {
                result = recoveryFactor > 0.7 || bucket > Math.max(800, 3000 * recoveryFactor);
            }
        } else if (veryLowCpuUsage) {
            // Even more lenient when CPU usage is very low
            if (bucket < 200) result = priority === 'critical';
            else if (bucket < 400) result = ['critical', 'high'].includes(priority);
            else result = true; // Run everything when CPU usage is very low and bucket is above 400
        } else {
            // Standard thresholds - also made more lenient
            if (bucket < 800) result = priority === 'critical';
            else if (bucket < 2000) result = ['critical', 'high'].includes(priority);
            else if (bucket < 5000) result = !['low'].includes(priority);
            else result = true; // Full bucket, run everything
        }
        
        this.cache[cacheKey] = result;
        return result;
    },

    /**
     * Safe object access to prevent errors from undefined properties
     * @param {Object} obj - The object to access
     * @param {string} path - The property path (e.g., 'a.b.c')
     * @param {*} defaultValue - Default value if path doesn't exist
     * @returns {*} - The value at the path or the default value
     */
    getNestedProperty: function(obj, path, defaultValue = undefined) {
        if (!obj || !path) return defaultValue;
        
        const properties = path.split('.');
        let value = obj;
        
        for (const prop of properties) {
            if (value === null || value === undefined || typeof value !== 'object') {
                return defaultValue;
            }
            value = value[prop];
        }
        
        return value !== undefined ? value : defaultValue;
    },
    
    /**
     * Safely execute a function with error handling
     * @param {function} fn - Function to execute
     * @param {Object} context - Context to bind the function to
     * @param {Array} args - Arguments to pass to the function
     * @param {*} defaultValue - Default value to return on error
     * @returns {*} - Result of the function or default value on error
     */
    safeExec: function(fn, context, args = [], defaultValue = null) {
        try {
            return fn.apply(context, args);
        } catch (error) {
            console.log(`Error in safeExec: ${error}`);
            console.log(`Stack trace: ${error.stack}`);
            return defaultValue;
        }
    },
    
    /**
     * Wrap a module's methods with error handling
     * @param {Object} module - The module to wrap
     * @param {string} moduleName - Name of the module for error reporting
     * @returns {Object} - Wrapped module
     */
    wrapModule: function(module, moduleName) {
        const wrapped = {};
        
        for (const key in module) {
            if (typeof module[key] === 'function') {
                wrapped[key] = function(...args) {
                    try {
                        return module[key].apply(module, args);
                    } catch (error) {
                        // Get detailed error information
                        const errorInfo = {
                            message: error.message || String(error),
                            stack: error.stack,
                            method: key,
                            module: moduleName,
                            args: args.map(arg => {
                                if (arg && typeof arg === 'object') {
                                    return arg.name || arg.id || JSON.stringify(arg).substring(0, 50);
                                }
                                return String(arg);
                            })
                        };
                        
                        // Log detailed error
                        console.log(`ERROR in ${moduleName}.${key}: ${errorInfo.message}`);
                        console.log(`Stack: ${errorInfo.stack}`);
                        console.log(`Args: ${errorInfo.args.join(', ')}`);
                        
                        // Store error for debugging
                        if (!global.errors) global.errors = [];
                        global.errors.push({
                            time: Game.time,
                            ...errorInfo
                        });
                        
                        // Keep only the last 10 errors
                        if (global.errors.length > 10) global.errors.shift();
                        
                        throw error; // Re-throw to maintain original behavior
                    }
                };
            } else {
                wrapped[key] = module[key];
            }
        }
        
        return wrapped;
    },
    
    /**
     * Track errors to prevent log spam
     * @param {string} key - Error identifier
     * @param {string} message - Error message
     * @param {number} interval - How often to log this error (in ticks)
     */
    logError: function(key, message, interval = 100) {
        if (!global.errorLog) global.errorLog = {};
        
        const now = Game.time;
        const lastLogged = global.errorLog[key] || 0;
        
        if (now - lastLogged >= interval) {
            console.log(`ERROR [${key}]: ${message}`);
            global.errorLog[key] = now;
        }
    },
    
    /**
     * Check if a position is safe from source keepers
     * @param {RoomPosition} pos - Position to check
     * @param {number} safeDistance - Safe distance from keepers (default: 5)
     * @returns {boolean} - True if position is safe
     */
    isSafeFromKeepers: function(pos, safeDistance = 5) {
        if (!pos || !pos.roomName) return false;
        
        const room = Game.rooms[pos.roomName];
        if (!room) return true; // Assume safe if room not visible
        
        // Cache keeper positions for each room (valid for 20 ticks)
        const cacheKey = `keepers_${room.name}`;
        if (!this.cache[cacheKey] || Game.time - this.cache[cacheKey].time > 20) {
            const keepers = room.find(FIND_HOSTILE_CREEPS, {
                filter: creep => creep.owner.username === 'Source Keeper'
            });
            
            this.cache[cacheKey] = {
                time: Game.time,
                keepers: keepers.map(k => ({ id: k.id, x: k.pos.x, y: k.pos.y }))
            };
        }
        
        const cachedKeepers = this.cache[cacheKey].keepers;
        if (cachedKeepers.length === 0) return true;
        
        // Check distance to each keeper
        for (const keeper of cachedKeepers) {
            const distance = Math.abs(keeper.x - pos.x) + Math.abs(keeper.y - pos.y);
            if (distance <= safeDistance) {
                return false;
            }
        }
        
        return true;
    },
    
    /**
     * Get cached find results to avoid expensive room.find operations
     * @param {Room} room - The room to search in
     * @param {number} findConstant - The FIND_* constant
     * @param {Object} options - Options for the find operation
     * @param {number} ttl - Time to live for the cache in ticks
     * @returns {Array} - The find results
     */
    cachedFind: function(room, findConstant, options = {}, ttl = 10) {
        const cacheKey = `find_${room.name}_${findConstant}_${JSON.stringify(options)}`;
        
        if (this.cache[cacheKey] && Game.time - this.cache[cacheKey].time < ttl) {
            return this.cache[cacheKey].results;
        }
        
        const results = room.find(findConstant, options);
        this.cache[cacheKey] = {
            time: Game.time,
            results: results
        };
        
        return results;
    },
    
    /**
     * Find the best source based on available harvesting positions
     * @param {Room} room - The room to analyze
     * @param {Array} sources - Array of sources to evaluate
     * @returns {Object|null} - Best source or null
     */
    findBestSourceByAvailability: function(room, sources) {
        if (!sources || sources.length === 0) return null;
        if (sources.length === 1) return sources[0];
        
        let bestSource = null;
        let bestScore = -1;
        
        for (const source of sources) {
            const availableSpaces = this.countAvailableHarvestingSpaces(room, source);
            const currentHarvesters = source.pos.findInRange(FIND_MY_CREEPS, 1, {
                filter: c => c.memory.role === 'harvester' || 
                           (c.memory.energySourceType === 'source' && c.memory.energySourceId === source.id)
            }).length;
            
            // Score = available spaces - current harvesters (higher is better)
            const score = availableSpaces - currentHarvesters;
            
            if (score > bestScore) {
                bestScore = score;
                bestSource = source;
            }
        }
        
        return bestSource;
    },
    
    /**
     * Count available harvesting spaces around a source
     * @param {Room} room - The room
     * @param {Source} source - The source to check
     * @returns {number} - Number of available harvesting spaces
     */
    countAvailableHarvestingSpaces: function(room, source) {
        const terrain = room.getTerrain();
        let count = 0;
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                
                const x = source.pos.x + dx;
                const y = source.pos.y + dy;
                
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                
                const terrainType = terrain.get(x, y);
                
                // Count plains and roads as available
                if (terrainType !== TERRAIN_MASK_WALL) {
                    // Check if there's a road structure
                    const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
                    const hasRoad = structures.some(s => s.structureType === STRUCTURE_ROAD);
                    
                    // Plains or road tiles are harvestable
                    if (terrainType === 0 || hasRoad) { // 0 = plains
                        count++;
                    }
                }
            }
        }
        
        return count;
    }
};

module.exports = utils;