/**
 * Remote Manager - Handles operations in remote rooms
 * Optimized for CPU efficiency and resiliency
 */
const utils = require('utils');

const remoteManager = {
    /**
     * Initialize remote operations memory
     */
    initMemory: function() {
        if (!Memory.remoteOps) {
            Memory.remoteOps = {
                rooms: {},
                scouts: {},
                lastUpdate: Game.time,
                activeRemotes: {}
            };
        }
    },
    
    /**
     * Run remote operations manager
     * Only runs when CPU conditions allow
     */
    run: function() {
        // Skip in emergency mode
        if (global.emergencyMode && global.emergencyMode.level === 'critical') return;
        
        // Only run every 10 ticks to save CPU
        if (Game.time % 10 !== 0) return;
        
        // Skip if CPU is low
        if (!utils.shouldExecute('low')) return;
        
        // Initialize memory
        this.initMemory();
        
        // Process each owned room
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;
            
            // Skip rooms below RCL 3
            if (room.controller.level < 3) continue;
            
            // Check for adjacent rooms to scout
            this.identifyRoomsToScout(room);
            
            // Manage remote operations for this room
            this.manageRemoteOperations(room);
        }
        
        // Update remote room data
        this.updateRemoteRooms();
        
        // Spawn remote creeps as needed
        this.spawnRemoteCreeps();
    },
    
    /**
     * Identify rooms to scout from a base room
     * @param {Room} room - The base room
     */
    identifyRoomsToScout: function(room) {
        // Get exits from the room
        const exits = Game.map.describeExits(room.name);
        
        // Check each exit
        for (const direction in exits) {
            const exitRoom = exits[direction];
            
            // Skip if we already own this room
            if (Game.rooms[exitRoom] && 
                Game.rooms[exitRoom].controller && 
                Game.rooms[exitRoom].controller.my) {
                continue;
            }
            
            // Add to scout list if not already tracked
            if (!Memory.remoteOps.rooms[exitRoom]) {
                Memory.remoteOps.rooms[exitRoom] = {
                    baseRoom: room.name,
                    lastScout: 0,
                    sources: 0,
                    hostiles: false,
                    reservation: null
                };
            }
        }
    },
    
    /**
     * Update data for remote rooms
     */
    updateRemoteRooms: function() {
        // Process visible remote rooms
        for (const roomName in Memory.remoteOps.rooms) {
            // If room is visible, update data
            if (Game.rooms[roomName]) {
                const room = Game.rooms[roomName];
                const roomData = Memory.remoteOps.rooms[roomName];
                
                // Update last scout time
                roomData.lastScout = Game.time;
                
                // Count sources
                const sources = room.find(FIND_SOURCES);
                roomData.sources = sources.length;
                
                // Check for hostiles
                const hostiles = room.find(FIND_HOSTILE_CREEPS);
                roomData.hostiles = hostiles.length > 0;
                
                // Check controller reservation
                if (room.controller) {
                    if (room.controller.reservation) {
                        roomData.reservation = {
                            username: room.controller.reservation.username,
                            ticksToEnd: room.controller.reservation.ticksToEnd
                        };
                    } else {
                        roomData.reservation = null;
                    }
                }
                
                // Store source positions for future miners
                if (!roomData.sourcePositions && sources.length > 0) {
                    roomData.sourcePositions = sources.map(source => ({
                        id: source.id,
                        x: source.pos.x,
                        y: source.pos.y
                    }));
                }
            }
        }
        
        // Clean up old rooms that haven't been scouted in a long time
        const MAX_SCOUT_AGE = 20000; // About 16.6 hours
        for (const roomName in Memory.remoteOps.rooms) {
            const roomData = Memory.remoteOps.rooms[roomName];
            
            // Skip rooms that are actively being used
            if (roomData.mining || roomData.reserved) continue;
            
            // Remove very old scout data
            if (Game.time - roomData.lastScout > MAX_SCOUT_AGE) {
                delete Memory.remoteOps.rooms[roomName];
            }
        }
    },
    
    /**
     * Manage remote operations for a base room
     * @param {Room} room - The base room
     */
    manageRemoteOperations: function(room) {
        // Skip if room is not ready for remote operations
        if (room.controller.level < 3) return;
        
        // Initialize active remotes for this room
        if (!Memory.remoteOps.activeRemotes[room.name]) {
            Memory.remoteOps.activeRemotes[room.name] = [];
        }
        
        // Check if we need to find new remote rooms
        const MAX_REMOTE_ROOMS = Math.min(2, room.controller.level - 2); // 1 at RCL3, 2 at RCL4+
        
        if (Memory.remoteOps.activeRemotes[room.name].length < MAX_REMOTE_ROOMS) {
            // Find best remote room that's not already active
            const bestRoom = this.findBestRemoteRoom(room.name);
            
            if (bestRoom) {
                Memory.remoteOps.activeRemotes[room.name].push(bestRoom);
                Memory.remoteOps.rooms[bestRoom].mining = true;
                console.log(`Room ${room.name} started remote mining in ${bestRoom}`);
            }
        }
        
        // Check existing remote rooms
        for (let i = 0; i < Memory.remoteOps.activeRemotes[room.name].length; i++) {
            const remoteName = Memory.remoteOps.activeRemotes[room.name][i];
            const remoteData = Memory.remoteOps.rooms[remoteName];
            
            // Skip if no data
            if (!remoteData) {
                Memory.remoteOps.activeRemotes[room.name].splice(i, 1);
                i--;
                continue;
            }
            
            // Check if room has hostiles
            if (remoteData.hostiles) {
                // If hostiles were detected recently, abandon the room temporarily
                if (remoteData.lastHostile && Game.time - remoteData.lastHostile < 1000) {
                    console.log(`Room ${room.name} temporarily abandoning remote ${remoteName} due to hostiles`);
                    Memory.remoteOps.activeRemotes[room.name].splice(i, 1);
                    remoteData.mining = false;
                    i--;
                    continue;
                }
            }
            
            // Check if reservation is needed
            if (remoteData.reservation) {
                // If reserved by someone else, abandon the room
                if (remoteData.reservation.username !== Memory.username) {
                    console.log(`Room ${room.name} abandoning remote ${remoteName} - reserved by ${remoteData.reservation.username}`);
                    Memory.remoteOps.activeRemotes[room.name].splice(i, 1);
                    remoteData.mining = false;
                    i--;
                    continue;
                }
            }
        }
    },
    
    /**
     * Find the best remote room for a base room
     * @param {string} baseRoomName - The base room name
     * @returns {string|null} - Best remote room name or null
     */
    findBestRemoteRoom: function(baseRoomName) {
        let bestRoom = null;
        let bestScore = -Infinity;
        
        for (const roomName in Memory.remoteOps.rooms) {
            const roomData = Memory.remoteOps.rooms[roomName];
            
            // Skip if not connected to this base room
            if (roomData.baseRoom !== baseRoomName) continue;
            
            // Skip if already being mined
            if (roomData.mining) continue;
            
            // Skip if has hostiles
            if (roomData.hostiles) continue;
            
            // Skip if reserved by someone else
            if (roomData.reservation && 
                roomData.reservation.username !== Memory.username) continue;
            
            // Skip if not scouted recently
            if (Game.time - roomData.lastScout > 5000) continue;
            
            // Calculate score
            let score = 0;
            
            // Sources are most important
            score += (roomData.sources || 0) * 50;
            
            // Subtract for distance (if we have route info)
            const route = Game.map.findRoute(baseRoomName, roomName);
            if (route !== ERR_NO_PATH) {
                score -= route.length * 10;
            } else {
                score -= 100; // Heavy penalty if no path
            }
            
            // Bonus for controller (can be reserved)
            if (roomData.controller) {
                score += 10;
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestRoom = roomName;
            }
        }
        
        return bestRoom;
    },
    
    /**
     * Get the best remote room for harvesting
     * @param {string} baseRoomName - Name of the base room
     * @returns {string|null} - Name of the best remote room or null
     */
    /**
     * Get detailed status of remote operations
     * @param {string} roomName - The base room name
     * @returns {string} - Status information
     */
    getDetailedStatus: function(roomName) {
        if (!Memory.remoteOps || !Memory.remoteOps.activeRemotes || !Memory.remoteOps.activeRemotes[roomName]) {
            return `No remote operations for room ${roomName}`;
        }
        
        const activeRemotes = Memory.remoteOps.activeRemotes[roomName];
        let output = `Remote Operations Status for ${roomName}:\n`;
        
        // Count remote creeps
        const scouts = _.filter(Game.creeps, c => c.memory.role === 'scout' && c.memory.homeRoom === roomName).length;
        output += `Scouts: ${scouts}\n\n`;
        
        // Show info for each remote room
        for (const remoteName of activeRemotes) {
            const remoteData = Memory.remoteOps.rooms[remoteName] || {};
            output += `== ${remoteName} ==\n`;
            output += `Sources: ${remoteData.sources || 0}\n`;
            
            // Show reservation status
            if (remoteData.reservation) {
                output += `Reserved by: ${remoteData.reservation.username} (${remoteData.reservation.ticksToEnd} ticks)\n`;
            } else if (remoteData.controller) {
                output += `Controller: Not reserved\n`;
            } else {
                output += `Controller: None\n`;
            }
            
            // Show hostiles
            output += `Hostiles: ${remoteData.hostiles ? 'YES' : 'No'}\n`;
            
            // Show creeps assigned to this room
            const reservers = _.filter(Game.creeps, c => c.memory.role === 'reserver' && c.memory.targetRoom === remoteName).length;
            const miners = _.filter(Game.creeps, c => c.memory.role === 'remoteMiner' && c.memory.targetRoom === remoteName).length;
            const haulers = _.filter(Game.creeps, c => c.memory.role === 'remoteHauler' && c.memory.targetRoom === remoteName).length;
            
            output += `Creeps: ${reservers} reservers, ${miners} miners, ${haulers} haulers\n\n`;
        }
        
        return output;
    },
    
    getBestRemoteRoom: function(baseRoomName) {
        // Skip if not initialized
        if (!Memory.remoteOps || !Memory.remoteOps.rooms) return null;
        
        let bestRoom = null;
        let bestScore = -1;
        
        for (const roomName in Memory.remoteOps.rooms) {
            const roomData = Memory.remoteOps.rooms[roomName];
            
            // Skip if not connected to this base room
            if (roomData.baseRoom !== baseRoomName) continue;
            
            // Skip if has hostiles
            if (roomData.hostiles) continue;
            
            // Skip if reserved by someone else
            if (roomData.reservation && roomData.reservation.username !== Memory.username) continue;
            
            // Calculate score based on sources and distance
            const sources = roomData.sources || 0;
            if (sources === 0) continue;
            
            // Simple scoring for now - can be expanded
            const score = sources * 10;
            
            if (score > bestScore) {
                bestScore = score;
                bestRoom = roomName;
            }
        }
        
        return bestRoom;
    },
    
    /**
     * Spawn remote creeps as needed
     */
    spawnRemoteCreeps: function() {
        // Skip if CPU is low
        if (!utils.shouldExecute('medium')) return;
        
        // Process each base room
        for (const baseRoomName in Memory.remoteOps.activeRemotes) {
            const baseRoom = Game.rooms[baseRoomName];
            if (!baseRoom) continue;
            
            // Skip if room is not ready
            if (baseRoom.controller.level < 3) continue;
            
            // Skip if no spawns available
            const spawns = baseRoom.find(FIND_MY_SPAWNS, {
                filter: s => !s.spawning
            });
            if (spawns.length === 0) continue;
            
            // Check if we need to spawn a scout
            this.spawnScoutIfNeeded(baseRoom, spawns[0]);
            
            // Process each active remote room
            for (const remoteRoomName of Memory.remoteOps.activeRemotes[baseRoomName]) {
                const remoteData = Memory.remoteOps.rooms[remoteRoomName];
                if (!remoteData) continue;
                
                // Spawn reserver if needed
                this.spawnReserverIfNeeded(baseRoom, spawns[0], remoteRoomName);
                
                // Spawn remote miners and haulers
                this.spawnRemoteMinersIfNeeded(baseRoom, spawns[0], remoteRoomName);
                this.spawnRemoteHaulersIfNeeded(baseRoom, spawns[0], remoteRoomName);
            }
        }
    },
    
    /**
     * Spawn a scout if needed
     * @param {Room} room - The base room
     * @param {StructureSpawn} spawn - The spawn to use
     */
    spawnScoutIfNeeded: function(room, spawn) {
        // Count existing scouts
        const scouts = _.filter(Game.creeps, c => 
            c.memory.role === 'scout' && 
            c.memory.homeRoom === room.name
        );
        
        // Only need one scout per room
        if (scouts.length >= 1) return;
        
        // Find rooms that need scouting
        let needsScouting = false;
        const exits = Game.map.describeExits(room.name);
        
        for (const direction in exits) {
            const exitRoom = exits[direction];
            
            // Skip if we own this room
            if (Game.rooms[exitRoom] && 
                Game.rooms[exitRoom].controller && 
                Game.rooms[exitRoom].controller.my) {
                continue;
            }
            
            // Check if room needs scouting
            if (!Memory.remoteOps.rooms[exitRoom] || 
                Game.time - Memory.remoteOps.rooms[exitRoom].lastScout > 1000) {
                needsScouting = true;
                break;
            }
        }
        
        // Spawn scout if needed
        if (needsScouting) {
            const body = [MOVE];
            const name = `Scout_${Game.time}`;
            
            const result = spawn.spawnCreep(body, name, {
                memory: {
                    role: 'scout',
                    homeRoom: room.name,
                    roomComplete: false
                }
            });
            
            if (result === OK) {
                console.log(`Spawning scout in ${room.name}`);
            }
        }
    },
    
    /**
     * Spawn a reserver if needed
     * @param {Room} room - The base room
     * @param {StructureSpawn} spawn - The spawn to use
     * @param {string} remoteRoomName - The remote room name
     */
    spawnReserverIfNeeded: function(room, spawn, remoteRoomName) {
        // Skip if room level is too low for reservers
        if (room.controller.level < 4) return;
        
        const remoteData = Memory.remoteOps.rooms[remoteRoomName];
        
        // Skip if no controller
        if (!remoteData.controller) return;
        
        // Check if reservation is needed
        let needsReservation = false;
        
        // If no reservation or reservation is by someone else
        if (!remoteData.reservation) {
            needsReservation = true;
        } else if (remoteData.reservation.username !== Memory.username) {
            // If reserved by enemy, need a reserver to attack controller
            needsReservation = true;
        } else if (remoteData.reservation.ticksToEnd < 1000) {
            // If reservation is running low
            needsReservation = true;
        }
        
        // Count existing reservers for this room
        const reservers = _.filter(Game.creeps, c => 
            c.memory.role === 'reserver' && 
            c.memory.targetRoom === remoteRoomName
        );
        
        // Spawn reserver if needed
        if (needsReservation && reservers.length === 0) {
            // Basic reserver body
            const body = [CLAIM, CLAIM, MOVE, MOVE];
            const name = `Reserver_${Game.time}`;
            
            const result = spawn.spawnCreep(body, name, {
                memory: {
                    role: 'reserver',
                    homeRoom: room.name,
                    targetRoom: remoteRoomName
                }
            });
            
            if (result === OK) {
                console.log(`Spawning reserver for ${remoteRoomName} from ${room.name}`);
            }
        }
    },
    
    /**
     * Spawn remote miners if needed
     * @param {Room} room - The base room
     * @param {StructureSpawn} spawn - The spawn to use
     * @param {string} remoteRoomName - The remote room name
     */
    spawnRemoteMinersIfNeeded: function(room, spawn, remoteRoomName) {
        const remoteData = Memory.remoteOps.rooms[remoteRoomName];
        
        // Skip if no source positions
        if (!remoteData.sourcePositions || remoteData.sourcePositions.length === 0) return;
        
        // Count existing miners for each source
        const miners = _.filter(Game.creeps, c => 
            c.memory.role === 'remoteMiner' && 
            c.memory.targetRoom === remoteRoomName
        );
        
        // Check each source
        for (const sourcePos of remoteData.sourcePositions) {
            // Check if this source already has a miner
            const hasMiner = miners.some(m => m.memory.sourceId === sourcePos.id);
            
            // Spawn miner if needed
            if (!hasMiner) {
                // Calculate body based on room energy
                let body;
                const energy = room.energyCapacityAvailable;
                
                if (energy >= 800) {
                    body = [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE];
                } else if (energy >= 550) {
                    body = [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE];
                } else {
                    body = [WORK, WORK, CARRY, MOVE];
                }
                
                const name = `RMiner_${Game.time}`;
                
                const result = spawn.spawnCreep(body, name, {
                    memory: {
                        role: 'remoteMiner',
                        homeRoom: room.name,
                        targetRoom: remoteRoomName,
                        sourceId: sourcePos.id
                    }
                });
                
                if (result === OK) {
                    console.log(`Spawning remote miner for ${remoteRoomName} from ${room.name}`);
                }
                
                // Only spawn one miner per cycle
                return;
            }
        }
    },
    
    /**
     * Spawn remote haulers if needed
     * @param {Room} room - The base room
     * @param {StructureSpawn} spawn - The spawn to use
     * @param {string} remoteRoomName - The remote room name
     */
    spawnRemoteHaulersIfNeeded: function(room, spawn, remoteRoomName) {
        const remoteData = Memory.remoteOps.rooms[remoteRoomName];
        
        // Skip if no sources
        if (!remoteData.sources || remoteData.sources === 0) return;
        
        // Count existing haulers
        const haulers = _.filter(Game.creeps, c => 
            c.memory.role === 'remoteHauler' && 
            c.memory.targetRoom === remoteRoomName
        );
        
        // Calculate needed haulers based on source count and distance
        let neededHaulers = remoteData.sources;
        
        // Adjust for distance if we have route info
        const route = Game.map.findRoute(room.name, remoteRoomName);
        if (route !== ERR_NO_PATH) {
            // Add one hauler per 2 rooms of distance
            neededHaulers += Math.floor(route.length / 2);
        }
        
        // Spawn hauler if needed
        if (haulers.length < neededHaulers) {
            // Calculate body based on room energy
            let body;
            const energy = room.energyCapacityAvailable;
            
            if (energy >= 1000) {
                // Balanced hauler with 10 CARRY, 5 MOVE
                body = [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE];
            } else if (energy >= 600) {
                // Medium hauler with 6 CARRY, 3 MOVE
                body = [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
            } else {
                // Small hauler with 4 CARRY, 2 MOVE
                body = [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
            }
            
            const name = `RHauler_${Game.time}`;
            
            const result = spawn.spawnCreep(body, name, {
                memory: {
                    role: 'remoteHauler',
                    homeRoom: room.name,
                    targetRoom: remoteRoomName,
                    working: false
                }
            });
            
            if (result === OK) {
                console.log(`Spawning remote hauler for ${remoteRoomName} from ${room.name}`);
            }
        }
    }
};

module.exports = remoteManager;