import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config/index.js';

const execFileAsync = promisify(execFile);

class MfaAlignmentService {
  constructor() {
    this.runtime = config.mfa.runtime;
    this.command = config.mfa.command;
    this.dockerCommand = config.mfa.dockerCommand;
    this.dockerContainer = config.mfa.dockerContainer;
    this.dictionary = config.mfa.dictionary;
    this.acousticModel = config.mfa.acousticModel;
    this.timeout = config.mfa.timeout;
  }

  get enabled() {
    return config.tts.alignmentProvider === 'mfa';
  }

  async alignSpeech(audioBuffer, text) {
    if (!this.enabled || !audioBuffer?.length || !text?.trim()) {
      return null;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bookparser-mfa-'));
    const wavPath = path.join(tempRoot, 'utterance.wav');
    const textPath = path.join(tempRoot, 'utterance.txt');
    const outputPath = path.join(tempRoot, 'utterance.json');

    try {
      await fs.writeFile(wavPath, audioBuffer);
      await fs.writeFile(textPath, text, 'utf8');

      if (this.runtime === 'docker') {
        await this.alignWithDocker(tempRoot);
      } else {
        await this.alignWithLocalMfa(wavPath, textPath, outputPath);
      }

      const alignmentJson = JSON.parse(await fs.readFile(outputPath, 'utf8'));
      const wordIntervals = this.extractTier(alignmentJson, 'words');
      const phoneIntervals = this.extractTier(alignmentJson, 'phones');
      const timings = this.mapWordIntervalsToText(wordIntervals, text);

      if (timings.length === 0) {
        return null;
      }

      return {
        provider: 'mfa',
        timings,
        phoneTimings: phoneIntervals
          .filter((entry) => entry.label && !this.isSilenceLabel(entry.label))
          .map((entry, phoneIndex) => ({
            startTime: entry.startTime,
            endTime: entry.endTime,
            phone: entry.label,
            phoneIndex
          }))
      };
    } catch (error) {
      console.warn(`[MFA] Alignment unavailable, falling back to estimated timings: ${error.message}`);
      return null;
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async alignWithLocalMfa(wavPath, textPath, outputPath) {
    await execFileAsync(this.command, this.buildMfaArgs(wavPath, textPath, outputPath), {
      timeout: this.timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8
    });
  }

  async alignWithDocker(tempRoot) {
    if (!this.dockerContainer) {
      throw new Error('MFA_DOCKER_CONTAINER is not configured');
    }

    const remoteRoot = `/tmp/bookparser-mfa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const remoteWavPath = `${remoteRoot}/utterance.wav`;
    const remoteTextPath = `${remoteRoot}/utterance.txt`;
    const remoteOutputPath = `${remoteRoot}/utterance.json`;
    const outputPath = path.join(tempRoot, 'utterance.json');

    try {
      await this.runDocker(['exec', this.dockerContainer, 'mkdir', '-p', remoteRoot]);
      await this.runDocker(['cp', path.join(tempRoot, 'utterance.wav'), `${this.dockerContainer}:${remoteWavPath}`]);
      await this.runDocker(['cp', path.join(tempRoot, 'utterance.txt'), `${this.dockerContainer}:${remoteTextPath}`]);
      await this.runDocker([
        'exec',
        this.dockerContainer,
        this.command,
        ...this.buildMfaArgs(remoteWavPath, remoteTextPath, remoteOutputPath)
      ]);
      await this.runDocker(['cp', `${this.dockerContainer}:${remoteOutputPath}`, outputPath]);
    } finally {
      await this.runDocker(['exec', this.dockerContainer, 'rm', '-rf', remoteRoot]).catch(() => {});
    }
  }

  buildMfaArgs(wavPath, textPath, outputPath) {
    return [
      'align_one',
      wavPath,
      textPath,
      this.dictionary,
      this.acousticModel,
      outputPath,
      '--output_format',
      'json',
      '--clean',
      '--overwrite',
      '--quiet'
    ];
  }

  async runDocker(args) {
    await execFileAsync(this.dockerCommand, args, {
      timeout: this.timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8
    });
  }

  extractTier(alignmentJson, tierName) {
    const tiers = alignmentJson?.tiers || {};
    const matchingTier = Object.entries(tiers).find(([name]) => (
      name.toLowerCase() === tierName || name.toLowerCase().endsWith(`- ${tierName}`)
    ));

    if (!matchingTier) {
      return [];
    }

    return (matchingTier[1]?.entries || [])
      .map(([startTime, endTime, label]) => ({
        startTime: Number(startTime),
        endTime: Number(endTime),
        label: String(label || '').trim()
      }))
      .filter((entry) => (
        Number.isFinite(entry.startTime) &&
        Number.isFinite(entry.endTime) &&
        entry.endTime > entry.startTime
      ));
  }

  mapWordIntervalsToText(wordIntervals, text) {
    const usableWords = wordIntervals.filter((entry) => (
      entry.label &&
      !this.isSilenceLabel(entry.label) &&
      entry.label !== '<unk>'
    ));

    if (usableWords.length === 0) {
      return [];
    }

    const textChars = Array.from(text);
    const ranges = [];
    let cursor = 0;

    usableWords.forEach((word, sequenceIndex) => {
      const label = this.normalizeLabel(word.label);
      const searchStart = cursor;
      const foundIndex = label ? text.indexOf(label, searchStart) : -1;

      let textStart;
      let textEnd;

      if (foundIndex >= 0) {
        textStart = foundIndex;
        textEnd = foundIndex + label.length;
        cursor = textEnd;
      } else {
        const remainingWords = usableWords.length - sequenceIndex;
        const remainingChars = Math.max(1, textChars.length - cursor);
        const span = Math.max(1, Math.round(remainingChars / remainingWords));
        textStart = cursor;
        textEnd = Math.min(text.length, cursor + span);
        cursor = textEnd;
      }

      ranges.push({
        startTime: word.startTime,
        endTime: word.endTime,
        textStart,
        textEnd,
        text: text.slice(textStart, textEnd),
        mora: word.label,
        phraseIndex: 0,
        moraIndex: sequenceIndex,
        alignmentProvider: 'mfa',
        alignmentLevel: 'word'
      });
    });

    return ranges;
  }

  normalizeLabel(label) {
    return String(label || '')
      .replace(/[、。！？!?.,，．「」『』（）()\[\]【】]/g, '')
      .trim();
  }

  isSilenceLabel(label) {
    const normalized = String(label || '').trim().toLowerCase();
    return ['', 'sil', 'sp', 'spn', 'silence', '<eps>'].includes(normalized);
  }
}

export default new MfaAlignmentService();
