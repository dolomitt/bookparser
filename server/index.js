import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import kuromoji from 'kuromoji';
import OpenAI from 'openai';
import JMDict from 'jmdict-simplified-node';

// Load env vars
dotenv.config();
console.log('Loaded .env values:');
console.log('PORT:', process.env.PORT);
console.log('UPLOAD_DIR:', process.env.UPLOAD_DIR);
console.log('BOOKS_DIR:', process.env.BOOKS_DIR);
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '[set]' : '[not set]');
console.log('VOICEVOX_HOST:', process.env.VOICEVOX_HOST);
console.log('VOICEVOX_PORT:', process.env.VOICEVOX_PORT);
console.log('VOICEVOX_DEFAULT_SPEAKER:', process.env.VOICEVOX_DEFAULT_SPEAKER);

const app = express();
const PORT = process.env.PORT || 5000;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './imports';
const BOOKS_DIR = process.env.BOOKS_DIR || './books';

// Ensure directories exist
[UPLOAD_DIR, BOOKS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Request body keys:', Object.keys(req.body));
  }
  next();
});

// Multer setup for file uploads
const upload = multer({ dest: UPLOAD_DIR });

// Initialize OpenAI
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

// Initialize Kuromoji tokenizer
let tokenizer = null;
kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, _tokenizer) => {
  if (err) {
    console.error('Failed to initialize Kuromoji tokenizer:', err);
  } else {
    tokenizer = _tokenizer;
    console.log('Kuromoji tokenizer initialized successfully');
  }
});

// Initialize JMDict dictionary
let jmdictDb = null;
import { setup as setupJmdict, readingBeginning, kanjiBeginning } from 'jmdict-simplified-node';

