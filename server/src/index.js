import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { config, logConfig } from './config/index.js';
import ollamaService from './services/ollamaService.js';
import japaneseService from './services/japaneseService.js';
import booksRouter from './routes/books.js';
import ttsRouter from './routes/tts.js';

// Log configuration
logConfig();

const app = express();

// Ensure directories exist
[config.uploadDir, config.booksDir].forEach(dir => {
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
const upload = multer({ dest: config.uploadDir });

// Test services on startup
ollamaService.testConnection();

// Mount routes
app.use('/api/books', booksRouter);
app.use('/api/text-to-speech', ttsRouter);

// List imports in progress
app.get('/api/imports', (req, res) => {
  fs.readdir(config.uploadDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read imports directory' });
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
    const filePath = path.join(config.uploadDir, filename);
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
        
        if (japaneseService.tokenizer) {
          // Use Kuromoji for Japanese tokenization
          const rawTokens = japaneseService.tokenize(line);
          
          // Apply basic token merging
          const tokens = japaneseService.mergeVerbTokens(
            japaneseService.mergePunctuationTokens(rawTokens), 
            {
              mergeAuxiliaryVerbs: true,
              mergeVerbParticles: true,
              mergeAllInflections: true,
              mergePunctuation: true
            }
          );
          
          // Prepare basic token data with hiragana readings
          const basicTokens = tokens.map(token => ({
            surface: token.surface_form,
            reading: japaneseService.katakanaToHiragana(token.reading),
            pos: token.pos,
            pos_detail: token.pos_detail_1
          }));
          
          // Get dictionary translations for each token
          const enhancedTokens = await Promise.all(basicTokens.map(async (token) => {
            // Look up in JMDict dictionary
            const dictLookup = await japaneseService.lookupInJMDict(token.surface, token.reading);
            
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
    const bookFilePath = path.join(config.booksDir, `${filename}.book`);
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
  const filePath = path.join(config.uploadDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

  // Check if there's a corresponding .book file with processed data
  const bookFilePath = path.join(config.booksDir, `${req.params.filename}.book`);
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

// Save individual processed sentence (for auto-save)
app.post('/api/import/:filename/save-sentence', (req, res) => {
  const filePath = path.join(config.uploadDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const { sentenceIndex, sentenceData, verbMergeOptions, timestamp } = req.body;
  const bookFileName = req.params.filename;

  try {
    // Check if book file already exists
    const bookFilePath = path.join(config.booksDir, `${bookFileName}.book`);
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
  const filePath = path.join(config.uploadDir, req.params.filename);
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
    const jsonDestPath = path.join(config.booksDir, `${bookFileName}.book`);
    fs.writeFileSync(jsonDestPath, JSON.stringify(completeBookData, null, 2), 'utf-8');

    // Also save original text file for compatibility
    const txtDestPath = path.join(config.booksDir, bookFileName);
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
  console.log(`Using remote processing (Ollama): ${useRemoteProcessing}`);

  // Prepare context sentences for Ollama (only if using remote processing)
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

    if (japaneseService.tokenizer) {
      // Use Kuromoji for Japanese tokenization
      const rawTokens = japaneseService.tokenize(text);
      console.log('Raw Kuromoji tokens:', rawTokens.slice(0, 5)); // Log first 5 tokens for debugging

      // Apply punctuation merging first
      let tokensAfterPunctuation = verbMergeOptions.mergePunctuation !== false ?
        japaneseService.mergePunctuationTokens(rawTokens) : rawTokens;

      // Apply verb merging based on options
      let tokens;
      if (verbMergeOptions.useCompoundDetection) {
        // First detect compound verbs, then apply regular merging
        const compoundTokens = japaneseService.detectCompoundVerbs(tokensAfterPunctuation);
        tokens = japaneseService.mergeVerbTokens(compoundTokens, verbMergeOptions);
      } else {
        // Just apply regular verb merging
        tokens = japaneseService.mergeVerbTokens(tokensAfterPunctuation, verbMergeOptions);
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
        reading: japaneseService.katakanaToHiragana(token.reading),
        pos: token.pos,
        pos_detail: token.pos_detail_1
      }));

      // Get Ollama analysis for enhanced translations and explanations (only if using remote processing)
      let ollamaAnalysis = null;
      if (useRemoteProcessing) {
        console.log('Calling Ollama for enhanced analysis...');
        try {
          ollamaAnalysis = await ollamaService.getAnalysis(text, basicTokens, contextSentences);
          console.log('[Ollama] Analysis completed successfully');
        } catch (ollamaError) {
          console.error('[Ollama] Analysis failed:', ollamaError);
          // Don't throw the error, just log it and continue with local processing
          console.log('[Ollama] Falling back to local dictionary processing only');
        }
      } else {
        console.log('Skipping Ollama analysis - using local processing only');
      }

      // Extract full line translation and token data from Ollama response
      let fullLineTranslation = 'N/A';
      let tokenAnalysisData = [];

      if (ollamaAnalysis) {
        if (ollamaAnalysis.fullLineTranslation) {
          fullLineTranslation = ollamaAnalysis.fullLineTranslation;
          tokenAnalysisData = ollamaAnalysis.tokens || [];
        } else if (Array.isArray(ollamaAnalysis)) {
          // Fallback for old format
          tokenAnalysisData = ollamaAnalysis;
        }
      }

      // Merge Kuromoji, JMDict, and Ollama data
      const enhancedTokens = await Promise.all(basicTokens.map(async (token, index) => {
        const aiData = tokenAnalysisData.find(ai => ai.surface === token.surface) || {};

        // Look up in JMDict dictionary
        const dictLookup = await japaneseService.lookupInJMDict(token.surface, token.reading);

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
        ? (ollamaAnalysis ? 'Processed with AI translations' : 'Processed with dictionary only (AI unavailable)')
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
          hasAIAnalysis: !!ollamaAnalysis
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

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
