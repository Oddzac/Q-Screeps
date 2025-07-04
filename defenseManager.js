/**
 * Defense Manager - Handles hostile detection and defense coordination
 * Optimized for CPU efficiency and resiliency
 */
const utils = require('utils');

const defenseManager = {
    /**
     * Run defense manager for a room
     * @param {Room} room - The room to manage defense for
     */
    run: function(room) {
        // Skip if we don't own the controller
        if (!room.controller || !room.controller.my) return;
        
        // Check for source keepers
        const hasKeepers = this.hasSourceKeepers(room);
        
        // Check for hostiles (excluding source keepers)
        const hostiles = this.getHostiles(room);
        
        // Update room memory with hostile information
        room.memory.defense = room.memory.defense || {};
        room.memory.defense.hostileCount = hostiles.length;
        room.memory.defense.hasSourceKeepers = hasKeepers;
        room.memory.defense.lastHostileCheck = Game.time;
        
        // Handle source keeper rooms differently
        if (hasKeepers && !room.memory.defense.keeperWarningIssued) {
            console.log(`⚠️ NOTICE: Room ${room.name} contains Source Keepers. Avoid until properly equipped.`);
            room.memory.defense.keeperWarningIssued = Game.time;
            
            // Mark sources near keepers as dangerous
            if (!room.memory.defense.keeperSourcesMarked) {
                this.markKeeperSources(room);
            }
        }
        
        // Run tower operations regardless of hostiles (handles heal and repair)
        this.runTowers(room);
        
        // Handle hostile-specific logic
        if (hostiles.length === 0) {
            if (room.memory.defense.threatLevel) {
                console.log(`Room ${room.name} is now safe from player threats.`);
                room.memory.defense.threatLevel = 0;
            }
            return;
        }
        
        // Assess threat level
        const threatLevel = this.assessThreatLevel(hostiles);
        room.memory.defense.threatLevel = threatLevel;
        
        // Handle defense based on threat level
        if (threatLevel >= 4) {
            // Critical threat - activate emergency mode
            if (!global.emergencyMode || global.emergencyMode.level !== 'critical') {
                global.emergencyMode = {
                    active: true,
                    startTime: Game.time,
                    level: 'critical',
                    reason: 'invasion'
                };
                console.log(`⚠️ CRITICAL THREAT in ${room.name}: Activating emergency protocols!`);
            }
        } else if (threatLevel >= 2) {
            // Significant threat - activate high emergency if not already in critical
            if (!global.emergencyMode || global.emergencyMode.level === 'off') {
                global.emergencyMode = {
                    active: true,
                    startTime: Game.time,
                    level: 'high',
                    reason: 'invasion'
                };
                console.log(`⚠️ HIGH THREAT in ${room.name}: Activating defense protocols!`);
            }
        }
        
        // Alert nearby rooms if needed
        if (threatLevel >= 3 && Game.time % 10 === 0) {
            this.alertNearbyRooms(room);
        }
    },
    
    /**
     * Get hostile entities in the room
     * @param {Room} room - The room to check
     * @returns {Array} - Array of hostile creeps
     */
    getHostiles: function(room) {
        return room.find(FIND_HOSTILE_CREEPS, {
            filter: creep => creep.owner.username !== 'Source Keeper'
        });
    },
    
    /**
     * Check if room has source keepers
     * @param {Room} room - The room to check
     * @returns {boolean} - True if room has source keepers
     */
    hasSourceKeepers: function(room) {
        const keepers = room.find(FIND_HOSTILE_CREEPS, {
            filter: creep => creep.owner.username === 'Source Keeper'
        });
        
        return keepers.length > 0;
    },
    
    /**
     * Assess threat level based on hostile creeps
     * @param {Array} hostiles - Array of hostile creeps
     * @returns {number} - Threat level (0-5)
     */
    assessThreatLevel: function(hostiles) {
        if (hostiles.length === 0) return 0;
        
        let threatLevel = 1; // Base threat level
        let totalAttackParts = 0;
        let totalHealParts = 0;
        let totalRangedParts = 0;
        let totalWorkParts = 0; // For dismantling
        
        // Count dangerous body parts
        for (const hostile of hostiles) {
            for (const part of hostile.body) {
                if (part.type === ATTACK) totalAttackParts++;
                if (part.type === RANGED_ATTACK) totalRangedParts++;
                if (part.type === HEAL) totalHealParts++;
                if (part.type === WORK) totalWorkParts++;
            }
        }
        
        // Adjust threat level based on body parts
        if (totalAttackParts + totalRangedParts > 10) threatLevel = Math.max(threatLevel, 4);
        else if (totalAttackParts + totalRangedParts > 5) threatLevel = Math.max(threatLevel, 3);
        else if (totalAttackParts + totalRangedParts > 0) threatLevel = Math.max(threatLevel, 2);
        
        // Healers make threats more dangerous
        if (totalHealParts > 5) threatLevel++;
        
        // Work parts could be used for dismantling
        if (totalWorkParts > 10) threatLevel = Math.max(threatLevel, 3);
        
        // Cap at level 5
        return Math.min(threatLevel, 5);
    },
    
    /**
     * Run tower operations for a room
     * @param {Room} room - The room to run towers for
     */
    runTowers: function(room) {
        const towers = room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER && s.energy > 0
        });
        
        if (towers.length === 0) return;
        
        // Process each tower with priority actions
        for (const tower of towers) {
            // Priority 1: Heal injured creeps
            if (this.towerHeal(tower)) continue;
            
            // Priority 2: Attack hostiles
            if (this.towerAttack(tower)) continue;
            
            // Priority 3: Repair critical structures (only if tower has >80% energy)
            if (tower.energy > tower.energyCapacity * 0.6) {
                this.towerRepair(tower);
            }
        }
    },
    
    /**
     * Tower healing logic
     * @param {StructureTower} tower - The tower
     * @returns {boolean} - True if action taken
     */
    towerHeal: function(tower) {
        const injured = tower.room.find(FIND_MY_CREEPS, {
            filter: c => c.hits < c.hitsMax
        });
        
        if (injured.length > 0) {
            const target = tower.pos.findClosestByRange(injured);
            tower.heal(target);
            return true;
        }
        return false;
    },
    
    /**
     * Tower attack logic with priority targeting
     * @param {StructureTower} tower - The tower
     * @returns {boolean} - True if action taken
     */
    towerAttack: function(tower) {
        // Use cached hostiles from room memory if available to save CPU
        let hostiles;
        if (tower.room.memory.defense && tower.room.memory.defense.hostileCache && 
            Game.time - tower.room.memory.defense.hostileCacheTime < 3) {
            hostiles = tower.room.memory.defense.hostileCache.map(id => Game.getObjectById(id))
                .filter(c => c !== null);
        } else {
            hostiles = tower.room.find(FIND_HOSTILE_CREEPS, {
                filter: c => c.owner.username !== 'Source Keeper'
            });
            
            // Cache the results
            if (!tower.room.memory.defense) tower.room.memory.defense = {};
            tower.room.memory.defense.hostileCache = hostiles.map(c => c.id);
            tower.room.memory.defense.hostileCacheTime = Game.time;
        }
        
        if (hostiles.length === 0) return false;
        
        // Prioritize targets by threat level and health
        const healers = hostiles.filter(c => c.body.some(part => part.type === HEAL));
        const attackers = hostiles.filter(c => 
            c.body.some(part => part.type === ATTACK || part.type === RANGED_ATTACK)
        );
        
        let target;
        
        // First priority: Low health healers
        const weakHealers = healers.filter(c => c.hits < c.hitsMax * 0.5);
        if (weakHealers.length > 0) {
            target = tower.pos.findClosestByRange(weakHealers);
        }
        // Second priority: Low health attackers
        else if (!target) {
            const weakAttackers = attackers.filter(c => c.hits < c.hitsMax * 0.5);
            if (weakAttackers.length > 0) {
                target = tower.pos.findClosestByRange(weakAttackers);
            }
        }
        // Third priority: Healers
        else if (!target && healers.length > 0) {
            target = tower.pos.findClosestByRange(healers);
        }
        // Fourth priority: Attackers
        else if (!target && attackers.length > 0) {
            target = tower.pos.findClosestByRange(attackers);
        }
        // Last priority: Any hostile
        else {
            target = tower.pos.findClosestByRange(hostiles);
        }
            
        tower.attack(target);
        return true;
    },
    
    /**
     * Tower repair logic using cached repair targets
     * @param {StructureTower} tower - The tower
     * @returns {boolean} - True if action taken
     */
    towerRepair: function(tower) {
        // Only repair if tower has sufficient energy (>60%)
        if (tower.store[RESOURCE_ENERGY] < tower.store.getCapacity(RESOURCE_ENERGY) * 0.6) return false;
        
        // Use cached repair targets from room memory
        if (tower.room.memory.repairTargets && tower.room.memory.repairTargets.length > 0) {
            // Prioritize critical structures first
            const criticalTypes = [STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_STORAGE];
            
            // First pass: check critical structures
            for (const id of tower.room.memory.repairTargets) {
                const structure = Game.getObjectById(id);
                if (structure && criticalTypes.includes(structure.structureType) && 
                    structure.hits < structure.hitsMax * 0.5) {
                    tower.repair(structure);
                    return true;
                }
            }
            
            // Second pass: check any damaged structure
            for (const id of tower.room.memory.repairTargets) {
                const structure = Game.getObjectById(id);
                if (structure && structure.hits < structure.hitsMax * 0.4) {
                    tower.repair(structure);
                    return true;
                }
            }
        }
        return false;
    },
    
    /**
     * Alert nearby rooms about invasion
     * @param {Room} room - The room under attack
     */
    alertNearbyRooms: function(room) {
        // This would be expanded in a multi-room setup
        console.log(`⚠️ ALERT: Room ${room.name} under attack! Threat level: ${room.memory.defense.threatLevel}`);
    },
    
    /**
     * Mark sources near keepers as dangerous
     * @param {Room} room - The room to check
     */
    markKeeperSources: function(room) {
        // Find all source keepers
        const keepers = room.find(FIND_HOSTILE_CREEPS, {
            filter: creep => creep.owner.username === 'Source Keeper'
        });
        
        if (keepers.length === 0) return;
        
        // Find all sources
        const sources = room.find(FIND_SOURCES);
        
        // Mark sources that are near keepers
        for (const source of sources) {
            let isNearKeeper = false;
            
            for (const keeper of keepers) {
                if (source.pos.getRangeTo(keeper) <= 5) {
                    isNearKeeper = true;
                    break;
                }
            }
            
            // Update source memory
            if (!room.memory.sources) room.memory.sources = {};
            if (!room.memory.sources[source.id]) room.memory.sources[source.id] = {};
            
            room.memory.sources[source.id].nearKeeper = isNearKeeper;
        }
        
        room.memory.defense.keeperSourcesMarked = true;
    }
};

module.exports = defenseManager;