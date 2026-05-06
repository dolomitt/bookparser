import kuromoji from 'kuromoji';
import JMDict from 'jmdict-simplified-node';
import { setup as setupJmdict, readingBeginning, kanjiBeginning } from 'jmdict-simplified-node';
import frequencyService from './frequencyService.js';

class JapaneseService {
  constructor() {
    this.tokenizer = null;
    this.jmdictDb = null;
    this.logLookupMisses = process.env.BOOKPARSER_JMDICT_LOG_MISSES === 'true';
    this.frequencyVerboseLogs = process.env.BOOKPARSER_FREQUENCY_VERBOSE === 'true';

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
      console.log('[JMDict] Attempting to open/create dictionary database...');
      const jmdictSetup = await setupJmdict('./jmdict-db', 'jmdict-eng-3.6.1.json');
      this.jmdictDb = jmdictSetup.db;
      console.log('[JMDict] ✅ Dictionary initialized');
      console.log('[JMDict] Dictionary date:', jmdictSetup.dictDate);
      console.log('[JMDict] Dictionary version:', jmdictSetup.version);
    } catch (err) {
      console.error('[JMDict] ❌ Failed to initialize JMDict dictionary:', err);
      console.log('[JMDict] Dictionary will be unavailable - using AI translations only');
    }
  }

  // Function to lookup word in JMDict
  async lookupInJMDict(word, reading) {
    //console.log(`[JMDict] Looking up word: "${word}", reading: "${reading}"`);

    if (word === '未' && this.katakanaToHiragana(reading) === 'み') {
      return {
        word,
        reading,
        meanings: 'not yet; un-; non-; before',
        partOfSpeech: ['pref'],
        source: 'JMDict'
      };
    }

    if (word === 'できにくい') {
      return {
        word,
        reading,
        meanings: 'hard to happen or form; unlikely to develop',
        partOfSpeech: ['v'],
        source: 'Rule'
      };
    }

    const stemAdjectiveMeanings = [
      { suffix: 'にくい', meaning: 'hard to do; difficult to do; unlikely to happen' },
      { suffix: 'やすい', meaning: 'easy to do; likely to happen' },
      { suffix: 'づらい', meaning: 'hard to do; difficult to do' },
      { suffix: 'がたい', meaning: 'hard to do; difficult to do' }
    ];
    const stemAdjectiveMeaning = stemAdjectiveMeanings.find(({ suffix }) =>
      typeof word === 'string' && word.length > suffix.length && word.endsWith(suffix)
    );
    if (stemAdjectiveMeaning) {
      return {
        word,
        reading,
        meanings: stemAdjectiveMeaning.meaning,
        partOfSpeech: ['v'],
        source: 'Rule'
      };
    }

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
        if (this.logLookupMisses) {
          console.log(`[JMDict] ❌ No results found for "${word}" (reading: "${reading}")`);
        }
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

  normalizeDigits(text) {
    return String(text || '').replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    );
  }

  readJapaneseNumber(number) {
    const value = Number.parseInt(this.normalizeDigits(number), 10);
    if (!Number.isInteger(value) || value < 0 || value > 99) {
      return null;
    }

    const ones = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
    if (value < 10) return ones[value] || null;
    if (value === 10) return 'じゅう';
    if (value < 20) return `じゅう${ones[value - 10]}`;

    const tens = Math.floor(value / 10);
    const remainder = value % 10;
    return `${ones[tens]}じゅう${ones[remainder]}`;
  }

  readJapaneseMonth(month) {
    const value = Number.parseInt(this.normalizeDigits(month), 10);
    const months = {
      1: 'いちがつ',
      2: 'にがつ',
      3: 'さんがつ',
      4: 'しがつ',
      5: 'ごがつ',
      6: 'ろくがつ',
      7: 'しちがつ',
      8: 'はちがつ',
      9: 'くがつ',
      10: 'じゅうがつ',
      11: 'じゅういちがつ',
      12: 'じゅうにがつ'
    };
    return months[value] || null;
  }

  readJapaneseDay(day) {
    const value = Number.parseInt(this.normalizeDigits(day), 10);
    const specialDays = {
      1: 'ついたち',
      2: 'ふつか',
      3: 'みっか',
      4: 'よっか',
      5: 'いつか',
      6: 'むいか',
      7: 'なのか',
      8: 'ようか',
      9: 'ここのか',
      10: 'とおか',
      14: 'じゅうよっか',
      20: 'はつか',
      24: 'にじゅうよっか'
    };
    if (specialDays[value]) return specialDays[value];
    if (value >= 1 && value <= 31) {
      const numberReading = this.readJapaneseNumber(value);
      return numberReading ? `${numberReading}にち` : null;
    }
    return null;
  }

  normalizeTokenReading(surface, reading) {
    const normalizedSurface = this.normalizeDigits(surface);
    const fullDateMatch = normalizedSurface.match(/^(\d{1,2})月(\d{1,2})日$/);
    if (fullDateMatch) {
      const monthReading = this.readJapaneseMonth(fullDateMatch[1]);
      const dayReading = this.readJapaneseDay(fullDateMatch[2]);
      if (monthReading && dayReading) {
        return `${monthReading}${dayReading}`;
      }
    }

    const monthMatch = normalizedSurface.match(/^(\d{1,2})月$/);
    if (monthMatch) {
      const monthReading = this.readJapaneseMonth(monthMatch[1]);
      if (monthReading) return monthReading;
    }

    const dayMatch = normalizedSurface.match(/^(\d{1,2})日$/);
    if (dayMatch) {
      const dayReading = this.readJapaneseDay(dayMatch[1]);
      if (dayReading) return dayReading;
    }

    return this.katakanaToHiragana(reading);
  }

  // Tokenize text using Kuromoji
  tokenize(text) {
    if (!this.tokenizer) {
      throw new Error('Kuromoji tokenizer not initialized');
    }
    return this.tokenizer.tokenize(text);
  }

  // Split lexicalized grammar compounds into learner-friendly pieces.
  // Example: "にあたる" -> "に" + "あたる"
  splitGrammarCompoundTokens(tokens, options = {}) {
    const { splitGrammarCompounds = true } = options;
    if (!splitGrammarCompounds) return tokens;

    const splitMap = {
      'にあたる': {
        meaning: 'to correspond to; to be equivalent to; to fall under',
        note: 'Grammar pattern: N にあたる = corresponding to / equivalent to N',
        parts: [
          { surface_form: 'に', reading: 'ニ', pos: '助詞', pos_detail_1: '格助詞', pos_detail_2: '*', pos_detail_3: '*', basic_form: 'に', pronunciation: 'ニ' },
          { surface_form: 'あたる', reading: 'アタル', pos: '動詞', pos_detail_1: '自立', pos_detail_2: '*', pos_detail_3: '*', basic_form: 'あたる', pronunciation: 'アタル' }
        ]
      },
      'について': {
        meaning: 'about; regarding; concerning',
        note: 'Grammar pattern: N について = about/regarding N',
        parts: [
          { surface_form: 'に', reading: 'ニ', pos: '助詞', pos_detail_1: '格助詞', pos_detail_2: '*', pos_detail_3: '*', basic_form: 'に', pronunciation: 'ニ' },
          { surface_form: 'ついて', reading: 'ツイテ', pos: '動詞', pos_detail_1: '自立', pos_detail_2: '*', pos_detail_3: '*', basic_form: 'つく', pronunciation: 'ツイテ' }
        ]
      },
      'によって': {
        meaning: 'by; due to; depending on',
        note: 'Grammar pattern: N によって = by/depending on N',
        parts: [
          { surface_form: 'に', reading: 'ニ', pos: '助詞', pos_detail_1: '格助詞', pos_detail_2: '*', pos_detail_3: '*', basic_form: 'に', pronunciation: 'ニ' },
          { surface_form: 'よって', reading: 'ヨッテ', pos: '動詞', pos_detail_1: '自立', pos_detail_2: '*', pos_detail_3: '*', basic_form: 'よる', pronunciation: 'ヨッテ' }
        ]
      },
      'に対して': {
        meaning: 'toward; against; in contrast to',
        note: 'Grammar pattern: N に対して = toward/against N',
        parts: [
          { surface_form: 'に', reading: 'ニ', pos: '助詞', pos_detail_1: '格助詞', pos_detail_2: '*', pos_detail_3: '*', basic_form: 'に', pronunciation: 'ニ' },
          { surface_form: '対して', reading: 'タイシテ', pos: '動詞', pos_detail_1: '自立', pos_detail_2: '*', pos_detail_3: '*', basic_form: '対する', pronunciation: 'タイシテ' }
        ]
      }
    };

    const expanded = [];

    for (const token of tokens) {
      const expression = splitMap[token.surface_form];
      if (!expression) {
        expanded.push(token);
        continue;
      }

      for (const part of expression.parts) {
        expanded.push({
          ...token,
          ...part,
          isSplitGrammarToken: true,
          originalCompound: token.surface_form,
          expressionSurface: token.surface_form,
          expressionMeaning: expression.meaning,
          expressionNote: expression.note
        });
      }
    }

    return expanded;
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

  isMergeableNounToken(token) {
    if (!token || token.pos !== '名詞') return false;
    if (token.isSplitGrammarToken) return false;
    if (token.pos_detail_1 === '非自立' || token.pos_detail_1 === '代名詞') return false;
    return true;
  }

  mergeNounCompounds(tokens, options = {}) {
    const { mergeNounCompounds = true } = options;
    if (!mergeNounCompounds) return tokens;

    const mergedTokens = [];
    let i = 0;

    while (i < tokens.length) {
      const currentToken = tokens[i];

      if (!this.isMergeableNounToken(currentToken)) {
        mergedTokens.push(currentToken);
        i += 1;
        continue;
      }

      const nounGroup = [currentToken];
      let j = i + 1;

      while (j < tokens.length && this.isMergeableNounToken(tokens[j])) {
        nounGroup.push(tokens[j]);
        j += 1;
      }

      if (nounGroup.length > 1) {
        mergedTokens.push({
          surface_form: nounGroup.map(t => t.surface_form).join(''),
          reading: nounGroup.map(t => t.reading || t.surface_form).join(''),
          pos: '名詞',
          pos_detail_1: 'compound',
          pos_detail_2: currentToken.pos_detail_2,
          pos_detail_3: currentToken.pos_detail_3,
          basic_form: nounGroup.map(t => t.basic_form || t.surface_form).join(''),
          pronunciation: nounGroup.map(t => t.pronunciation || t.reading || t.surface_form).join(''),
          isCompoundNoun: true,
          originalTokens: nounGroup,
          mergeReason: 'noun_compound'
        });
      } else {
        mergedTokens.push(currentToken);
      }

      i = j;
    }

    return mergedTokens;
  }

  mergePrefixNounCompounds(tokens, options = {}) {
    const { mergePrefixNounCompounds = true } = options;
    if (!mergePrefixNounCompounds) return tokens;

    const mergedTokens = [];
    let i = 0;

    while (i < tokens.length) {
      const prefixToken = tokens[i];
      const nounToken = tokens[i + 1];

      const matchesUnPrefixCompound =
        prefixToken?.surface_form === '未' &&
        prefixToken?.pos === '接頭詞' &&
        this.isMergeableNounToken(nounToken);

      if (matchesUnPrefixCompound) {
        const compoundGroup = [prefixToken, nounToken];
        mergedTokens.push({
          surface_form: compoundGroup.map(t => t.surface_form).join(''),
          reading: compoundGroup.map(t => t.reading || t.surface_form).join(''),
          pos: '名詞',
          pos_detail_1: 'prefix_compound',
          pos_detail_2: nounToken.pos_detail_2,
          pos_detail_3: nounToken.pos_detail_3,
          basic_form: compoundGroup.map(t => t.basic_form || t.surface_form).join(''),
          pronunciation: compoundGroup.map(t => t.pronunciation || t.reading || t.surface_form).join(''),
          isPrefixCompound: true,
          originalTokens: compoundGroup,
          mergeReason: 'mi_prefix_noun'
        });
        i += compoundGroup.length;
        continue;
      }

      mergedTokens.push(prefixToken);
      i += 1;
    }

    return mergedTokens;
  }

  mergeNominalizedNounPhrases(tokens, options = {}) {
    const { mergeNominalizedNounPhrases = true } = options;
    if (!mergeNominalizedNounPhrases) return tokens;

    const mergedTokens = [];
    let i = 0;

    while (i < tokens.length) {
      const currentToken = tokens[i];
      const noToken = tokens[i + 1];
      const stemToken = tokens[i + 2];
      const suffixToken = tokens[i + 3];

      const matchesNoVerbStemKata =
        currentToken?.pos === '名詞' &&
        noToken?.surface_form === 'の' &&
        noToken?.pos === '助詞' &&
        stemToken?.pos === '動詞' &&
        suffixToken?.surface_form === '方' &&
        suffixToken?.pos === '名詞';

      if (matchesNoVerbStemKata) {
        const phraseGroup = [currentToken, noToken, stemToken, suffixToken];
        mergedTokens.push({
          surface_form: phraseGroup.map(t => t.surface_form).join(''),
          reading: phraseGroup.map(t => t.reading || t.surface_form).join(''),
          pos: '名詞',
          pos_detail_1: 'nominalized_phrase',
          pos_detail_2: currentToken.pos_detail_2,
          pos_detail_3: currentToken.pos_detail_3,
          basic_form: `${currentToken.basic_form || currentToken.surface_form}の${stemToken.basic_form || stemToken.surface_form}方`,
          pronunciation: phraseGroup.map(t => t.pronunciation || t.reading || t.surface_form).join(''),
          isNominalizedPhrase: true,
          originalTokens: phraseGroup,
          mergeReason: 'noun_no_verbstem_kata'
        });
        i += phraseGroup.length;
        continue;
      }

      mergedTokens.push(currentToken);
      i += 1;
    }

    return mergedTokens;
  }

  mergeCoordinatedNounPhrases(tokens, options = {}) {
    const { mergeCoordinatedNounPhrases = true } = options;
    if (!mergeCoordinatedNounPhrases) return tokens;

    const mergedTokens = [];
    let i = 0;

    while (i < tokens.length) {
      const firstNoun = tokens[i];
      const particle = tokens[i + 1];
      const secondNoun = tokens[i + 2];

      const matchesCoordinatedNouns =
        firstNoun?.pos === '名詞' &&
        particle?.surface_form === 'と' &&
        particle?.pos === '助詞' &&
        particle?.pos_detail_1 === '並立助詞' &&
        secondNoun?.pos === '名詞';

      if (matchesCoordinatedNouns) {
        const phraseGroup = [firstNoun, particle, secondNoun];
        mergedTokens.push({
          surface_form: phraseGroup.map(t => t.surface_form).join(''),
          reading: phraseGroup.map(t => t.reading || t.surface_form).join(''),
          pos: '名詞',
          pos_detail_1: 'coordinated_phrase',
          pos_detail_2: firstNoun.pos_detail_2,
          pos_detail_3: firstNoun.pos_detail_3,
          basic_form: phraseGroup.map(t => t.basic_form || t.surface_form).join(''),
          pronunciation: phraseGroup.map(t => t.pronunciation || t.reading || t.surface_form).join(''),
          isCoordinatedPhrase: true,
          originalTokens: phraseGroup,
          mergeReason: 'noun_to_noun'
        });
        i += phraseGroup.length;
        continue;
      }

      mergedTokens.push(firstNoun);
      i += 1;
    }

    return mergedTokens;
  }

  mergeAuxiliarySequences(tokens, options = {}) {
    const { mergeAuxiliarySequences = true } = options;
    if (!mergeAuxiliarySequences) return tokens;

    const mergedTokens = [];
    let i = 0;

    while (i < tokens.length) {
      const currentToken = tokens[i];

      if (currentToken.pos === '助動詞' && !currentToken.isSplitGrammarToken) {
        const auxiliaryGroup = [currentToken];
        let j = i + 1;

        while (
          j < tokens.length &&
          tokens[j].pos === '助動詞' &&
          !tokens[j].isSplitGrammarToken
        ) {
          auxiliaryGroup.push(tokens[j]);
          j++;
        }

        if (auxiliaryGroup.length > 1) {
          const surfaceForm = auxiliaryGroup.map(t => t.surface_form).join('');
          const reading = auxiliaryGroup.map(t => t.reading || t.surface_form).join('');
          const pronunciation = auxiliaryGroup.map(t => t.pronunciation || t.reading || t.surface_form).join('');

          mergedTokens.push({
            surface_form: surfaceForm,
            reading,
            pos: '助動詞',
            pos_detail_1: 'compound',
            pos_detail_2: currentToken.pos_detail_2,
            pos_detail_3: currentToken.pos_detail_3,
            conjugated_type: currentToken.conjugated_type,
            conjugated_form: auxiliaryGroup[auxiliaryGroup.length - 1].conjugated_form,
            basic_form: currentToken.basic_form || surfaceForm,
            pronunciation,
            originalTokens: auxiliaryGroup,
            mergeReason: 'auxiliary_sequence'
          });
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

  mergeGrammarExpressions(tokens, options = {}) {
    const { mergeGrammarExpressions = true } = options;
    if (!mergeGrammarExpressions) return tokens;

    const expressionPatterns = [
      {
        parts: ['かも', 'しれない'],
        surface: 'かもしれない',
        reading: 'カモシレナイ',
        meaning: 'might; may; could be',
        note: 'Grammar pattern: かもしれない = might / may / could be'
      },
      {
        parts: ['かも', 'しれません'],
        surface: 'かもしれません',
        reading: 'カモシレマセン',
        meaning: 'might; may; could be',
        note: 'Polite grammar pattern: かもしれません = might / may / could be'
      },
      {
        parts: ['と', 'いう'],
        surface: 'という',
        reading: 'トイウ',
        meaning: 'called; that; saying that; the fact that',
        note: 'Grammar pattern: という = called / that / saying that'
      }
    ];

    const mergedTokens = [];
    let i = 0;

    while (i < tokens.length) {
      const pattern = expressionPatterns.find((candidate) =>
        candidate.parts.every((part, offset) => tokens[i + offset]?.surface_form === part)
      );

      if (!pattern) {
        mergedTokens.push(tokens[i]);
        i += 1;
        continue;
      }

      const expressionGroup = tokens.slice(i, i + pattern.parts.length);
      mergedTokens.push({
        surface_form: pattern.surface,
        reading: expressionGroup.map(t => t.reading || t.surface_form).join('') || pattern.reading,
        pos: '助動詞',
        pos_detail_1: 'grammar_expression',
        pos_detail_2: expressionGroup[0].pos_detail_2,
        pos_detail_3: expressionGroup[0].pos_detail_3,
        basic_form: pattern.surface,
        pronunciation: expressionGroup.map(t => t.pronunciation || t.reading || t.surface_form).join('') || pattern.reading,
        originalTokens: expressionGroup,
        mergeReason: 'grammar_expression',
        expressionSurface: pattern.surface,
        expressionMeaning: pattern.meaning,
        expressionNote: pattern.note
      });
      i += pattern.parts.length;
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
    const stemAdjectiveSuffixes = new Set(['にくい', 'やすい', 'づらい', 'がたい']);

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
          // Merge verb stem + auxiliary adjective patterns like できにくい.
          else if (
            mergeVerbSuffixes &&
            nextToken.pos === '形容詞' &&
            nextToken.pos_detail_1 === '非自立' &&
            stemAdjectiveSuffixes.has(nextToken.surface_form)
          ) {
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
    if (this.frequencyVerboseLogs) {
      console.log('[Frequency] enhanceTokensWithFrequency called with settings:', frequencySettings);
      console.log('[Frequency] Processing', tokens.length, 'tokens');
    }

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
        if (this.frequencyVerboseLogs && lemma === '僕') {
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
