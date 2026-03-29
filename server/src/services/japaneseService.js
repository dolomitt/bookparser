import kuromoji from 'kuromoji';
import JMDict from 'jmdict-simplified-node';
import { setup as setupJmdict, readingBeginning, kanjiBeginning } from 'jmdict-simplified-node';
import frequencyService from './frequencyService.js';

class JapaneseService {
  constructor() {
    this.tokenizer = null;
    this.jmdictDb = null;

    if (process.env.NODE_ENV === 'test' || process.env.SKIP_LANGUAGE_INIT === 'true') {
      console.log('[JMDict] Skipping language resource initialization');
      return;
    }

    this.initializeTokenizer();
    this.initializeJMDict();
  }

  // Initialize Kuromoji tokenizer
  initializeTokenizer() {
    kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, tokenizer) => {
      if (err) {
        console.error('Failed to initialize Kuromoji tokenizer:', err);
      } else {
        this.tokenizer = tokenizer;
        console.log('Kuromoji tokenizer initialized successfully');
      }
    });
  }

  // Initialize JMDict dictionary
  async initializeJMDict() {
    try {
      console.log('[JMDict] Initializing JMDict dictionary...');
      // Try to use existing database first, if that fails, parse from JSON
      try {
        console.log('[JMDict] Attempting to load existing database...');
        const jmdictSetup = await setupJmdict('./jmdict-db', 'jmdict-eng-3.6.1.json');
        this.jmdictDb = jmdictSetup.db;
        console.log('[JMDict] ✅ Dictionary initialized from existing database');
        console.log('[JMDict] Dictionary date:', jmdictSetup.dictDate);
        console.log('[JMDict] Dictionary version:', jmdictSetup.version);
      } catch (dbError) {
        console.log('[JMDict] ⚠️ Existing database not found or corrupted, parsing from JSON file...');
        console.log('[JMDict] This may take a few minutes...');
        try {
          // Parse from JSON file (this will take some time)
          const jmdictSetup = await setupJmdict('./jmdict-db', 'jmdict-eng-3.6.1.json');
          this.jmdictDb = jmdictSetup.db;
          console.log('[JMDict] ✅ Dictionary initialized from JSON file');
          console.log('[JMDict] Dictionary date:', jmdictSetup.dictDate);
          console.log('[JMDict] Dictionary version:', jmdictSetup.version);
        } catch (jsonError) {
          console.error('[JMDict] ❌ Failed to parse JSON file:', jsonError);
          throw jsonError;
        }
      }
    } catch (err) {
      console.error('[JMDict] ❌ Failed to initialize JMDict dictionary:', err);
      console.log('[JMDict] Dictionary will be unavailable - using AI translations only');
    }
  }

  // Function to lookup word in JMDict
  async lookupInJMDict(word, reading) {
    //console.log(`[JMDict] Looking up word: "${word}", reading: "${reading}"`);

    if (!this.jmdictDb) {
      console.log('[JMDict] Database not available - skipping lookup');
      return null;
    }

    try {
      //console.log(`[JMDict] Searching by kanji: "${word}"`);
      // Search by kanji first
      let results = await kanjiBeginning(this.jmdictDb, word, 3);
      //console.log(`[JMDict] Kanji search results: ${results.length} entries found`);

      // If no results by kanji, try by reading
      if (results.length === 0 && reading) {
        //console.log(`[JMDict] No kanji results, searching by reading: "${reading}"`);
        results = await readingBeginning(this.jmdictDb, reading, 3);
        //console.log(`[JMDict] Reading search results: ${results.length} entries found`);
      }

      if (results.length > 0) {
        // Return the first result with English meanings
        const result = results[0];

        // Debug: log the structure of the first sense to understand the data
        //console.log(`[DEBUG] First sense structure:`, JSON.stringify(result.sense[0], null, 2));

        const meanings = result.sense
          .filter(s => s.gloss && s.gloss.length > 0)
          .map(s => {
            // Handle different possible structures of gloss
            return s.gloss.map(g => {
              if (typeof g === 'string') {
                return g;
              } else if (g && typeof g === 'object' && g.text) {
                return g.text;
              } else if (g && typeof g === 'object' && g.value) {
                return g.value;
              } else {
                return String(g);
              }
            }).join(', ');
          })
          .join('; ');

        const lookupResult = {
          word: word,
          reading: reading,
          meanings: meanings || 'No translation found',
          partOfSpeech: result.sense[0]?.partOfSpeech || [],
          source: 'JMDict'
        };

        //console.log(`[JMDict] ✅ Found translation for "${word}": "${meanings}"`);
        return lookupResult;
      } else {
        console.log(`[JMDict] ❌ No results found for "${word}" (reading: "${reading}")`);
      }
    } catch (error) {
      console.error(`[JMDict] ❌ Error looking up word "${word}":`, error);
    }

    return null;
  }

  // Function to convert katakana to hiragana
  katakanaToHiragana(str) {
    if (!str) return str;
    return str.replace(/[\u30A1-\u30F6]/g, function (match) {
      const chr = match.charCodeAt(0) - 0x60;
      return String.fromCharCode(chr);
    });
  }

  // Tokenize text using Kuromoji
  tokenize(text) {
    if (!this.tokenizer) {
      throw new Error('Kuromoji tokenizer not initialized');
    }
    return this.tokenizer.tokenize(text);
  }

  // Function to merge punctuation tokens
  mergePunctuationTokens(tokens) {
    const mergedTokens = [];
    let i = 0;

    while (i < tokens.length) {
      const currentToken = tokens[i];

      // Check if current token is punctuation
      if (currentToken.pos === '記号') {
        let punctuationGroup = [currentToken];
        let j = i + 1;

        // Look ahead for consecutive punctuation
        while (j < tokens.length && tokens[j].pos === '記号') {
          punctuationGroup.push(tokens[j]);
          j++;
        }

        // Create merged punctuation token if multiple found
        if (punctuationGroup.length > 1) {
          const mergedPunctuation = {
            surface_form: punctuationGroup.map(t => t.surface_form).join(''),
            reading: punctuationGroup.map(t => t.reading || t.surface_form).join(''),
            pos: '記号',
            pos_detail_1: 'merged',
            pos_detail_2: currentToken.pos_detail_2,
            pos_detail_3: currentToken.pos_detail_3,
            basic_form: punctuationGroup.map(t => t.basic_form || t.surface_form).join(''),
            pronunciation: punctuationGroup.map(t => t.pronunciation || t.reading || t.surface_form).join(''),
            isMergedPunctuation: true,
            originalTokens: punctuationGroup,
            mergeReason: 'punctuation_sequence'
          };
          mergedTokens.push(mergedPunctuation);
        } else {
          mergedTokens.push(currentToken);
        }

        i = j;
      } else {
        mergedTokens.push(currentToken);
        i++;
      }
    }

    return mergedTokens;
  }

  // Function to merge verb tokens with all inflections into single units
  mergeVerbTokens(tokens, options = {}) {
    const {
      mergeAuxiliaryVerbs = true,
      mergeVerbParticles = true,
      mergeVerbSuffixes = true,
      mergeTeForm = true,
      mergeMasuForm = true,
      mergeAllInflections = true,
      mergePunctuation = true,
      customMergePatterns = []
    } = options;

    const mergedTokens = [];
    let i = 0;

    // Comprehensive list of verb inflections and particles to merge
    const verbInflections = [
      // Basic inflections
      'て', 'で', 'た', 'だ', 'ない', 'なかった', 'ぬ', 'ず',
      // Masu forms
      'ます', 'ました', 'ません', 'ませんでした', 'ましょう',
      // Potential forms
      'れる', 'られる', 'える', 'られ',
      // Passive/Causative
      'せる', 'させる', 'れる', 'られる',
      // Conditional
      'ば', 'れば', 'たら', 'だら', 'なら',
      // Volitional
      'う', 'よう', 'ろう',
      // Imperative
      'ろ', 'よ', 'れ',
      // Copula and auxiliary
      'である', 'です', 'でした', 'だった', 'じゃない', 'ではない',
      // Continuous/Progressive
      'いる', 'ある', 'おる',
      // Other common endings
      'そう', 'らしい', 'みたい', 'ようだ', 'っぽい'
    ];

    // Particles that commonly attach to verbs
    const verbParticles = [
      'は', 'が', 'を', 'に', 'で', 'と', 'から', 'まで', 'より', 'へ',
      'も', 'だけ', 'しか', 'ばかり', 'など', 'なり', 'やら', 'か'
    ];

    // Auxiliary verbs and helping verbs
    const auxiliaryPatterns = [
      'いる', 'ある', 'おる', 'くる', 'いく', 'みる', 'しまう', 'おく',
      'あげる', 'くれる', 'もらう', 'やる', 'いただく', 'さしあげる'
    ];

    while (i < tokens.length) {
      const currentToken = tokens[i];

      // Check if current token is a verb
      if (currentToken.pos === '動詞') {
        let verbGroup = [currentToken];
        let j = i + 1;

        // Look ahead for tokens that should be merged with the verb
        while (j < tokens.length) {
          const nextToken = tokens[j];
          let shouldMerge = false;

          // Merge auxiliary verbs
          if (mergeAuxiliaryVerbs && nextToken.pos === '助動詞') {
            shouldMerge = true;
          }
          // Merge verb suffixes
          else if (mergeVerbSuffixes && nextToken.pos === '動詞' && nextToken.pos_detail_1 === '接尾') {
            shouldMerge = true;
          }
          // Merge all verb inflections
          else if (mergeAllInflections && verbInflections.includes(nextToken.surface_form)) {
            shouldMerge = true;
          }
          // Merge auxiliary verb patterns
          else if (mergeAuxiliaryVerbs && auxiliaryPatterns.includes(nextToken.surface_form)) {
            shouldMerge = true;
          }
          // Merge specific particles that attach to verbs
          else if (mergeVerbParticles && nextToken.pos === '助詞') {
            // Only merge particles that are commonly part of verb constructions
            // Exclude と as it's a quotative/conjunctive particle that should remain separate
            if (['て', 'で', 'た', 'だ', 'ば', 'ても', 'でも', 'ながら', 'つつ'].includes(nextToken.surface_form)) {
              shouldMerge = true;
            }
          }
          // Merge any token that's part of a verb conjugation pattern
          else if (nextToken.pos === '動詞' && nextToken.pos_detail_1 !== '自立') {
            shouldMerge = true;
          }
          // Merge tokens that are clearly inflectional morphemes
          else if (nextToken.pos_detail_1 === '接続助詞' || nextToken.pos_detail_1 === '格助詞') {
            if (['て', 'で', 'ば', 'と', 'ても', 'でも'].includes(nextToken.surface_form)) {
              shouldMerge = true;
            }
          }

          // Check custom merge patterns
          for (const pattern of customMergePatterns) {
            if (pattern.test && pattern.test(nextToken, currentToken)) {
              shouldMerge = true;
              break;
            }
          }

          if (shouldMerge) {
            verbGroup.push(nextToken);
            j++;
          } else {
            break;
          }
        }

        // Create merged verb token
        if (verbGroup.length > 1) {
          const mergedVerb = {
            surface_form: verbGroup.map(t => t.surface_form).join(''),
            reading: verbGroup.map(t => t.reading || t.surface_form).join(''),
            pos: '動詞',
            pos_detail_1: 'inflected',
            pos_detail_2: currentToken.pos_detail_2,
            pos_detail_3: currentToken.pos_detail_3,
            conjugated_type: currentToken.conjugated_type,
            conjugated_form: verbGroup[verbGroup.length - 1].conjugated_form,
            basic_form: currentToken.basic_form,
            pronunciation: verbGroup.map(t => t.pronunciation || t.reading || t.surface_form).join(''),
            isCompoundVerb: true,
            originalTokens: verbGroup,
            mergeReason: 'verb_inflection_complete',
            inflectionCount: verbGroup.length - 1
          };
          mergedTokens.push(mergedVerb);
        } else {
          mergedTokens.push(currentToken);
        }

        i = j;
      } else {
        mergedTokens.push(currentToken);
        i++;
      }
    }

    return mergedTokens;
  }

  // Alternative approach: Use compound word detection
  detectCompoundVerbs(tokens) {
    const compoundTokens = [];
    let i = 0;

    while (i < tokens.length) {
      const currentToken = tokens[i];

      // Look for verb + verb combinations (compound verbs)
      if (currentToken.pos === '動詞' && i + 1 < tokens.length) {
        const nextToken = tokens[i + 1];

        // Common compound verb patterns
        if (nextToken.pos === '動詞' ||
          (nextToken.surface_form && ['込む', '出す', '上げる', '下げる', '回る', '切る'].includes(nextToken.surface_form))) {

          const compoundVerb = {
            surface_form: currentToken.surface_form + nextToken.surface_form,
            reading: (currentToken.reading || currentToken.surface_form) + (nextToken.reading || nextToken.surface_form),
            pos: '動詞',
            pos_detail_1: 'compound',
            basic_form: currentToken.basic_form + nextToken.basic_form,
            isCompoundVerb: true,
            originalTokens: [currentToken, nextToken],
            mergeReason: 'compound_verb_pattern'
          };

          compoundTokens.push(compoundVerb);
          i += 2; // Skip both tokens
          continue;
        }
      }

      compoundTokens.push(currentToken);
      i++;
    }

    return compoundTokens;
  }

  // Check if a character is kanji
  isKanji(char) {
    const code = char.charCodeAt(0);
    return (code >= 0x4e00 && code <= 0x9faf) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x20000 && code <= 0x2a6df); // CJK Extension B
  }

  // Check if token contains kanji
  hasKanji(text) {
    return text.split('').some(char => this.isKanji(char));
  }

  // Enhance tokens with frequency-based furigana visibility
  enhanceTokensWithFrequency(tokens, frequencySettings = {}) {
    console.log('[Frequency] enhanceTokensWithFrequency called with settings:', frequencySettings);
    console.log('[Frequency] Processing', tokens.length, 'tokens');

    const {
      hideFrequentFurigana = true,
      frequencyThreshold = 1000,
      alwaysShowUnknown = true,
      customFrequencyRules = {}
    } = frequencySettings;

    return tokens.map(token => {
      const enhancedToken = { ...token };

      // Only process tokens that have kanji and reading
      if (this.hasKanji(token.surface_form) && token.reading && token.reading !== token.surface_form) {
        // Get the lemma (basic form) for proper frequency lookup
        const lemma = token.basic_form || token.surface_form;

        // Get frequency information using surface form, lemma, and reading
        const frequency = frequencyService.getFrequency(token.surface_form, lemma, token.reading);
        const frequencyCategory = frequencyService.getFrequencyCategory(token.surface_form, lemma, token.reading);

        // Only log for specific testing word "僕"
        if (lemma === '僕') {
          console.log(`[Frequency] Token: "${token.surface_form}" (lemma: "${lemma}", reading: "${token.reading}") -> frequency: ${frequency}, shouldHide: ${frequency >= frequencyThreshold}`);
        }

        // Determine if furigana should be hidden based on frequency
        let shouldHideFurigana = false;

        if (hideFrequentFurigana) {
          // Check custom rules first (check both surface form and lemma)
          if (customFrequencyRules[token.surface_form] !== undefined) {
            shouldHideFurigana = customFrequencyRules[token.surface_form];
          } else if (customFrequencyRules[lemma] !== undefined) {
            shouldHideFurigana = customFrequencyRules[lemma];
          } else if (frequency !== null) {
            // Use frequency threshold
            shouldHideFurigana = frequency >= frequencyThreshold;
          } else if (!alwaysShowUnknown) {
            // If word is unknown and we don't always show unknown words
            shouldHideFurigana = false;
          }
        }

        // Add frequency metadata to token
        enhancedToken.frequency = {
          frequency: frequency,
          category: frequencyCategory,
          shouldHideFurigana: shouldHideFurigana,
          hasFrequencyData: frequency !== null,
          lemma: lemma // Store the lemma used for lookup
        };
      } else {
        // For tokens without kanji or reading, no furigana needed
        enhancedToken.frequency = {
          frequency: null,
          category: 'no_kanji',
          shouldHideFurigana: true, // No furigana to hide
          hasFrequencyData: false,
          lemma: token.basic_form || token.surface_form
        };
      }

      return enhancedToken;
    });
  }

  // Get frequency statistics for a set of tokens
  getTokenFrequencyStats(tokens) {
    const stats = {
      totalTokens: tokens.length,
      tokensWithKanji: 0,
      tokensWithFrequencyData: 0,
      tokensWithHiddenFurigana: 0,
      frequencyDistribution: {
        very_common: 0,
        common: 0,
        somewhat_common: 0,
        uncommon: 0,
        rare: 0,
        unknown: 0
      }
    };

    tokens.forEach(token => {
      // Use the correct property name for surface form
      const surfaceForm = token.surface_form || token.surface;

      if (this.hasKanji(surfaceForm)) {
        stats.tokensWithKanji++;

        if (token.frequency) {
          if (token.frequency.hasFrequencyData) {
            stats.tokensWithFrequencyData++;
          }

          if (token.frequency.shouldHideFurigana) {
            stats.tokensWithHiddenFurigana++;
          }

          stats.frequencyDistribution[token.frequency.category]++;
        }
      }
    });

    return stats;
  }
}

export default new JapaneseService();
