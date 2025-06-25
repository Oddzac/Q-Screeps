/**
 * Performance Monitor - Track and analyze CPU usage
 */
const performanceMonitor = {
    // Track function execution times
    functionStats: {},
    
    // Track module CPU usage
    moduleStats: {},
    
    // Track overall CPU usage
    overallStats: {
        ticks: 0,
        totalCpu: 0,
        maxCpu: 0,
        minCpu: Infinity,
        bucketLevels: []
    },
    
    /**
     * Reset statistics
     */
    reset: function() {
        this.functionStats = {};
        this.moduleStats = {};
        this.overallStats = {
            ticks: 0,
            totalCpu: 0,
            maxCpu: 0,
            minCpu: Infinity,
            bucketLevels: []
        };
    },
    
    /**
     * Track function execution time
     * @param {string} name - Function name
     * @param {function} fn - Function to track
     * @param {Object} context - Context to bind the function to
     * @param {Array} args - Arguments to pass to the function
     * @returns {*} - Result of the function
     */
    trackFunction: function(name, fn, context, ...args) {
        const start = Game.cpu.getUsed();
        const result = fn.apply(context || this, args);
        const end = Game.cpu.getUsed();
        const cpuUsed = end - start;
        
        // Update function stats
        if (!this.functionStats[name]) {
            this.functionStats[name] = {
                calls: 0,
                totalCpu: 0,
                maxCpu: 0,
                minCpu: Infinity
            };
        }
        
        this.functionStats[name].calls++;
        this.functionStats[name].totalCpu += cpuUsed;
        this.functionStats[name].maxCpu = Math.max(this.functionStats[name].maxCpu, cpuUsed);
        this.functionStats[name].minCpu = Math.min(this.functionStats[name].minCpu, cpuUsed);
        
        return result;
    },
    
    /**
     * Track module CPU usage
     * @param {string} name - Module name
     * @param {function} fn - Function to track
     * @param {Object} context - Context to bind the function to
     * @param {Array} args - Arguments to pass to the function
     * @returns {*} - Result of the function
     */
    trackModule: function(name, fn, context, ...args) {
        const start = Game.cpu.getUsed();
        const result = fn.apply(context || this, args);
        const end = Game.cpu.getUsed();
        const cpuUsed = end - start;
        
        // Update module stats
        if (!this.moduleStats[name]) {
            this.moduleStats[name] = {
                calls: 0,
                totalCpu: 0,
                maxCpu: 0,
                minCpu: Infinity
            };
        }
        
        this.moduleStats[name].calls++;
        this.moduleStats[name].totalCpu += cpuUsed;
        this.moduleStats[name].maxCpu = Math.max(this.moduleStats[name].maxCpu, cpuUsed);
        this.moduleStats[name].minCpu = Math.min(this.moduleStats[name].minCpu, cpuUsed);
        
        return result;
    },
    
    /**
     * Track overall CPU usage
     * @param {number} cpuUsed - CPU used this tick
     */
    trackOverall: function(cpuUsed) {
        this.overallStats.ticks++;
        this.overallStats.totalCpu += cpuUsed;
        this.overallStats.maxCpu = Math.max(this.overallStats.maxCpu, cpuUsed);
        this.overallStats.minCpu = Math.min(this.overallStats.minCpu, cpuUsed);
        this.overallStats.bucketLevels.push(Game.cpu.bucket);
        
        // Keep bucket history at a reasonable size
        if (this.overallStats.bucketLevels.length > 100) {
            this.overallStats.bucketLevels.shift();
        }
    },
    
    /**
     * Get function statistics
     * @returns {Object} - Function statistics
     */
    getFunctionStats: function() {
        const result = {};
        
        for (const name in this.functionStats) {
            const stats = this.functionStats[name];
            result[name] = {
                calls: stats.calls,
                totalCpu: stats.totalCpu.toFixed(2),
                avgCpu: (stats.totalCpu / stats.calls).toFixed(2),
                maxCpu: stats.maxCpu.toFixed(2),
                minCpu: stats.minCpu.toFixed(2)
            };
        }
        
        return result;
    },
    
    /**
     * Get module statistics
     * @returns {Object} - Module statistics
     */
    getModuleStats: function() {
        const result = {};
        
        for (const name in this.moduleStats) {
            const stats = this.moduleStats[name];
            result[name] = {
                calls: stats.calls,
                totalCpu: stats.totalCpu.toFixed(2),
                avgCpu: (stats.totalCpu / stats.calls).toFixed(2),
                maxCpu: stats.maxCpu.toFixed(2),
                minCpu: stats.minCpu.toFixed(2)
            };
        }
        
        return result;
    },
    
    /**
     * Get overall statistics
     * @returns {Object} - Overall statistics
     */
    getOverallStats: function() {
        return {
            ticks: this.overallStats.ticks,
            totalCpu: this.overallStats.totalCpu.toFixed(2),
            avgCpu: (this.overallStats.totalCpu / this.overallStats.ticks).toFixed(2),
            maxCpu: this.overallStats.maxCpu.toFixed(2),
            minCpu: this.overallStats.minCpu.toFixed(2),
            avgBucket: (this.overallStats.bucketLevels.reduce((sum, val) => sum + val, 0) / 
                      this.overallStats.bucketLevels.length).toFixed(0),
            bucketTrend: this.getBucketTrend()
        };
    },
    
    /**
     * Get bucket trend
     * @returns {string} - Bucket trend (increasing, decreasing, stable)
     */
    getBucketTrend: function() {
        if (this.overallStats.bucketLevels.length < 10) return 'unknown';
        
        const recent = this.overallStats.bucketLevels.slice(-10);
        const first = recent.slice(0, 5).reduce((sum, val) => sum + val, 0) / 5;
        const last = recent.slice(-5).reduce((sum, val) => sum + val, 0) / 5;
        
        if (last - first > 50) return 'increasing';
        if (first - last > 50) return 'decreasing';
        return 'stable';
    },
    
    /**
     * Log statistics
     */
    logStats: function() {
        // Get overall stats
        const overall = this.getOverallStats();
        
        console.log(`Performance Monitor - Overall Stats:
- Ticks: ${overall.ticks}
- Avg CPU: ${overall.avgCpu}
- Max CPU: ${overall.maxCpu}
- Min CPU: ${overall.minCpu}
- Avg Bucket: ${overall.avgBucket}
- Bucket Trend: ${overall.bucketTrend}
`);
        
        // Get top 5 CPU-intensive modules
        const modules = Object.entries(this.getModuleStats())
            .sort((a, b) => parseFloat(b[1].totalCpu) - parseFloat(a[1].totalCpu))
            .slice(0, 5);
        
        console.log(`Top 5 CPU-Intensive Modules:`);
        for (const [name, stats] of modules) {
            console.log(`- ${name}: ${stats.totalCpu} CPU (${stats.avgCpu} avg, ${stats.calls} calls)`);
        }
        
        // Get top 5 CPU-intensive functions
        const functions = Object.entries(this.getFunctionStats())
            .sort((a, b) => parseFloat(b[1].totalCpu) - parseFloat(a[1].totalCpu))
            .slice(0, 5);
        
        console.log(`Top 5 CPU-Intensive Functions:`);
        for (const [name, stats] of functions) {
            console.log(`- ${name}: ${stats.totalCpu} CPU (${stats.avgCpu} avg, ${stats.calls} calls)`);
        }
    }
};

// Add global function to access performance monitor
global.getPerformance = function() {
    performanceMonitor.logStats();
    return 'Performance stats logged to console';
};

// Add global function to reset performance monitor
global.resetPerformance = function() {
    performanceMonitor.reset();
    return 'Performance monitor reset';
};

module.exports = performanceMonitor;