/**
 * Recovery Manager - Handles adaptive recovery after pixel generation
 * Monitors CPU bucket recovery rate and adjusts operations accordingly
 */
const recoveryManager = {
    // Track bucket history for recovery rate calculation
    bucketHistory: [],
    historyLength: 20, // Number of ticks to track
    
    // Recovery state
    recoveryStartTime: 0,
    recoveryStartBucket: 0,
    isRecovering: false,
    recoveryRate: 0, // Bucket points per tick
    
    /**
     * Update recovery status based on current bucket
     */
    update: function() {
        const currentBucket = Game.cpu.bucket;
        
        // Track bucket history
        this.bucketHistory.push(currentBucket);
        if (this.bucketHistory.length > this.historyLength) {
            this.bucketHistory.shift();
        }
        
        // Detect pixel generation (sudden drop from 10000)
        if (currentBucket < 9000 && global.previousBucket === 10000) {
            this.startRecovery(currentBucket);
        }
        
        // Store current bucket for next tick comparison
        global.previousBucket = currentBucket;
        
        // Update recovery rate if in recovery mode
        if (this.isRecovering) {
            this.updateRecoveryRate();
            this.checkRecoveryComplete();
        }
    },
    
    /**
     * Start recovery mode
     * @param {number} startBucket - Starting bucket level
     */
    startRecovery: function(startBucket) {
        this.isRecovering = true;
        this.recoveryStartTime = Game.time;
        this.recoveryStartBucket = startBucket;
        this.bucketHistory = [startBucket]; // Reset history
        this.recoveryRate = 0;
        
        console.log(`🔄 Starting adaptive recovery at tick ${Game.time}, bucket: ${startBucket}`);
    },
    
    /**
     * Update the bucket recovery rate
     */
    updateRecoveryRate: function() {
        if (this.bucketHistory.length < 2) return;
        
        // Calculate short-term recovery rate (last 5 ticks)
        const shortTermLength = Math.min(5, this.bucketHistory.length);
        const recentBuckets = this.bucketHistory.slice(-shortTermLength);
        const shortTermRate = (recentBuckets[recentBuckets.length-1] - recentBuckets[0]) / (shortTermLength - 1);
        
        // Calculate long-term recovery rate (all history)
        const longTermRate = (this.bucketHistory[this.bucketHistory.length-1] - this.bucketHistory[0]) / 
                           (this.bucketHistory.length - 1);
        
        // Use weighted average, favoring short-term rate
        this.recoveryRate = (shortTermRate * 0.7) + (longTermRate * 0.3);
        
        // Log recovery rate periodically
        if (Game.time % 10 === 0) {
            console.log(`Recovery rate: ${this.recoveryRate.toFixed(2)} bucket/tick, ` +
                      `current bucket: ${Game.cpu.bucket}, ` +
                      `recovery time: ${Game.time - this.recoveryStartTime} ticks`);
        }
    },
    
    /**
     * Check if recovery is complete
     */
    checkRecoveryComplete: function() {
        const currentBucket = Game.cpu.bucket;
        const recoveryTime = Game.time - this.recoveryStartTime;
        
        // End recovery if bucket is high enough and stable
        if ((currentBucket > 8000 && this.recoveryRate > 0) || 
            (currentBucket > 5000 && recoveryTime > 200) || 
            recoveryTime > 500) {
            
            this.isRecovering = false;
            console.log(`✅ Recovery complete after ${recoveryTime} ticks. ` +
                      `Bucket: ${currentBucket}, final rate: ${this.recoveryRate.toFixed(2)}`);
        }
    },
    
    /**
     * Get the current recovery factor (0-1)
     * Higher values mean better recovery, allowing more operations
     * @returns {number} - Recovery factor between 0 and 1
     */
    getRecoveryFactor: function() {
        if (!this.isRecovering) return 1.0; // Not in recovery mode
        
        const currentBucket = Game.cpu.bucket;
        
        // Base factor on current bucket level
        let factor = Math.min(currentBucket / 10000, 0.9);
        
        // Adjust based on recovery rate
        if (this.recoveryRate > 10) {
            // Good recovery rate, be more lenient
            factor += 0.1;
        } else if (this.recoveryRate < 0) {
            // Negative recovery rate, be more strict
            factor *= 0.5;
        }
        
        // Ensure factor is between 0 and 1
        return Math.max(0.1, Math.min(factor, 1.0));
    },
    
    /**
     * Check if an operation should run based on priority and recovery status
     * @param {string} priority - Priority level ('critical', 'high', 'medium', 'low')
     * @returns {boolean} - Whether the operation should proceed
     */
    shouldRun: function(priority) {
        if (!this.isRecovering) return true; // Not in recovery mode
        
        const factor = this.getRecoveryFactor();
        const currentBucket = Game.cpu.bucket;
        
        // Always run critical operations
        if (priority === 'critical') return true;
        
        // For other priorities, use recovery factor and bucket level
        switch(priority) {
            case 'high':
                return factor > 0.3 || currentBucket > 1000;
            case 'medium':
                return factor > 0.5 || currentBucket > 3000;
            case 'low':
                return factor > 0.7 || currentBucket > 5000;
            default:
                return factor > 0.9;
        }
    },
    
    /**
     * Get status information for display
     * @returns {string} - Status information
     */
    getStatus: function() {
        let output = `Recovery Status:\n`;
        
        if (this.isRecovering) {
            const recoveryTime = Game.time - this.recoveryStartTime;
            const factor = this.getRecoveryFactor();
            
            output += `- Status: ACTIVE (${recoveryTime} ticks)\n`;
            output += `- Bucket: ${Game.cpu.bucket} / 10000\n`;
            output += `- Recovery Rate: ${this.recoveryRate.toFixed(2)} bucket/tick\n`;
            output += `- Recovery Factor: ${(factor * 100).toFixed(0)}%\n`;
            output += `- Operations: ${this.getOperationsStatus()}\n`;
        } else {
            output += `- Status: INACTIVE\n`;
            output += `- Bucket: ${Game.cpu.bucket} / 10000\n`;
            output += `- Last Recovery: ${this.recoveryStartTime ? Game.time - this.recoveryStartTime : 'never'} ticks ago\n`;
        }
        
        return output;
    },
    
    /**
     * Get operations status based on current recovery factor
     * @returns {string} - Operations status
     */
    getOperationsStatus: function() {
        const factor = this.getRecoveryFactor();
        
        if (factor < 0.3) return "Critical Only";
        if (factor < 0.5) return "Critical + High";
        if (factor < 0.7) return "Critical + High + Medium";
        if (factor < 0.9) return "Most Operations";
        return "All Operations";
    }
};

module.exports = recoveryManager;