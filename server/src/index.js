import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, logConfig } from './config/index.js';
import ollamaService from './services/ollamaService.js';
import japaneseService from './services/japaneseService.js';
import booksRouter from './routes/books.js';
import ttsRouter from './routes/tts.js';

// Log configuration
logConfig();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../../client/dist');

// Ensure directories exist
[config.uploadDir, config.booksDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Add request logging middleware
const requestLogsEnabled = process.env.BOOKPARSER_REQUEST_LOGS === 'true';
app.use((req, res, next) => {
  if (requestLogsEnabled) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('Request body keys:', Object.keys(req.body));
    }
  }
  next();
});

// Multer setup for file uploads
const maxUploadSizeBytes = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || '', 10) || 10 * 1024 * 1024;
const upload = multer({
  dest: config.uploadDir,
  limits: {
    fileSize: maxUploadSizeBytes,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (extension !== '.txt') {
      cb(new Error('Only .txt files are allowed'));
      return;
    }
    cb(null, true);
  }
});

function uploadSingleTxt(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `File too large. Maximum size is ${Math.floor(maxUploadSizeBytes / (1024 * 1024))}MB`
        });
      }
      return res.status(400).json({ error: err.message });
    }

    return res.status(400).json({ error: err.message || 'Invalid upload request' });
  });
}

// Test services on startup
const shouldRunExternalChecks =
  process.env.NODE_ENV !== 'test' && process.env.SKIP_EXTERNAL_CHECKS !== 'true';

if (shouldRunExternalChecks) {
  ollamaService.testConnection();
} else {
  console.log('[Startup] Skipping external service checks');
}

// Mount routes
app.use('/api/books', booksRouter);
app.use('/api/text-to-speech', ttsRouter);

// List imports in progress
app.get('/api/imports', (req, res) => {
  fs.readdir(config.uploadDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read imports directory' });
    const pendingImports = files.filter((file) => {
      if (file === '.gitkeep') return false;
      const completedBookPath = path.join(config.booksDir, `${file}.book`);
      return !fs.existsSync(completedBookPath);
    });
    res.json(pendingImports);
  });
});

function loadLinesForImportFilename(filename) {
  const importTextPath = path.join(config.uploadDir, filename);
  const booksTextPath = path.join(config.booksDir, filename);
  const bookJsonPath = path.join(config.booksDir, `${filename}.book`);

  if (fs.existsSync(importTextPath)) {
    return {
      lines: fs.readFileSync(importTextPath, 'utf-8').split('\n'),
      sourceLocation: 'imports'
    };
  }

  if (fs.existsSync(booksTextPath)) {
    return {
      lines: fs.readFileSync(booksTextPath, 'utf-8').split('\n'),
      sourceLocation: 'books'
    };
  }

  if (fs.existsSync(bookJsonPath)) {
    try {
      const bookData = JSON.parse(fs.readFileSync(bookJsonPath, 'utf-8'));
      if (Array.isArray(bookData?.content?.originalLines)) {
        return {
          lines: bookData.content.originalLines,
          sourceLocation: 'books'
        };
      }
    } catch (error) {
      console.error('Error reading .book fallback content:', error);
    }
  }

  return null;
}

function resolveSourceTextPath(filename) {
  const importTextPath = path.join(config.uploadDir, filename);
  if (fs.existsSync(importTextPath)) {
    return importTextPath;
  }

  const booksTextPath = path.join(config.booksDir, filename);
  if (fs.existsSync(booksTextPath)) {
    return booksTextPath;
  }

  return null;
}

function validateImportUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(text) {
  const namedEntities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  return String(text || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const codePoint = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }

    return namedEntities[entity.toLowerCase()] || match;
  });
}

function extractTagContent(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(html || '').match(pattern);
  return match ? match[1] : '';
}

