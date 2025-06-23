/**
 * Verification script for construction system refactoring
 * Run this to verify that the new system is working correctly
 */
module.exports = function() {
    console.log('Starting construction system verification...');
    
    // Step 1: Verify modules load correctly
    try {
        const construction = require('construction');
        const globalConstruction = require('global.construction');
        const helpers = require('helpers');
        console.log('✓ All modules loaded successfully');
    } catch (e) {
        console.log('❌ Error loading modules:', e);
        return 'Verification failed: Modules not found or contain errors';
    }
    
    // Step 2: Verify key functions exist
    const construction = require('construction');
    const functionTests = [
        { name: 'run', exists: typeof construction.run === 'function' },
        { name: 'planRoads', exists: typeof construction.planRoads === 'function' },
        { name: 'planLinks', exists: typeof construction.planLinks === 'function' },
        { name: 'generateRoomPlan', exists: typeof construction.generateRoomPlan === 'function' },
        { name: 'visualizeRoomPlan', exists: typeof construction.visualizeRoomPlan === 'function' },
        { name: 'optimizer.getCachedConstructionSites', exists: typeof construction.optimizer.getCachedConstructionSites === 'function' }
    ];
    
    let allFunctionsExist = true;
    for (const test of functionTests) {
        if (test.exists) {
            console.log(`✓ Function '${test.name}' exists`);
        } else {
            console.log(`❌ Function '${test.name}' is missing`);
            allFunctionsExist = false;
        }
    }
    
    if (!allFunctionsExist) {
        return 'Verification failed: Some functions are missing';
    }
    
    // Step 3: Verify global functions
    const globalFunctions = [
        'checkNextConstructionSites',
        'diagnosisConstruction',
        'analyzeRoomPlanAlignment',
        'checkPlanningStatus',
        'forceConstruction',
        'generateRoomPlan',
        'visualizeRoomPlan'
    ];
    
    let allGlobalsExist = true;
    for (const funcName of globalFunctions) {
        if (typeof global[funcName] === 'function') {
            console.log(`✓ Global function '${funcName}' exists`);
        } else {
            console.log(`❌ Global function '${funcName}' is missing`);
            allGlobalsExist = false;
        }
    }
    
    if (!allGlobalsExist) {
        return 'Verification failed: Some global functions are missing';
    }
    
    // Step 4: Test with a room if available
    const room = Object.values(Game.rooms)[0];
    if (room) {
        console.log(`Testing with room ${room.name}`);
        try {
            // Test optimizer functions
            const sites = construction.optimizer.getCachedConstructionSites(room);
            console.log(`✓ Found ${sites.count} construction sites in ${room.name}`);
            
            // Test planning status
            const status = globalConstruction.checkPlanningStatus(room.name);
            console.log(`✓ Planning status check successful`);
            
            // Don't actually run the construction manager as it might create sites
            console.log(`✓ All room tests passed`);
        } catch (e) {
            console.log(`❌ Error during room tests:`, e);
            return 'Verification failed: Room tests encountered errors';
        }
    } else {
        console.log('⚠️ No rooms available for testing');
    }
    
    console.log('\nVerification completed successfully!');
    console.log('The construction system refactoring appears to be working correctly.');
    console.log('You can now safely run the cleanup script: require("cleanup-construction")()\n');
    
    return 'Verification successful';
};

// To run this script in the Screeps console:
// require('verify-construction')()