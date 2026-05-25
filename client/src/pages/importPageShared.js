export const JLPT_LEVEL_RANK = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };

export const TOKEN_SPACING = {
  AFTER_WORDS_PARTICLES: 'afterWordsParticles',
  NONE: 'none'
};

export const READING_FONT_SCALE = {
  DEFAULT: 1,
  MIN: 0.85,
  MAX: 1.5,
  STEP: 0.05
};

export const getSpeechTagsFromResponse = (responseData = {}) => {
  const rawTags = responseData.speechTags || responseData.analysis?.speechTags || [];
  return Array.isArray(rawTags)
    ? rawTags.filter((tag) => typeof tag === 'string' && tag.trim()).slice(0, 2)
    : [];
};

export const clampReadingFontScale = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return READING_FONT_SCALE.DEFAULT;

  const clamped = Math.min(
    READING_FONT_SCALE.MAX,
    Math.max(READING_FONT_SCALE.MIN, numericValue)
  );
  return Math.round(clamped * 100) / 100;
};

export const isKnownJlptGrammar = (token, jlptSettings = {}) => {
  const knownLevel = jlptSettings.knownLevel;
  const grammarLevel = token?.jlptGrammar?.level;
  if (!knownLevel || !grammarLevel) return false;
  return JLPT_LEVEL_RANK[grammarLevel] <= JLPT_LEVEL_RANK[knownLevel];
};

export const getDisplayToken = (token = {}) => {
  if (
    token.surface === '未' &&
    token.reading === 'み' &&
    /Sheep|Ram|Goat|zodiac|south-southwest|lunar calendar/i.test(token.translation || '')
  ) {
    return {
      ...token,
      translation: 'not yet; un-; non-; before',
      contextualMeaning: 'not yet; un-; non-',
      jlptVocabulary: null,
      vocabularyJlptLevel: null
    };
  }

  return token;
};