// Initialize JMDict database
async function initializeJMDict() {
  try {
    console.log('[JMDict] Initializing JMDict dictionary...');
    // Try to use existing database first, if that fails, parse from JSON
    try {
      console.log('[JMDict] Attempting to load existing database...');
      const jmdictSetup = await setupJmdict('./jmdict-db', 'jmdict-eng-3.6.1.json');
      jmdictDb = jmdictSetup.db;
      console.log('[JMDict] ✅ Dictionary initialized from existing database');
      console.log('[JMDict] Dictionary date:', jmdictSetup.dictDate);
      console.log('[JMDict] Dictionary version:', jmdictSetup.version);
    } catch (dbError) {
      console.log('[JMDict] ⚠️ Existing database not found or corrupted, parsing from JSON file...');
      console.log('[JMDict] This may take a few minutes...');
      try {
        // Parse from JSON file (this will take some time)
        const jmdictSetup = await setupJmdict('./jmdict-db', 'jmdict-eng-3.6.1.json');
        jmdictDb = jmdictSetup.db;
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

// Start JMDict initialization
initializeJMDict();

// Function to lookup word in JMDict
async function lookupInJMDict(word, reading) {
  console.log(`[JMDict] Looking up word: "${word}", reading: "${reading}"`);

  if (!jmdictDb) {
    console.log('[JMDict] Database not available - skipping lookup');
    return null;
  }

  try {
    console.log(`[JMDict] Searching by kanji: "${word}"`);
    // Search by kanji first
    let results = await kanjiBeginning(jmdictDb, word, 3);
    console.log(`[JMDict] Kanji search results: ${results.length} entries found`);

    // If no results by kanji, try by reading
    if (results.length === 0 && reading) {
      console.log(`[JMDict] No kanji results, searching by reading: "${reading}"`);
      results = await readingBeginning(jmdictDb, reading, 3);
      console.log(`[JMDict] Reading search results: ${results.length} entries found`);
    }

    if (results.length > 0) {
      // Return the first result with English meanings
      const result = results[0];
      
      // Debug: log the structure of the first sense to understand the data
      console.log(`[DEBUG] First sense structure:`, JSON.stringify(result.sense[0], null, 2));
      
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

      console.log(`[JMDict] ✅ Found translation for "${word}": "${meanings}"`);
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
function katakanaToHiragana(str) {
  if (!str) return str;
  return str.replace(/[\u30A1-\u30F6]/g, function (match) {
    const chr = match.charCodeAt(0) - 0x60;
    return String.fromCharCode(chr);
  });
}

// Function to get OpenAI analysis for tokens
async function getOpenAIAnalysis(originalText, tokens, contextLines = {}) {
  console.log('[OpenAI] Starting OpenAI analysis...');
  console.log('[OpenAI] Original text:', originalText);
  console.log('[OpenAI] Number of tokens:', tokens.length);
  
  if (!openai) {
    console.log('[OpenAI] ❌ OpenAI not configured, skipping AI analysis');
    return null;
  }

  console.log('[OpenAI] ✅ OpenAI client is configured');

  try {
    const tokenList = tokens.map(token => token.surface).join(' | ');
    console.log('[OpenAI] Token list for analysis:', tokenList);

    // Build context with previous and next lines
    let contextText = '';
    if (contextLines.previousLine) {
      contextText += `Previous line: "${contextLines.previousLine}"\n`;
    }
    contextText += `Current line: "${originalText}"`;
    if (contextLines.nextLine) {
      contextText += `\nNext line: "${contextLines.nextLine}"`;
    }

    console.log('[OpenAI] Context text:', contextText);

    const prompt = `Analyze this Japanese sentence and provide translations and contextual explanations for each token, plus a full line translation:

Context:
${contextText}

Tokens to analyze: ${tokenList}

Please provide:
1. A complete, natural English translation of the entire line
2. Individual token analysis with translations and contextual explanations

Format as JSON object with this structure:
{
  "fullLineTranslation": "Complete natural English translation of the entire sentence",
  "tokens": [
    {
      "surface": "友人",
      "translation": "friend",
      "contextualMeaning": "refers to the narrator as Holmes' friend",
      "grammaticalRole": "noun, subject"
    }
  ]
}`;

    console.log('[OpenAI] 🚀 Sending request to OpenAI API...');
    console.log('[OpenAI] Using model: gpt-4');
    console.log('[OpenAI] Prompt length:', prompt.length, 'characters');

    const startTime = Date.now();
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a Japanese language expert. Provide accurate translations and contextual explanations for Japanese tokens."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 5000
    });

    const endTime = Date.now();
    console.log('[OpenAI] ✅ Received response from OpenAI API');
    console.log('[OpenAI] Response time:', endTime - startTime, 'ms');
    console.log('[OpenAI] Usage:', completion.usage);

    const response = completion.choices[0].message.content;
    console.log('[OpenAI] Raw response content:', response);

    // Try to parse JSON response - handle cases where there's text before the JSON
    try {
      // First try to parse the response directly
      const parsedResponse = JSON.parse(response);
      console.log('[OpenAI] ✅ Successfully parsed JSON response');
      console.log('[OpenAI] Full line translation:', parsedResponse.fullLineTranslation);
      console.log('[OpenAI] Number of token analyses:', parsedResponse.tokens?.length || 0);
      return parsedResponse;
    } catch (parseError) {
      console.log('[OpenAI] Direct JSON parse failed, trying to extract JSON from response...');
      
      // Try to find JSON object in the response
      try {
        // Look for JSON object starting with { and ending with }
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const jsonString = jsonMatch[0];
          const parsedResponse = JSON.parse(jsonString);
          console.log('[OpenAI] ✅ Successfully extracted and parsed JSON from response');
          console.log('[OpenAI] Full line translation:', parsedResponse.fullLineTranslation);
          console.log('[OpenAI] Number of token analyses:', parsedResponse.tokens?.length || 0);
          return parsedResponse;
        } else {
          console.error('[OpenAI] ❌ No JSON object found in response');
          console.error('[OpenAI] Raw response:', response);
          return null;
        }
      } catch (extractError) {
        console.error('[OpenAI] ❌ Failed to extract and parse JSON from response:', extractError);
        console.error('[OpenAI] Raw response that failed to parse:', response);
        return null;
      }
    }
  } catch (error) {
    console.error('[OpenAI] ❌ OpenAI API error:', error);
    console.error('[OpenAI] Error type:', error.constructor.name);
    console.error('[OpenAI] Error message:', error.message);
    
    if (error.response) {
      console.error('[OpenAI] HTTP status:', error.response.status);
      console.error('[OpenAI] Response data:', error.response.data);
    }
    
    if (error.code) {
      console.error('[OpenAI] Error code:', error.code);
    }
    
    // Re-throw the error so it can be caught by the calling function
    throw error;
  }
}

// --- API Endpoints ---

// List all books
app.get('/api/books', (req, res) => {
  fs.readdir(BOOKS_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read books directory' });
    // Return all files, not just .txt files
    res.json(files);
  });
});

// List imports in progress
app.get('/api/imports', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read imports directory' });
    // Return all files, not just .txt files
    res.json(files);
  });
});

