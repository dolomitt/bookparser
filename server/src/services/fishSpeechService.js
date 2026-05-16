import { config } from '../config/index.js';
import mfaAlignmentService from './mfaAlignmentService.js';

class FishSpeechService {
  constructor() {
    this.baseUrl = config.fishSpeech.baseUrl;
    this.apiKey = config.fishSpeech.apiKey;
    this.referenceId = config.fishSpeech.referenceId;
    this.format = config.fishSpeech.format;
    this.timeout = config.fishSpeech.timeout;
  }

  filterTextForTTS(text) {
    if (!text) return text;

    return text
      .replace(/\u30FB/g, '')
      .replace(/\u2026/g, '...')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async generateSpeech(text, options = {}) {
    const filteredText = this.filterTextForTTS(text);
    const synthesisText = this.buildTaggedPrompt(filteredText, options.speechTags);
    const referenceId = options.referenceId || this.referenceId || null;
    const speed = Number(options.speed);

    console.log(`Generating Fish Speech audio for text: "${filteredText.substring(0, 50)}..."`);
    console.log(`Using Fish Speech at: ${this.baseUrl}, includeTimings: ${Boolean(options.includeTimings)}`);

    const payload = {
      text: synthesisText,
      references: [],
      reference_id: referenceId,
      format: this.format,
      normalize: true,
      streaming: false,
      max_new_tokens: config.fishSpeech.maxNewTokens,
      chunk_length: config.fishSpeech.chunkLength,
      top_p: config.fishSpeech.topP,
      repetition_penalty: config.fishSpeech.repetitionPenalty,
      temperature: config.fishSpeech.temperature,
      ...(Number.isNaN(config.fishSpeech.seed) ? {} : { seed: config.fishSpeech.seed }),
      ...(Number.isFinite(speed) ? { prosody: { speed } } : {}),
      use_memory_cache: config.fishSpeech.useMemoryCache
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: this.contentTypeForFormat(this.format),
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Fish Speech TTS failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());

      if (options.includeTimings) {
        const wavInfo = this.readWavInfo(audioBuffer);
        const mfaAlignment = await mfaAlignmentService.alignSpeech(audioBuffer, filteredText);
        const timings = mfaAlignment?.timings?.length
          ? mfaAlignment.timings
          : this.estimateTimingData(filteredText, wavInfo.duration);

        return {
          audio: audioBuffer.toString('base64'),
          timings,
          alignmentProvider: mfaAlignment?.provider || 'estimated',
          phoneTimings: mfaAlignment?.phoneTimings || [],
          audioFormat: this.format,
          sampleRate: wavInfo.sampleRate
        };
      }

      return audioBuffer;
    } catch (error) {
      console.error('[Fish Speech] Text-to-speech error:', error);

      let errorMessage = 'Speech generation failed';
      let statusCode = 500;

      if (error.name === 'AbortError') {
        errorMessage = `Timed out connecting to Fish Speech server at ${this.baseUrl}`;
        statusCode = 503;
      } else if (
        error.message.includes('fetch failed') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('Unable to connect')
      ) {
        errorMessage = `Cannot connect to Fish Speech server at ${this.baseUrl}`;
        statusCode = 503;
      } else if (error.message.includes('Fish Speech TTS failed')) {
        errorMessage = error.message;
        statusCode = 502;
      }

      const fishSpeechError = new Error(errorMessage);
      fishSpeechError.statusCode = statusCode;
      throw fishSpeechError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  buildTaggedPrompt(text, speechTags = []) {
    const tags = (Array.isArray(speechTags) ? speechTags : [speechTags])
      .map((tag) => String(tag || '').trim())
      .map((tag) => {
        const inner = tag.match(/^\[(.+)\]$/)?.[1] || tag;
        return inner
          .replace(/[\r\n]/g, ' ')
          .replace(/[()[\]{}<>]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      })
      .filter((tag) => tag.length >= 3 && tag.length <= 80)
      .slice(0, 2)
      .map((tag) => `[${tag}]`);

    return tags.length > 0 ? `${tags.join(' ')} ${text}` : text;
  }

  contentTypeForFormat(format) {
    if (format === 'mp3') return 'audio/mpeg';
    if (format === 'opus') return 'audio/ogg';
    if (format === 'pcm') return 'application/octet-stream';
    return 'audio/wav';
  }

  readWavInfo(buffer) {
    const fallback = {
      duration: 3,
      sampleRate: config.fishSpeech.sampleRate
    };

    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      return fallback;
    }

    let offset = 12;
    let sampleRate = fallback.sampleRate;
    let byteRate = 0;
    let dataSize = 0;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;

      if (chunkId === 'fmt ' && chunkStart + 16 <= buffer.length) {
        sampleRate = buffer.readUInt32LE(chunkStart + 4);
        byteRate = buffer.readUInt32LE(chunkStart + 8);
      } else if (chunkId === 'data') {
        dataSize = chunkSize;
        break;
      }

      offset = chunkStart + chunkSize + (chunkSize % 2);
    }

    return {
      duration: byteRate > 0 && dataSize > 0 ? dataSize / byteRate : fallback.duration,
      sampleRate
    };
  }

  estimateTimingData(text, duration) {
    const chars = [];

    for (let index = 0; index < text.length;) {
      const codePoint = text.codePointAt(index);
      const char = String.fromCodePoint(codePoint);
      const length = char.length;

      if (!/\s/.test(char)) {
        chars.push({ char, index, length });
      }

      index += length;
    }

    if (chars.length === 0) {
      return [];
    }

    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 3;
    const charDuration = safeDuration / chars.length;

    return chars.map((entry, moraIndex) => ({
      startTime: moraIndex * charDuration,
      endTime: (moraIndex + 1) * charDuration,
      textStart: entry.index,
      textEnd: entry.index + entry.length,
      text: entry.char,
      mora: entry.char,
      phraseIndex: 0,
      moraIndex,
      estimated: true
    }));
  }
}

export default new FishSpeechService();
