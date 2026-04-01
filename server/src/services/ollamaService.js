import { config } from '../config/index.js';

const COMPACT_PROMPT_POS = new Set([
  '名詞',
  '動詞',
  '形容詞',
  '副詞',
  '連体詞',
  '接続詞',
  '助詞',
  '助動詞'
]);

function extractJsonObjectsFromBuffer(buffer) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastConsumed = 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];

    if (start === -1) {
      if (ch === '{') {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        objects.push(buffer.slice(start, i + 1));
        lastConsumed = i + 1;
        start = -1;
      }
    }
  }

  return {
    objects,
    remaining: buffer.slice(lastConsumed)
  };
}

class OllamaService {
  constructor() {
    this.baseUrls = Array.isArray(config.ollama.baseUrls) && config.ollama.baseUrls.length > 0
      ? [...config.ollama.baseUrls]
      : [config.ollama.baseUrl];
    this.baseUrl = this.baseUrls[0];
    this.nextBaseUrlIndex = 0;
    this.model = config.ollama.model;
    this.timeout = config.ollama.timeout;
    this.healthCheckTimeout = config.ollama.healthTimeout;
    this.healthCacheMs = config.ollama.healthCacheMs;
    this.modelLoadTimeout = config.ollama.modelLoadTimeout;
    this.modelLoadCacheMs = config.ollama.modelLoadCacheMs;
    this.maxRetries = config.ollama.maxRetries;
    this.maxTokens = config.ollama.maxTokens;
    this.verboseLogs = process.env.BOOKPARSER_VERBOSE_LOGS === 'true';
    this.healthStatusByBaseUrl = new Map();
    this.inFlightByBaseUrl = new Map(this.baseUrls.map((baseUrl) => [baseUrl, 0]));
    this.serverAvailabilityWaiters = [];
    this.modelLoadedStatusByBaseUrl = new Map();
    this.modelLoadInFlightByBaseUrl = new Map();
    this.contextMode = config.ollama.contextMode === 'compact' ? 'compact' : 'full';
    const thinkEnv = process.env.BOOKPARSER_OLLAMA_THINK;
    this.think = thinkEnv !== undefined
      ? (thinkEnv === 'true' ? true : thinkEnv === 'false' ? false : thinkEnv)
      : false;
  }

  log(...args) {
    if (this.verboseLogs) {
      console.log(...args);
    }
  }

  getRotatedBaseUrls() {
    if (this.baseUrls.length <= 1) {
      return [...this.baseUrls];
    }

    const startIndex = this.nextBaseUrlIndex % this.baseUrls.length;
    this.nextBaseUrlIndex = (startIndex + 1) % this.baseUrls.length;
    return [
      ...this.baseUrls.slice(startIndex),
      ...this.baseUrls.slice(0, startIndex)
    ];
  }

  getBaseUrlForAttempt(rotatedBaseUrls, attempt) {
    if (!Array.isArray(rotatedBaseUrls) || rotatedBaseUrls.length === 0) {
      return this.baseUrl;
    }

    const index = (attempt - 1) % rotatedBaseUrls.length;
    return rotatedBaseUrls[index];
  }

  isHealthStatusFresh(entry) {
    if (!entry || typeof entry.checkedAt !== 'number') {
      return false;
    }
    return (Date.now() - entry.checkedAt) <= this.healthCacheMs;
  }

  setHealthStatus(baseUrl, healthy, reason = '') {
    this.healthStatusByBaseUrl.set(baseUrl, {
      healthy: Boolean(healthy),
      reason: String(reason || ''),
      checkedAt: Date.now()
    });
  }

  isModelLoadedStatusFresh(entry) {
    if (!entry || typeof entry.checkedAt !== 'number') {
      return false;
    }
    return (Date.now() - entry.checkedAt) <= this.modelLoadCacheMs;
  }

  setModelLoadedStatus(baseUrl, loaded, reason = '') {
    this.modelLoadedStatusByBaseUrl.set(baseUrl, {
      loaded: Boolean(loaded),
      reason: String(reason || ''),
      checkedAt: Date.now()
    });
  }

