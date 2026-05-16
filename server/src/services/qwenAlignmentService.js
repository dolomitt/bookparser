import { config } from '../config/index.js';

class QwenAlignmentService {
  constructor() {
    this.baseUrl = config.qwenAligner.baseUrl;
    this.timeout = config.qwenAligner.timeout;
    this.language = config.qwenAligner.language;
  }

  get enabled() {
    return ['qwen', 'qwen3', 'qwen-aligner'].includes(config.tts.alignmentProvider);
  }

  async alignSpeech(audioBuffer, text) {
    if (!this.enabled || !audioBuffer?.length || !text?.trim()) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/align`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: audioBuffer.toString('base64'),
          text,
          language: this.language
        }),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || `Qwen aligner failed: ${response.status} ${response.statusText}`);
      }

      const timings = this.mapSegmentsToText(payload.segments || [], text);

      if (timings.length === 0) {
        return null;
      }

      return {
        provider: 'qwen3',
        timings,
        phoneTimings: []
      };
    } catch (error) {
      console.warn(`[QwenAligner] Alignment unavailable: ${error.message}`);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  mapSegmentsToText(segments, text) {
    let cursor = 0;

    return segments
      .map((segment, index) => {
        const label = String(segment.text || '').trim();
        const startTime = Number(segment.startTime);
        const endTime = Number(segment.endTime);

        if (!label || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
          return null;
        }

        const foundIndex = text.indexOf(label, cursor);
        let textStart;
        let textEnd;

        if (foundIndex >= 0) {
          textStart = foundIndex;
          textEnd = foundIndex + label.length;
          cursor = textEnd;
        } else {
          textStart = cursor;
          textEnd = Math.min(text.length, cursor + label.length);
          cursor = textEnd;
        }

        return {
          startTime,
          endTime,
          textStart,
          textEnd,
          text: text.slice(textStart, textEnd),
          mora: label,
          phraseIndex: 0,
          moraIndex: index,
          alignmentProvider: 'qwen3',
          alignmentLevel: 'qwen-segment'
        };
      })
      .filter(Boolean);
  }
}

export default new QwenAlignmentService();
