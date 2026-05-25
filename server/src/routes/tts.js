import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
const pageTtsTasks = new Map();
const PAGE_TTS_TASK_LOG_LIMIT = 250;
const ttsDiskCacheDir = path.resolve(config.booksDir, '.tts-cache');

if (!fs.existsSync(ttsDiskCacheDir)) {
  fs.mkdirSync(ttsDiskCacheDir, { recursive: true });
}

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

function buildTtsCacheKey({ text, speaker, referenceId, speechTags, speed, volume }) {
  const provider = config.tts.provider;
  const isS2Provider = ['s2-pro', 's2cpp', 's2'].includes(provider);

  return JSON.stringify({
    provider: config.tts.provider,
    alignmentProvider: config.tts.alignmentProvider,
    text: normalizeTextForCache(text),
    speaker: isS2Provider ? '' : String(speaker || ''),
    referenceId: isS2Provider ? '' : String(referenceId || ''),
    speechTags: normalizeSpeechTagsForCache(speechTags),
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

function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  return null;
}

function convertCachedTtsResultForRequest(result, includeTimings = false) {
  if (includeTimings) {
    return result && typeof result === 'object' && typeof result.audio === 'string'
      ? cloneCachedResult(result)
      : null;
  }

  const buffer = toBuffer(result);
  if (buffer) {
    return Buffer.from(buffer);
  }

  if (result && typeof result === 'object' && typeof result.audio === 'string') {
    return Buffer.from(result.audio, 'base64');
  }

  return null;
}

function getDiskCacheBasePath(cacheKey) {
  const hash = crypto.createHash('sha256').update(cacheKey).digest('hex');
  return path.join(ttsDiskCacheDir, hash);
}

function getDiskCachePaths(cacheKey) {
  const basePath = getDiskCacheBasePath(cacheKey);
  return {
    metaPath: `${basePath}.json`,
    audioPath: `${basePath}.bin`
  };
}

function serializeDiskTtsResult(result) {
  const buffer = toBuffer(result);
  if (buffer) {
    return {
      meta: {
        kind: 'binary'
      },
      audioBuffer: buffer
    };
  }

  if (result && typeof result === 'object' && typeof result.audio === 'string') {
    return {
      meta: {
        kind: 'timed',
        payload: {
          ...result,
          audio: undefined
        }
      },
      audioBuffer: Buffer.from(result.audio, 'base64')
    };
  }

  return null;
}

function deserializeDiskTtsResult(meta, audioBuffer) {
  if (!meta || !audioBuffer) {
    return null;
  }

  if (meta.kind === 'binary') {
    return Buffer.from(audioBuffer);
  }

  if (meta.kind === 'timed') {
    return {
      ...(meta.payload || {}),
      audio: Buffer.from(audioBuffer).toString('base64')
    };
  }

  return null;
}

function getPersistentTtsResult(cacheKey) {
  const { metaPath, audioPath } = getDiskCachePaths(cacheKey);
  if (!fs.existsSync(metaPath) || !fs.existsSync(audioPath)) {
    return null;
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const audioBuffer = fs.readFileSync(audioPath);
    return deserializeDiskTtsResult(meta, audioBuffer);
  } catch (error) {
    console.warn(`[${ttsProviderLabel}] Failed to read TTS disk cache:`, error.message);
    return null;
  }
}

function setPersistentTtsResult(cacheKey, result) {
  const serialized = serializeDiskTtsResult(result);
  if (!serialized) {
    return;
  }

  const { metaPath, audioPath } = getDiskCachePaths(cacheKey);
  try {
    fs.writeFileSync(audioPath, serialized.audioBuffer);
    fs.writeFileSync(metaPath, JSON.stringify({
      ...serialized.meta,
      storedAt: new Date().toISOString()
    }, null, 2), 'utf-8');
  } catch (error) {
    console.warn(`[${ttsProviderLabel}] Failed to write TTS disk cache:`, error.message);
  }
}

function getCachedTtsResult(cacheKey, includeTimings = false) {
  if (!config.tts.cacheEnabled) {
    return null;
  }

  if (ttsCache.has(cacheKey)) {
    const cached = ttsCache.get(cacheKey);
    ttsCache.delete(cacheKey);
    ttsCache.set(cacheKey, cached);
    return convertCachedTtsResultForRequest(cached.result, includeTimings);
  }

  const persistentResult = getPersistentTtsResult(cacheKey);
  if (persistentResult != null) {
    setCachedTtsResult(cacheKey, persistentResult);
    return convertCachedTtsResultForRequest(persistentResult, includeTimings);
  }

  return null;
}

function setCachedTtsResult(cacheKey, result) {
  if (!config.tts.cacheEnabled || config.tts.cacheMaxEntries <= 0) {
    return;
  }

  const existing = ttsCache.get(cacheKey)?.result || null;
  const shouldKeepExistingTimed =
    existing &&
    typeof existing === 'object' &&
    typeof existing.audio === 'string' &&
    !(result && typeof result === 'object' && typeof result.audio === 'string');
  const valueToStore = shouldKeepExistingTimed ? existing : result;

  ttsCache.set(cacheKey, {
    createdAt: Date.now(),
    result: cloneCachedResult(valueToStore)
  });

  while (ttsCache.size > config.tts.cacheMaxEntries) {
    const oldestKey = ttsCache.keys().next().value;
    ttsCache.delete(oldestKey);
  }
}

function persistTtsResult(cacheKey, result) {
  if (!config.tts.cacheEnabled) {
    return;
  }

  const existingPersistent = getPersistentTtsResult(cacheKey);
  const shouldKeepExistingTimed =
    existingPersistent &&
    typeof existingPersistent === 'object' &&
    typeof existingPersistent.audio === 'string' &&
    !(result && typeof result === 'object' && typeof result.audio === 'string');
  const valueToStore = shouldKeepExistingTimed ? existingPersistent : result;

  setCachedTtsResult(cacheKey, valueToStore);
  setPersistentTtsResult(cacheKey, valueToStore);
}

async function generateTtsResult({ text, speaker, referenceId, speechTags, includeTimings = false, speed = 1.0, volume = 1.0 }) {
  const cacheKey = buildTtsCacheKey({ text, speaker, referenceId, speechTags, speed, volume });
  let result = getCachedTtsResult(cacheKey, includeTimings);
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
      persistTtsResult(cacheKey, generatedResult);
      console.log(`[${ttsProviderLabel}] TTS cache stored (${ttsCache.size} entries)`);
      return generatedResult;
    }).finally(() => {
      ttsInFlight.delete(cacheKey);
    });

    ttsInFlight.set(cacheKey, generationPromise);
    result = await generationPromise;
  }

  return { result, cacheHit };
}

