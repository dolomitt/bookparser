import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';

class MFAService {
  constructor() {
    this.tempDir = './temp_mfa';
    this.modelsDir = '/root/Documents/MFA/pretrained_models';
    this.ensureDirectories();
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      await fs.mkdir(this.modelsDir, { recursive: true });
    } catch (error) {
      console.error('[MFA] Error creating directories:', error);
    }
  }

  // Check if MFA is available on the system
  async checkMFAAvailability() {
    return new Promise((resolve) => {
      const mfaPath = '/root/miniconda3/bin/mfa';
      console.log(`[MFA] Using MFA at: ${mfaPath}`);
      
      const mfa = spawn(mfaPath, ['version'], { stdio: 'pipe' });
      
      mfa.on('close', (code) => {
        if (code === 0) {
          console.log(`[MFA] MFA is available and working`);
          this.mfaCommand = mfaPath;
          resolve(true);
        } else {
          console.log(`[MFA] MFA command failed with code ${code}`);
          resolve(false);
        }
      });
      
      mfa.on('error', (error) => {
        console.log(`[MFA] MFA command error: ${error.message}`);
        resolve(false);
      });
    });
  }

  // Prepare text file for MFA alignment
  async prepareTextFile(text, filename) {
    const textPath = path.join(this.tempDir, `${filename}.txt`);
    
    // Clean text for MFA - remove problematic characters and normalize
    const cleanText = text
      .replace(/・/g, '')
      .replace(/[…]/g, '...')
      .replace(/[〜]/g, '～')
      .replace(/[―]/g, '—')
      .replace(/\s+/g, ' ')
      .trim();
    
    await fs.writeFile(textPath, cleanText, 'utf8');
    return textPath;
  }

  // Save audio file for MFA alignment
  async prepareAudioFile(audioBuffer, filename) {
    const audioPath = path.join(this.tempDir, `${filename}.wav`);
    await fs.writeFile(audioPath, audioBuffer);
    return audioPath;
  }

  // Run MFA alignment
  async runAlignment(audioPath, textPath, outputDir, language = 'japanese_mfa') {
    const mfaAvailable = await this.checkMFAAvailability();
    
    if (!mfaAvailable) {
      console.warn('[MFA] Montreal Forced Aligner not found. Using fallback alignment.');
      return this.fallbackAlignment(audioPath, textPath);
    }

    return new Promise((resolve, reject) => {
      const args = [
        'align',
        path.dirname(audioPath),
        language,
        language,
        outputDir,
        '--clean'
      ];

      console.log(`[MFA] Running alignment with command: ${this.mfaCommand}`);
      console.log('[MFA] Running alignment with args:', args);
      
      // Use the detected MFA command
      const cmdParts = this.mfaCommand.split(' ');
      const command = cmdParts[0];
      const baseArgs = cmdParts.slice(1);
      const fullArgs = [...baseArgs, ...args];
      
      const mfa = spawn(command, fullArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      mfa.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      mfa.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      mfa.on('close', (code) => {
        if (code === 0) {
          console.log('[MFA] Alignment completed successfully');
          resolve({ stdout, stderr, outputDir });
        } else {
          console.error('[MFA] Alignment failed with code:', code);
          console.error('[MFA] stderr:', stderr);
          reject(new Error(`MFA alignment failed: ${stderr}`));
        }
      });

      mfa.on('error', (error) => {
        console.error('[MFA] Process error:', error);
        reject(error);
      });
    });
  }

  // Fallback alignment using VoiceVox timing data
  async fallbackAlignment(audioPath, textPath) {
    console.log('[MFA] Using fallback alignment method');
    
    // Read the text file
    const text = await fs.readFile(textPath, 'utf8');
    
    // This would integrate with VoiceVox timing data
    // For now, return a basic structure that can be enhanced
    return {
      method: 'fallback',
      text: text,
      audioPath: audioPath,
      message: 'Using VoiceVox timing data as fallback'
    };
  }

  // Parse TextGrid output from MFA
  async parseTextGrid(textGridPath) {
    try {
      const content = await fs.readFile(textGridPath, 'utf8');
      const intervals = this.extractIntervalsFromTextGrid(content);
      return intervals;
    } catch (error) {
      console.error('[MFA] Error parsing TextGrid:', error);
      return [];
    }
  }

  // Extract timing intervals from TextGrid format
  extractIntervalsFromTextGrid(content) {
    const intervals = [];
    const lines = content.split('\n');
    
    let inIntervalTier = false;
    let currentInterval = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.includes('item [') && lines[i + 1]?.includes('class = "IntervalTier"')) {
        inIntervalTier = true;
        continue;
      }
      
      if (inIntervalTier) {
        if (line.startsWith('xmin =')) {
          currentInterval.startTime = parseFloat(line.split('=')[1].trim());
        } else if (line.startsWith('xmax =')) {
          currentInterval.endTime = parseFloat(line.split('=')[1].trim());
        } else if (line.startsWith('text =')) {
          const text = line.split('=')[1].trim().replace(/"/g, '');
          currentInterval.text = text;
          
          if (text && text !== '') {
            intervals.push({ ...currentInterval });
          }
          currentInterval = {};
        }
      }
    }
    
    return intervals;
  }

  // Main function to align VoiceVox audio with text
  async alignVoiceVoxAudio(audioBuffer, text, options = {}) {
    const {
      filename = `alignment_${Date.now()}`,
      language = 'japanese_mfa',
      useVoiceVoxTimings = true
    } = options;

    try {
      console.log('[MFA] Starting audio-text alignment');
      
      // Prepare files
      const audioPath = await this.prepareAudioFile(audioBuffer, filename);
      const textPath = await this.prepareTextFile(text, filename);
      const outputDir = path.join(this.tempDir, `${filename}_output`);
      
      await fs.mkdir(outputDir, { recursive: true });
      
      // Try MFA alignment first
      let alignmentResult;
      try {
        alignmentResult = await this.runAlignment(audioPath, textPath, outputDir, language);
      } catch (error) {
        console.warn('[MFA] MFA alignment failed, using fallback:', error.message);
        alignmentResult = await this.fallbackAlignment(audioPath, textPath);
      }
      
      // Parse results
      let timingData = [];
      
      if (alignmentResult.method === 'fallback') {
        // Use VoiceVox timing data if available
        if (useVoiceVoxTimings && options.voiceVoxTimings) {
          timingData = this.enhanceVoiceVoxTimings(options.voiceVoxTimings, text);
        } else {
          timingData = this.generateBasicTimings(text, options.audioDuration || 10);
        }
      } else {
        // Parse MFA TextGrid output
        const textGridPath = path.join(outputDir, `${filename}.TextGrid`);
        timingData = await this.parseTextGrid(textGridPath);
      }
      
      // Clean up temporary files
      await this.cleanup(audioPath, textPath, outputDir);
      
      return {
        success: true,
        timingData: timingData,
        method: alignmentResult.method || 'mfa',
        totalDuration: timingData.length > 0 ? Math.max(...timingData.map(t => t.endTime)) : 0
      };
      
    } catch (error) {
      console.error('[MFA] Alignment process failed:', error);
      return {
        success: false,
        error: error.message,
        timingData: []
      };
    }
  }

  // Enhance VoiceVox timings with better word-level alignment
  enhanceVoiceVoxTimings(voiceVoxTimings, text) {
    console.log('[MFA] Enhancing VoiceVox timings');
    
    // Group mora-level timings into word-level timings
    const wordTimings = [];
    let currentWord = '';
    let wordStart = 0;
    let wordEnd = 0;
    
    for (let i = 0; i < voiceVoxTimings.length; i++) {
      const timing = voiceVoxTimings[i];
      
      if (currentWord === '') {
        currentWord = timing.text;
        wordStart = timing.startTime;
        wordEnd = timing.endTime;
      } else {
        // Check if this mora belongs to the same word
        const nextChar = text.charAt(timing.textStart);
        const isWordBoundary = this.isWordBoundary(nextChar, timing.text);
        
        if (isWordBoundary) {
          // Finish current word
          wordTimings.push({
            startTime: wordStart,
            endTime: wordEnd,
            text: currentWord,
            confidence: 0.8 // VoiceVox-based confidence
          });
          
          // Start new word
          currentWord = timing.text;
          wordStart = timing.startTime;
          wordEnd = timing.endTime;
        } else {
          // Continue current word
          currentWord += timing.text;
          wordEnd = timing.endTime;
        }
      }
    }
    
    // Add final word
    if (currentWord) {
      wordTimings.push({
        startTime: wordStart,
        endTime: wordEnd,
        text: currentWord,
        confidence: 0.8
      });
    }
    
    return wordTimings;
  }

  // Check if character represents a word boundary
  isWordBoundary(char, moraText) {
    // Japanese word boundaries (simplified)
    const punctuation = /[。、！？\s]/;
    const particles = /[は|が|を|に|で|と|の|へ|から|まで]/;
    
    return punctuation.test(char) || particles.test(moraText);
  }

  // Generate basic timing data when MFA is not available
  generateBasicTimings(text, duration) {
    console.log('[MFA] Generating basic timing data');
    
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const timePerWord = duration / words.length;
    
    return words.map((word, index) => ({
      startTime: index * timePerWord,
      endTime: (index + 1) * timePerWord,
      text: word,
      confidence: 0.5 // Lower confidence for basic timing
    }));
  }

  // Clean up temporary files
  async cleanup(audioPath, textPath, outputDir) {
    try {
      await fs.unlink(audioPath);
      await fs.unlink(textPath);
      await fs.rm(outputDir, { recursive: true, force: true });
      console.log('[MFA] Cleanup completed');
    } catch (error) {
      console.warn('[MFA] Cleanup warning:', error.message);
    }
  }

  // Get alignment statistics
  getAlignmentStats(timingData) {
    if (!timingData || timingData.length === 0) {
      return { totalWords: 0, totalDuration: 0, averageWordDuration: 0 };
    }
    
    const totalWords = timingData.length;
    const totalDuration = Math.max(...timingData.map(t => t.endTime));
    const averageWordDuration = totalDuration / totalWords;
    
    return {
      totalWords,
      totalDuration,
      averageWordDuration,
      confidence: timingData.reduce((sum, t) => sum + (t.confidence || 0), 0) / totalWords
    };
  }
}

export default new MFAService();
