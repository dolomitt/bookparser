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
    this.baseUrl = config.ollama.baseUrl;
    this.model = config.ollama.model;
    this.timeout = config.ollama.timeout;
    this.maxRetries = config.ollama.maxRetries;
    this.maxTokens = config.ollama.maxTokens;
    this.contextMode = config.ollama.contextMode === 'compact' ? 'compact' : 'full';
    const thinkEnv = process.env.BOOKPARSER_OLLAMA_THINK;
    this.think = thinkEnv !== undefined
      ? (thinkEnv === 'true' ? true : thinkEnv === 'false' ? false : thinkEnv)
      : false;
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
    try {
      console.log('[Ollama] Testing connection to Ollama server...');
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        console.log('[Ollama] ✅ Connected to Ollama server');
        console.log('[Ollama] Available models:', data.models?.map(m => m.name) || 'No models found');

        // Check if our configured model exists
        const modelExists = data.models?.some(m => m.name === this.model);
        if (modelExists) {
          console.log(`[Ollama] ✅ Model "${this.model}" is available`);
        } else {
          console.log(`[Ollama] ⚠️ Model "${this.model}" not found. Available models:`, data.models?.map(m => m.name));
        }
      } else {
        console.log(`[Ollama] ❌ Failed to connect: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.log(`[Ollama] ❌ Connection test failed:`, error.message);
    }
  }

  // Get Ollama analysis for tokens with retry logic
  async getAnalysis(originalText, tokens, contextLines = {}, maxRetries = this.maxRetries, onChunk = null) {
    console.log('[Ollama] Starting Ollama analysis...');
    console.log('[Ollama] Original text:', originalText);
    console.log('[Ollama] Number of tokens:', tokens.length);

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[Ollama] Retry attempt ${attempt - 1}/${maxRetries}`);
          // Exponential backoff: wait 2^(attempt-2) seconds before retry
          const waitTime = Math.pow(2, attempt - 2) * 1000;
          console.log(`[Ollama] Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        const promptTokens = this.buildPromptTokens(tokens);
        const tokenList = promptTokens.map((token) => this.getTokenSurface(token)).filter(Boolean).join(' | ');
        console.log('[Ollama] Token list for analysis:', tokenList);
        if (this.contextMode === 'compact') {
          console.log(
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

        console.log('[Ollama] Context text:', contextText);

        // Use fixed token limit for response
        const fixedNumPredict = this.maxTokens;

        console.log(`[Ollama] Using fixed response limit: ${fixedNumPredict} tokens for ${promptTokens.length} prompt tokens`);

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
  ]
}`;

        console.log('[Ollama] 🚀 Sending request to Ollama API...');
        console.log('[Ollama] Using model:', this.model);
        console.log('[Ollama] Prompt length:', prompt.length, 'characters');

        const startTime = Date.now();

        // Create AbortController for timeout - configurable timeout for larger models
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.ollama.timeout);

        const shouldStream = typeof onChunk === 'function';

        const response = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
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
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`[Ollama] Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`[Ollama] Error response body:`, errorText);
          throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const endTime = Date.now();

        console.log('[Ollama] ✅ Received response from Ollama API');
        console.log('[Ollama] Response time:', endTime - startTime, 'ms');

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
            console.log('[Ollama] Unparsed streaming tail length:', tailExtracted.remaining.trim().length);
          }

          console.log('[Ollama] Streamed chunk count:', streamedChunkCount);
          console.log('[Ollama] Streamed thinking chunk count:', streamedThinkingChunkCount);
        } else {
          const data = await response.json();
          responseText = data.response;
        }

        console.log('[Ollama] Raw response content:', responseText);

        // Try to parse JSON response - handle cases where there's text before the JSON
        try {
          // First try to parse the response directly
          const parsedResponse = JSON.parse(responseText);
          console.log('[Ollama] ✅ Successfully parsed JSON response');
          //console.log('[Ollama] Full line translation:', parsedResponse.fullLineTranslation);
          console.log('[Ollama] Number of token analyses:', parsedResponse.tokens?.length || 0);
          return parsedResponse;
        } catch (parseError) {
          console.log('[Ollama] Direct JSON parse failed, trying to extract JSON from response...');

          // Try to find JSON object in the response
          try {
            // Look for JSON object starting with { and ending with }
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const jsonString = jsonMatch[0];
              const parsedResponse = JSON.parse(jsonString);
              console.log('[Ollama] ✅ Successfully extracted and parsed JSON from response');
              //console.log('[Ollama] Full line translation:', parsedResponse.fullLineTranslation);
              console.log('[Ollama] Number of token analyses:', parsedResponse.tokens?.length || 0);
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
        console.error(`[Ollama] ❌ Ollama API error (attempt ${attempt}):`, error);
        console.error('[Ollama] Error type:', error.constructor.name);
        console.error('[Ollama] Error message:', error.message);

        if (error.code === 'ECONNREFUSED') {
          console.error('[Ollama] Cannot connect to Ollama server at:', this.baseUrl);
        } else if (error.name === 'AbortError') {
          console.error(`[Ollama] Request timed out after ${config.ollama.timeout / 1000} seconds`);
        }

        // If this is the last attempt, throw the error
        if (attempt === maxRetries + 1) {
          if (error.name === 'AbortError') {
            throw new Error('Ollama request timed out - try using local processing instead');
          }
          throw error;
        }

        // Otherwise, continue to next retry attempt
        console.log(`[Ollama] Will retry... (${maxRetries + 1 - attempt} attempts remaining)`);
      }
    }
  }
}

export default new OllamaService();