// Upload book (txt) with automatic local processing
app.post('/api/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  const filename = req.file.filename;
  const originalname = req.file.originalname;
  
  console.log(`[AUTO-PROCESS] Starting automatic processing for uploaded file: ${originalname}`);
  
  try {
    // Read the uploaded file content
    const filePath = path.join(UPLOAD_DIR, filename);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
    
    console.log(`[AUTO-PROCESS] File contains ${lines.length} lines`);
    
    // Process each line with local processing (dictionary only)
    const processedData = {};
    let processedCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      
      try {
        console.log(`[AUTO-PROCESS] Processing line ${i + 1}/${lines.length}: "${line.substring(0, 30)}..."`);
        
        if (tokenizer) {
          // Use Kuromoji for Japanese tokenization
          const rawTokens = tokenizer.tokenize(line);
          
          // Apply basic token merging
          const tokens = mergeVerbTokens(mergePunctuationTokens(rawTokens), {
            mergeAuxiliaryVerbs: true,
            mergeVerbParticles: true,
            mergeAllInflections: true,
            mergePunctuation: true
          });
          
          // Prepare basic token data with hiragana readings
          const basicTokens = tokens.map(token => ({
            surface: token.surface_form,
            reading: katakanaToHiragana(token.reading),
            pos: token.pos,
            pos_detail: token.pos_detail_1
          }));
          
          // Get dictionary translations for each token
          const enhancedTokens = await Promise.all(basicTokens.map(async (token) => {
            // Look up in JMDict dictionary
            const dictLookup = await lookupInJMDict(token.surface, token.reading);
            
            let translation = 'N/A';
            if (dictLookup && dictLookup.meanings) {
              if (typeof dictLookup.meanings === 'string') {
                translation = dictLookup.meanings;
              } else if (Array.isArray(dictLookup.meanings)) {
                translation = dictLookup.meanings.join('; ');
              } else {
                translation = String(dictLookup.meanings);
              }
            }
            
            return {
              ...token,
              translation: translation,
              contextualMeaning: 'N/A',
              grammaticalRole: token.pos,
              dictionarySource: dictLookup ? dictLookup.source : null
            };
          }));
          
          // Count different types of tokens
          const words = tokens.filter(token =>
            token.pos === '名詞' || token.pos === '動詞' || token.pos === '形容詞' || token.pos === '副詞'
          );
          const nouns = tokens.filter(token => token.pos === '名詞');
          const verbs = tokens.filter(token => token.pos === '動詞');
          
          // Store processed line data
          processedData[i] = {
            result: 'Processed with local dictionary',
            processed: true,
            originalText: line,
            sentenceIndex: i,
            fullSentenceTranslation: 'N/A (local processing)',
            analysis: {
              totalTokens: tokens.length,
              words: words.length,
              nouns: nouns.length,
              verbs: verbs.length,
              characters: line.length,
              tokens: enhancedTokens,
              hasAIAnalysis: false
            }
          };
          
          processedCount++;
        } else {
          console.log(`[AUTO-PROCESS] Kuromoji not ready, skipping line ${i + 1}`);
        }
      } catch (lineError) {
        console.error(`[AUTO-PROCESS] Error processing line ${i + 1}:`, lineError);
        // Continue with next line even if one fails
      }
    }
    
    // Create book data structure with processed content
    const bookData = {
      metadata: {
        originalFilename: filename,
        bookname: originalname,
        savedAt: new Date().toISOString(),
        totalLines: lines.length,
        processedLines: processedCount,
        version: '1.0',
        autoProcessed: true,
        processingType: 'local_dictionary'
      },
      settings: {
        verbMergeOptions: {
          mergeAuxiliaryVerbs: true,
          mergeVerbParticles: true,
          mergeAllInflections: true,
          mergePunctuation: true
        },
        processingDate: new Date().toISOString()
      },
      content: {
        originalLines: lines,
        processedData: processedData
      }
    };
    
    // Save the processed book
    const bookFilePath = path.join(BOOKS_DIR, `${filename}.book`);
    fs.writeFileSync(bookFilePath, JSON.stringify(bookData, null, 2), 'utf-8');
    
    console.log(`[AUTO-PROCESS] ✅ Successfully processed and saved book: ${originalname}`);
    console.log(`[AUTO-PROCESS] Processed ${processedCount}/${lines.length} lines`);
    
    res.json({ 
      filename: filename, 
      originalname: originalname,
      autoProcessed: true,
      processedLines: processedCount,
      totalLines: lines.length,
      bookFile: `${filename}.book`
    });
    
  } catch (error) {
    console.error('[AUTO-PROCESS] Error during automatic processing:', error);
    // Still return success for the upload, but indicate processing failed
    res.json({ 
      filename: filename, 
      originalname: originalname,
      autoProcessed: false,
      error: 'Auto-processing failed, manual processing required'
    });
  }
});

