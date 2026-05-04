const JLPT_RANK = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
const DIFFICULTY_PERCENTILE = 0.8;

function isPunctuationToken(token) {
  const surface = String(token?.surface || token?.surface_form || '').trim();
  if (!surface) return true;
  if (token?.pos === '記号') return true;
  return /^[。、，,.!?！？「」『』（）()[\]{}:：;；・…\s]+$/.test(surface);
}

function collectProcessedTokens(bookData = {}) {
  const processedSentences = bookData?.content?.processedSentences;
  if (!processedSentences || typeof processedSentences !== 'object') {
    return [];
  }

  return Object.values(processedSentences)
    .flatMap((sentence) => Array.isArray(sentence?.tokens) ? sentence.tokens : []);
}

function getTokenVocabularyLevel(token) {
  return (
    token?.jlptLevel ||
    token?.vocabularyJlptLevel ||
    token?.jlptVocabulary?.level ||
    null
  );
}

function getTokenGrammarLevel(token) {
  return token?.jlptGrammar?.level || null;
}

function getDistributionDifficulty(jlptCounts) {
  const total = JLPT_LEVELS.reduce((sum, level) => sum + (jlptCounts[level] || 0), 0);
  if (total === 0) return null;

  const target = total * DIFFICULTY_PERCENTILE;
  let cumulative = 0;

  for (const level of JLPT_LEVELS) {
    cumulative += jlptCounts[level] || 0;
    if (cumulative >= target) {
      return level;
    }
  }

  return 'N1';
}

export function getBookStats(bookData = {}) {
  const tokens = collectProcessedTokens(bookData);
  const wordTokens = tokens.filter((token) => !isPunctuationToken(token));
  const jlptCounts = {};
  const vocabularyCounts = {};
  const grammarCounts = {};

  for (const token of wordTokens) {
    const vocabularyLevel = getTokenVocabularyLevel(token);
    const grammarLevel = getTokenGrammarLevel(token);
    const level = JLPT_RANK[vocabularyLevel] ? vocabularyLevel : grammarLevel;
    if (!JLPT_RANK[level]) continue;

    jlptCounts[level] = (jlptCounts[level] || 0) + 1;
    if (level === vocabularyLevel) {
      vocabularyCounts[level] = (vocabularyCounts[level] || 0) + 1;
    } else {
      grammarCounts[level] = (grammarCounts[level] || 0) + 1;
    }
  }

  const jlptTaggedCount = JLPT_LEVELS.reduce((sum, level) => sum + (jlptCounts[level] || 0), 0);

  return {
    wordCount: wordTokens.length || null,
    difficultyLevel: getDistributionDifficulty(jlptCounts),
    jlptTaggedCount: jlptTaggedCount || null,
    jlptLevelCounts: jlptCounts,
    jlptVocabularyCounts: vocabularyCounts,
    jlptGrammarCounts: grammarCounts
  };
}
