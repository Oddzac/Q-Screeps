# Q-Screeps

A Screeps AI implementation focused on efficiency and CPU optimization.

## Key Features

- **CPU Optimization**: Adaptive recovery system that scales operations based on CPU availability
- **Error Resilience**: Robust error handling with detailed logging and recovery mechanisms
- **Performance Monitoring**: Built-in tools to track and analyze CPU usage
- **Memory Management**: Efficient memory usage with automatic cleanup and compression
- **Defensive Systems**: Sophisticated threat assessment and tower management

## Usage

### Performance Monitoring

```javascript
// Get performance statistics
global.getPerformance();

// Reset performance statistics
global.resetPerformance();

// Wrap a module with performance monitoring
const myWrappedModule = global.wrapWithPerformance('moduleName', myModule);
```

### Room Planning

```javascript
// Force planning for a room
global.forcePlanning('roomName');

// Check and fix misaligned structures
global.checkRoomAlignment('roomName');

// Clear room optimizer caches
global.clearRoomCaches();
```

### Recovery Management

The system includes an adaptive recovery manager that automatically scales operations based on CPU availability. When the CPU bucket is draining, the system will enter recovery mode and prioritize critical operations.

## Architecture

The codebase is organized into modules:

- **Main Loop**: Orchestrates the execution of all other modules
- **Room Manager**: Handles room-level operations and intelligence
- **Defense Manager**: Manages defensive structures and threat assessment
- **Movement Manager**: Optimizes creep movement with path caching
- **Memory Manager**: Handles memory cleanup and optimization
- **Recovery Manager**: Manages CPU recovery during high usage periods
- **Role Modules**: Define behavior for different creep roles

## Recent Improvements

- Enhanced tower targeting logic with better prioritization
- Optimized path caching in movement manager
- Added performance monitoring tools
- Improved error handling with rate limiting
- Optimized recovery manager to reduce CPU usage
- Added caching to builder priority calculation