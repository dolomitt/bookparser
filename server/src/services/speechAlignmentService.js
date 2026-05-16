import { config } from '../config/index.js';
import mfaAlignmentService from './mfaAlignmentService.js';
import qwenAlignmentService from './qwenAlignmentService.js';

class SpeechAlignmentService {
  async alignSpeech(audioBuffer, text) {
    if (['qwen', 'qwen3', 'qwen-aligner'].includes(config.tts.alignmentProvider)) {
      const qwenAlignment = await qwenAlignmentService.alignSpeech(audioBuffer, text);
      if (qwenAlignment?.timings?.length || !config.qwenAligner.fallbackToMfa) {
        return qwenAlignment;
      }

      return mfaAlignmentService.alignSpeech(audioBuffer, text);
    }

    return mfaAlignmentService.alignSpeech(audioBuffer, text);
  }
}

export default new SpeechAlignmentService();
