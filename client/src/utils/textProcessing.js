// Text processing utilities
export const splitIntoSentences = (text) => {
  // Split by Japanese sentence endings, handling quotation marks properly
  // Use a more precise approach to avoid overlapping matches
  const sentences = [];
  let currentSentence = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    currentSentence += char;

    // Check for two-character endings first
    if ((char === '。' && nextChar === '」') ||
      (char === '」' && nextChar === '。') ||
      (char === '。' && nextChar === '』') ||
      (char === '』' && nextChar === '。') ||
      (char === '！' && nextChar === '」') ||
      (char === '」' && nextChar === '！') ||
      (char === '？' && nextChar === '」') ||
      (char === '」' && nextChar === '？')) {
      // Add the second character and complete the sentence
      currentSentence += nextChar;
      sentences.push(currentSentence.trim());
      currentSentence = '';
      i += 2; // Skip both characters
    }
    // Check for single-character endings only if not part of a two-character pattern
    else if ((char === '。' || char === '！' || char === '？') &&
      nextChar !== '」' && nextChar !== '』') {
      sentences.push(currentSentence.trim());
      currentSentence = '';
      i++;
    }
    else {
      i++;
    }
  }

  // Add any remaining text as the last sentence
  if (currentSentence.trim()) {
    sentences.push(currentSentence.trim());
  }

  return sentences.filter(sentence => sentence.length > 0);
};

export const isKanji = (char) => {
  const code = char.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9faf) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x20000 && code <= 0x2a6df); // CJK Extension B
};

export const hasKanji = (text) => {
  return text.split('').some(char => isKanji(char));
};

export const mapTimingsToTokens = (timings, tokens) => {
  const tokenTimings = [];
  let currentTextPos = 0;

  tokens.forEach((token, tokenIndex) => {
    const tokenStart = currentTextPos;
    const tokenEnd = currentTextPos + token.surface.length;

    // Find all timing points that overlap with this token
    const overlappingTimings = timings.filter(timing =>
      timing.textStart < tokenEnd && timing.textEnd > tokenStart
    );

    if (overlappingTimings.length > 0) {
      // Use the earliest start time and latest end time for this token
      const startTime = Math.min(...overlappingTimings.map(t => t.startTime));
      const endTime = Math.max(...overlappingTimings.map(t => t.endTime));

      tokenTimings.push({
        tokenIndex,
        startTime,
        endTime,
        token: token.surface
      });
    }

    currentTextPos = tokenEnd;
  });

  return tokenTimings;
};

export const getErrorMessage = (error) => {
  if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
    return 'Server not running. Please start the server with "npm run dev" in the bookparser directory.';
  } else if (error.response?.status === 503) {
    return 'Cannot connect to VOICEVOX engine';
  } else if (error.response?.status === 502) {
    return 'VOICEVOX engine error';
  } else if (error.response?.data?.error) {
    return error.response.data.error;
  } else {
    return `Error: ${error.message}`;
  }
};