// Get content of imported file (line by line) with any existing processed data
app.get('/api/import/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

  // Check if there's a corresponding .book file with processed data
  const bookFilePath = path.join(BOOKS_DIR, `${req.params.filename}.book`);
  let processedData = {};
  let processedSentences = {};
  let verbMergeOptions = {};

  if (fs.existsSync(bookFilePath)) {
    try {
      const bookData = JSON.parse(fs.readFileSync(bookFilePath, 'utf-8'));
      processedData = bookData.content?.processedData || {};
      processedSentences = bookData.content?.processedSentences || {};
      verbMergeOptions = bookData.settings?.verbMergeOptions || {};
      console.log(`Found existing processed data for ${req.params.filename} with ${Object.keys(processedData).length} processed lines and ${Object.keys(processedSentences).length} processed sentences`);
    } catch (error) {
      console.error('Error reading book file:', error);
    }
  }

  res.json({
    lines,
    existingProcessedData: processedData,
    existingProcessedSentences: processedSentences,
    existingVerbMergeOptions: verbMergeOptions
  });
});

// Save individual processed line (for auto-save)
app.post('/api/import/:filename/save-line', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const { lineIndex, lineData, verbMergeOptions, timestamp } = req.body;
  const bookFileName = req.params.filename;

  try {
    // Check if book file already exists
    const bookFilePath = path.join(BOOKS_DIR, `${bookFileName}.book`);
    let bookData = {};

    if (fs.existsSync(bookFilePath)) {
      // Load existing book data
      try {
        bookData = JSON.parse(fs.readFileSync(bookFilePath, 'utf-8'));
      } catch (error) {
        console.error('Error reading existing book file:', error);
        bookData = {};
      }
    }

    // Initialize book data structure if it doesn't exist
    if (!bookData.content) bookData.content = {};
    if (!bookData.content.processedData) bookData.content.processedData = {};
    if (!bookData.settings) bookData.settings = {};
    if (!bookData.metadata) bookData.metadata = {};

    // Update the specific line
    bookData.content.processedData[lineIndex] = lineData;
    bookData.settings.verbMergeOptions = verbMergeOptions;
    bookData.metadata.lastUpdated = timestamp;
    bookData.metadata.originalFilename = req.params.filename;

    // Save updated book data
    fs.writeFileSync(bookFilePath, JSON.stringify(bookData, null, 2), 'utf-8');

    console.log(`Auto-saved line ${lineIndex} for ${bookFileName}`);
    res.json({ success: true, lineIndex, savedAt: timestamp });
  } catch (error) {
    console.error('Error saving line:', error);
    res.status(500).json({ error: 'Failed to save line data' });
  }
});

// Save individual processed sentence (for auto-save)
app.post('/api/import/:filename/save-sentence', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const { sentenceIndex, sentenceData, verbMergeOptions, timestamp } = req.body;
  const bookFileName = req.params.filename;

  try {
    // Check if book file already exists
    const bookFilePath = path.join(BOOKS_DIR, `${bookFileName}.book`);
    let bookData = {};

    if (fs.existsSync(bookFilePath)) {
      // Load existing book data
      try {
        bookData = JSON.parse(fs.readFileSync(bookFilePath, 'utf-8'));
      } catch (error) {
        console.error('Error reading existing book file:', error);
        bookData = {};
      }
    }

    // Initialize book data structure if it doesn't exist
    if (!bookData.content) bookData.content = {};
    if (!bookData.content.processedSentences) bookData.content.processedSentences = {};
    if (!bookData.settings) bookData.settings = {};
    if (!bookData.metadata) bookData.metadata = {};

    // Update the specific sentence
    bookData.content.processedSentences[sentenceIndex] = sentenceData;
    bookData.settings.verbMergeOptions = verbMergeOptions;
    bookData.metadata.lastUpdated = timestamp;
    bookData.metadata.originalFilename = req.params.filename;

    // Save updated book data
    fs.writeFileSync(bookFilePath, JSON.stringify(bookData, null, 2), 'utf-8');

    console.log(`Auto-saved sentence ${sentenceIndex} for ${bookFileName}`);
    res.json({ success: true, sentenceIndex, savedAt: timestamp });
  } catch (error) {
    console.error('Error saving sentence:', error);
    res.status(500).json({ error: 'Failed to save sentence data' });
  }
});