  isTargetModelRunning(models = []) {
    const expected = String(this.model || '').trim();
    if (!expected) {
      return false;
    }

    return models.some((model) => {
      const candidates = [
        model?.name,
        model?.model
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

      return candidates.includes(expected);
    });
  }

  async checkModelLoaded(baseUrl, { force = false } = {}) {
    const cached = this.modelLoadedStatusByBaseUrl.get(baseUrl);
    if (!force && this.isModelLoadedStatusFresh(cached)) {
      return cached.loaded;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.healthCheckTimeout);

    try {
      const response = await fetch(`${baseUrl}/api/ps`, { signal: controller.signal });
      if (!response.ok) {
        this.setModelLoadedStatus(baseUrl, false, `ps returned ${response.status}`);
        return false;
      }

      const data = await response.json();
      const loaded = this.isTargetModelRunning(Array.isArray(data?.models) ? data.models : []);
      this.setModelLoadedStatus(
        baseUrl,
        loaded,
        loaded ? '' : `model "${this.model}" not loaded`
      );
      return loaded;
    } catch (error) {
      this.setModelLoadedStatus(baseUrl, false, error?.message || 'model load check failed');
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async warmupModel(baseUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.modelLoadTimeout);

    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: ' ',
          stream: false,
          keep_alive: '10m',
          options: {
            num_predict: 0,
            temperature: 0
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`warmup failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      this.setModelLoadedStatus(baseUrl, true);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async ensureModelLoaded(baseUrl) {
    const alreadyLoaded = await this.checkModelLoaded(baseUrl);
    if (alreadyLoaded) {
      return;
    }

    const inFlight = this.modelLoadInFlightByBaseUrl.get(baseUrl);
    if (inFlight) {
      await inFlight;
      return;
    }

    const loadPromise = (async () => {
      try {
        this.log(`[Ollama] Model "${this.model}" is not loaded on ${baseUrl}; warming up before timed request...`);
        await this.warmupModel(baseUrl);
        const isLoadedAfterWarmup = await this.checkModelLoaded(baseUrl, { force: true });
        if (!isLoadedAfterWarmup) {
          const reason = this.modelLoadedStatusByBaseUrl.get(baseUrl)?.reason || 'unknown reason';
          throw new Error(`model "${this.model}" still not loaded after warmup (${reason})`);
        }
      } catch (error) {
        this.setModelLoadedStatus(baseUrl, false, error?.message || 'warmup failed');
        throw error;
      } finally {
        this.modelLoadInFlightByBaseUrl.delete(baseUrl);
      }
    })();

    this.modelLoadInFlightByBaseUrl.set(baseUrl, loadPromise);
    await loadPromise;
  }

  getOrderedBaseUrlsForAttempt(baseUrls, attempt = 1) {
    if (!Array.isArray(baseUrls) || baseUrls.length === 0) {
      return [];
    }

    if (baseUrls.length === 1) {
      return [...baseUrls];
    }

    const shift = (attempt - 1) % baseUrls.length;
    return [
      ...baseUrls.slice(shift),
      ...baseUrls.slice(0, shift)
    ];
  }

  async generateOnBaseUrl(baseUrl, payload, requestType = 'analysis') {
    await this.ensureModelLoaded(baseUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const startedAt = Date.now();
    console.log(`[Ollama] -> ${requestType} ${baseUrl}`);

    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.setHealthStatus(baseUrl, false, `${requestType} returned ${response.status}`);
        throw new Error(`${baseUrl}: HTTP ${response.status} ${response.statusText} - ${errorText}`);
      }

      this.setHealthStatus(baseUrl, true);
      const durationMs = Date.now() - startedAt;
      console.log(`[Ollama] <- ${requestType} ${baseUrl} (${durationMs}ms)`);
      return response;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (error.name === 'AbortError') {
        this.setHealthStatus(baseUrl, false, `${requestType} timeout`);
        console.warn(`[Ollama] xx ${requestType} ${baseUrl} timeout (${durationMs}ms)`);
        throw new Error(`${baseUrl}: request timed out after ${this.timeout / 1000} seconds`);
      }

      if (error.code === 'ECONNREFUSED' || /fetch failed/i.test(error.message || '')) {
        this.setHealthStatus(baseUrl, false, error.message);
      }
      console.warn(`[Ollama] xx ${requestType} ${baseUrl} failed (${durationMs}ms): ${error.message || 'request failed'}`);

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  waitForServerAvailability() {
    return new Promise((resolve) => {
      this.serverAvailabilityWaiters.push(resolve);
    });
  }

  notifyServerAvailability() {
    if (this.serverAvailabilityWaiters.length === 0) {
      return;
    }
    const waiters = this.serverAvailabilityWaiters.splice(0, this.serverAvailabilityWaiters.length);
    for (const resolve of waiters) {
      resolve();
    }
  }

  async reserveLeastLoadedBaseUrl(baseUrls) {
    const candidates = Array.from(new Set(baseUrls || []))
      .filter(Boolean)
      .filter((baseUrl) => this.inFlightByBaseUrl.has(baseUrl));

    if (candidates.length === 0) {
      return null;
    }

    while (true) {
      let selected = candidates[0];
      let selectedLoad = this.inFlightByBaseUrl.get(selected) || 0;

      for (const baseUrl of candidates) {
        const load = this.inFlightByBaseUrl.get(baseUrl) || 0;
        if (load < selectedLoad) {
          selected = baseUrl;
          selectedLoad = load;
        }
      }

      // Strict guard: at most one in-flight request per server.
      if (selectedLoad === 0) {
        this.inFlightByBaseUrl.set(selected, 1);
        return selected;
      }

      await this.waitForServerAvailability();
    }
  }

  releaseReservedBaseUrl(baseUrl) {
    if (!baseUrl || !this.inFlightByBaseUrl.has(baseUrl)) {
      return;
    }
    const current = this.inFlightByBaseUrl.get(baseUrl) || 0;
    const next = Math.max(0, current - 1);
    this.inFlightByBaseUrl.set(baseUrl, next);
    if (next === 0) {
      this.notifyServerAvailability();
    }
  }

  buildSummaryPrompt(sourceText, maxSentences) {
    return `Summarize this Japanese text in exactly ${maxSentences} concise English sentences.
Focus on key events, themes, and context.
Return JSON only:
{
  "summaryTitle": "A short potential title in English (max 10 words)",
  "summarySentences": [
    "Sentence 1",
    "Sentence 2",
    "Sentence 3"
  ]
}

Text:
${sourceText}`;
  }

  extractSummaryResult(data, maxSentences) {
    const payload = this.extractJsonPayload(data.response || '{}');
    const summaryTitle = this.normalizeSummaryTitle(payload);
    const summarySentences = this.normalizeSummarySentences(payload, maxSentences);

    if (summarySentences.length === 0) {
      throw new Error('Ollama summary response did not include summary sentences');
    }

    return {
      summaryTitle,
      summarySentences
    };
  }

  splitSummaryTextIntoChunks(sourceText, targetChunks) {
    const cleanText = String(sourceText || '').trim();
    if (!cleanText) {
      return [];
    }

    const chunksRequested = Math.max(1, Number(targetChunks) || 1);
    if (chunksRequested === 1 || cleanText.length < 4000) {
      return [cleanText];
    }

    const paragraphs = cleanText
      .split(/\n+/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    const pieces = paragraphs.length > 0
      ? paragraphs
      : cleanText
        .split(/(?<=[。！？.!?])\s+/)
        .map((segment) => segment.trim())
        .filter(Boolean);

    if (pieces.length <= 1) {
      return [cleanText];
    }

    const targetChars = Math.ceil(cleanText.length / chunksRequested);
    const chunks = [];
    let current = '';

    for (const piece of pieces) {
      const separator = current ? '\n' : '';
      const candidate = `${current}${separator}${piece}`;
      const canCloseCurrent =
        current.length > 0 &&
        candidate.length > targetChars &&
        chunks.length < chunksRequested - 1;

      if (canCloseCurrent) {
        chunks.push(current.trim());
        current = piece;
      } else {
        current = candidate;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.filter(Boolean);
  }

  async summarizeChunkWithFailover(chunkText, maxSentences, baseUrls, startOffset = 0) {
    if (!Array.isArray(baseUrls) || baseUrls.length === 0) {
      throw new Error('No healthy Ollama servers available for summary chunk');
    }

    const orderedBaseUrls = this.getOrderedBaseUrlsForAttempt(baseUrls, startOffset + 1);
    const prompt = this.buildSummaryPrompt(chunkText, maxSentences);
    let lastError = null;

    for (const baseUrl of orderedBaseUrls) {
      try {
        const response = await this.generateOnBaseUrl(baseUrl, {
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
          think: this.think,
          options: {
            temperature: 0.2,
            top_p: 0.9,
            top_k: 40,
            num_predict: Math.max(this.maxTokens, config.ollama.summaryMaxTokens || this.maxTokens)
          }
        }, 'summary');

        const data = await response.json();
        return this.extractSummaryResult(data, maxSentences);
      } catch (error) {
        lastError = error;
        console.warn(`[Ollama] Summary chunk fallback from ${baseUrl}: ${error.message}`);
      }
    }

    throw lastError || new Error('Failed to summarize chunk on all available servers');
  }

  async summarizeChunkWithRetries(chunkText, maxSentences, baseUrls, startOffset = 0) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        if (attempt > 1) {
          const waitTime = Math.pow(2, attempt - 2) * 1000;
          this.log(`[Ollama] Summary chunk retry ${attempt - 1}/${this.maxRetries} after ${waitTime}ms`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }

        return await this.summarizeChunkWithFailover(
          chunkText,
          maxSentences,
          baseUrls,
          startOffset + attempt - 1
        );
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Failed to summarize chunk after retries');
  }

  async checkBaseUrlHealth(baseUrl, { force = false } = {}) {
    const cached = this.healthStatusByBaseUrl.get(baseUrl);
    if (!force && this.isHealthStatusFresh(cached)) {
      return cached.healthy;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.healthCheckTimeout);

    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) {
        this.setHealthStatus(baseUrl, false, `tags returned ${response.status}`);
        return false;
      }

      const data = await response.json();
      const modelExists = data.models?.some((model) => model.name === this.model);
      if (!modelExists) {
        this.setHealthStatus(baseUrl, false, `model "${this.model}" missing`);
        return false;
      }

      this.setHealthStatus(baseUrl, true);
      return true;
    } catch (error) {
      this.setHealthStatus(baseUrl, false, error?.message || 'health check failed');
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getHealthyBaseUrlsForRequest() {
    const candidateBaseUrls = [...this.baseUrls];
    this.log('[Ollama] Candidate servers for this request:', candidateBaseUrls.join(', '));

    const healthStatuses = await Promise.all(
      candidateBaseUrls.map((baseUrl) => this.checkBaseUrlHealth(baseUrl))
    );
    const healthyBaseUrls = candidateBaseUrls.filter((baseUrl, index) => healthStatuses[index]);

    if (healthyBaseUrls.length === 0) {
      throw new Error(`No healthy Ollama servers available: ${candidateBaseUrls.join(', ')}`);
    }

    this.log('[Ollama] Healthy servers for this request:', healthyBaseUrls.join(', '));
    return healthyBaseUrls;
  }

  getTokenSurface(token) {
    return (token?.surface || token?.surface_form || '').trim();
  }

  isCompactPromptToken(token) {
    const surface = this.getTokenSurface(token);
    if (!surface) return false;
    if (token?.pos === '記号') return false;
    if (token?.isSplitGrammarToken || token?.expressionSurface) return true;
    return COMPACT_PROMPT_POS.has(token?.pos);
  }

  buildPromptTokens(tokens) {
    if (this.contextMode !== 'compact') {
      return tokens;
    }

    const filtered = tokens.filter((token) => this.isCompactPromptToken(token));
    const seenSurfaces = new Set();
    const deduped = [];

    for (const token of filtered) {
      const surface = this.getTokenSurface(token);
      if (seenSurfaces.has(surface)) continue;
      seenSurfaces.add(surface);
      deduped.push(token);
    }

    if (deduped.length > 0) {
      return deduped;
    }

    // Fallback to original tokens to avoid sending an empty token list.
    return tokens;
  }

  // Test Ollama connection and list available models
  async testConnection() {
    this.log(`[Ollama] Testing connection to ${this.baseUrls.length} Ollama server(s)...`);

    for (const baseUrl of this.baseUrls) {
      try {
        const isHealthy = await this.checkBaseUrlHealth(baseUrl, { force: true });
        if (isHealthy) {
          const response = await fetch(`${baseUrl}/api/tags`);
          if (!response.ok) {
            this.log(`[Ollama] ❌ Failed to connect to ${baseUrl}: ${response.status} ${response.statusText}`);
            continue;
          }
          const data = await response.json();
          this.log(`[Ollama] ✅ Connected to ${baseUrl}`);
          this.log('[Ollama] Available models:', data.models?.map(m => m.name) || 'No models found');

          // Check if our configured model exists
          const modelExists = data.models?.some(m => m.name === this.model);
          if (modelExists) {
            this.log(`[Ollama] ✅ Model "${this.model}" is available on ${baseUrl}`);
          } else {
            this.log(`[Ollama] ⚠️ Model "${this.model}" not found on ${baseUrl}. Available models:`, data.models?.map(m => m.name));
          }
        } else {
          const reason = this.healthStatusByBaseUrl.get(baseUrl)?.reason;
          this.log(`[Ollama] ❌ Health check failed for ${baseUrl}${reason ? ` (${reason})` : ''}`);
        }
      } catch (error) {
        this.log(`[Ollama] ❌ Connection test failed for ${baseUrl}:`, error.message);
      }
    }
  }

  // Get Ollama analysis for tokens with retry logic
  async getAnalysis(originalText, tokens, contextLines = {}, maxRetries = this.maxRetries, onChunk = null) {
    this.log('[Ollama] Starting Ollama analysis...');
    this.log('[Ollama] Original text:', originalText);
    this.log('[Ollama] Number of tokens:', tokens.length);
    const healthyBaseUrls = await this.getHealthyBaseUrlsForRequest();
    const attemptedBaseUrls = new Set();

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const untriedBaseUrls = healthyBaseUrls.filter((baseUrl) => !attemptedBaseUrls.has(baseUrl));
      const candidateBaseUrls = untriedBaseUrls.length > 0 ? untriedBaseUrls : healthyBaseUrls;
      const activeBaseUrl = await this.reserveLeastLoadedBaseUrl(candidateBaseUrls);

      if (!activeBaseUrl) {
        throw new Error('No available Ollama servers could be reserved for analysis');
      }

      attemptedBaseUrls.add(activeBaseUrl);
      try {
        const currentLoad = this.inFlightByBaseUrl.get(activeBaseUrl) || 0;
        this.log(`[Ollama] Assigned analysis request to ${activeBaseUrl} (in-flight: ${currentLoad})`);

        if (attempt > 1) {
          this.log(`[Ollama] Retry attempt ${attempt - 1}/${maxRetries} via ${activeBaseUrl}`);
          // Exponential backoff: wait 2^(attempt-2) seconds before retry
          const waitTime = Math.pow(2, attempt - 2) * 1000;
          this.log(`[Ollama] Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        const promptTokens = this.buildPromptTokens(tokens);
        const tokenList = promptTokens.map((token) => this.getTokenSurface(token)).filter(Boolean).join(' | ');
        this.log('[Ollama] Token list for analysis:', tokenList);
        if (this.contextMode === 'compact') {
          this.log(
            `[Ollama] Compact mode: prompt tokens reduced from ${tokens.length} to ${promptTokens.length}`
          );
        }

        // Build context with previous and next sentences (up to 5 each)
        let contextText = '';
        if (contextLines.previousSentences && contextLines.previousSentences.length > 0) {
          contextText += `Previous sentences:\n`;
          contextLines.previousSentences.forEach((sentence, index) => {
            contextText += `${index + 1}. "${sentence}"\n`;
          });
        }
        contextText += `Current sentence: "${originalText}"`;
        if (contextLines.nextSentences && contextLines.nextSentences.length > 0) {
          contextText += `\nNext sentences:\n`;
          contextLines.nextSentences.forEach((sentence, index) => {
            contextText += `${index + 1}. "${sentence}"\n`;
          });
        }

        this.log('[Ollama] Context text:', contextText);

        // Use fixed token limit for response
        const fixedNumPredict = this.maxTokens;

        this.log(`[Ollama] Using fixed response limit: ${fixedNumPredict} tokens for ${promptTokens.length} prompt tokens`);

        const prompt = `Translate this Japanese sentence and analyze listed tokens.
Identify fixed expressions/set phrases (if any) and include them.

${contextText}

Tokens: ${tokenList}

Return JSON only:
{
  "fullLineTranslation": "English translation",
  "tokens": [
    {
      "surface": "token",
      "translation": "meaning",
      "contextualMeaning": "context explanation",
      "grammaticalRole": "grammar role"
    }
  ],
  "expressions": [
    {
      "surface": "set phrase or multi-token expression from sentence",
      "meaning": "natural English meaning",
      "note": "brief grammar/set-phrase note"
    }
  ],
  "sentenceNotes": [
    {
      "type": "grammar|nuance|context",
      "text": "short note explaining one important point in this sentence"
    }
  ]
}`;

        this.log('[Ollama] 🚀 Sending request to Ollama API...');
        this.log('[Ollama] Using model:', this.model);
        this.log('[Ollama] Prompt length:', prompt.length, 'characters');

        const startTime = Date.now();

        const shouldStream = typeof onChunk === 'function';
        const requestPayload = {
          model: this.model,
          prompt: prompt,
          stream: shouldStream,
          format: 'json',
          think: this.think,
          options: {
            temperature: 0.3,
            top_p: 0.9,
            top_k: 40,
            num_predict: fixedNumPredict // Fixed response length
          }
        };

        const response = await this.generateOnBaseUrl(
          activeBaseUrl,
          requestPayload,
          shouldStream ? 'analysis-stream' : 'analysis'
        );

        this.log(`[Ollama] Response status: ${response.status} ${response.statusText}`);

        const endTime = Date.now();

        this.log('[Ollama] ✅ Received response from Ollama API');
        this.log('[Ollama] Response time:', endTime - startTime, 'ms');

        let responseText = '';
        if (shouldStream) {
          if (!response.body) {
            throw new Error('Ollama streaming response body is empty');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = '';
          let streamedChunkCount = 0;
          let streamedThinkingChunkCount = 0;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            pending += decoder.decode(value, { stream: true });
            const extracted = extractJsonObjectsFromBuffer(pending);
            pending = extracted.remaining;

            for (const objectJson of extracted.objects) {
              try {
                const parsedChunk = JSON.parse(objectJson);
                const chunkText = typeof parsedChunk.response === 'string' ? parsedChunk.response : '';
                const thinkingText = typeof parsedChunk.thinking === 'string' ? parsedChunk.thinking : '';

                if (thinkingText.length > 0) {
                  onChunk({ kind: 'thinking', content: thinkingText });
                  streamedThinkingChunkCount += 1;
                }

                if (chunkText.length > 0) {
                  responseText += chunkText;
                  onChunk({ kind: 'response', content: chunkText });
                  streamedChunkCount += 1;
                }
              } catch (streamParseError) {
                console.error('[Ollama] Failed to parse streaming chunk:', streamParseError);
              }
            }
          }

          pending += decoder.decode();
          const tailExtracted = extractJsonObjectsFromBuffer(pending);
          for (const objectJson of tailExtracted.objects) {
            try {
              const parsedTail = JSON.parse(objectJson);
              const chunkText = typeof parsedTail.response === 'string' ? parsedTail.response : '';
              const thinkingText = typeof parsedTail.thinking === 'string' ? parsedTail.thinking : '';

              if (thinkingText.length > 0) {
                onChunk({ kind: 'thinking', content: thinkingText });
                streamedThinkingChunkCount += 1;
              }

              if (chunkText.length > 0) {
                responseText += chunkText;
                onChunk({ kind: 'response', content: chunkText });
                streamedChunkCount += 1;
              }
            } catch (tailParseError) {
              console.error('[Ollama] Failed to parse streaming tail chunk:', tailParseError);
            }
          }

          if (tailExtracted.remaining.trim()) {
            this.log('[Ollama] Unparsed streaming tail length:', tailExtracted.remaining.trim().length);
          }

          this.log('[Ollama] Streamed chunk count:', streamedChunkCount);
          this.log('[Ollama] Streamed thinking chunk count:', streamedThinkingChunkCount);
        } else {
          const data = await response.json();
          responseText = data.response;
        }

        this.log('[Ollama] Raw response content:', responseText);

        // Try to parse JSON response - handle cases where there's text before the JSON
        try {
          // First try to parse the response directly
          const parsedResponse = JSON.parse(responseText);
          this.log('[Ollama] ✅ Successfully parsed JSON response');
          //this.log('[Ollama] Full line translation:', parsedResponse.fullLineTranslation);
          this.log('[Ollama] Number of token analyses:', parsedResponse.tokens?.length || 0);
          return parsedResponse;
        } catch (parseError) {
          this.log('[Ollama] Direct JSON parse failed, trying to extract JSON from response...');

          // Try to find JSON object in the response
          try {
            // Look for JSON object starting with { and ending with }
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const jsonString = jsonMatch[0];
              const parsedResponse = JSON.parse(jsonString);
              this.log('[Ollama] ✅ Successfully extracted and parsed JSON from response');
              //this.log('[Ollama] Full line translation:', parsedResponse.fullLineTranslation);
              this.log('[Ollama] Number of token analyses:', parsedResponse.tokens?.length || 0);
              return parsedResponse;
            } else {
              console.error('[Ollama] ❌ No JSON object found in response');
              console.error('[Ollama] Raw response:', responseText);
              return null;
            }
          } catch (extractError) {
            console.error('[Ollama] ❌ Failed to extract and parse JSON from response:', extractError);
            console.error('[Ollama] Raw response that failed to parse:', responseText);
            return null;
          }
        }
      } catch (error) {
        const isTimeoutError =
          error.name === 'AbortError' ||
          /timed out|timeout/i.test(error.message || '');

        if (isTimeoutError) {
          console.warn(`[Ollama] ⚠️ Request timeout (attempt ${attempt} on ${activeBaseUrl})`);
        } else {
          console.error(`[Ollama] ❌ Ollama API error (attempt ${attempt} on ${activeBaseUrl}):`, error);
          console.error('[Ollama] Error type:', error.constructor.name);
          console.error('[Ollama] Error message:', error.message);
        }
        if (isTimeoutError || error.code === 'ECONNREFUSED' || /fetch failed/i.test(error.message || '')) {
          this.setHealthStatus(activeBaseUrl, false, error.message);
        }

        if (error.code === 'ECONNREFUSED') {
          console.error('[Ollama] Cannot connect to Ollama server at:', activeBaseUrl);
        } else if (isTimeoutError) {
          console.error(`[Ollama] Request timed out after ${config.ollama.timeout / 1000} seconds`);
        }

        // If this is the last attempt, throw the error
        if (attempt === maxRetries + 1) {
          if (isTimeoutError) {
            throw new Error('Ollama request timed out - try using local processing instead');
          }
          throw error;
        }

        // Otherwise, continue to next retry attempt
        this.log(`[Ollama] Will retry... (${maxRetries + 1 - attempt} attempts remaining)`);
      } finally {
        this.releaseReservedBaseUrl(activeBaseUrl);
      }
    }
  }

