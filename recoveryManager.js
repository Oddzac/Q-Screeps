/**
 * Recovery Manager - Handles adaptive recovery during CPU crisis
 * Only activates when bucket is continuously draining, not just after pixel generation
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
    
    // Consecutive ticks of bucket drain to trigger recovery
    drainThreshold: 5,
    drainCounter: 0,
    
    /**
     * Update recovery status based on current bucket
     */
    update: function() {
        const currentBucket = Game.cpu.bucket;
        
        // Only update every other tick to save CPU
        if (Game.time % 2 === 0) {
            // Track bucket history
            this.bucketHistory.push(currentBucket);
            if (this.bucketHistory.length > this.historyLength) {
                this.bucketHistory.shift();
            }
            
            // Check for continuous bucket drain
            if (global.previousBucket !== undefined && currentBucket < global.previousBucket) {
                this.drainCounter++;
                
                // Only enter recovery if bucket is continuously draining AND below 5000
                if (this.drainCounter >= this.drainThreshold && currentBucket < 5000 && !this.isRecovering) {
                    this.startRecovery(currentBucket);
                }
            } else {
                // Reset drain counter if bucket is stable or increasing
                this.drainCounter = 0;
            }
            
            // Update recovery rate if in recovery mode
            if (this.isRecovering) {
                this.updateRecoveryRate();
                this.checkRecoveryComplete();
            }
        }
        
        // Store current bucket for next tick comparison
        global.previousBucket = currentBucket;
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
        // More lenient exit conditions
        if ((currentBucket > 5000 && this.recoveryRate > 0) || 
            (currentBucket > 3000 && recoveryTime > 100) || 
            recoveryTime > 300) {
            
            this.isRecovering = false;
            this.drainCounter = 0; // Reset drain counter
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
        
        // Much more generous curve - start with higher base factor
        let factor = Math.min(Math.pow(currentBucket / 10000, 0.5), 0.98);
        
        // Adjust based on recovery rate - more lenient adjustments
        if (this.recoveryRate > 5) {
            // Good recovery rate, be more lenient
            factor += 0.15;
        } else if (this.recoveryRate > 0) {
            // Positive recovery rate
            factor += 0.1;
        } else if (this.recoveryRate < 0) {
            // Negative recovery rate, be more strict but still not too harsh
            factor *= 0.8;
        }
        
        // Add a larger bonus for time spent in recovery to prevent stalling
        const recoveryTime = Game.time - this.recoveryStartTime;
        if (recoveryTime > 20) { // Kick in sooner
            factor += Math.min(0.2, recoveryTime / 500); // Max 0.2 bonus after 500 ticks
        }
        
        // Log recovery factor calculation periodically
        if (Game.time % 10 === 0) {
            console.log(`Recovery factor: ${factor.toFixed(2)}, bucket: ${currentBucket}, rate: ${this.recoveryRate.toFixed(2)}, time: ${recoveryTime}`);
        }
        
        // Ensure factor is between 0.2 and 1.0 (higher minimum)
        return Math.max(0.2, Math.min(factor, 1.0));
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
        
        // Check if CPU usage is reasonable
        const avgCpuUsage = global.cpuHistory && global.cpuHistory.length > 0 ?
                          global.cpuHistory.reduce((sum, val) => sum + val, 0) / global.cpuHistory.length : 1.0;
        const veryLowCpuUsage = avgCpuUsage < 2.0; // Much more lenient threshold
        
        // For other priorities, use recovery factor and bucket level - much more lenient thresholds
        let result;
        switch(priority) {
            case 'high':
                // Almost always run high priority tasks
                result = factor > 0.1 || currentBucket > 500 || veryLowCpuUsage;
                break;
            case 'medium':
                // Very lenient with medium priority to prevent room stalling
                result = factor > 0.2 || currentBucket > 800 || veryLowCpuUsage || avgCpuUsage < 3.0;
                break;
            case 'low':
                // More lenient with low priority
                result = factor > 0.3 || currentBucket > 1500 || (veryLowCpuUsage && currentBucket > 1000);
                break;
            default:
                result = factor > 0.5;
        }
        
        // Log decisions for medium priority periodically
        if (priority === 'medium' && Game.time % 10 === 0) {
            console.log(`shouldRun ${priority} = ${result}, factor: ${factor.toFixed(2)}, bucket: ${currentBucket}, avgCpu: ${avgCpuUsage.toFixed(2)}, veryLowCpu: ${veryLowCpuUsage}`);
        }
        
        return result;
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