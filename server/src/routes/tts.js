import express from 'express';
import { config } from '../config/index.js';
import fishSpeechService from '../services/fishSpeechService.js';
import voicevoxService from '../services/voicevoxService.js';

const router = express.Router();
const ttsService = ['fish-speech', 'fish'].includes(config.tts.provider)
  ? fishSpeechService
  : voicevoxService;
const ttsProviderLabel = ['fish-speech', 'fish'].includes(config.tts.provider)
  ? 'Fish Speech'
  : 'VOICEVOX';

// Text-to-speech endpoint using the configured TTS provider with timing data
router.post('/', async (req, res) => {
  console.log('Received /api/text-to-speech request');
  
  const { text, speaker, referenceId, speechTags, includeTimings = false, speed = 1.0, volume = 1.0 } = req.body;

  if (!text) {
    console.log('Error: No text provided for text-to-speech');
    return res.status(400).json({ error: 'No text provided for text-to-speech' });
  }

  try {
    const result = await ttsService.generateSpeech(text, {
      speaker,
      referenceId,
      speechTags,
      includeTimings,
      speed,
      volume
    });

    if (includeTimings) {
      // Return JSON response with both audio and timing data
      res.json(result);
      console.log(`[${ttsProviderLabel}] Audio and timing data sent to client (${result.timings.length} timing points)`);
    } else {
      // Return audio data only
      res.set({
        'Content-Type': 'audio/wav',
        'Content-Length': result.byteLength,
        'Cache-Control': 'no-cache'
      });

      res.send(Buffer.from(result));
      console.log(`[${ttsProviderLabel}] Audio sent to client (${result.byteLength} bytes)`);
    }

  } catch (error) {
    console.error(`[${ttsProviderLabel}] Text-to-speech error:`, error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error.message,
      details: error.message
    });
  }
});


export default router;