// Save processed file to books with all analysis data
app.post('/api/import/:filename/save', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const { bookname, originalLines, processedData, verbMergeOptions, metadata } = req.body;
  const bookFileName = bookname || req.params.filename;

  // Create comprehensive book data structure
  const completeBookData = {
    metadata: {
      originalFilename: req.params.filename,
      bookname: bookFileName,
      savedAt: metadata?.savedAt || new Date().toISOString(),
      totalLines: metadata?.totalLines || 0,
      processedLines: metadata?.processedLines || 0,
      version: '1.0'
    },
    settings: {
      verbMergeOptions: verbMergeOptions || {},
      processingDate: new Date().toISOString()
    },
    content: {
      originalLines: originalLines || [],
      processedData: processedData || {}
    }
  };

  try {
    // Save as JSON file with .book extension for processed books
    const jsonDestPath = path.join(BOOKS_DIR, `${bookFileName}.book`);
    fs.writeFileSync(jsonDestPath, JSON.stringify(completeBookData, null, 2), 'utf-8');

    // Also save original text file for compatibility
    const txtDestPath = path.join(BOOKS_DIR, bookFileName);
    fs.copyFileSync(filePath, txtDestPath);

    console.log(`Saved book with processed data: ${jsonDestPath}`);
    console.log(`Book metadata:`, completeBookData.metadata);

    res.json({
      success: true,
      savedFiles: [jsonDestPath, txtDestPath],
      processedLines: Object.keys(processedData || {}).length
    });
  } catch (error) {
    console.error('Error saving book:', error);
    res.status(500).json({ error: 'Failed to save book data' });
  }
});