function getPageTtsTaskSnapshot(task) {
  if (!task) return null;

  return {
    draftFilename: task.draftFilename,
    currentPage: task.currentPage,
    status: task.status,
    totalSentences: task.totalSentences,
    generatedCount: task.generatedCount,
    errorCount: task.errorCount,
    completedCount: task.generatedCount + task.errorCount,
    activeSentenceIndex: Number.isInteger(task.activeSentenceIndex) ? task.activeSentenceIndex : null,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt || null,
    logs: Array.isArray(task.logs) ? task.logs : [],
    lastError: task.lastError || null
  };
}

function writeSseEvent(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastPageTtsTask(task, event, data) {
  for (const client of task.clients) {
    writeSseEvent(client, event, data);
  }
}

function pushPageTtsTaskLog(task, message, extras = {}) {
  const entry = {
    at: new Date().toISOString(),
    message: String(message || ''),
    ...extras
  };
  task.logs.push(entry);
  if (task.logs.length > PAGE_TTS_TASK_LOG_LIMIT) {
    task.logs.splice(0, task.logs.length - PAGE_TTS_TASK_LOG_LIMIT);
  }
  task.updatedAt = entry.at;
  broadcastPageTtsTask(task, 'log', entry);
  broadcastPageTtsTask(task, 'snapshot', getPageTtsTaskSnapshot(task));
}

function createPageTtsTask(params) {
  const task = {
    draftFilename: params.draftFilename,
    currentPage: params.currentPage,
    status: 'running',
    sentenceRequests: params.sentenceRequests,
    ttsOptions: params.ttsOptions || {},
    totalSentences: params.sentenceRequests.length,
    generatedCount: 0,
    errorCount: 0,
    activeSentenceIndex: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
    logs: [],
    clients: new Set()
  };
  pageTtsTasks.set(task.draftFilename, task);
  return task;
}

async function runPageTtsTask(task) {
  pushPageTtsTaskLog(task, `Starting audio generation for page ${task.currentPage}: 0/${task.totalSentences}`);

  try {
    for (const sentenceRequest of task.sentenceRequests) {
      const { sentenceIndex, text, speechTags = [] } = sentenceRequest;
      task.activeSentenceIndex = sentenceIndex;
      task.updatedAt = new Date().toISOString();
      broadcastPageTtsTask(task, 'snapshot', getPageTtsTaskSnapshot(task));

      pushPageTtsTaskLog(task, `Generating audio for sentence ${sentenceIndex}...`, {
        kind: 'status',
        sentenceIndex
      });

      try {
        await generateTtsResult({
          text,
          speaker: task.ttsOptions.speaker,
          referenceId: task.ttsOptions.referenceId,
          speechTags,
          includeTimings: true,
          speed: task.ttsOptions.speed,
          volume: task.ttsOptions.volume
        });

        task.generatedCount += 1;
        task.updatedAt = new Date().toISOString();
        broadcastPageTtsTask(task, 'sentence-complete', {
          sentenceIndex,
          metrics: getPageTtsTaskSnapshot(task)
        });
        pushPageTtsTaskLog(task, `Generated audio for sentence ${sentenceIndex}`, {
          kind: 'result',
          sentenceIndex
        });
      } catch (error) {
        task.errorCount += 1;
        pushPageTtsTaskLog(task, `Error on sentence ${sentenceIndex}: ${error.message || 'unknown error'}`, {
          kind: 'error',
          sentenceIndex
        });
      }
    }

    task.status = 'completed';
    task.activeSentenceIndex = null;
    task.finishedAt = new Date().toISOString();
    task.updatedAt = task.finishedAt;
    broadcastPageTtsTask(task, 'snapshot', getPageTtsTaskSnapshot(task));
    broadcastPageTtsTask(task, 'done', getPageTtsTaskSnapshot(task));
  } catch (error) {
    task.status = 'failed';
    task.activeSentenceIndex = null;
    task.finishedAt = new Date().toISOString();
    task.updatedAt = task.finishedAt;
    task.lastError = error.message || 'Task failed';
    pushPageTtsTaskLog(task, `Task failed: ${task.lastError}`, { kind: 'error' });
    broadcastPageTtsTask(task, 'failed', getPageTtsTaskSnapshot(task));
  }
}

router.get('/draft/:filename/page-task', (req, res) => {
  res.json({
    task: getPageTtsTaskSnapshot(pageTtsTasks.get(req.params.filename))
  });
});

router.get('/draft/:filename/page-task/stream', (req, res) => {
  const task = pageTtsTasks.get(req.params.filename);
  if (!task) {
    return res.status(404).json({ error: 'No audio page task found for this draft' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  if (req.socket && typeof req.socket.setNoDelay === 'function') {
    req.socket.setNoDelay(true);
  }

  task.clients.add(res);
  writeSseEvent(res, 'snapshot', getPageTtsTaskSnapshot(task));

  const keepAliveTimer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 3000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    task.clients.delete(res);
  });
});

router.post('/draft/:filename/page-task', async (req, res) => {
  const currentPage = Number.parseInt(req.body?.currentPage, 10);
  const sentenceRequests = Array.isArray(req.body?.sentenceRequests)
    ? req.body.sentenceRequests
      .map((item) => ({
        sentenceIndex: Number.parseInt(item?.sentenceIndex, 10),
        text: String(item?.text || ''),
        speechTags: normalizeSpeechTagsForCache(item?.speechTags)
      }))
      .filter((item) => Number.isInteger(item.sentenceIndex) && item.sentenceIndex >= 0 && item.text.trim())
    : [];

  if (!Number.isInteger(currentPage) || currentPage < 1) {
    return res.status(400).json({ error: 'Invalid currentPage' });
  }

  if (sentenceRequests.length === 0) {
    return res.status(400).json({ error: 'No sentences provided for audio page task' });
  }

  const existingTask = pageTtsTasks.get(req.params.filename);
  if (existingTask?.status === 'running') {
    return res.json({
      task: getPageTtsTaskSnapshot(existingTask),
      alreadyRunning: true
    });
  }

  const task = createPageTtsTask({
    draftFilename: req.params.filename,
    currentPage,
    sentenceRequests,
    ttsOptions: req.body?.ttsOptions || {}
  });

  runPageTtsTask(task).catch((error) => {
    console.error(`[${ttsProviderLabel}] Unhandled page audio task error:`, error);
  });

  res.status(202).json({
    task: getPageTtsTaskSnapshot(task),
    alreadyRunning: false
  });
});

// Text-to-speech endpoint using the configured TTS provider with timing data
router.post('/', async (req, res) => {
  console.log('Received /api/text-to-speech request');
  
  const { text, speaker, referenceId, speechTags, includeTimings = false, speed = 1.0, volume = 1.0 } = req.body;

  if (!text) {
    console.log('Error: No text provided for text-to-speech');
    return res.status(400).json({ error: 'No text provided for text-to-speech' });
  }

  try {
    const { result, cacheHit } = await generateTtsResult({
      text,
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
