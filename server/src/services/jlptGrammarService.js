import fs from 'node:fs';

class JlptGrammarService {
  constructor() {
    this.levelRank = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
    this.entries = [];
    this.byPattern = new Map();
    this.source = null;
    this.load();
  }

  normalizePattern(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[〜～]/g, '')
      .trim();
  }

  load() {
    try {
      const dataUrl = new URL('../data/jlptGrammar.json', import.meta.url);
      const payload = JSON.parse(fs.readFileSync(dataUrl, 'utf-8'));
      this.entries = Array.isArray(payload.entries) ? payload.entries : [];
      this.source = payload.source || null;

      for (const entry of this.entries) {
        const variants = Array.isArray(entry.variants) && entry.variants.length > 0
          ? entry.variants
          : [entry.pattern];

        for (const variant of variants) {
          const key = this.normalizePattern(variant);
          if (!key) continue;

          const existing = this.byPattern.get(key);
          if (!existing || this.levelRank[entry.level] < this.levelRank[existing.level]) {
            this.byPattern.set(key, entry);
          }
        }
      }
    } catch (error) {
      console.warn('[JLPT Grammar] Failed to load grammar data:', error.message);
      this.entries = [];
      this.byPattern.clear();
    }
  }

  findMatch(token) {
    const candidates = [
      token?.expressionSurface,
      token?.surface_form,
      token?.surface,
      token?.basic_form
    ];

    for (const candidate of candidates) {
      const key = this.normalizePattern(candidate);
      if (!key) continue;
      const match = this.byPattern.get(key);
      if (match) return match;
    }

    return null;
  }

  annotateTokens(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0 || this.byPattern.size === 0) {
      return tokens;
    }

    return tokens.map((token) => {
      const match = this.findMatch(token);
      if (!match) return token;

      return {
        ...token,
        jlptGrammar: {
          level: match.level,
          pattern: match.pattern,
          meaning: match.meaning,
          sourceTitle: this.source?.title || 'JLPT Grammar List',
          sourceUrl: this.source?.url || 'https://jlptgrammarlist.neocities.org/'
        }
      };
    });
  }
}

export default new JlptGrammarService();
