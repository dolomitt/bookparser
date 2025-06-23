import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import kuromoji from 'kuromoji';
import OpenAI from 'openai';

// Load env vars
dotenv.config();
console.log('Loaded .env values:');
console.log('PORT:', process.env.PORT);
console.log('UPLOAD_DIR:', process.env.UPLOAD_DIR);
console.log('BOOKS_DIR:', process.env.BOOKS_DIR);
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '[set]' : '[not set]');

const app = express();
const PORT = process.env.PORT || 5000;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './imports';
const BOOKS_DIR = process.env.BOOKS_DIR || './books';

// Ensure directories exist
[UPLOAD_DIR, BOOKS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json());

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

// Function to get OpenAI analysis for tokens
async function getOpenAIAnalysis(originalText, tokens) {
  if (!openai) {
    console.log('OpenAI not configured, skipping AI analysis');
    return null;
  }

  try {
    const tokenList = tokens.map(token => token.surface).join(' | ');

    const prompt = `Analyze this Japanese sentence and provide translations and contextual explanations for each token:

Original sentence: "${originalText}"
Tokens: ${tokenList}

For each token, provide:
1. English translation
2. Contextual meaning in this sentence
3. Grammatical role

Format as JSON array with objects containing: surface, translation, contextualMeaning, grammaticalRole

Example format:
[
  {
    "surface": "友人",
    "translation": "friend",
    "contextualMeaning": "refers to the narrator as Holmes' friend",
    "grammaticalRole": "noun, subject"
  }
]`;

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
      max_tokens: 2000
    });

    const response = completion.choices[0].message.content;
    console.log('OpenAI response:', response);

    // Try to parse JSON response
    try {
      return JSON.parse(response);
    } catch (parseError) {
      console.error('Failed to parse OpenAI JSON response:', parseError);
      return null;
    }
  } catch (error) {
    console.error('OpenAI API error:', error);
    return null;
  }
}

// --- API Endpoints ---

// List all books
app.get('/api/books', (req, res) => {
  fs.readdir(BOOKS_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read books directory' });
    res.json(files.filter(f => f.endsWith('.txt')));
  });
});

// List imports in progress
app.get('/api/imports', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read imports directory' });
    res.json(files.filter(f => f.endsWith('.txt')));
  });
});

// Upload book (txt)
app.post('/api/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename, originalname: req.file.originalname });
});

// Get content of imported file (line by line)
app.get('/api/import/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  res.json({ lines });
});

// Save processed file to books
app.post('/api/import/:filename/save', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  const destPath = path.join(BOOKS_DIR, req.body.bookname || req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  fs.copyFileSync(filePath, destPath);
  res.json({ success: true });
});

// Japanese text processing endpoint with Kuromoji
app.post('/api/parse', async (req, res) => {
  console.log('Received /api/parse request');
  console.log('Request body:', req.body);

  const { text, lineIndex } = req.body;

  if (!text) {
    console.log('Error: No text provided for processing');
    return res.status(400).json({ error: 'No text provided for processing' });
  }

  console.log(`Processing line ${lineIndex}: "${text.substring(0, 50)}..."`);

  try {
    let result;

    if (tokenizer) {
      // Use Kuromoji for Japanese tokenization
      const tokens = tokenizer.tokenize(text);
      console.log('Kuromoji tokens:', tokens.slice(0, 5)); // Log first 5 tokens for debugging

      // Count different types of tokens
      const words = tokens.filter(token =>
        token.pos === '名詞' || // Nouns
        token.pos === '動詞' || // Verbs
        token.pos === '形容詞' || // Adjectives
        token.pos === '副詞' // Adverbs
      );

      const nouns = tokens.filter(token => token.pos === '名詞');
      const verbs = tokens.filter(token => token.pos === '動詞');

      // Prepare basic token data
      const basicTokens = tokens.map(token => ({
        surface: token.surface_form,
        reading: token.reading,
        pos: token.pos,
        pos_detail: token.pos_detail_1
      }));

      // Get OpenAI analysis for enhanced translations and explanations
      console.log('Calling OpenAI for enhanced analysis...');
      const openaiAnalysis = await getOpenAIAnalysis(text, basicTokens);

      // Merge Kuromoji and OpenAI data
      const enhancedTokens = basicTokens.map((token, index) => {
        const aiData = openaiAnalysis?.find(ai => ai.surface === token.surface) || {};
        return {
          ...token,
          translation: aiData.translation || 'N/A',
          contextualMeaning: aiData.contextualMeaning || 'N/A',
          grammaticalRole: aiData.grammaticalRole || token.pos
        };
      });

      const analysisStatus = openaiAnalysis ? 'with AI translations' : 'basic analysis only';

      result = {
        result: `Japanese analysis ${analysisStatus} - Total tokens: ${tokens.length}, Words: ${words.length}, Nouns: ${nouns.length}, Verbs: ${verbs.length}, Characters: ${text.length}`,
        processed: true,
        originalText: text,
        lineIndex: lineIndex,
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
        lineIndex: lineIndex
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
