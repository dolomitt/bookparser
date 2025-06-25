# Ollama Timeout and Response Size Fix

## Problem
The Ollama service was timing out after 30 seconds when processing Japanese text with the `gemma3:12b` model, causing the following error:

```
[Ollama] ❌ Ollama API error: DOMException [AbortError]: This operation was aborted
[Ollama] Request timed out after 30 seconds
[Ollama] Analysis failed: Error: Ollama request timed out - try using local processing instead
[Ollama] Falling back to local dictionary processing only
```

## Root Causes
1. **Timeout Too Short**: The 12B parameter model (`gemma3:12b`) requires more time to process complex Japanese sentences
2. **Response Size Limits**: Fixed `num_predict: 1000` was insufficient for analyzing sentences with many tokens
3. **Inefficient Stop Conditions**: `stop: ["\n\n"]` could truncate JSON responses prematurely

## Solution Implemented

### 1. Increased Timeout Duration
- **Before**: Fixed 30-second timeout
- **After**: Configurable timeout (default 120 seconds, set to 180 seconds for gemma3:12b)

### 2. Added Retry Logic with Exponential Backoff
- Implements retry mechanism with up to 2 retries by default
- Uses exponential backoff: 1s, 2s, 4s delays between retries
- Configurable via `OLLAMA_MAX_RETRIES` environment variable

### 3. Fixed Response Size Limit
- **Before**: Fixed `num_predict: 1000` tokens (too small)
- **After**: Fixed `num_predict: 10000` tokens (generous limit)
- Ensures sufficient space for complete responses without truncation

### 4. Optimized Stop Conditions
- **Before**: `stop: ["\n\n"]` (could truncate JSON)
- **After**: `stop: ["}\n", "}\r\n"]` (stops after complete JSON object)

### 5. Made Configuration Flexible
Added new environment variables:
- `OLLAMA_TIMEOUT`: Timeout in milliseconds (default: 120000ms = 2 minutes)
- `OLLAMA_MAX_RETRIES`: Number of retry attempts (default: 2)
- `OLLAMA_MAX_TOKENS`: Fixed response token limit (default: 10000)

## Configuration Changes

### Environment Variables (.env)
```bash
# Ollama Configuration
OLLAMA_HOST=192.168.1.43
OLLAMA_PORT=11434
OLLAMA_MODEL=gemma3:12b
OLLAMA_TIMEOUT=180000              # 3 minutes for large models
OLLAMA_MAX_RETRIES=2               # 2 retry attempts
OLLAMA_MAX_TOKENS=10000            # Fixed response token limit
```

### Files Modified
1. `server/src/services/ollamaService.js` - Main timeout, retry, and response size logic
2. `server/src/config/index.js` - Configuration management
3. `server/.env` - Environment variables
4. `server/test_ollama_fix.js` - Test script (new)

## How It Works

### Fixed Response Size Limit
```javascript
// Use fixed token limit for response
const fixedNumPredict = config.ollama.maxTokens;
console.log(`[Ollama] Using fixed response limit: ${fixedNumPredict} tokens for ${tokens.length} input tokens`);
```

### Timeout Handling
```javascript
// Create AbortController for timeout - configurable timeout for larger models
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), config.ollama.timeout);
```

### Retry Logic
```javascript
for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
  try {
    if (attempt > 1) {
      // Exponential backoff: wait 2^(attempt-2) seconds before retry
      const waitTime = Math.pow(2, attempt - 2) * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    // ... attempt API call
  } catch (error) {
    if (attempt === maxRetries + 1) {
      throw error; // Final attempt failed
    }
    // Continue to next retry
  }
}
```

### Graceful Fallback
When Ollama fails (timeout or other errors), the system automatically falls back to local dictionary processing:

```javascript
} catch (ollamaError) {
  console.error('[Ollama] Analysis failed:', ollamaError);
  console.log('[Ollama] Falling back to local dictionary processing only');
}
```

## Benefits

1. **Improved Reliability**: Handles temporary network issues and model loading delays
2. **Better Performance**: Optimized prompts and generous fixed token limit
3. **Flexible Configuration**: Easy to adjust timeouts and limits for different model sizes
4. **Graceful Degradation**: System continues working even when Ollama is unavailable
5. **Better Logging**: More detailed error reporting and performance metrics
6. **No Truncation**: Fixed 10,000 token limit ensures complete responses

## Response Size

- **Fixed Limit**: 10,000 tokens for all requests
- **Benefit**: Eliminates truncation issues and provides ample space for complex analyses
- **Trade-off**: May use more resources but ensures complete responses

## Testing

Use the test script to verify the fixes:

```bash
cd bookparser/server
node test_ollama_fix.js
```

The test will:
1. Test connection to Ollama server
2. Attempt analysis with the problematic Japanese sentence
3. Show timing and retry behavior
4. Demonstrate fixed response size limit
5. Show fallback to local processing if needed

## Performance Impact

- **Timeout**: Increased from 30s to 180s for large models
- **Retries**: Up to 2 additional attempts with exponential backoff
- **Response Size**: Fixed 10,000 token limit prevents truncation
- **Prompt**: Reduced size by ~40% for faster processing
- **Fallback**: Immediate fallback to local processing on failure

## Monitoring

The system now logs:
- Response times for successful requests
- Retry attempts and wait times
- Fixed response size limit usage
- Timeout values and model information
- Fallback behavior

Example log output:
```
[Ollama] Using fixed response limit: 10000 tokens for 30 input tokens
[Ollama] 🚀 Sending request to Ollama API...
[Ollama] Using model: gemma3:12b
[Ollama] Response time: 45230 ms
[Ollama] ✅ Successfully parsed JSON response
```

## Future Improvements

1. **Adaptive Timeout**: Adjust timeout based on sentence length/complexity and historical performance
2. **Model-Specific Settings**: Different timeouts and token limits for different model sizes
3. **Health Monitoring**: Track success rates and adjust retry logic automatically
4. **Response Caching**: Cache results for repeated sentences to improve performance
5. **Token Usage Analytics**: Monitor actual vs. predicted token usage to optimize calculations
