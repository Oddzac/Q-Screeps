/**
 * Cleanup script for construction system refactoring
 * This script will help you safely remove the old files
 */
module.exports = function() {
    console.log('Starting construction system cleanup...');
    
    // List of files to remove
    const filesToRemove = [
        'constructionManager.js',
        'constructionManager.planLinks.js',
        'constructionOptimizer.js',
        'global.analyzeRoomPlanAlignment.js',
        'global.checkNextConstructionSites.js',
        'global.checkPlanningStatus.js',
        'global.diagnosisConstruction.js'
    ];
    
    // Check if new files exist first
    try {
        const construction = require('construction');
        const globalConstruction = require('global.construction');
        const helpers = require('helpers');
        console.log('✓ New modules loaded successfully');
    } catch (e) {
        console.log('❌ Error loading new modules:', e);
        return 'Cleanup aborted: New modules not found or contain errors';
    }
    
    // Check if main.js has been updated
    try {
        const mainContent = require('main');
        if (typeof mainContent === 'object' && mainContent.loop) {
            console.log('✓ Main module loaded successfully');
        } else {
            console.log('⚠️ Main module structure seems unusual');
        }
    } catch (e) {
        console.log('❌ Error loading main module:', e);
        return 'Cleanup aborted: Main module not found or contains errors';
    }
    
    // Instructions for manual removal
    console.log('\nTo complete the cleanup, manually delete these files:');
    for (const file of filesToRemove) {
        console.log(`- ${file}`);
    }
    
    console.log('\nAlso consider removing these temporary files:');
    console.log('- main.js.updated');
    console.log('- migration-construction.js');
    console.log('- cleanup-construction.js (this file)');
    
    console.log('\nKeep these files:');
    console.log('- construction.js - Main construction module');
    console.log('- global.construction.js - Global interface functions');
    console.log('- helpers.js - Helper functions');
    console.log('- construction-refactor.md - Documentation');
    console.log('- CONSTRUCTION-README.md - User guide');
    
    return 'Cleanup instructions completed';
};

// To run this script in the Screeps console:
// require('cleanup-construction')()