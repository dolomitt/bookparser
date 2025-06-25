# Montreal Forced Aligner (MFA) Integration with VoiceVox

This document describes the integration of Montreal Forced Aligner with VoiceVox for enhanced audio-text timing alignment in the bookparser project.

## Overview

The MFA integration provides improved timing alignment between VoiceVox-generated audio and text content. It offers both mora-level timing (from VoiceVox) and word-level timing (from MFA) for better synchronization in reading applications.

## Features

### 1. Dual Alignment Methods
- **VoiceVox Native**: Mora-level timing based on VoiceVox's internal phoneme analysis
- **MFA Enhanced**: Word-level timing using Montreal Forced Aligner for more accurate alignment
- **Fallback Support**: Graceful degradation when MFA is not available

### 2. Enhanced API Endpoints

#### `/api/text-to-speech/enhanced` (POST)
Enhanced TTS with MFA alignment support.

**Request Body:**
```json
{
  "text": "こんにちは、世界！",
  "speaker": 1,
  "speed": 1.0,
  "volume": 1.0,
  "useMFA": true,
  "language": "japanese_mfa"
}
```

**Response:**
```json
{
  "audio": "base64_encoded_audio",
  "timings": [
    {
      "startTime": 0.0,
      "endTime": 0.5,
      "text": "こんにちは",
      "confidence": 0.8
    }
  ],
  "audioFormat": "wav",
  "sampleRate": 24000,
  "alignment": {
    "method": "mfa",
    "stats": {
      "totalWords": 3,
      "totalDuration": 2.5,
      "averageWordDuration": 0.83,
      "confidence": 0.8
    },
    "originalVoiceVoxTimings": 12,
    "enhancedTimings": 3
  },
  "enhanced": true,
  "timestamp": "2025-06-25T10:24:00.000Z"
}
```

#### `/api/text-to-speech/compare-alignment` (POST)
Compare VoiceVox and MFA alignment methods.

**Request Body:**
```json
{
  "text": "こんにちは、世界！",
  "speaker": 1,
  "speed": 1.0,
  "volume": 1.0
}
```

**Response:**
```json
{
  "voiceVoxOnly": {
    "timings": [...],
    "stats": {
      "totalMoras": 12,
      "totalDuration": 2.5,
      "averageMoraDuration": 0.21,
      "type": "mora-level"
    }
  },
  "mfaEnhanced": {
    "timings": [...],
    "stats": {
      "totalWords": 3,
      "totalDuration": 2.5,
      "averageWordDuration": 0.83,
      "confidence": 0.8,
      "type": "word-level"
    },
    "method": "mfa"
  },
  "comparison": {
    "voiceVox": {
      "count": 12,
      "duration": 2.5,
      "type": "mora-level"
    },
    "mfa": {
      "count": 3,
      "duration": 2.5,
      "type": "word-level"
    },
    "improvement": {
      "granularityChange": 9,
      "durationDifference": 0.0,
      "recommended": "mfa"
    }
  },
  "audio": "base64_encoded_audio",
  "audioFormat": "wav",
  "sampleRate": 24000
}
```

## Installation and Setup

### 1. Install Montreal Forced Aligner

#### Option A: Using Conda (Recommended)
```bash
conda install -c conda-forge montreal-forced-alignment
```

#### Option B: Using pip
```bash
pip install montreal-forced-alignment
```

### 2. Download Language Models
For Japanese text alignment:
```bash
mfa download acoustic japanese_mfa
mfa download dictionary japanese_mfa
```

### 3. Verify Installation
```bash
mfa --version
```

## Usage

### 1. Basic Enhanced TTS
```javascript
const response = await fetch('/api/text-to-speech/enhanced', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'こんにちは、世界！今日はいい天気ですね。',
    speaker: 1,
    useMFA: true
  })
});

const result = await response.json();
console.log(`Alignment method: ${result.alignment.method}`);
console.log(`Word-level timings: ${result.timings.length}`);
```