// Function to merge punctuation tokens
function mergePunctuationTokens(tokens) {
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
function mergeVerbTokens(tokens, options = {}) {
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
function detectCompoundVerbs(tokens) {
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

// Japanese text processing endpoint with Kuromoji
app.post('/api/parse', async (req, res) => {
  console.log('Received /api/parse request');
  console.log('Request body:', req.body);

  const { text, sentenceIndex, verbMergeOptions = {}, allSentences = [], useRemoteProcessing = true } = req.body;

  if (!text) {
    console.log('Error: No text provided for processing');
    return res.status(400).json({ error: 'No text provided for processing' });
  }

  console.log(`Processing sentence ${sentenceIndex}: "${text.substring(0, 50)}..."`);
  console.log(`Using remote processing (OpenAI): ${useRemoteProcessing}`);

  // Prepare context sentences for OpenAI (only if using remote processing)
  const contextSentences = {};
  if (useRemoteProcessing && allSentences && allSentences.length > 0) {
    if (sentenceIndex > 0) {
      contextSentences.previousSentence = allSentences[sentenceIndex - 1];
    }
    if (sentenceIndex < allSentences.length - 1) {
      contextSentences.nextSentence = allSentences[sentenceIndex + 1];
    }
  }

  try {
    let result;

    if (tokenizer) {
      // Use Kuromoji for Japanese tokenization
      const rawTokens = tokenizer.tokenize(text);
      console.log('Raw Kuromoji tokens:', rawTokens.slice(0, 5)); // Log first 5 tokens for debugging

      // Apply punctuation merging first
      let tokensAfterPunctuation = verbMergeOptions.mergePunctuation !== false ?
        mergePunctuationTokens(rawTokens) : rawTokens;

      // Apply verb merging based on options
      let tokens;
      if (verbMergeOptions.useCompoundDetection) {
        // First detect compound verbs, then apply regular merging
        const compoundTokens = detectCompoundVerbs(tokensAfterPunctuation);
        tokens = mergeVerbTokens(compoundTokens, verbMergeOptions);
      } else {
        // Just apply regular verb merging
        tokens = mergeVerbTokens(tokensAfterPunctuation, verbMergeOptions);
      }

      console.log('Processed tokens:', tokens.slice(0, 5)); // Log first 5 processed tokens

      // Log verb merging statistics
      const mergedVerbs = tokens.filter(token => token.isCompoundVerb);
      if (mergedVerbs.length > 0) {
        console.log(`Merged ${mergedVerbs.length} compound verbs:`,
          mergedVerbs.map(v => `${v.surface_form} (${v.mergeReason})`));
      }

      // Count different types of tokens
      const words = tokens.filter(token =>
        token.pos === '名詞' || // Nouns
        token.pos === '動詞' || // Verbs
        token.pos === '形容詞' || // Adjectives
        token.pos === '副詞' // Adverbs
      );

      const nouns = tokens.filter(token => token.pos === '名詞');
      const verbs = tokens.filter(token => token.pos === '動詞');

      // Prepare basic token data with hiragana readings
      const basicTokens = tokens.map(token => ({
        surface: token.surface_form,
        reading: katakanaToHiragana(token.reading),
        pos: token.pos,
        pos_detail: token.pos_detail_1
      }));

        // Get OpenAI analysis for enhanced translations and explanations (only if using remote processing)
        let openaiAnalysis = null;
        if (useRemoteProcessing) {
          console.log('Calling OpenAI for enhanced analysis...');
          try {
            openaiAnalysis = await getOpenAIAnalysis(text, basicTokens, contextSentences);
            console.log('[OpenAI] Analysis completed successfully');
          } catch (openaiError) {
            console.error('[OpenAI] Analysis failed:', openaiError);
            // Don't throw the error, just log it and continue with local processing
            console.log('[OpenAI] Falling back to local dictionary processing only');
          }
        } else {
          console.log('Skipping OpenAI analysis - using local processing only');
        }

      // Extract full line translation and token data from OpenAI response
      let fullLineTranslation = 'N/A';
      let tokenAnalysisData = [];

      if (openaiAnalysis) {
        if (openaiAnalysis.fullLineTranslation) {
          fullLineTranslation = openaiAnalysis.fullLineTranslation;
          tokenAnalysisData = openaiAnalysis.tokens || [];
        } else if (Array.isArray(openaiAnalysis)) {
          // Fallback for old format
          tokenAnalysisData = openaiAnalysis;
        }
      }

      // Merge Kuromoji, JMDict, and OpenAI data
      const enhancedTokens = await Promise.all(basicTokens.map(async (token, index) => {
        const aiData = tokenAnalysisData.find(ai => ai.surface === token.surface) || {};

        // Look up in JMDict dictionary
        const dictLookup = await lookupInJMDict(token.surface, token.reading);

        // Debug logging to see what we're getting from dictionary
        if (dictLookup) {
          console.log(`[DEBUG] Dictionary lookup for "${token.surface}":`, JSON.stringify(dictLookup, null, 2));
        }

        // For local processing, prioritize dictionary, for remote processing prioritize AI
        let translation = 'N/A';
        if (useRemoteProcessing) {
          // Remote processing: prioritize AI translation, fallback to dictionary
          translation = aiData.translation || 'N/A';
          if (translation === 'N/A' && dictLookup && dictLookup.meanings) {
            // Ensure we extract string properly
            if (typeof dictLookup.meanings === 'string') {
              translation = dictLookup.meanings;
            } else if (Array.isArray(dictLookup.meanings)) {
              translation = dictLookup.meanings.join('; ');
            } else {
              translation = String(dictLookup.meanings);
            }
          }
        } else {
          // Local processing: use dictionary only
          if (dictLookup && dictLookup.meanings) {
            // Ensure we extract string properly
            if (typeof dictLookup.meanings === 'string') {
              translation = dictLookup.meanings;
            } else if (Array.isArray(dictLookup.meanings)) {
              translation = dictLookup.meanings.join('; ');
            } else {
              translation = String(dictLookup.meanings);
            }
          }
        }

        return {
          ...token,
          translation: translation,
          contextualMeaning: aiData.contextualMeaning || 'N/A',
          grammaticalRole: aiData.grammaticalRole || token.pos,
          // Only include safe dictionary data, not the full object
          dictionarySource: dictLookup ? dictLookup.source : null
        };
      }));

      const analysisStatus = useRemoteProcessing 
        ? (openaiAnalysis ? 'Processed with AI translations' : 'Processed with dictionary only (AI unavailable)')
        : 'Processed with local dictionary';

        result = {
          result: analysisStatus,
          processed: true,
          originalText: text,
          sentenceIndex: sentenceIndex,
          fullSentenceTranslation: fullLineTranslation,
          analysis: {
            totalTokens: tokens.length,
            words: words.length,
            nouns: nouns.length,
            verbs: verbs.length,
            characters: text.length,
            tokens: enhancedTokens,
            hasAIAnalysis: !!openaiAnalysis
          }
        };
    } else {
      // Fallback to basic analysis if Kuromoji isn't ready
      const wordCount = text.trim().split(/\s+/).length;
      const charCount = text.length;

        result = {
          result: `Basic analysis - Words: ${wordCount}, Characters: ${charCount} (Kuromoji not ready)`,
          processed: true,
          originalText: text,
          sentenceIndex: sentenceIndex
        };
    }

    console.log('Sending response:', result);
    res.json(result);

  } catch (error) {
    console.error('Error processing text:', error);
    res.status(500).json({
      error: 'Failed to process text',
      details: error.message
    });
  }
});

// Text-to-speech endpoint using VOICEVOX with timing data
app.post('/api/text-to-speech', async (req, res) => {
  console.log('Received /api/text-to-speech request');
  
  const { text, speaker, includeTimings = false, speed = 1.0, volume = 1.0 } = req.body;
  
  // Use environment variables for VOICEVOX configuration
  const voicevoxHost = process.env.VOICEVOX_HOST || '192.168.1.43';
  const voicevoxPort = process.env.VOICEVOX_PORT || '50021';
  const defaultSpeaker = process.env.VOICEVOX_DEFAULT_SPEAKER || '1';
  const finalSpeaker = speaker || defaultSpeaker;
  const voicevoxBaseUrl = `http://${voicevoxHost}:${voicevoxPort}`;

  if (!text) {
    console.log('Error: No text provided for text-to-speech');
    return res.status(400).json({ error: 'No text provided for text-to-speech' });
  }

  console.log(`Generating speech for text: "${text.substring(0, 50)}..." with speaker ${finalSpeaker}`);
  console.log(`Using VOICEVOX at: ${voicevoxBaseUrl}, includeTimings: ${includeTimings}`);

  try {
    // Step 1: Get audio query from VOICEVOX
    console.log('[VOICEVOX] Requesting audio query...');
    const audioQueryUrl = `${voicevoxBaseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${finalSpeaker}`;
    const audioQueryResponse = await fetch(audioQueryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!audioQueryResponse.ok) {
      throw new Error(`Audio query failed: ${audioQueryResponse.status} ${audioQueryResponse.statusText}`);
    }

    const audioQuery = await audioQueryResponse.json();
    console.log('[VOICEVOX] Audio query successful');

    // Apply speed and volume settings to the audio query
    if (speed !== 1.0) {
      audioQuery.speedScale = speed;
      console.log(`[VOICEVOX] Applied speed scale: ${speed}`);
    }
    
    if (volume !== 1.0) {
      audioQuery.volumeScale = volume;
      console.log(`[VOICEVOX] Applied volume scale: ${volume}`);
    }

    // Step 2: Generate synthesis audio
    console.log('[VOICEVOX] Requesting audio synthesis...');
    const synthesisUrl = `${voicevoxBaseUrl}/synthesis?speaker=${finalSpeaker}`;
    const synthesisResponse = await fetch(synthesisUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(audioQuery),
    });

    if (!synthesisResponse.ok) {
      throw new Error(`Synthesis failed: ${synthesisResponse.status} ${synthesisResponse.statusText}`);
    }

    console.log('[VOICEVOX] Audio synthesis successful');

    // Step 3: Process timing data if requested
    if (includeTimings) {
      // Extract timing information from audio query
      const timingData = extractTimingData(audioQuery, text);
      
      // Return JSON response with both audio and timing data
      const audioBuffer = await synthesisResponse.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString('base64');
      
      res.json({
        audio: audioBase64,
        timings: timingData,
        audioFormat: 'wav',
        sampleRate: audioQuery.outputSamplingRate || 24000
      });
      
      console.log(`[VOICEVOX] Audio and timing data sent to client (${audioBuffer.byteLength} bytes audio, ${timingData.length} timing points)`);
    } else {
      // Return audio data only (original behavior)
      const audioBuffer = await synthesisResponse.arrayBuffer();
      
      // Set appropriate headers for audio response
      res.set({
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.byteLength,
        'Cache-Control': 'no-cache'
      });

      // Send the audio data
      res.send(Buffer.from(audioBuffer));
      console.log(`[VOICEVOX] Audio sent to client (${audioBuffer.byteLength} bytes)`);
    }

  } catch (error) {
    console.error('[VOICEVOX] Text-to-speech error:', error);
    
    let errorMessage = 'Speech generation failed';
    let statusCode = 500;
    
    if (error.message.includes('Failed to fetch') || error.message.includes('ECONNREFUSED')) {
      errorMessage = `Cannot connect to VOICEVOX engine at ${voicevoxBaseUrl}`;
      statusCode = 503;
    } else if (error.message.includes('Audio query failed') || error.message.includes('Synthesis failed')) {
      errorMessage = `VOICEVOX error: ${error.message}`;
      statusCode = 502;
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: error.message
    });
  }
});

// Helper function to extract timing data from VOICEVOX audio query
function extractTimingData(audioQuery, originalText) {
  console.log('[VOICEVOX] Extracting timing data...');
  console.log('[VOICEVOX] Audio query structure:', JSON.stringify(audioQuery, null, 2));
  
  const timings = [];
  let currentTime = 0;
  let textIndex = 0;
  
  // VOICEVOX audio query contains accent_phrases with moras
  if (audioQuery.accent_phrases && Array.isArray(audioQuery.accent_phrases)) {
    console.log(`[VOICEVOX] Found ${audioQuery.accent_phrases.length} accent phrases`);
    
    audioQuery.accent_phrases.forEach((phrase, phraseIndex) => {
      console.log(`[VOICEVOX] Processing phrase ${phraseIndex}:`, JSON.stringify(phrase, null, 2));
      
      if (phrase.moras && Array.isArray(phrase.moras)) {
        console.log(`[VOICEVOX] Phrase ${phraseIndex} has ${phrase.moras.length} moras`);
        
        phrase.moras.forEach((mora, moraIndex) => {
          console.log(`[VOICEVOX] Processing mora ${moraIndex}:`, JSON.stringify(mora, null, 2));
          
          // Each mora has a vowel_length (and consonant_length if applicable)
          const consonantLength = mora.consonant_length || 0;
          const vowelLength = mora.vowel_length || 0;
          
          // Calculate timing for this mora
          const startTime = currentTime;
          const endTime = currentTime + consonantLength + vowelLength;
          
          // Get mora text - try different possible fields
          const moraText = mora.text || mora.phoneme || mora.vowel || '';
          console.log(`[VOICEVOX] Mora text: "${moraText}", consonant: ${consonantLength}, vowel: ${vowelLength}`);
          
          // Map mora to original text characters
          let textLength = 1; // Default to 1 character
          let matchedText = '';
          
          if (textIndex < originalText.length) {
            const remainingText = originalText.substring(textIndex);
            matchedText = remainingText.charAt(0); // Default to next character
            
            // Try to match mora text if available
            if (moraText && remainingText.startsWith(moraText)) {
              textLength = moraText.length;
              matchedText = moraText;
            } else if (moraText) {
              // Try hiragana/katakana conversion
              for (let i = 1; i <= Math.min(3, remainingText.length); i++) {
                const candidate = remainingText.substring(0, i);
                if (candidate === moraText || 
                    katakanaToHiragana(candidate) === katakanaToHiragana(moraText)) {
                  textLength = i;
                  matchedText = candidate;
                  break;
                }
              }
            }
          }
          
          // Only add timing if we have a valid time duration and text
          if (endTime > startTime && matchedText) {
            const timingEntry = {
              startTime: startTime,
              endTime: endTime,
              textStart: textIndex,
              textEnd: textIndex + textLength,
              text: matchedText,
              mora: moraText,
              phraseIndex: phraseIndex,
              moraIndex: moraIndex,
              consonantLength: consonantLength,
              vowelLength: vowelLength
            };
            
            timings.push(timingEntry);
            console.log(`[VOICEVOX] Added timing: ${JSON.stringify(timingEntry)}`);
          }
          
          currentTime = endTime;
          textIndex += textLength;
        });
      }
      
      // Add pause after phrase if specified
      if (phrase.pause_mora && phrase.pause_mora.vowel_length) {
        console.log(`[VOICEVOX] Adding pause: ${phrase.pause_mora.vowel_length}s`);
        currentTime += phrase.pause_mora.vowel_length;
      }
    });
  } else {
    console.log('[VOICEVOX] No accent_phrases found in audio query');
  }
  
  console.log(`[VOICEVOX] Extracted ${timings.length} timing points`);
  console.log(`[VOICEVOX] Text coverage: ${textIndex}/${originalText.length} characters`);
  console.log(`[VOICEVOX] Total duration: ${currentTime}s`);
  
  return timings;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
