/**
 * Migration script for construction system refactoring
 * Run this in the Screeps console to migrate to the new system
 */
module.exports = function() {
    console.log('Starting construction system migration...');
    
    // Step 1: Verify new files exist
    try {
        const construction = require('construction');
        const globalConstruction = require('global.construction');
        const helpers = require('helpers');
        console.log('✓ New modules loaded successfully');
    } catch (e) {
        console.log('❌ Error loading new modules:', e);
        return 'Migration failed: New modules not found or contain errors';
    }
    
    // Step 2: Update main.js
    console.log('To update main.js:');
    console.log('1. Replace: const constructionManager = require(\'constructionManager\');');
    console.log('   With:    const construction = require(\'construction\');');
    console.log('');
    console.log('2. Replace all instances of constructionManager.run with construction.run');
    console.log('');
    console.log('3. Replace global function imports:');
    console.log('   With: const globalConstruction = require(\'global.construction\');');
    console.log('         global.checkNextConstructionSites = globalConstruction.checkNextConstructionSites;');
    console.log('         global.diagnosisConstruction = globalConstruction.diagnosisConstruction;');
    console.log('         global.analyzeRoomPlanAlignment = globalConstruction.analyzeRoomPlanAlignment;');
    console.log('         global.checkPlanningStatus = globalConstruction.checkPlanningStatus;');
    console.log('         global.forceConstruction = globalConstruction.forceConstruction;');
    console.log('         global.generateRoomPlan = globalConstruction.generateRoomPlan;');
    console.log('         global.visualizeRoomPlan = globalConstruction.visualizeRoomPlan;');
    console.log('');
    console.log('4. Update all other references to constructionManager to use construction instead');
    
    // Step 3: Test the new system
    console.log('');
    console.log('Testing new construction system...');
    
    // Test a simple function
    try {
        const construction = require('construction');
        const room = Object.values(Game.rooms)[0];
        if (room) {
            console.log(`Testing with room ${room.name}`);
            const optimizer = construction.optimizer;
            const sites = optimizer.getCachedConstructionSites(room);
            console.log(`✓ Found ${sites.count} construction sites in ${room.name}`);
        } else {
            console.log('⚠️ No rooms available for testing');
        }
    } catch (e) {
        console.log('❌ Error testing construction system:', e);
        return 'Migration test failed';
    }
    
    // Step 4: Cleanup instructions
    console.log('');
    console.log('After verifying everything works, you can delete these files:');
    console.log('- constructionManager.js');
    console.log('- constructionManager.planLinks.js');
    console.log('- constructionOptimizer.js');
    console.log('- global.analyzeRoomPlanAlignment.js');
    console.log('- global.checkNextConstructionSites.js');
    console.log('- global.checkPlanningStatus.js');
    console.log('- global.diagnosisConstruction.js');
    
    return 'Migration script completed successfully';
};

// To run this script in the Screeps console:
// require('migration-construction')();