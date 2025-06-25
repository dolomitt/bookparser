import express from 'express';
import voicevoxService from '../services/voicevoxService.js';

const router = express.Router();

// Text-to-speech endpoint using VOICEVOX with timing data
router.post('/', async (req, res) => {
  console.log('Received /api/text-to-speech request');
  
  const { text, speaker, includeTimings = false, speed = 1.0, volume = 1.0 } = req.body;

  if (!text) {
    console.log('Error: No text provided for text-to-speech');
    return res.status(400).json({ error: 'No text provided for text-to-speech' });
  }

  try {
    const result = await voicevoxService.generateSpeech(text, {
      speaker,
      includeTimings,
      speed,
      volume
    });

    if (includeTimings) {
      // Return JSON response with both audio and timing data
      res.json(result);
      console.log(`[VOICEVOX] Audio and timing data sent to client (${result.timings.length} timing points)`);
    } else {
      // Return audio data only
      res.set({
        'Content-Type': 'audio/wav',
        'Content-Length': result.byteLength,
        'Cache-Control': 'no-cache'
      });

      res.send(Buffer.from(result));
      console.log(`[VOICEVOX] Audio sent to client (${result.byteLength} bytes)`);
    }

  } catch (error) {
    console.error('[VOICEVOX] Text-to-speech error:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error.message,
      details: error.message
    });
  }
});

// Enhanced text-to-speech endpoint with MFA alignment
router.post('/enhanced', async (req, res) => {
  console.log('Received /api/text-to-speech/enhanced request');
  
  const { 
    text, 
    speaker, 
    speed = 1.0, 
    volume = 1.0, 
    useMFA = true, 
    language = 'japanese_mfa'
  } = req.body;

  if (!text) {
    console.log('Error: No text provided for enhanced text-to-speech');
    return res.status(400).json({ error: 'No text provided for enhanced text-to-speech' });
  }

  try {
    console.log(`[VOICEVOX+MFA] Processing enhanced TTS request with MFA: ${useMFA}`);
    
    const result = await voicevoxService.generateSpeechWithMFA(text, {
      speaker,
      speed,
      volume,
      useMFA,
      language
    });

    // Always return JSON response with enhanced timing data
    res.json({
      ...result,
      enhanced: true,
      timestamp: new Date().toISOString()
    });

    console.log(`[VOICEVOX+MFA] Enhanced audio and timing data sent to client`);
    console.log(`[VOICEVOX+MFA] Alignment method: ${result.alignment.method}`);
    console.log(`[VOICEVOX+MFA] Timing points: ${result.timings.length}`);

  } catch (error) {
    console.error('[VOICEVOX+MFA] Enhanced text-to-speech error:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error.message,
      details: error.message,
      enhanced: false
    });
  }
});

// Endpoint to compare alignment methods
router.post('/compare-alignment', async (req, res) => {
  console.log('Received /api/text-to-speech/compare-alignment request');
  
  const { text, speaker, speed = 1.0, volume = 1.0 } = req.body;

  if (!text) {
    console.log('Error: No text provided for alignment comparison');
    return res.status(400).json({ error: 'No text provided for alignment comparison' });
  }

  try {
    console.log('[ALIGNMENT-COMPARE] Running both VoiceVox and MFA alignment for comparison');
    
    // Generate with VoiceVox only
    const voiceVoxResult = await voicevoxService.generateSpeech(text, {
      speaker,
      includeTimings: true,
      speed,
      volume
    });

    // Generate with MFA enhancement
    const mfaResult = await voicevoxService.generateSpeechWithMFA(text, {
      speaker,
      speed,
      volume,
      useMFA: true
    });

    // Compare the results
    const comparison = voicevoxService.compareAlignments(
      voiceVoxResult.timings, 
      mfaResult.timings
    );

    res.json({
      voiceVoxOnly: {
        timings: voiceVoxResult.timings,
        stats: voicevoxService.getVoiceVoxAlignmentStats(voiceVoxResult.timings)
      },
      mfaEnhanced: {
        timings: mfaResult.timings,
        stats: mfaResult.alignment.stats,
        method: mfaResult.alignment.method
      },
      comparison: comparison,
      audio: mfaResult.audio, // Use the MFA-enhanced audio
      audioFormat: mfaResult.audioFormat,
      sampleRate: mfaResult.sampleRate,
      timestamp: new Date().toISOString()
    });

    console.log('[ALIGNMENT-COMPARE] Comparison completed and sent to client');

  } catch (error) {
    console.error('[ALIGNMENT-COMPARE] Comparison error:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error.message,
      details: error.message
    });
  }
});

export default router;