function htmlToPlainText(html) {
  const source = String(html || '');
  const mainHtml =
    extractTagContent(source, 'article') ||
    extractTagContent(source, 'main') ||
    extractTagContent(source, 'body') ||
    source;

  return decodeHtmlEntities(
    mainHtml
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<(?:p|div|section|article|main|header|footer|h[1-6]|li|br)\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|div|section|article|main|header|footer|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

function markdownToPlainText(markdown) {
  return String(markdown || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/^\s{0,3}> ?/gm, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/<[^>]+>/g, ' ');
}

function getMarkdownText(markdown) {
  if (!markdown) return '';
  if (typeof markdown === 'string') return markdown;
  return markdown.raw_markdown || markdown.fit_markdown || markdown.markdown_with_citations || '';
}

function normalizeTitleForMatching(title) {
  return String(title || '')
    .split(/\s+[|｜-]\s+|[|｜]/)[0]
    .replace(/\s+/g, '')
    .trim();
}

function lineMatchesTitle(line, title) {
  const normalizedTitle = normalizeTitleForMatching(title);
  if (!normalizedTitle || normalizedTitle.length < 4) return false;

  const normalizedLine = String(line || '').replace(/\s+/g, '').trim();
  return normalizedLine === normalizedTitle || normalizedLine.includes(normalizedTitle);
}

function trimArticleStart(lines, title = '') {
  const titleIndexes = [];

  lines.forEach((line, index) => {
    if (lineMatchesTitle(line, title)) {
      titleIndexes.push(index);
    }
  });

  if (titleIndexes.length > 1) {
    return lines.slice(titleIndexes[titleIndexes.length - 1]);
  }

  if (titleIndexes.length === 1 && titleIndexes[0] > 10) {
    return lines.slice(titleIndexes[0]);
  }

  return lines;
}

function cleanArticleLines(lines, title = '') {
  const trimmedLines = trimArticleStart(lines, title);
  const cleaned = [];
  let skipSidebarLines = 0;

  const stopPatterns = [
    /^Related Articles$/i,
    /^Topics\b/i,
    /^Newsletter$/i,
    /^SEE MORE STORIES$/i,
    /^©\s*\d{4}/i
  ];

  const skipPatterns = [
    /^Privacy Center$/i,
    /^Privacy Policy$/i,
    /^Powered by$/i,
    /^Skip to main content$/i,
    /^Open Navigation Menu$/i,
    /^Menu$/i,
    /^Subscribe$/i,
    /^MAGAZINE$/i,
    /^My Account$/i,
    /^Promotion$/i,
    /^EnglishDeutsch/i,
    /^ILLUSTRATION-/i,
    /^By [A-Z]/,
    /WIRED.*サブスクリプションサービス/,
    /関連記事はこちら/,
    /詳しくはこちら。?$/,
    /^雑誌『WIRED』日本版$/
  ];

  for (const line of trimmedLines) {
    if (stopPatterns.some((pattern) => pattern.test(line))) {
      break;
    }

    if (/^Most Popular$/i.test(line)) {
      skipSidebarLines = 9;
      continue;
    }

    if (skipSidebarLines > 0) {
      skipSidebarLines -= 1;
      continue;
    }

    if (skipPatterns.some((pattern) => pattern.test(line))) {
      continue;
    }

    cleaned.push(line);
  }

  return cleaned;
}

function normalizeArticleLines(text, article = {}) {
  const rawLines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}|\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^https?:\/\//i.test(line));

  return cleanArticleLines(rawLines, article.title).slice(0, 1200);
}

function getTitleFromHtml(html) {
  const titleMatch = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return '';
  return decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim();
}

function buildUrlImportFilename(articleUrl, title = '') {
  const parsed = new URL(articleUrl);
  const hostPart = parsed.hostname.replace(/^www\./i, '');
  const pathParts = parsed.pathname.split('/').map((part) => part.trim()).filter(Boolean);
  const lastPathPart = pathParts[pathParts.length - 1] || '';
  const rawBase = `${hostPart}-${lastPathPart || title || 'article'}`;
  const slug = rawBase
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'article';

  let filename = `${slug}.txt`;
  let candidatePath = path.join(config.uploadDir, filename);
  let counter = 2;
  while (fs.existsSync(candidatePath) || fs.existsSync(path.join(config.booksDir, `${filename}.book`))) {
    filename = `${slug}-${counter}.txt`;
    candidatePath = path.join(config.uploadDir, filename);
    counter += 1;
  }

  return filename;
}

async function scrapeArticleWithCrawl4AI(articleUrl) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (config.crawl4ai.token) {
    headers.Authorization = `Bearer ${config.crawl4ai.token}`;
  }

  const response = await fetch(`${config.crawl4ai.baseUrl}/crawl`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(config.crawl4ai.timeout),
    body: JSON.stringify({
      urls: [articleUrl],
      browser_config: {
        type: 'BrowserConfig',
        params: {
          headless: true
        }
      },
      crawler_config: {
        type: 'CrawlerRunConfig',
        params: {
          stream: false,
          cache_mode: 'bypass'
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Crawl4AI crawl failed (${response.status}): ${errorText || response.statusText}`);
  }

  const payload = await response.json();
  const result = Array.isArray(payload?.results) ? payload.results[0] : payload;

  if (!result?.success && result?.success !== undefined) {
    throw new Error(result.error_message || 'Crawl4AI could not crawl this URL');
  }

  const markdown = getMarkdownText(result?.markdown);
  const title = result?.metadata?.title || '';
  const fallbackHtmlText = result?.cleaned_html ? htmlToPlainText(result.cleaned_html) : '';

  return {
    provider: 'crawl4ai',
    title: String(title || '').trim(),
    text: markdown ? markdownToPlainText(markdown) : fallbackHtmlText
  };
}

async function scrapeArticleWithFirecrawl(articleUrl) {
  const response = await fetch(`${config.firecrawl.apiUrl}/scrape`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.firecrawl.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: articleUrl,
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: config.firecrawl.timeout
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Firecrawl scrape failed (${response.status}): ${errorText || response.statusText}`);
  }

  const payload = await response.json();
  const data = payload?.data || payload;
  const markdown = data?.markdown || payload?.markdown || '';
  const metadata = data?.metadata || payload?.metadata || {};
  const title = metadata.title || metadata.ogTitle || metadata.pageTitle || '';

  return {
    provider: 'firecrawl',
    title: String(title || '').trim(),
    text: markdownToPlainText(markdown)
  };
}

async function scrapeArticleDirectly(articleUrl) {
  const response = await fetch(articleUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      'User-Agent': 'Bookparser/1.0 (+https://localhost)'
    }
  });

  if (!response.ok) {
    throw new Error(`Article fetch failed (${response.status}): ${response.statusText}`);
  }

  const rawText = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(rawText);

  return {
    provider: 'direct',
    title: isHtml ? getTitleFromHtml(rawText) : '',
    text: isHtml ? htmlToPlainText(rawText) : rawText
  };
}

async function scrapeArticle(articleUrl) {
  if (config.crawl4ai.baseUrl) {
    try {
      return await scrapeArticleWithCrawl4AI(articleUrl);
    } catch (error) {
      console.warn('[URL Import] Crawl4AI failed, falling back:', error.message);
    }
  }

  if (config.firecrawl.apiKey) {
    try {
      return await scrapeArticleWithFirecrawl(articleUrl);
    } catch (error) {
      console.warn('[URL Import] Firecrawl failed, falling back to direct fetch:', error.message);
    }
  }

  return scrapeArticleDirectly(articleUrl);
}

// Upload book (txt) with automatic local processing
app.post('/api/import', uploadSingleTxt, async (req, res) => {
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
          const grammarSplitTokens = japaneseService.splitGrammarCompoundTokens(rawTokens, {
            splitGrammarCompounds: true
          });

          // Apply basic token merging
          const tokens = japaneseService.mergeVerbTokens(
            japaneseService.mergeNounCompounds(
              japaneseService.mergePunctuationTokens(grammarSplitTokens)
            ),
            {
              mergeAuxiliaryVerbs: true,
              mergeVerbParticles: true,
              mergeAllInflections: true,
              mergePunctuation: true
            }
          );

          // Prepare basic token data with hiragana readings
          const basicTokens = tokens.map(token => ({
            surface_form: token.surface_form,
            basic_form: token.basic_form,
            reading: japaneseService.katakanaToHiragana(token.reading),
            pos: token.pos,
            pos_detail: token.pos_detail_1,
            isSplitGrammarToken: token.isSplitGrammarToken || false,
            originalCompound: token.originalCompound || null,
            expressionSurface: token.expressionSurface || null,
            expressionMeaning: token.expressionMeaning || null,
            expressionNote: token.expressionNote || null
          }));

          // Get dictionary translations for each token
          const enhancedTokens = await Promise.all(basicTokens.map(async (token) => {
            // Skip JMDict lookup for punctuation marks (記号)
            let dictLookup = null;
            if (token.pos !== '記号') {
              dictLookup = await japaneseService.lookupInJMDict(token.surface_form, token.reading);
            }

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

// Import an article from a URL as a plain text source file.
app.post('/api/import/url', async (req, res) => {
  const parsedUrl = validateImportUrl(req.body?.url);
  if (!parsedUrl) {
    return res.status(400).json({ error: 'A valid http or https URL is required' });
  }

  try {
    const articleUrl = parsedUrl.toString();
    const article = await scrapeArticle(articleUrl);
    const lines = normalizeArticleLines(article.text, article);

    if (lines.length === 0) {
      return res.status(422).json({ error: 'No readable article text found at that URL' });
    }

    const filename = buildUrlImportFilename(articleUrl, article.title);
    const importPath = path.join(config.uploadDir, filename);
    fs.writeFileSync(importPath, `${lines.join('\n')}\n`, 'utf-8');

    const originalname = article.title || parsedUrl.hostname;
    console.log(`[URL Import] Imported ${lines.length} lines from ${articleUrl} via ${article.provider}: ${filename}`);

    res.json({
      filename,
      originalname,
      sourceUrl: articleUrl,
      provider: article.provider,
      totalLines: lines.length
    });
  } catch (error) {
    console.error('[URL Import] Failed to import article:', error);
    res.status(502).json({
      error: 'Failed to import article from URL',
      details: error.message
    });
  }
});

// Get content of imported file (line by line) with any existing processed data
app.get('/api/import/:filename', (req, res) => {
  const loadResult = loadLinesForImportFilename(req.params.filename);
  if (!loadResult) return res.status(404).json({ error: 'File not found' });
  const { lines, sourceLocation } = loadResult;

  // Check if there's a corresponding .book file with processed data
  const bookFilePath = path.join(config.booksDir, `${req.params.filename}.book`);
  const hasCompletedBook = fs.existsSync(bookFilePath);
  let processedData = {};
  let processedSentences = {};
  let verbMergeOptions = {};
  let summaryTitle = null;
  let summarySentences = [];
  let summaryGeneratedAt = null;

  if (hasCompletedBook) {
    try {
      const bookData = JSON.parse(fs.readFileSync(bookFilePath, 'utf-8'));
      processedData = bookData.content?.processedData || {};
      processedSentences = bookData.content?.processedSentences || {};
      verbMergeOptions = bookData.settings?.verbMergeOptions || {};
      const summaryData = bookData.content?.summary || {};
      summaryTitle = summaryData.title ? String(summaryData.title).trim() : null;
      if (Array.isArray(summaryData.sentences)) {
        summarySentences = summaryData.sentences.map((sentence) => String(sentence || '').trim()).filter(Boolean);
      } else if (Array.isArray(bookData.content?.summarySentences)) {
        summarySentences = bookData.content.summarySentences.map((sentence) => String(sentence || '').trim()).filter(Boolean);
      }
      summaryGeneratedAt = summaryData.generatedAt || null;
      console.log(`Found existing processed data for ${req.params.filename} with ${Object.keys(processedData).length} processed lines and ${Object.keys(processedSentences).length} processed sentences`);
    } catch (error) {
      console.error('Error reading book file:', error);
    }
  }

  res.json({
    lines,
    existingProcessedData: processedData,
    existingProcessedSentences: processedSentences,
    existingVerbMergeOptions: verbMergeOptions,
    existingSummaryTitle: summaryTitle,
    existingSummarySentences: summarySentences,
    existingSummaryGeneratedAt: summaryGeneratedAt,
    sourceLocation: sourceLocation,
    isCompletedBookView: sourceLocation === 'books' || hasCompletedBook
  });
});

app.post('/api/import/:filename/summarize', async (req, res) => {
  const loadResult = loadLinesForImportFilename(req.params.filename);
  if (!loadResult) {
    return res.status(404).json({ error: 'File not found' });
  }

  const { lines } = loadResult;
  const textForSummary = lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!textForSummary) {
    return res.status(400).json({ error: 'No text available to summarize' });
  }

  try {
    const summaryResult = await ollamaService.summarizeText(textForSummary, 3);
    const summaryTitle = Array.isArray(summaryResult)
      ? null
      : (String(summaryResult?.summaryTitle || '').trim() || null);
    const summarySentences = Array.isArray(summaryResult)
      ? summaryResult.map((sentence) => String(sentence || '').trim()).filter(Boolean).slice(0, 3)
      : (Array.isArray(summaryResult?.summarySentences)
        ? summaryResult.summarySentences.map((sentence) => String(sentence || '').trim()).filter(Boolean).slice(0, 3)
        : []);
    const generatedAt = new Date().toISOString();
    const bookFilePath = path.join(config.booksDir, `${req.params.filename}.book`);

    let bookData = {};
    if (fs.existsSync(bookFilePath)) {
      try {
        bookData = JSON.parse(fs.readFileSync(bookFilePath, 'utf-8'));
      } catch (error) {
        console.error('Error reading existing book file for summary:', error);
        bookData = {};
      }
    }

    if (!bookData.content) bookData.content = {};
    if (!Array.isArray(bookData.content.originalLines)) {
      bookData.content.originalLines = lines;
    }
    if (!bookData.metadata) bookData.metadata = {};
    if (!bookData.settings) bookData.settings = {};

    bookData.content.summary = {
      title: summaryTitle,
      sentences: summarySentences,
      generatedAt
    };
    bookData.metadata.lastUpdated = generatedAt;
    bookData.metadata.summarySentences = summarySentences.length;
    bookData.metadata.originalFilename = req.params.filename;

    fs.writeFileSync(bookFilePath, JSON.stringify(bookData, null, 2), 'utf-8');

    res.json({
      success: true,
      summaryTitle,
      summarySentences,
      generatedAt
    });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Save individual processed sentence (for auto-save)
app.post('/api/import/:filename/save-sentence', (req, res) => {
  const sourcePath = resolveSourceTextPath(req.params.filename);
  const existingBookPath = path.join(config.booksDir, `${req.params.filename}.book`);
  if (!sourcePath && !fs.existsSync(existingBookPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

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
    bookData.metadata.processedSentences = Object.keys(bookData.content.processedSentences).length;
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
  const sourcePath = resolveSourceTextPath(req.params.filename);
  if (!sourcePath && !Array.isArray(req.body.originalLines)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const {
    bookname,
    originalLines,
    processedData,
    processedSentences,
    verbMergeOptions,
    metadata,
    summaryTitle,
    summarySentences,
    summaryGeneratedAt
  } = req.body;
  const bookFileName = bookname || req.params.filename;
  const existingBookPath = path.join(config.booksDir, `${bookFileName}.book`);
  let existingSummary = null;

  if (fs.existsSync(existingBookPath)) {
    try {
      const existingBookData = JSON.parse(fs.readFileSync(existingBookPath, 'utf-8'));
      existingSummary = existingBookData?.content?.summary || null;
    } catch (error) {
      console.error('Error reading existing book summary during save:', error);
    }
  }

  const normalizedSummarySentences = Array.isArray(summarySentences)
    ? summarySentences.map((sentence) => String(sentence || '').trim()).filter(Boolean).slice(0, 3)
    : (Array.isArray(existingSummary?.sentences)
      ? existingSummary.sentences.map((sentence) => String(sentence || '').trim()).filter(Boolean).slice(0, 3)
      : []);
  const normalizedSummaryTitle = String(summaryTitle || existingSummary?.title || '').trim() || null;

  const normalizedSummaryGeneratedAt = summaryGeneratedAt || existingSummary?.generatedAt || null;

  // Create comprehensive book data structure
  const completeBookData = {
    metadata: {
      originalFilename: req.params.filename,
      bookname: bookFileName,
      savedAt: metadata?.savedAt || new Date().toISOString(),
      totalLines: metadata?.totalLines || 0,
      processedLines: metadata?.processedLines || 0,
      processedSentences: metadata?.processedSentences || Object.keys(processedSentences || {}).length,
      version: '1.0'
    },
    settings: {
      verbMergeOptions: verbMergeOptions || {},
      processingDate: new Date().toISOString()
    },
    content: {
      originalLines: originalLines || [],
      processedData: processedData || {},
      processedSentences: processedSentences || {},
      summary: {
        title: normalizedSummaryTitle,
        sentences: normalizedSummarySentences,
        generatedAt: normalizedSummaryGeneratedAt
      }
    }
  };

  try {
    // Save as JSON file with .book extension for processed books
    const jsonDestPath = path.join(config.booksDir, `${bookFileName}.book`);
    fs.writeFileSync(jsonDestPath, JSON.stringify(completeBookData, null, 2), 'utf-8');

    // Also save original text file for compatibility
    const txtDestPath = path.join(config.booksDir, bookFileName);
    if (sourcePath) {
      if (path.resolve(sourcePath) !== path.resolve(txtDestPath)) {
        fs.copyFileSync(sourcePath, txtDestPath);
      }
    } else if (Array.isArray(originalLines)) {
      fs.writeFileSync(txtDestPath, originalLines.join('\n'), 'utf-8');
    }

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

function buildContextSentences(allSentences = [], sentenceIndex = 0, useRemoteProcessing = true) {
  const contextSentences = {};
  if (!useRemoteProcessing || !allSentences || allSentences.length === 0) {
    return contextSentences;
  }

  const configuredWindow = Number.isInteger(config.ollama.contextWindow) && config.ollama.contextWindow >= 0
    ? config.ollama.contextWindow
    : null;
  const defaultWindow = config.ollama.contextMode === 'compact' ? 1 : 5;
  const contextWindow = configuredWindow ?? defaultWindow;

  const previousSentences = [];
  for (let i = sentenceIndex - 1; i >= 0 && previousSentences.length < contextWindow; i--) {
    if (allSentences[i] && allSentences[i].trim()) {
      // Unshift to preserve original text order (oldest to newest)
      previousSentences.unshift(allSentences[i]);
    }
  }
  if (previousSentences.length > 0) {
    contextSentences.previousSentences = previousSentences;
  }

  const nextSentences = [];
  for (let i = sentenceIndex + 1; i < allSentences.length && nextSentences.length < contextWindow; i++) {
    if (allSentences[i] && allSentences[i].trim()) {
      nextSentences.push(allSentences[i]);
    }
  }
  if (nextSentences.length > 0) {
    contextSentences.nextSentences = nextSentences;
  }

  return contextSentences;
}

function normalizeExpressionText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .trim();
}

function findExpressionRange(tokens, expressionSurface) {
  const normalizedExpression = normalizeExpressionText(expressionSurface);
  if (!normalizedExpression) return null;

  const normalizedSurfaces = tokens.map((token) =>
    normalizeExpressionText(token.surface_form || token.surface || '')
  );

  for (let start = 0; start < normalizedSurfaces.length; start++) {
    let joined = '';
    for (let end = start; end < Math.min(normalizedSurfaces.length, start + 8); end++) {
      joined += normalizedSurfaces[end];
      if (joined === normalizedExpression) {
        return { start, end };
      }
      if (!normalizedExpression.startsWith(joined)) {
        break;
      }
    }
  }

  return null;
}

function applyAiExpressionAnnotations(tokens, expressions = []) {
  if (!Array.isArray(expressions) || expressions.length === 0) {
    return tokens;
  }

  const annotatedTokens = tokens.map((token) => ({ ...token }));
  let expressionCounter = 0;

  for (const expression of expressions) {
    const expressionSurface = expression?.surface || expression?.phrase || expression?.expression;
    const range = findExpressionRange(annotatedTokens, expressionSurface);
    if (!range) continue;

    expressionCounter += 1;
    const expressionId = `ai-exp-${expressionCounter}`;
    const expressionMeaning = expression?.meaning || expression?.translation || null;
    const expressionNote = expression?.note || expression?.type || null;

    for (let idx = range.start; idx <= range.end; idx++) {
      // Keep existing handcrafted grammar expression annotations unless they already came from AI.
      if (annotatedTokens[idx].expressionSurface && annotatedTokens[idx].expressionSource !== 'ai') {
        continue;
      }

      annotatedTokens[idx] = {
        ...annotatedTokens[idx],
        expressionSurface: expressionSurface || annotatedTokens[idx].expressionSurface || null,
        expressionMeaning: expressionMeaning || annotatedTokens[idx].expressionMeaning || null,
        expressionNote: expressionNote || annotatedTokens[idx].expressionNote || null,
        expressionId,
        expressionTokenIndex: idx - range.start,
        expressionTokenLength: range.end - range.start + 1,
        expressionSource: 'ai'
      };
    }
  }

  return annotatedTokens;
}

function collectSentenceNotes(ollamaAnalysis = null, aiExpressions = [], tokens = []) {
  const notes = [];
  const seen = new Set();

  const pushNote = (text, type = 'note') => {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    notes.push({ type, text: normalized });
  };

  if (ollamaAnalysis && typeof ollamaAnalysis === 'object') {
    const rawNotes =
      ollamaAnalysis.sentenceNotes ??
      ollamaAnalysis.notes ??
      ollamaAnalysis.grammarNotes ??
      [];

    if (Array.isArray(rawNotes)) {
      for (const note of rawNotes) {
        if (typeof note === 'string') {
          pushNote(note, 'note');
          continue;
        }
        pushNote(
          note?.text || note?.note || note?.explanation || note?.description,
          note?.type || 'note'
        );
      }
    } else if (typeof rawNotes === 'string') {
      pushNote(rawNotes, 'note');
    }
  }

  for (const expression of aiExpressions || []) {
    if (!expression?.surface || !expression?.note) continue;
    pushNote(`${expression.surface}: ${expression.note}`, 'expression');
  }

  // Fallback notes from token-level expression notes (works even without AI notes).
  if (notes.length === 0) {
    for (const token of tokens) {
      if (!token?.expressionSurface || !token?.expressionNote) continue;
      pushNote(`${token.expressionSurface}: ${token.expressionNote}`, 'expression');
    }
  }

  return notes.slice(0, 4);
}

async function processTextAnalysis(payload, onOllamaChunk = null) {
  const {
    text,
    sentenceIndex,
    verbMergeOptions = {},
    allSentences = [],
    useRemoteProcessing = true,
    frequencySettings = {}
  } = payload;

  const contextSentences = buildContextSentences(allSentences, sentenceIndex, useRemoteProcessing);
  let result;

  if (japaneseService.tokenizer) {
    const rawTokens = japaneseService.tokenize(text);
    const grammarSplitTokens = japaneseService.splitGrammarCompoundTokens(rawTokens, verbMergeOptions);

    const tokensAfterPunctuation = verbMergeOptions.mergePunctuation !== false
      ? japaneseService.mergePunctuationTokens(grammarSplitTokens)
      : grammarSplitTokens;

    let tokens;
    if (verbMergeOptions.useCompoundDetection) {
      const compoundTokens = japaneseService.detectCompoundVerbs(tokensAfterPunctuation);
      tokens = japaneseService.mergeVerbTokens(
        japaneseService.mergeNounCompounds(compoundTokens, verbMergeOptions),
        verbMergeOptions
      );
    } else {
      tokens = japaneseService.mergeVerbTokens(
        japaneseService.mergeNounCompounds(tokensAfterPunctuation, verbMergeOptions),
        verbMergeOptions
      );
    }

    const words = tokens.filter(token =>
      token.pos === '名詞' || token.pos === '動詞' || token.pos === '形容詞' || token.pos === '副詞'
    );
    const nouns = tokens.filter(token => token.pos === '名詞');
    const verbs = tokens.filter(token => token.pos === '動詞');

    const basicTokens = tokens.map(token => ({
      surface_form: token.surface_form,
      basic_form: token.basic_form,
      surface: token.surface_form,
      reading: japaneseService.katakanaToHiragana(token.reading),
      pos: token.pos,
      pos_detail: token.pos_detail_1,
      isSplitGrammarToken: token.isSplitGrammarToken || false,
      originalCompound: token.originalCompound || null,
      expressionSurface: token.expressionSurface || null,
      expressionMeaning: token.expressionMeaning || null,
      expressionNote: token.expressionNote || null
    }));

    let ollamaAnalysis = null;
    if (useRemoteProcessing) {
      try {
        ollamaAnalysis = await ollamaService.getAnalysis(
          text,
          basicTokens,
          contextSentences,
          undefined,
          onOllamaChunk
        );
      } catch (ollamaError) {
        // Continue with local dictionary data if Ollama fails
      }
    }

    let fullLineTranslation = 'N/A';
    let tokenAnalysisData = [];

    if (ollamaAnalysis) {
      if (ollamaAnalysis.fullLineTranslation) {
        fullLineTranslation = ollamaAnalysis.fullLineTranslation;
        tokenAnalysisData = ollamaAnalysis.tokens || [];
      } else if (Array.isArray(ollamaAnalysis)) {
        tokenAnalysisData = ollamaAnalysis;
      }
    }

    const enhancedTokens = await Promise.all(basicTokens.map(async (token) => {
      const aiData = tokenAnalysisData.find(ai => ai.surface === token.surface_form) || {};

      let dictLookup = null;
      if (token.pos !== '記号') {
        dictLookup = await japaneseService.lookupInJMDict(token.surface_form, token.reading);
        const basicForm = String(token.basic_form || '').trim();
        if (!dictLookup && basicForm && basicForm !== token.surface_form) {
          dictLookup = await japaneseService.lookupInJMDict(basicForm, token.reading);
        }
      }

      let translation = 'N/A';
      if (useRemoteProcessing) {
        translation = aiData.translation || 'N/A';
        if (translation === 'N/A' && dictLookup && dictLookup.meanings) {
          if (typeof dictLookup.meanings === 'string') {
            translation = dictLookup.meanings;
          } else if (Array.isArray(dictLookup.meanings)) {
            translation = dictLookup.meanings.join('; ');
          } else {
            translation = String(dictLookup.meanings);
          }
        }
      } else if (dictLookup && dictLookup.meanings) {
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
        contextualMeaning: aiData.contextualMeaning || 'N/A',
        grammaticalRole: aiData.grammaticalRole || token.pos,
        dictionarySource: dictLookup ? dictLookup.source : null
      };
    }));

    const aiExpressions = Array.isArray(ollamaAnalysis?.expressions) ? ollamaAnalysis.expressions : [];
    const expressionAnnotatedTokens = applyAiExpressionAnnotations(enhancedTokens, aiExpressions);
    const sentenceNotes = collectSentenceNotes(ollamaAnalysis, aiExpressions, expressionAnnotatedTokens);
    const tokensWithFrequency = japaneseService.enhanceTokensWithFrequency(expressionAnnotatedTokens, frequencySettings);
    const frequencyStats = japaneseService.getTokenFrequencyStats(tokensWithFrequency);

    const analysisStatus = useRemoteProcessing
      ? (ollamaAnalysis ? 'Processed with AI translations' : 'Processed with dictionary only (AI unavailable)')
      : 'Processed with local dictionary';

    result = {
      result: analysisStatus,
      processed: true,
      originalText: text,
      sentenceIndex: sentenceIndex,
      fullSentenceTranslation: fullLineTranslation,
      sentenceNotes: sentenceNotes,
      analysis: {
        totalTokens: tokens.length,
        words: words.length,
        nouns: nouns.length,
        verbs: verbs.length,
        characters: text.length,
        tokens: tokensWithFrequency,
        hasAIAnalysis: !!ollamaAnalysis,
        frequencyStats: frequencyStats,
        sentenceNotes: sentenceNotes
      }
    };
  } else {
    const wordCount = text.trim().split(/\s+/).length;
    const charCount = text.length;

    result = {
      result: `Basic analysis - Words: ${wordCount}, Characters: ${charCount} (Kuromoji not ready)`,
      processed: true,
      originalText: text,
      sentenceIndex: sentenceIndex
    };
  }

  return result;
}

// Japanese text processing endpoint with Kuromoji
app.post('/api/parse', async (req, res) => {
  const payload = {
    text: req.body.text,
    sentenceIndex: req.body.sentenceIndex,
    verbMergeOptions: req.body.verbMergeOptions || {},
    allSentences: req.body.allSentences || [],
    useRemoteProcessing: req.body.useRemoteProcessing !== false,
    frequencySettings: req.body.frequencySettings || {}
  };

  if (!payload.text) {
    return res.status(400).json({ error: 'No text provided for processing' });
  }

  try {
    const result = await processTextAnalysis(payload);
    res.json(result);
  } catch (error) {
    console.error('Error processing text:', error);
    res.status(500).json({
      error: 'Failed to process text',
      details: error.message
    });
  }
});

// Streaming endpoint for live Ollama output while processing.
app.post('/api/parse/stream', async (req, res) => {
  const payload = {
    text: req.body.text,
    sentenceIndex: req.body.sentenceIndex,
    verbMergeOptions: req.body.verbMergeOptions || {},
    allSentences: req.body.allSentences || [],
    useRemoteProcessing: req.body.useRemoteProcessing !== false,
    frequencySettings: req.body.frequencySettings || {}
  };

  if (!payload.text) {
    return res.status(400).json({ error: 'No text provided for processing' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-transform');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  if (req.socket && typeof req.socket.setNoDelay === 'function') {
    req.socket.setNoDelay(true);
  }

  const writeEvent = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Keep the connection alive through proxies while Ollama is generating.
  const keepAliveTimer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 3000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
  });

  try {
    writeEvent('status', { message: 'starting' });
    writeEvent('status', { message: 'analyzing' });
    const result = await processTextAnalysis(payload, (chunk) => {
      if (chunk && typeof chunk === 'object') {
        writeEvent('chunk', {
          kind: chunk.kind || 'response',
          content: typeof chunk.content === 'string' ? chunk.content : ''
        });
        return;
      }

      writeEvent('chunk', {
        kind: 'response',
        content: chunk == null ? '' : String(chunk)
      });
    });
    writeEvent('final', result);
    writeEvent('done', { ok: true });
    clearInterval(keepAliveTimer);
    res.end();
  } catch (error) {
    console.error('Error processing streamed text:', error);
    writeEvent('error', { message: error.message || 'Failed to process text' });
    clearInterval(keepAliveTimer);
    res.end();
  }
});

// Serve built React app when available (used in containerized/prod mode).
if (fs.existsSync(clientDistPath)) {
  console.log(`[Static] Serving client from: ${clientDistPath}`);
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  console.log('[Static] Client build not found, skipping static file serving');
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

export default app;
export { app };
