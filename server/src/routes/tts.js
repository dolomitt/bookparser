import express from 'express';
import { config } from '../config/index.js';
import fishSpeechService from '../services/fishSpeechService.js';
import s2ProService from '../services/s2ProService.js';
import voicevoxService from '../services/voicevoxService.js';

const router = express.Router();
const ttsCache = new Map();
const ttsInFlight = new Map();
const ttsProviderMap = {
  'fish-speech': { label: 'Fish Speech', service: fishSpeechService },
  fish: { label: 'Fish Speech', service: fishSpeechService },
  's2-pro': { label: 'S2 Pro', service: s2ProService },
  s2cpp: { label: 'S2 Pro', service: s2ProService },
  s2: { label: 'S2 Pro', service: s2ProService },
  voicevox: { label: 'VOICEVOX', service: voicevoxService }
};
const selectedTtsProvider = ttsProviderMap[config.tts.provider] || ttsProviderMap.voicevox;
const ttsService = selectedTtsProvider.service;
const ttsProviderLabel = selectedTtsProvider.label;

function normalizeSpeechTagsForCache(speechTags) {
  return (Array.isArray(speechTags) ? speechTags : [speechTags])
    .map((tag) => String(tag || '').trim())
    .filter(Boolean);
}

function normalizeTextForCache(text) {
  return String(text || '')
    .replace(/\u30FB/g, '')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTtsCacheKey({ text, speaker, referenceId, speechTags, includeTimings, speed, volume }) {
  const provider = config.tts.provider;
  const isS2Provider = ['s2-pro', 's2cpp', 's2'].includes(provider);

  return JSON.stringify({
    provider: config.tts.provider,
    alignmentProvider: config.tts.alignmentProvider,
    text: normalizeTextForCache(text),
    speaker: isS2Provider ? '' : String(speaker || ''),
    referenceId: isS2Provider ? '' : String(referenceId || ''),
    speechTags: normalizeSpeechTagsForCache(speechTags),
    includeTimings: Boolean(includeTimings),
    speed: isS2Provider ? 1 : Number(speed) || 1,
    volume: isS2Provider ? 1 : Number(volume) || 1,
    fishReferenceId: config.fishSpeech.referenceId || '',
    fishSeed: Number.isNaN(config.fishSpeech.seed) ? 'random' : config.fishSpeech.seed,
    fishTemperature: config.fishSpeech.temperature,
    fishTopP: config.fishSpeech.topP,
    s2Temperature: config.s2Pro.temperature,
    s2TopP: config.s2Pro.topP,
    s2TopK: config.s2Pro.topK,
    s2MaxNewTokens: config.s2Pro.maxNewTokens,
    s2ReferenceAudioPath: config.s2Pro.referenceAudioPath || '',
    s2ReferenceText: config.s2Pro.referenceText || ''
  });
}

function cloneCachedResult(result) {
  if (Buffer.isBuffer(result)) {
    return Buffer.from(result);
  }

  if (result instanceof ArrayBuffer) {
    return result.slice(0);
  }

  return JSON.parse(JSON.stringify(result));
}

function getCachedTtsResult(cacheKey) {
  if (!config.tts.cacheEnabled || !ttsCache.has(cacheKey)) {
    return null;
  }

  const cached = ttsCache.get(cacheKey);
  ttsCache.delete(cacheKey);
  ttsCache.set(cacheKey, cached);
  return cloneCachedResult(cached.result);
}

function setCachedTtsResult(cacheKey, result) {
  if (!config.tts.cacheEnabled || config.tts.cacheMaxEntries <= 0) {
    return;
  }

  ttsCache.set(cacheKey, {
    createdAt: Date.now(),
    result: cloneCachedResult(result)
  });

  while (ttsCache.size > config.tts.cacheMaxEntries) {
    const oldestKey = ttsCache.keys().next().value;
    ttsCache.delete(oldestKey);
  }
}

// Text-to-speech endpoint using the configured TTS provider with timing data
router.post('/', async (req, res) => {
  console.log('Received /api/text-to-speech request');
  
  const { text, speaker, referenceId, speechTags, includeTimings = false, speed = 1.0, volume = 1.0 } = req.body;

  if (!text) {
    console.log('Error: No text provided for text-to-speech');
    return res.status(400).json({ error: 'No text provided for text-to-speech' });
  }

  try {
    const cacheKey = buildTtsCacheKey({ text, speaker, referenceId, speechTags, includeTimings, speed, volume });
    let result = getCachedTtsResult(cacheKey);
    const cacheHit = Boolean(result);

    if (cacheHit) {
      console.log(`[${ttsProviderLabel}] TTS cache hit`);
    } else if (ttsInFlight.has(cacheKey)) {
      console.log(`[${ttsProviderLabel}] TTS in-flight cache join`);
      result = await ttsInFlight.get(cacheKey);
    } else {
      const generationPromise = ttsService.generateSpeech(text, {
        speaker,
        referenceId,
        speechTags,
        includeTimings,
        speed,
        volume
      }).then((generatedResult) => {
        setCachedTtsResult(cacheKey, generatedResult);
        console.log(`[${ttsProviderLabel}] TTS cache stored (${ttsCache.size} entries)`);
        return generatedResult;
      }).finally(() => {
        ttsInFlight.delete(cacheKey);
      });

      ttsInFlight.set(cacheKey, generationPromise);
      result = await generationPromise;
    }

    if (includeTimings) {
      // Return JSON response with both audio and timing data
      res.json(result);
      console.log(`[${ttsProviderLabel}] Audio and timing data sent to client (${result.timings.length} timing points${cacheHit ? ', cached' : ''})`);
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
