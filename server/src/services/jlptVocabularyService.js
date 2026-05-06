import fs from 'node:fs';

class JlptVocabularyService {
  constructor() {
    this.levelRank = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
    this.entries = [];
    this.byVariant = new Map();
    this.source = null;
    this.load();
  }

  normalizeValue(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .trim();
  }

  normalizeReading(value) {
    return this.normalizeValue(value).replace(/[\u30A1-\u30F6]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0x60)
    );
  }

  hasKanji(value) {
    return /[\u3400-\u4dbf\u4e00-\u9faf]/.test(String(value || ''));
  }

  load() {
    try {
      const dataUrl = new URL('../data/jlptVocabulary.json', import.meta.url);
      const payload = JSON.parse(fs.readFileSync(dataUrl, 'utf-8'));
      this.entries = Array.isArray(payload.entries) ? payload.entries : [];
      this.source = payload.source || null;

      for (const entry of this.entries) {
        const variants = Array.isArray(entry.variants) && entry.variants.length > 0
          ? entry.variants
          : [entry.word, entry.reading];

        for (const variant of variants) {
          const key = this.normalizeValue(variant);
          if (!key) continue;

          const existing = this.byVariant.get(key);
          if (!existing || this.levelRank[entry.level] < this.levelRank[existing.level]) {
            this.byVariant.set(key, entry);
          }
        }
      }
    } catch (error) {
      console.warn('[JLPT Vocabulary] Failed to load vocabulary data:', error.message);
      this.entries = [];
      this.byVariant.clear();
    }
  }

  findMatch(token) {
    const surfaceCandidates = [
      token?.surface_form,
      token?.surface,
      token?.basic_form
    ];
    const tokenHasKanji = surfaceCandidates.some((candidate) => this.hasKanji(candidate));
    const candidates = tokenHasKanji
      ? surfaceCandidates
      : [...surfaceCandidates, token?.reading];

    for (const candidate of candidates) {
      const key = this.normalizeValue(candidate);
      if (!key) continue;
      const match = this.byVariant.get(key);
      const tokenReading = this.normalizeReading(token?.reading);
      const matchReading = this.normalizeReading(match?.reading);
      if (match && (!tokenReading || !matchReading || tokenReading === matchReading)) return match;
    }

    return null;
  }

  annotateTokens(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0 || this.byVariant.size === 0) {
      return tokens;
    }

    return tokens.map((token) => {
      const match = this.findMatch(token);
      if (!match) return token;

      return {
        ...token,
        jlptVocabulary: {
          level: match.level,
          word: match.word,
          reading: match.reading,
          meaning: match.meaning,
          sourceTitle: this.source?.title || 'JLPT Vocabulary',
          sourceUrl: this.source?.url || 'https://github.com/wkei/jlpt-vocab-api/tree/main/data-source'
        },
        vocabularyJlptLevel: match.level
      };
    });
  }
}

export default new JlptVocabularyService();
