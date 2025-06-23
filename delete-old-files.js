/**
 * Script to delete old construction files
 * This will be executed by the Screeps engine
 */

// List of files to remove
const filesToRemove = [
    'constructionManager',
    'constructionManager.planLinks',
    'constructionOptimizer',
    'global.analyzeRoomPlanAlignment',
    'global.checkNextConstructionSites',
    'global.checkPlanningStatus',
    'global.diagnosisConstruction'
];

// Delete the files
for (const file of filesToRemove) {
    try {
        delete require.cache[require.resolve(file)];
        console.log(`✓ Removed ${file} from require cache`);
    } catch (e) {
        console.log(`⚠️ Could not remove ${file} from require cache: ${e.message}`);
    }
}

console.log('\nOld construction files have been removed from the require cache.');
console.log('The new consolidated construction system is now active.');
console.log('\nNote: This script only removes the files from the require cache.');
console.log('You will still need to delete the actual files from your codebase.');

module.exports = 'Old construction files removed from require cache';