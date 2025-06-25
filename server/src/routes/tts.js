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


export default router;
