import { config } from '../config/index.js';
import mfaService from './mfaService.js';

class VoicevoxService {
  constructor() {
    this.baseUrl = config.voicevox.baseUrl;
    this.defaultSpeaker = config.voicevox.defaultSpeaker;
  }

  // Filter text to remove problematic characters for TTS
  filterTextForTTS(text) {
    if (!text) return text;
    
    // Remove or replace problematic characters
    let filteredText = text
      // Remove middle dot (・) which causes TTS issues
      .replace(/・/g, '')
      // Remove other problematic punctuation that might cause issues
      .replace(/[…]/g, '...')  // Replace ellipsis with regular dots
      .replace(/[〜]/g, '～')   // Normalize wave dash
      .replace(/[―]/g, '—')    // Normalize em dash
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`[VOICEVOX] Text filtering: "${text}" -> "${filteredText}"`);
    return filteredText;
  }

  // Generate text-to-speech audio
  async generateSpeech(text, options = {}) {
    const { 
      speaker = this.defaultSpeaker, 
      includeTimings = false, 
      speed = 1.0, 
      volume = 1.0 
    } = options;

    // Filter text to remove problematic characters
    const filteredText = this.filterTextForTTS(text);

    console.log(`Generating speech for text: "${filteredText.substring(0, 50)}..." with speaker ${speaker}`);
    console.log(`Using VOICEVOX at: ${this.baseUrl}, includeTimings: ${includeTimings}`);

    try {
      // Step 1: Get audio query from VOICEVOX
      console.log('[VOICEVOX] Requesting audio query...');
      const audioQueryUrl = `${this.baseUrl}/audio_query?text=${encodeURIComponent(filteredText)}&speaker=${speaker}`;
      const audioQueryResponse = await fetch(audioQueryUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!audioQueryResponse.ok) {
        throw new Error(`Audio query failed: ${audioQueryResponse.status} ${audioQueryResponse.statusText}`);
      }

      const audioQuery = await audioQueryResponse.json();
      console.log('[VOICEVOX] Audio query successful');

      // Apply speed and volume settings to the audio query
      if (speed !== 1.0) {
        audioQuery.speedScale = speed;
        console.log(`[VOICEVOX] Applied speed scale: ${speed}`);
      }
      
      if (volume !== 1.0) {
        audioQuery.volumeScale = volume;
        console.log(`[VOICEVOX] Applied volume scale: ${volume}`);
      }

      // Step 2: Generate synthesis audio
      console.log('[VOICEVOX] Requesting audio synthesis...');
      const synthesisUrl = `${this.baseUrl}/synthesis?speaker=${speaker}`;
      const synthesisResponse = await fetch(synthesisUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(audioQuery),
      });

      if (!synthesisResponse.ok) {
        throw new Error(`Synthesis failed: ${synthesisResponse.status} ${synthesisResponse.statusText}`);
      }

      console.log('[VOICEVOX] Audio synthesis successful');

      // Step 3: Process timing data if requested
      if (includeTimings) {
        // Extract timing information from audio query
        // Use filtered text for processing but include original text for reference
        const timingData = this.extractTimingData(audioQuery, filteredText, text);
        
        // Return JSON response with both audio and timing data
        const audioBuffer = await synthesisResponse.arrayBuffer();
        const audioBase64 = Buffer.from(audioBuffer).toString('base64');
        
        return {
          audio: audioBase64,
          timings: timingData,
          audioFormat: 'wav',
          sampleRate: audioQuery.outputSamplingRate || 24000
        };
      } else {
        // Return audio buffer only
        return await synthesisResponse.arrayBuffer();
      }

    } catch (error) {
      console.error('[VOICEVOX] Text-to-speech error:', error);
      
      let errorMessage = 'Speech generation failed';
      let statusCode = 500;
      
      if (error.message.includes('Failed to fetch') || error.message.includes('ECONNREFUSED')) {
        errorMessage = `Cannot connect to VOICEVOX engine at ${this.baseUrl}`;
        statusCode = 503;
      } else if (error.message.includes('Audio query failed') || error.message.includes('Synthesis failed')) {
        errorMessage = `VOICEVOX error: ${error.message}`;
        statusCode = 502;
      }

      const voicevoxError = new Error(errorMessage);
      voicevoxError.statusCode = statusCode;
      throw voicevoxError;
    }
  }

  // Helper function to extract timing data from VOICEVOX audio query
  extractTimingData(audioQuery, filteredText, originalText = null) {
    // If originalText is not provided, use filteredText for both
    const textForMapping = originalText || filteredText;
    
    console.log('[VOICEVOX] Extracting timing data...');
    console.log(`[VOICEVOX] Filtered text: "${filteredText}"`);
    if (originalText) {
      console.log(`[VOICEVOX] Original text: "${originalText}"`);
    }
    console.log('[VOICEVOX] Audio query structure:', JSON.stringify(audioQuery, null, 2));
    
    const timings = [];
    let currentTime = 0;
    let textIndex = 0;
    
    // VOICEVOX audio query contains accent_phrases with moras
    if (audioQuery.accent_phrases && Array.isArray(audioQuery.accent_phrases)) {
      console.log(`[VOICEVOX] Found ${audioQuery.accent_phrases.length} accent phrases`);
      
      audioQuery.accent_phrases.forEach((phrase, phraseIndex) => {
        console.log(`[VOICEVOX] Processing phrase ${phraseIndex}:`, JSON.stringify(phrase, null, 2));
        
        if (phrase.moras && Array.isArray(phrase.moras)) {
          console.log(`[VOICEVOX] Phrase ${phraseIndex} has ${phrase.moras.length} moras`);
          
          phrase.moras.forEach((mora, moraIndex) => {
            console.log(`[VOICEVOX] Processing mora ${moraIndex}:`, JSON.stringify(mora, null, 2));
            
            // Each mora has a vowel_length (and consonant_length if applicable)
            const consonantLength = mora.consonant_length || 0;
            const vowelLength = mora.vowel_length || 0;
            
            // Calculate timing for this mora
            const startTime = currentTime;
            const endTime = currentTime + consonantLength + vowelLength;
            
            // Get mora text - try different possible fields
            const moraText = mora.text || mora.phoneme || mora.vowel || '';
            console.log(`[VOICEVOX] Mora text: "${moraText}", consonant: ${consonantLength}, vowel: ${vowelLength}`);
            
            // Map mora to text characters (use filtered text for processing)
            let textLength = 1; // Default to 1 character
            let matchedText = '';
            
            if (textIndex < filteredText.length) {
              const remainingText = filteredText.substring(textIndex);
              matchedText = remainingText.charAt(0); // Default to next character
              
              // Try to match mora text if available
              if (moraText && remainingText.startsWith(moraText)) {
                textLength = moraText.length;
                matchedText = moraText;
              } else if (moraText) {
                // Try hiragana/katakana conversion
                for (let i = 1; i <= Math.min(3, remainingText.length); i++) {
                  const candidate = remainingText.substring(0, i);
                  if (candidate === moraText || 
                      this.katakanaToHiragana(candidate) === this.katakanaToHiragana(moraText)) {
                    textLength = i;
                    matchedText = candidate;
                    break;
                  }
                }
              }
            }
            
            // Only add timing if we have a valid time duration and text
            if (endTime > startTime && matchedText) {
              const timingEntry = {
                startTime: startTime,
                endTime: endTime,
                textStart: textIndex,
                textEnd: textIndex + textLength,
                text: matchedText,
                mora: moraText,
                phraseIndex: phraseIndex,
                moraIndex: moraIndex,
                consonantLength: consonantLength,
                vowelLength: vowelLength
              };
              
              timings.push(timingEntry);
              console.log(`[VOICEVOX] Added timing: ${JSON.stringify(timingEntry)}`);
            }
            
            currentTime = endTime;
            textIndex += textLength;
          });
        }
        
        // Add pause after phrase if specified
        if (phrase.pause_mora && phrase.pause_mora.vowel_length) {
          console.log(`[VOICEVOX] Adding pause: ${phrase.pause_mora.vowel_length}s`);
          currentTime += phrase.pause_mora.vowel_length;
        }
      });
    } else {
      console.log('[VOICEVOX] No accent_phrases found in audio query');
    }
    
    console.log(`[VOICEVOX] Extracted ${timings.length} timing points`);
    console.log(`[VOICEVOX] Text coverage: ${textIndex}/${filteredText.length} characters`);
    console.log(`[VOICEVOX] Total duration: ${currentTime}s`);
    
    return timings;
  }

  // Function to convert katakana to hiragana
  katakanaToHiragana(str) {
    if (!str) return str;
    return str.replace(/[\u30A1-\u30F6]/g, function (match) {
      const chr = match.charCodeAt(0) - 0x60;
      return String.fromCharCode(chr);
    });
  }

  // Enhanced speech generation with MFA alignment
  async generateSpeechWithMFA(text, options = {}) {
    const { 
      speaker = this.defaultSpeaker, 
      speed = 1.0, 
      volume = 1.0,
      useMFA = true,
      language = 'japanese_mfa'
    } = options;

    console.log('[VOICEVOX+MFA] Starting enhanced speech generation with MFA alignment');

    try {
      // Step 1: Generate audio with VoiceVox (always include timings for MFA processing)
      const voiceVoxResult = await this.generateSpeech(text, {
        speaker,
        includeTimings: true,
        speed,
        volume
      });

      if (!voiceVoxResult.audio || !voiceVoxResult.timings) {
        throw new Error('Failed to generate VoiceVox audio with timings');
      }

      // Step 2: Convert base64 audio back to buffer for MFA processing
      const audioBuffer = Buffer.from(voiceVoxResult.audio, 'base64');

      // Step 3: Use MFA for enhanced alignment if requested
      let enhancedTimings = voiceVoxResult.timings;
      let alignmentMethod = 'voicevox';
      let alignmentStats = {};

      if (useMFA) {
        console.log('[VOICEVOX+MFA] Running MFA alignment...');
        
        const mfaResult = await mfaService.alignVoiceVoxAudio(audioBuffer, text, {
          filename: `voicevox_${Date.now()}`,
          language: language,
          useVoiceVoxTimings: true,
          voiceVoxTimings: voiceVoxResult.timings,
          audioDuration: this.calculateAudioDuration(voiceVoxResult.timings)
        });

        if (mfaResult.success && mfaResult.timingData.length > 0) {
          enhancedTimings = mfaResult.timingData;
          alignmentMethod = mfaResult.method;
          alignmentStats = mfaService.getAlignmentStats(enhancedTimings);
          console.log('[VOICEVOX+MFA] MFA alignment successful');
        } else {
          console.warn('[VOICEVOX+MFA] MFA alignment failed, using VoiceVox timings');
          alignmentStats = this.getVoiceVoxAlignmentStats(voiceVoxResult.timings);
        }
      } else {
        alignmentStats = this.getVoiceVoxAlignmentStats(voiceVoxResult.timings);
      }

      // Step 4: Return enhanced result
      return {
        audio: voiceVoxResult.audio,
        timings: enhancedTimings,
        audioFormat: voiceVoxResult.audioFormat,
        sampleRate: voiceVoxResult.sampleRate,
        alignment: {
          method: alignmentMethod,
          stats: alignmentStats,
          originalVoiceVoxTimings: voiceVoxResult.timings.length,
          enhancedTimings: enhancedTimings.length
        }
      };

    } catch (error) {
      console.error('[VOICEVOX+MFA] Enhanced speech generation failed:', error);
      
      // Fallback to regular VoiceVox generation
      console.log('[VOICEVOX+MFA] Falling back to regular VoiceVox generation');
      try {
        const fallbackResult = await this.generateSpeech(text, {
          speaker,
          includeTimings: true,
          speed,
          volume
        });

        return {
          ...fallbackResult,
          alignment: {
            method: 'voicevox_fallback',
            stats: this.getVoiceVoxAlignmentStats(fallbackResult.timings),
            error: error.message
          }
        };
      } catch (fallbackError) {
        console.error('[VOICEVOX+MFA] Fallback also failed:', fallbackError);
        throw fallbackError;
      }
    }
  }

  // Calculate audio duration from VoiceVox timings
  calculateAudioDuration(timings) {
    if (!timings || timings.length === 0) return 0;
    return Math.max(...timings.map(t => t.endTime));
  }

  // Get alignment statistics for VoiceVox timings
  getVoiceVoxAlignmentStats(timings) {
    if (!timings || timings.length === 0) {
      return { totalMoras: 0, totalDuration: 0, averageMoraDuration: 0 };
    }

    const totalMoras = timings.length;
    const totalDuration = this.calculateAudioDuration(timings);
    const averageMoraDuration = totalDuration / totalMoras;

    return {
      totalMoras,
      totalDuration,
      averageMoraDuration,
      type: 'mora-level'
    };
  }

  // Utility method to compare timing alignments
  compareAlignments(voiceVoxTimings, mfaTimings) {
    const comparison = {
      voiceVox: {
        count: voiceVoxTimings.length,
        duration: this.calculateAudioDuration(voiceVoxTimings),
        type: 'mora-level'
      },
      mfa: {
        count: mfaTimings.length,
        duration: mfaTimings.length > 0 ? Math.max(...mfaTimings.map(t => t.endTime)) : 0,
        type: 'word-level'
      }
    };

    comparison.improvement = {
      granularityChange: comparison.voiceVox.count - comparison.mfa.count,
      durationDifference: Math.abs(comparison.voiceVox.duration - comparison.mfa.duration),
      recommended: comparison.mfa.count > 0 ? 'mfa' : 'voicevox'
    };

    return comparison;
  }
}

export default new VoicevoxService();
