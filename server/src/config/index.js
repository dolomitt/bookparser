import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

function normalizeBaseUrl(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return null;
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawValue)
    ? rawValue
    : `http://${rawValue}`;

  try {
    const parsed = new URL(withProtocol);
    if (!parsed.hostname) {
      return null;
    }
    const path = parsed.pathname && parsed.pathname !== '/'
      ? parsed.pathname.replace(/\/+$/, '')
      : '';
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return null;
  }
}

function parseOllamaBaseUrls(endpointsRaw, host, port) {
  const configured = String(endpointsRaw || '')
    .split(',')
    .map((entry) => normalizeBaseUrl(entry))
    .filter(Boolean);

  const deduped = Array.from(new Set(configured));
  if (deduped.length > 0) {
    return deduped;
  }

  const fallback = normalizeBaseUrl(`${host}:${port}`);
  return fallback ? [fallback] : ['http://127.0.0.1:11434'];
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseInteger(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const ollamaHost = process.env.BOOKPARSER_OLLAMA_HOST || '192.168.1.43';
const ollamaPort = process.env.BOOKPARSER_OLLAMA_PORT || '11434';
const openAiCompatibleEndpointRaw =
  process.env.BOOKPARSER_OPENAI_ENDPOINTS ||
  process.env.BOOKPARSER_AI_ENDPOINTS ||
  process.env.BOOKPARSER_OLLAMA_ENDPOINTS;
const openAiCompatibleHost = process.env.BOOKPARSER_OPENAI_HOST || ollamaHost;
const openAiCompatiblePort = process.env.BOOKPARSER_OPENAI_PORT || ollamaPort;
const ollamaBaseUrls = parseOllamaBaseUrls(
  openAiCompatibleEndpointRaw,
  openAiCompatibleHost,
  openAiCompatiblePort
).map((baseUrl) => (
  /\/v\d+(?:\/|$)/.test(baseUrl) ? baseUrl : `${baseUrl}/v1`
));
const disableThinkingRaw =
  process.env.BOOKPARSER_OPENAI_DISABLE_THINKING ??
  process.env.BOOKPARSER_AI_DISABLE_THINKING;
const disableThinking = disableThinkingRaw !== undefined
  ? parseBoolean(disableThinkingRaw, false)
  : process.env.BOOKPARSER_OLLAMA_THINK === 'false';
const openAiResponseFormat = (
  process.env.BOOKPARSER_OPENAI_RESPONSE_FORMAT ||
  process.env.BOOKPARSER_AI_RESPONSE_FORMAT ||
  'text'
).trim().toLowerCase();
const ttsProvider = (
  process.env.BOOKPARSER_TTS_PROVIDER ||
  process.env.TTS_PROVIDER ||
  'voicevox'
).trim().toLowerCase();
const fishSpeechBaseUrl = normalizeBaseUrl(
  process.env.FISH_SPEECH_BASE_URL ||
  `${process.env.FISH_SPEECH_HOST || '192.168.1.43'}:${process.env.FISH_SPEECH_PORT || '16580'}`
) || 'http://192.168.1.43:16580';
const s2ProBaseUrl = normalizeBaseUrl(
  process.env.S2_PRO_BASE_URL ||
  `${process.env.S2_PRO_HOST || '127.0.0.1'}:${process.env.S2_PRO_PORT || '3030'}`
) || 'http://127.0.0.1:3030';
const qwenAlignerBaseUrl = normalizeBaseUrl(
  process.env.QWEN_ALIGNER_BASE_URL ||
  `${process.env.QWEN_ALIGNER_HOST || '127.0.0.1'}:${process.env.QWEN_ALIGNER_PORT || '8050'}`
) || 'http://127.0.0.1:8050';

export const config = {
  port: process.env.PORT || 5000,
  uploadDir: process.env.UPLOAD_DIR || './imports',
  booksDir: process.env.BOOKS_DIR || './books',

  crawl4ai: {
    baseUrl: (process.env.CRAWL4AI_BASE_URL || '').replace(/\/+$/, ''),
    token: process.env.CRAWL4AI_TOKEN || '',
    timeout: parseInt(process.env.CRAWL4AI_TIMEOUT) || 60000
  },

  firecrawl: {
    apiKey: process.env.FIRECRAWL_API_KEY || '',
    apiUrl: (process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev/v2').replace(/\/+$/, ''),
    timeout: parseInt(process.env.FIRECRAWL_TIMEOUT) || 45000
  },

  tts: {
    provider: ['fish-speech', 'fish', 's2-pro', 's2cpp', 's2', 'voicevox'].includes(ttsProvider) ? ttsProvider : 'voicevox',
    alignmentProvider: (
      process.env.BOOKPARSER_TTS_ALIGNMENT_PROVIDER ||
      process.env.TTS_ALIGNMENT_PROVIDER ||
      'estimated'
    ).trim().toLowerCase(),
    cacheEnabled: parseBoolean(process.env.BOOKPARSER_TTS_CACHE_ENABLED, true),
    cacheMaxEntries: parseInt(process.env.BOOKPARSER_TTS_CACHE_MAX_ENTRIES) || 100
  },

  ollama: {
    provider: (process.env.BOOKPARSER_OPENAI_PROVIDER || process.env.BOOKPARSER_AI_PROVIDER || 'openai-compatible').trim().toLowerCase(),
    host: openAiCompatibleHost,
    port: openAiCompatiblePort,
    baseUrls: ollamaBaseUrls,
    apiKey: process.env.BOOKPARSER_OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.BOOKPARSER_AI_API_KEY || '',
    model: process.env.BOOKPARSER_OPENAI_MODEL || process.env.BOOKPARSER_AI_MODEL || process.env.BOOKPARSER_OLLAMA_MODEL || 'gemma3:12b',
    timeout: parseInt(process.env.BOOKPARSER_OPENAI_TIMEOUT || process.env.BOOKPARSER_OLLAMA_TIMEOUT) || 120000, // 120 seconds default
    healthTimeout: parseInt(process.env.BOOKPARSER_OPENAI_HEALTH_TIMEOUT || process.env.BOOKPARSER_OLLAMA_HEALTH_TIMEOUT) || 3000,
    healthCacheMs: parseInt(process.env.BOOKPARSER_OPENAI_HEALTH_CACHE_MS || process.env.BOOKPARSER_OLLAMA_HEALTH_CACHE_MS) || 3000,
    modelLoadTimeout: parseInt(process.env.BOOKPARSER_OPENAI_MODEL_LOAD_TIMEOUT || process.env.BOOKPARSER_OLLAMA_MODEL_LOAD_TIMEOUT) || 90000,
    modelLoadCacheMs: parseInt(process.env.BOOKPARSER_OPENAI_MODEL_LOAD_CACHE_MS || process.env.BOOKPARSER_OLLAMA_MODEL_LOAD_CACHE_MS) || 5000,
    maxRetries: parseInt(process.env.BOOKPARSER_OPENAI_MAX_RETRIES || process.env.BOOKPARSER_OLLAMA_MAX_RETRIES) || 2,
    maxTokens: parseInt(process.env.BOOKPARSER_OPENAI_MAX_TOKENS || process.env.BOOKPARSER_OLLAMA_MAX_TOKENS) || 10000, // Fixed response token limit
    analysisBaseMaxTokens: parseInt(process.env.BOOKPARSER_OPENAI_ANALYSIS_BASE_MAX_TOKENS || process.env.BOOKPARSER_AI_ANALYSIS_BASE_MAX_TOKENS) || 700,
    analysisMaxTokensPerToken: parseInt(process.env.BOOKPARSER_OPENAI_ANALYSIS_MAX_TOKENS_PER_TOKEN || process.env.BOOKPARSER_AI_ANALYSIS_MAX_TOKENS_PER_TOKEN) || 90,
    summaryMaxTokens: parseInt(process.env.BOOKPARSER_OPENAI_SUMMARY_MAX_TOKENS || process.env.BOOKPARSER_OLLAMA_SUMMARY_MAX_TOKENS) || 16000,
    logStats: parseBoolean(process.env.BOOKPARSER_OPENAI_LOG_STATS || process.env.BOOKPARSER_AI_LOG_STATS, false),
    disableThinking,
    responseFormat: ['text', 'json_object'].includes(openAiResponseFormat) ? openAiResponseFormat : 'text',
    contextMode: (process.env.BOOKPARSER_CONTEXT_MODE || 'full').toLowerCase(),
    aiTokenScope: (process.env.BOOKPARSER_AI_TOKEN_SCOPE || 'learner').toLowerCase(),
    contextWindow: parseInt(process.env.BOOKPARSER_CONTEXT_WINDOW || '', 10),
    get baseUrl() {
      return `http://${this.host}:${this.port}/v1`;
    }
  },

  voicevox: {
    host: process.env.VOICEVOX_HOST || '192.168.1.43',
    port: process.env.VOICEVOX_PORT || '50021',
    defaultSpeaker: process.env.VOICEVOX_DEFAULT_SPEAKER || '1',
    get baseUrl() {
      return `http://${this.host}:${this.port}`;
    }
  },

  fishSpeech: {
    baseUrl: fishSpeechBaseUrl,
    apiKey: process.env.FISH_SPEECH_API_KEY || '',
    referenceId: process.env.FISH_SPEECH_REFERENCE_ID || '',
    format: process.env.FISH_SPEECH_FORMAT || 'wav',
    timeout: parseInt(process.env.FISH_SPEECH_TIMEOUT) || 120000,
    sampleRate: parseInt(process.env.FISH_SPEECH_SAMPLE_RATE) || 44100,
    maxNewTokens: parseInt(process.env.FISH_SPEECH_MAX_NEW_TOKENS) || 1024,
    chunkLength: parseInt(process.env.FISH_SPEECH_CHUNK_LENGTH) || 200,
    topP: parseFloat(process.env.FISH_SPEECH_TOP_P) || 0.8,
    repetitionPenalty: parseFloat(process.env.FISH_SPEECH_REPETITION_PENALTY) || 1.1,
    temperature: parseFloat(process.env.FISH_SPEECH_TEMPERATURE) || 0.8,
    seed: parseInt(process.env.FISH_SPEECH_SEED || '20260514', 10),
    useMemoryCache: process.env.FISH_SPEECH_USE_MEMORY_CACHE || 'off'
  },

  s2Pro: {
    baseUrl: s2ProBaseUrl,
    timeout: parseInteger(process.env.S2_PRO_TIMEOUT, 180000),
    sampleRate: parseInteger(process.env.S2_PRO_SAMPLE_RATE, 44100),
    maxNewTokens: parseInteger(process.env.S2_PRO_MAX_NEW_TOKENS, 512),
    topP: parseNumber(process.env.S2_PRO_TOP_P, 0.8),
    topK: parseInteger(process.env.S2_PRO_TOP_K, 30),
    temperature: parseNumber(process.env.S2_PRO_TEMPERATURE, 0.8),
    minTokensBeforeEnd: parseInteger(process.env.S2_PRO_MIN_TOKENS_BEFORE_END, 0),
    threads: parseInteger(process.env.S2_PRO_THREADS, 4),
    enableSpeechTags: parseBoolean(process.env.S2_PRO_ENABLE_SPEECH_TAGS, true),
    referenceAudioPath: process.env.S2_PRO_REFERENCE_AUDIO_PATH || '',
    referenceText: process.env.S2_PRO_REFERENCE_TEXT || ''
  },

  mfa: {
    runtime: (process.env.MFA_RUNTIME || 'local').trim().toLowerCase(),
    command: process.env.MFA_COMMAND || 'mfa',
    dockerCommand: process.env.MFA_DOCKER_COMMAND || 'docker',
    dockerContainer: process.env.MFA_DOCKER_CONTAINER || '',
    dictionary: process.env.MFA_DICTIONARY || 'japanese_mfa',
    acousticModel: process.env.MFA_ACOUSTIC_MODEL || 'japanese_mfa',
    timeout: parseInt(process.env.MFA_TIMEOUT) || 120000
  },

  qwenAligner: {
    baseUrl: qwenAlignerBaseUrl,
    timeout: parseInt(process.env.QWEN_ALIGNER_TIMEOUT) || 180000,
    language: process.env.QWEN_ALIGNER_LANGUAGE || 'Japanese',
    fallbackToMfa: parseBoolean(process.env.QWEN_ALIGNER_FALLBACK_TO_MFA, false)
  }
};

// Log configuration on startup
export function logConfig() {
  console.log('Loaded configuration:');
  console.log('PORT:', config.port);
  console.log('UPLOAD_DIR:', config.uploadDir);
  console.log('BOOKS_DIR:', config.booksDir);
  console.log('CRAWL4AI_BASE_URL:', config.crawl4ai.baseUrl || '[not configured]');
  console.log('FIRECRAWL_API_URL:', config.firecrawl.apiUrl);
  console.log('FIRECRAWL_API_KEY:', config.firecrawl.apiKey ? '[configured]' : '[not configured]');
  console.log('BOOKPARSER_AI_PROVIDER:', config.ollama.provider);
  console.log('BOOKPARSER_OPENAI_BASE_URLS:', config.ollama.baseUrls.join(', '));
  console.log('BOOKPARSER_OPENAI_API_KEY:', config.ollama.apiKey ? '[configured]' : '[not configured]');
  console.log('BOOKPARSER_OPENAI_MODEL:', config.ollama.model);
  console.log('BOOKPARSER_OPENAI_TIMEOUT:', config.ollama.timeout + 'ms');
  console.log('BOOKPARSER_OPENAI_HEALTH_TIMEOUT:', config.ollama.healthTimeout + 'ms');
  console.log('BOOKPARSER_OPENAI_HEALTH_CACHE_MS:', config.ollama.healthCacheMs + 'ms');
  console.log('BOOKPARSER_OPENAI_MODEL_LOAD_TIMEOUT:', config.ollama.modelLoadTimeout + 'ms');
  console.log('BOOKPARSER_OPENAI_MODEL_LOAD_CACHE_MS:', config.ollama.modelLoadCacheMs + 'ms');
  console.log('BOOKPARSER_OPENAI_MAX_RETRIES:', config.ollama.maxRetries);
  console.log('BOOKPARSER_OPENAI_ANALYSIS_BASE_MAX_TOKENS:', config.ollama.analysisBaseMaxTokens);
  console.log('BOOKPARSER_OPENAI_ANALYSIS_MAX_TOKENS_PER_TOKEN:', config.ollama.analysisMaxTokensPerToken);
  console.log('BOOKPARSER_OPENAI_SUMMARY_MAX_TOKENS:', config.ollama.summaryMaxTokens);
  console.log('BOOKPARSER_OPENAI_LOG_STATS:', config.ollama.logStats);
  console.log('BOOKPARSER_OPENAI_DISABLE_THINKING:', config.ollama.disableThinking);
  console.log('BOOKPARSER_OPENAI_RESPONSE_FORMAT:', config.ollama.responseFormat);
  console.log('BOOKPARSER_CONTEXT_MODE:', config.ollama.contextMode);
  console.log('BOOKPARSER_AI_TOKEN_SCOPE:', config.ollama.aiTokenScope);
  if (!Number.isNaN(config.ollama.contextWindow)) {
    console.log('BOOKPARSER_CONTEXT_WINDOW:', config.ollama.contextWindow);
  }
  console.log('BOOKPARSER_TTS_PROVIDER:', config.tts.provider);
  console.log('BOOKPARSER_TTS_ALIGNMENT_PROVIDER:', config.tts.alignmentProvider);
  console.log('BOOKPARSER_TTS_CACHE_ENABLED:', config.tts.cacheEnabled);
  console.log('BOOKPARSER_TTS_CACHE_MAX_ENTRIES:', config.tts.cacheMaxEntries);
  console.log('VOICEVOX_HOST:', config.voicevox.host);
  console.log('VOICEVOX_PORT:', config.voicevox.port);
  console.log('VOICEVOX_DEFAULT_SPEAKER:', config.voicevox.defaultSpeaker);
  console.log('FISH_SPEECH_BASE_URL:', config.fishSpeech.baseUrl);
  console.log('FISH_SPEECH_API_KEY:', config.fishSpeech.apiKey ? '[configured]' : '[not configured]');
  console.log('FISH_SPEECH_REFERENCE_ID:', config.fishSpeech.referenceId || '[not configured]');
  console.log('FISH_SPEECH_SEED:', Number.isNaN(config.fishSpeech.seed) ? '[random]' : config.fishSpeech.seed);
  console.log('S2_PRO_BASE_URL:', config.s2Pro.baseUrl);
  console.log('S2_PRO_REFERENCE_AUDIO_PATH:', config.s2Pro.referenceAudioPath || '[not configured]');
  console.log('S2_PRO_TEMPERATURE:', config.s2Pro.temperature);
  console.log('S2_PRO_TOP_P:', config.s2Pro.topP);
  console.log('S2_PRO_TOP_K:', config.s2Pro.topK);
  console.log('MFA_COMMAND:', config.mfa.command);
  console.log('MFA_RUNTIME:', config.mfa.runtime);
  console.log('MFA_DOCKER_CONTAINER:', config.mfa.dockerContainer || '[not configured]');
  console.log('MFA_DICTIONARY:', config.mfa.dictionary);
  console.log('MFA_ACOUSTIC_MODEL:', config.mfa.acousticModel);
  console.log('QWEN_ALIGNER_BASE_URL:', config.qwenAligner.baseUrl);
  console.log('QWEN_ALIGNER_LANGUAGE:', config.qwenAligner.language);
  console.log('QWEN_ALIGNER_FALLBACK_TO_MFA:', config.qwenAligner.fallbackToMfa);
}
