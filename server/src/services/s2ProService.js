import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config/index.js';
import speechAlignmentService from './speechAlignmentService.js';

class S2ProService {
  constructor() {
    this.baseUrl = config.s2Pro.baseUrl;
    this.timeout = config.s2Pro.timeout;
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
    const synthesisText = config.s2Pro.enableSpeechTags
      ? this.buildTaggedPrompt(filteredText, options.speechTags)
      : filteredText;

    console.log(`Generating S2 Pro audio for text: "${filteredText.substring(0, 50)}..."`);
    console.log(`Using S2 Pro at: ${this.baseUrl}, includeTimings: ${Boolean(options.includeTimings)}`);

    const formData = new FormData();
    formData.set('text', synthesisText);
    formData.set('params', JSON.stringify({
      max_new_tokens: config.s2Pro.maxNewTokens,
      temperature: config.s2Pro.temperature,
      top_p: config.s2Pro.topP,
      top_k: config.s2Pro.topK,
      min_tokens_before_end: config.s2Pro.minTokensBeforeEnd,
      n_threads: config.s2Pro.threads,
      verbose: false
    }));

    await this.addReferenceAudio(formData);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`S2 Pro TTS failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());

      if (options.includeTimings) {
        const wavInfo = this.readWavInfo(audioBuffer);
        const alignment = await speechAlignmentService.alignSpeech(audioBuffer, filteredText);
        const timings = alignment?.timings?.length
          ? alignment.timings
          : this.estimateTimingData(filteredText, wavInfo.duration);

        return {
          audio: audioBuffer.toString('base64'),
          timings,
          alignmentProvider: alignment?.provider || 'estimated',
          phoneTimings: alignment?.phoneTimings || [],
          audioFormat: 'wav',
          sampleRate: wavInfo.sampleRate
        };
      }

      return audioBuffer;
    } catch (error) {
      console.error('[S2 Pro] Text-to-speech error:', error);

      let errorMessage = 'Speech generation failed';
      let statusCode = 500;

      if (error.name === 'AbortError') {
        errorMessage = `Timed out connecting to S2 Pro server at ${this.baseUrl}`;
        statusCode = 503;
      } else if (
        error.message.includes('fetch failed') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('Unable to connect')
      ) {
        errorMessage = `Cannot connect to S2 Pro server at ${this.baseUrl}`;
        statusCode = 503;
      } else if (error.message.includes('S2 Pro TTS failed')) {
        errorMessage = error.message;
        statusCode = 502;
      }

      const s2ProError = new Error(errorMessage);
      s2ProError.statusCode = statusCode;
      throw s2ProError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async addReferenceAudio(formData) {
    const referenceAudioPath = config.s2Pro.referenceAudioPath.trim();
    const referenceText = config.s2Pro.referenceText.trim();

    if (!referenceAudioPath && !referenceText) {
      return;
    }

    if (!referenceAudioPath || !referenceText) {
      throw new Error('S2_PRO_REFERENCE_AUDIO_PATH and S2_PRO_REFERENCE_TEXT must both be configured for voice cloning');
    }

    const audioBuffer = await fs.readFile(referenceAudioPath);
    const filename = path.basename(referenceAudioPath);
    formData.set('reference', new Blob([audioBuffer]), filename);
    formData.set('reference_text', referenceText);
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

  readWavInfo(buffer) {
    const fallback = {
      duration: 3,
      sampleRate: config.s2Pro.sampleRate
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

export default new S2ProService();
