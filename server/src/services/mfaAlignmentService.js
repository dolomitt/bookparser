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
      const phoneTimings = phoneIntervals
        .filter((entry) => entry.label && !this.isSilenceLabel(entry.label))
        .map((entry, phoneIndex) => ({
          startTime: entry.startTime,
          endTime: entry.endTime,
          phone: entry.label,
          phoneIndex
        }));
      const timings = this.mapPhoneIntervalsToText(wordIntervals, phoneTimings, text);

      if (timings.length === 0) {
        return null;
      }

      return {
        provider: 'mfa',
        timings,
        phoneTimings
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
    return this.mapWordIntervalsToRanges(wordIntervals, text).map((word, sequenceIndex) => ({
      startTime: word.startTime,
      endTime: word.endTime,
      textStart: word.textStart,
      textEnd: word.textEnd,
      text: word.text,
      mora: word.label,
      phraseIndex: 0,
      moraIndex: sequenceIndex,
      alignmentProvider: 'mfa',
      alignmentLevel: 'word'
    }));
  }

  mapWordIntervalsToRanges(wordIntervals, text) {
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
        label: word.label
      });
    });

    return ranges;
  }

  mapPhoneIntervalsToText(wordIntervals, phoneTimings, text) {
    const wordRanges = this.mapWordIntervalsToRanges(wordIntervals, text);
    const timings = [];

    wordRanges.forEach((word, wordIndex) => {
      const units = this.splitTextIntoTimingUnits(word.text, word.textStart);
      const phones = phoneTimings.filter((phone) => (
        phone.endTime > word.startTime - 0.01 &&
        phone.startTime < word.endTime + 0.01
      ));

      if (units.length === 0) {
        return;
      }

      if (phones.length === 0) {
        timings.push(...this.distributeWordAcrossUnits(word, units, wordIndex));
        return;
      }

      const phoneGroups = this.normalizePhoneGroups(this.groupPhonesIntoJapaneseMoras(phones), units.length);

      if (phoneGroups.length !== units.length) {
        timings.push(...this.distributeWordAcrossUnits(word, units, wordIndex));
        return;
      }

      phoneGroups.forEach((group, unitIndex) => {
        const unit = units[unitIndex];
        const startTime = Math.max(word.startTime, group.startTime);
        const endTime = Math.min(word.endTime, group.endTime);

        timings.push({
          startTime,
          endTime: endTime > startTime ? endTime : startTime + 0.01,
          textStart: unit.textStart,
          textEnd: unit.textEnd,
          text: unit.text,
          mora: unit.text,
          phraseIndex: wordIndex,
          moraIndex: unitIndex,
          alignmentProvider: 'mfa',
          alignmentLevel: 'phone-mora',
          phones: group.phones.map((phone) => phone.phone)
        });
      });
    });

    return timings.length > 0
      ? this.fillMissingTimingGaps(timings, text)
      : this.mapWordIntervalsToText(wordIntervals, text);
  }

  fillMissingTimingGaps(timings, text) {
    const sortedTimings = [...timings].sort((a, b) => (
      a.textStart - b.textStart || a.startTime - b.startTime
    ));
    const filledTimings = [];

    sortedTimings.forEach((timing, index) => {
      const previous = filledTimings[filledTimings.length - 1];

      if (previous && timing.textStart > previous.textEnd) {
        const gapText = text.slice(previous.textEnd, timing.textStart);
        const gapUnits = this.splitTextIntoTimingUnits(gapText, previous.textEnd);

        if (gapUnits.length > 0) {
          const gapStartTime = previous.endTime;
          const gapEndTime = Math.max(gapStartTime, timing.startTime);
          const gapDuration = gapEndTime - gapStartTime;

          if (gapDuration > 0.02) {
            const unitDuration = gapDuration / gapUnits.length;
            gapUnits.forEach((unit, unitIndex) => {
              filledTimings.push({
                startTime: gapStartTime + (unitIndex * unitDuration),
                endTime: gapStartTime + ((unitIndex + 1) * unitDuration),
                textStart: unit.textStart,
                textEnd: unit.textEnd,
                text: unit.text,
                mora: unit.text,
                phraseIndex: previous.phraseIndex,
                moraIndex: previous.moraIndex + unitIndex + 1,
                alignmentProvider: 'mfa',
                alignmentLevel: 'interpolated-gap'
              });
            });
          }
        }
      }

      filledTimings.push(timing);

      const next = sortedTimings[index + 1];
      if (!next && timing.textEnd < text.length) {
        const tailText = text.slice(timing.textEnd);
        const tailUnits = this.splitTextIntoTimingUnits(tailText, timing.textEnd);
        const tailDuration = Math.max(0.05, timing.endTime - timing.startTime);
        const unitDuration = tailDuration / Math.max(1, tailUnits.length);

        tailUnits.forEach((unit, unitIndex) => {
          filledTimings.push({
            startTime: timing.endTime + (unitIndex * unitDuration),
            endTime: timing.endTime + ((unitIndex + 1) * unitDuration),
            textStart: unit.textStart,
            textEnd: unit.textEnd,
            text: unit.text,
            mora: unit.text,
            phraseIndex: timing.phraseIndex,
            moraIndex: timing.moraIndex + unitIndex + 1,
            alignmentProvider: 'mfa',
            alignmentLevel: 'interpolated-tail'
          });
        });
      }
    });

    return filledTimings.sort((a, b) => (
      a.startTime - b.startTime || a.textStart - b.textStart
    ));
  }

  splitTextIntoTimingUnits(text, absoluteStart) {
    const units = [];
    const combiningSmallKana = new Set(['ゃ', 'ゅ', 'ょ', 'ャ', 'ュ', 'ョ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ゎ', 'ヮ']);
    const attachToPrevious = new Set(['ー']);
    let offset = 0;

    for (const char of text) {
      const length = char.length;
      const textStart = absoluteStart + offset;
      const textEnd = textStart + length;
      offset += length;

      if (this.isPunctuationOrWhitespace(char)) {
        continue;
      }

      const previous = units[units.length - 1];
      if (previous && (combiningSmallKana.has(char) || attachToPrevious.has(char))) {
        previous.text += char;
        previous.textEnd = textEnd;
        continue;
      }

      units.push({
        textStart,
        textEnd,
        text: char
      });
    }

    return units;
  }

  groupPhonesIntoJapaneseMoras(phones) {
    const groups = [];
    let current = [];

    phones.forEach((phone, index) => {
      current.push(phone);
      const nextPhone = phones[index + 1]?.phone || '';

      if (this.isJapaneseMoraNucleus(phone.phone, nextPhone)) {
        groups.push(this.createPhoneGroup(current));
        current = [];
      }
    });

    if (current.length > 0) {
      if (groups.length > 0) {
        groups[groups.length - 1] = this.createPhoneGroup([...groups[groups.length - 1].phones, ...current]);
      } else {
        groups.push(this.createPhoneGroup(current));
      }
    }

    return groups;
  }

  normalizePhoneGroups(groups, targetCount) {
    const normalized = groups.map((group) => ({ ...group, phones: [...group.phones] }));

    while (normalized.length < targetCount && normalized.length > 0) {
      const splitIndex = normalized
        .map((group, index) => ({ index, duration: group.endTime - group.startTime }))
        .sort((a, b) => b.duration - a.duration)[0].index;
      const group = normalized[splitIndex];
      const midpoint = group.startTime + ((group.endTime - group.startTime) / 2);
      const firstPhones = group.phones.length > 1
        ? group.phones.slice(0, Math.ceil(group.phones.length / 2))
        : [{ ...group.phones[0], endTime: midpoint }];
      const secondPhones = group.phones.length > 1
        ? group.phones.slice(Math.ceil(group.phones.length / 2))
        : [{ ...group.phones[0], startTime: midpoint }];

      normalized.splice(
        splitIndex,
        1,
        this.createPhoneGroup(firstPhones),
        this.createPhoneGroup(secondPhones)
      );
    }

    while (normalized.length > targetCount && normalized.length > 1) {
      let mergeIndex = 0;
      let shortestDuration = Infinity;

      for (let index = 0; index < normalized.length - 1; index += 1) {
        const duration = normalized[index].endTime - normalized[index].startTime;
        if (duration < shortestDuration) {
          shortestDuration = duration;
          mergeIndex = index;
        }
      }

      normalized.splice(
        mergeIndex,
        2,
        this.createPhoneGroup([
          ...normalized[mergeIndex].phones,
          ...normalized[mergeIndex + 1].phones
        ])
      );
    }

    return normalized;
  }

  createPhoneGroup(phones) {
    return {
      startTime: Math.min(...phones.map((phone) => phone.startTime)),
      endTime: Math.max(...phones.map((phone) => phone.endTime)),
      phones
    };
  }

  distributeWordAcrossUnits(word, units, wordIndex) {
    const duration = Math.max(0.01, word.endTime - word.startTime);
    const unitDuration = duration / units.length;

    return units.map((unit, unitIndex) => ({
      startTime: word.startTime + (unitIndex * unitDuration),
      endTime: word.startTime + ((unitIndex + 1) * unitDuration),
      textStart: unit.textStart,
      textEnd: unit.textEnd,
      text: unit.text,
      mora: unit.text,
      phraseIndex: wordIndex,
      moraIndex: unitIndex,
      alignmentProvider: 'mfa',
      alignmentLevel: 'distributed-word'
    }));
  }

  isJapaneseMoraNucleus(phone, nextPhone = '') {
    const normalized = String(phone || '').trim().toLowerCase();
    const next = String(nextPhone || '').trim().toLowerCase();

    if (/[aeiouɯəɛɔæɑɒ]/i.test(normalized)) {
      return true;
    }

    if (/^(n|m|ŋ|ɲ|ɴ|nː|mː|ŋː|ɲː)$/.test(normalized)) {
      return !next || !/[aeiouɯəɛɔæɑɒ]/i.test(next) || normalized.includes('ː');
    }

    return normalized === 'cl' || normalized === 'q';
  }

  isPunctuationOrWhitespace(char) {
    return /[\s、。！？!?.,，．「」『』（）()\[\]【】]/.test(char);
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