  extractJsonPayload(responseText) {
    try {
      return JSON.parse(responseText);
    } catch (parseError) {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw parseError;
      }
      return JSON.parse(jsonMatch[0]);
    }
  }

  normalizeSummaryTitle(payload) {
    const rawTitle = payload?.summaryTitle ?? payload?.title ?? payload?.potentialTitle;
    const normalized = String(rawTitle || '').replace(/\s+/g, ' ').trim();
    return normalized || null;
  }

  normalizeSummarySentences(payload, maxSentences = 3) {
    const fromArray = Array.isArray(payload?.summarySentences)
      ? payload.summarySentences
      : [];

    let sentences = fromArray
      .map((sentence) => String(sentence || '').trim())
      .filter(Boolean);

    if (sentences.length === 0 && typeof payload?.summary === 'string') {
      sentences = payload.summary
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
    }

    if (sentences.length === 0 && typeof payload?.text === 'string') {
      sentences = payload.text
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
    }

    return sentences.slice(0, maxSentences);
  }

  async summarizeText(sourceText, maxSentences = 3) {
    const normalizedInput = String(sourceText || '').trim();
    if (!normalizedInput) {
      return [];
    }

    const maxInputChars = 30000;
    const clippedInput = normalizedInput.length > maxInputChars
      ? `${normalizedInput.slice(0, maxInputChars)}\n\n[Truncated due to length]`
      : normalizedInput;
    this.log(`[Ollama] Generating summary on primary server with input length=${clippedInput.length}`);

    const summaryBaseUrl = this.baseUrls[0];
    const primaryHealthy = await this.checkBaseUrlHealth(summaryBaseUrl);
    if (!primaryHealthy) {
      const reason = this.healthStatusByBaseUrl.get(summaryBaseUrl)?.reason || 'health check failed';
      throw new Error(`Primary summary server unavailable (${summaryBaseUrl}): ${reason}`);
    }

    const reservedSummaryBaseUrl = await this.reserveLeastLoadedBaseUrl([summaryBaseUrl]);
    if (!reservedSummaryBaseUrl) {
      throw new Error(`Primary summary server could not be reserved (${summaryBaseUrl})`);
    }

    try {
      return this.summarizeChunkWithRetries(
        clippedInput,
        maxSentences,
        [summaryBaseUrl],
        0
      );
    } finally {
      this.releaseReservedBaseUrl(reservedSummaryBaseUrl);
    }
  }
}

export default new OllamaService();
