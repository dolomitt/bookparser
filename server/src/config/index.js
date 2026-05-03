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
    return `${parsed.protocol}//${parsed.host}`;
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

const ollamaHost = process.env.BOOKPARSER_OLLAMA_HOST || '192.168.1.43';
const ollamaPort = process.env.BOOKPARSER_OLLAMA_PORT || '11434';
const ollamaBaseUrls = parseOllamaBaseUrls(process.env.BOOKPARSER_OLLAMA_ENDPOINTS, ollamaHost, ollamaPort);

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

  ollama: {
    host: ollamaHost,
    port: ollamaPort,
    baseUrls: ollamaBaseUrls,
    model: process.env.BOOKPARSER_OLLAMA_MODEL || 'gemma3:12b',
    timeout: parseInt(process.env.BOOKPARSER_OLLAMA_TIMEOUT) || 120000, // 120 seconds default
    healthTimeout: parseInt(process.env.BOOKPARSER_OLLAMA_HEALTH_TIMEOUT) || 3000,
    healthCacheMs: parseInt(process.env.BOOKPARSER_OLLAMA_HEALTH_CACHE_MS) || 3000,
    modelLoadTimeout: parseInt(process.env.BOOKPARSER_OLLAMA_MODEL_LOAD_TIMEOUT) || 90000,
    modelLoadCacheMs: parseInt(process.env.BOOKPARSER_OLLAMA_MODEL_LOAD_CACHE_MS) || 5000,
    maxRetries: parseInt(process.env.BOOKPARSER_OLLAMA_MAX_RETRIES) || 2,
    maxTokens: parseInt(process.env.BOOKPARSER_OLLAMA_MAX_TOKENS) || 10000, // Fixed response token limit
    summaryMaxTokens: parseInt(process.env.BOOKPARSER_OLLAMA_SUMMARY_MAX_TOKENS) || 16000,
    contextMode: (process.env.BOOKPARSER_CONTEXT_MODE || 'full').toLowerCase(),
    contextWindow: parseInt(process.env.BOOKPARSER_CONTEXT_WINDOW || '', 10),
    get baseUrl() {
      return `http://${this.host}:${this.port}`;
    }
  },

  voicevox: {
    host: process.env.VOICEVOX_HOST || '192.168.1.43',
    port: process.env.VOICEVOX_PORT || '50021',
    defaultSpeaker: process.env.VOICEVOX_DEFAULT_SPEAKER || '1',
    get baseUrl() {
      return `http://${this.host}:${this.port}`;
    }
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
  console.log('BOOKPARSER_OLLAMA_HOST:', config.ollama.host);
  console.log('BOOKPARSER_OLLAMA_PORT:', config.ollama.port);
  console.log('BOOKPARSER_OLLAMA_BASE_URLS:', config.ollama.baseUrls.join(', '));
  console.log('BOOKPARSER_OLLAMA_MODEL:', config.ollama.model);
  console.log('BOOKPARSER_OLLAMA_TIMEOUT:', config.ollama.timeout + 'ms');
  console.log('BOOKPARSER_OLLAMA_HEALTH_TIMEOUT:', config.ollama.healthTimeout + 'ms');
  console.log('BOOKPARSER_OLLAMA_HEALTH_CACHE_MS:', config.ollama.healthCacheMs + 'ms');
  console.log('BOOKPARSER_OLLAMA_MODEL_LOAD_TIMEOUT:', config.ollama.modelLoadTimeout + 'ms');
  console.log('BOOKPARSER_OLLAMA_MODEL_LOAD_CACHE_MS:', config.ollama.modelLoadCacheMs + 'ms');
  console.log('BOOKPARSER_OLLAMA_MAX_RETRIES:', config.ollama.maxRetries);
  console.log('BOOKPARSER_OLLAMA_SUMMARY_MAX_TOKENS:', config.ollama.summaryMaxTokens);
  console.log('BOOKPARSER_CONTEXT_MODE:', config.ollama.contextMode);
  if (!Number.isNaN(config.ollama.contextWindow)) {
    console.log('BOOKPARSER_CONTEXT_WINDOW:', config.ollama.contextWindow);
  }
  console.log('VOICEVOX_HOST:', config.voicevox.host);
  console.log('VOICEVOX_PORT:', config.voicevox.port);
  console.log('VOICEVOX_DEFAULT_SPEAKER:', config.voicevox.defaultSpeaker);
}
