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
        
        // If no hostiles, nothing more to do
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
        
        // Run tower operations (handles attack, heal, and repair)
        this.runTowers(room);
        
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
            if (tower.energy > tower.energyCapacity * 0.8) {
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
        const hostiles = tower.room.find(FIND_HOSTILE_CREEPS, {
            filter: c => c.owner.username !== 'Source Keeper'
        });
        
        if (hostiles.length === 0) return false;
        
        // Prioritize aggressive hostiles
        const aggressive = hostiles.filter(c => 
            c.body.some(part => part.type === ATTACK || part.type === RANGED_ATTACK)
        );
        
        const target = aggressive.length > 0 ? 
            tower.pos.findClosestByRange(aggressive) : 
            tower.pos.findClosestByRange(hostiles);
            
        tower.attack(target);
        return true;
    },
    
    /**
     * Tower repair logic using cached repair targets
     * @param {StructureTower} tower - The tower
     * @returns {boolean} - True if action taken
     */
    towerRepair: function(tower) {
        // Use cached repair targets from room memory
        if (tower.room.memory.repairTargets && tower.room.memory.repairTargets.length > 0) {
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