### 2. Compare Alignment Methods
```javascript
const response = await fetch('/api/text-to-speech/compare-alignment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'こんにちは、世界！今日はいい天気ですね。',
    speaker: 1
  })
});

const comparison = await response.json();
console.log('Recommended method:', comparison.comparison.improvement.recommended);
```

### 3. Test Integration
Run the test script to verify the integration:
```bash
cd bookparser/server
node test_mfa_integration.js
```

## Architecture

### Service Layer
- **`mfaService.js`**: Handles MFA operations, file preparation, and alignment processing
- **`voicevoxService.js`**: Enhanced with MFA integration methods
- **`tts.js`**: Updated routes with new MFA endpoints

### Key Components

#### MFA Service (`mfaService.js`)
- **`checkMFAAvailability()`**: Verifies MFA installation
- **`alignVoiceVoxAudio()`**: Main alignment function
- **`enhanceVoiceVoxTimings()`**: Converts mora-level to word-level timings
- **`parseTextGrid()`**: Processes MFA TextGrid output

#### Enhanced VoiceVox Service
- **`generateSpeechWithMFA()`**: Combines VoiceVox and MFA
- **`compareAlignments()`**: Compares different alignment methods
- **`calculateAudioDuration()`**: Utility for timing calculations

## Timing Data Formats

### VoiceVox Timing (Mora-level)
```json
{
  "startTime": 0.0,
  "endTime": 0.2,
  "textStart": 0,
  "textEnd": 1,
  "text": "こ",
  "mora": "ko",
  "phraseIndex": 0,
  "moraIndex": 0,
  "consonantLength": 0.05,
  "vowelLength": 0.15
}
```

### MFA Enhanced Timing (Word-level)
```json
{
  "startTime": 0.0,
  "endTime": 0.8,
  "text": "こんにちは",
  "confidence": 0.85
}
```

## Configuration

### Environment Variables
Add to your `.env` file:
```env
# MFA Configuration (optional)
MFA_LANGUAGE=japanese
MFA_TEMP_DIR=./temp_mfa
MFA_MODELS_DIR=./mfa_models
```

### Default Settings
- **Language**: Japanese
- **Fallback**: VoiceVox timings when MFA fails
- **Cleanup**: Automatic temporary file removal
- **Confidence**: 0.8 for MFA-enhanced timings, 0.5 for basic timings

## Error Handling

The integration includes comprehensive error handling:

1. **MFA Not Available**: Falls back to VoiceVox timings
2. **Alignment Failure**: Uses enhanced VoiceVox processing
3. **File System Errors**: Graceful cleanup and error reporting
4. **Network Issues**: Standard VoiceVox error handling

## Performance Considerations

- **MFA Processing**: Adds 2-5 seconds for alignment processing
- **Memory Usage**: Temporary audio files are cleaned up automatically
- **Caching**: Consider implementing alignment result caching for repeated texts
- **Concurrent Requests**: MFA processes are isolated per request

## Troubleshooting

### Common Issues

1. **MFA Not Found**
   ```
   Error: MFA alignment failed: spawn mfa ENOENT
   ```
   Solution: Install MFA using conda or pip

2. **Missing Language Models**
   ```
   Error: No acoustic model found for japanese
   ```
   Solution: Download Japanese models with `mfa download`

3. **Permission Errors**
   ```
   Error: EACCES: permission denied, mkdir './temp_mfa'
   ```
   Solution: Ensure write permissions for temp directories

### Debug Mode
Enable detailed logging by setting:
```env
DEBUG=mfa,voicevox
```

## Future Enhancements

1. **Multi-language Support**: Extend beyond Japanese
2. **Custom Models**: Support for user-trained MFA models
3. **Real-time Alignment**: Streaming alignment for long texts
4. **Alignment Caching**: Cache results for improved performance
5. **Visual Alignment**: Web interface for timing visualization

## Contributing

When contributing to the MFA integration:

1. Test with both MFA available and unavailable scenarios
2. Ensure fallback mechanisms work correctly
3. Add appropriate logging for debugging
4. Update documentation for new features
5. Consider performance impact of changes

## License

This integration follows the same license as the main bookparser project.
