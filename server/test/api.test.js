import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

let app;
let tempRoot;
let uploadsDir;
let booksDir;

function emptyDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, entry);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookparser-test-'));
  uploadsDir = path.join(tempRoot, 'imports');
  booksDir = path.join(tempRoot, 'books');

  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(booksDir, { recursive: true });

  process.env.NODE_ENV = 'test';
  process.env.SKIP_EXTERNAL_CHECKS = 'true';
  process.env.SKIP_LANGUAGE_INIT = 'true';
  process.env.UPLOAD_DIR = uploadsDir;
  process.env.BOOKS_DIR = booksDir;
  process.env.PORT = '0';
  process.env.CRAWL4AI_BASE_URL = 'http://crawl4ai.test';
  process.env.CRAWL4AI_TIMEOUT = '10000';
  process.env.FIRECRAWL_API_KEY = '';
  process.env.FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v2';

  const serverModule = await import('../src/index.js');
  app = serverModule.app || serverModule.default;
  assert.ok(app, 'Express app export was not found from server/src/index.js');
});

beforeEach(() => {
  emptyDirectory(uploadsDir);
  emptyDirectory(booksDir);
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('GET /api/books returns an empty list when no books exist', async () => {
  const response = await request(app).get('/api/books');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, []);
});

test('GET /api/books returns existing book files', async () => {
  const expectedFile = 'sample.book';
  fs.writeFileSync(path.join(booksDir, expectedFile), '{}', 'utf-8');

  const response = await request(app).get('/api/books');

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body));
  assert.ok(response.body.includes(expectedFile));
});

test('GET /api/books/:book returns plain text content', async () => {
  const filename = 'plain.txt';
  fs.writeFileSync(path.join(booksDir, filename), 'line1\nline2', 'utf-8');

  const response = await request(app).get(`/api/books/${filename}`);

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/plain/);
  assert.equal(response.text, 'line1\nline2');
});

test('GET /api/books/:book returns originalLines for .book files', async () => {
  const filename = 'sample.book';
  fs.writeFileSync(
    path.join(booksDir, filename),
    JSON.stringify({
      content: {
        originalLines: ['a', 'b']
      }
    }),
    'utf-8'
  );

  const response = await request(app).get(`/api/books/${filename}`);

  assert.equal(response.status, 200);
  assert.equal(response.text, 'a\nb');
});

test('GET /api/imports returns files in import directory', async () => {
  const expectedFile = 'queued.txt';
  fs.writeFileSync(path.join(uploadsDir, expectedFile), 'line 1', 'utf-8');

  const response = await request(app).get('/api/imports');

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body));
  assert.ok(response.body.includes(expectedFile));
});

test('GET /api/imports excludes imports that already have completed .book files', async () => {
  const completedName = 'done.txt';
  fs.writeFileSync(path.join(uploadsDir, completedName), 'line 1', 'utf-8');
  fs.writeFileSync(
    path.join(booksDir, `${completedName}.book`),
    JSON.stringify({ metadata: { status: 'reading', completed: true } }),
    'utf-8'
  );

  const pendingName = 'pending.txt';
  fs.writeFileSync(path.join(uploadsDir, pendingName), 'line 1', 'utf-8');

  const draftName = 'draft.txt';
  fs.writeFileSync(path.join(uploadsDir, draftName), 'line 1', 'utf-8');
  fs.writeFileSync(
    path.join(booksDir, `${draftName}.book`),
    JSON.stringify({ metadata: { status: 'draft', completed: false } }),
    'utf-8'
  );

  const response = await request(app).get('/api/imports');

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body));
  assert.ok(response.body.includes(pendingName));
  assert.ok(response.body.includes(draftName));
  assert.ok(!response.body.includes(completedName));
});

test('GET /api/books excludes draft progress files that still have import sources', async () => {
  const draftName = 'draft-resource.txt';
  fs.writeFileSync(path.join(uploadsDir, draftName), 'line 1', 'utf-8');
  fs.writeFileSync(
    path.join(booksDir, `${draftName}.book`),
    JSON.stringify({ metadata: { status: 'draft', completed: false } }),
    'utf-8'
  );

  const completedName = 'completed-resource.txt';
  fs.writeFileSync(path.join(uploadsDir, completedName), 'line 1', 'utf-8');
  fs.writeFileSync(
    path.join(booksDir, `${completedName}.book`),
    JSON.stringify({ metadata: { status: 'reading', completed: true } }),
    'utf-8'
  );

  const response = await request(app).get('/api/books');

  assert.equal(response.status, 200);
  assert.ok(!response.body.includes(`${draftName}.book`));
  assert.ok(response.body.includes(`${completedName}.book`));
});

test('POST /api/import/url rejects invalid URLs', async () => {
  const response = await request(app)
    .post('/api/import/url')
    .send({ url: 'file:///tmp/article.html' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /valid http or https URL/);
});

test('POST /api/import/url imports readable article text into the imports directory', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => {
      assert.equal(url, 'http://crawl4ai.test/crawl');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.urls, ['https://example.com/news/article']);

      return {
        success: true,
        results: [{
          success: true,
          metadata: {
            title: '戦争と環境'
          },
          markdown: {
            raw_markdown: '# 戦争と環境\nこれはテスト記事です。\n環境への影響を説明します。\n'
          }
        }]
      };
    },
    text: async () => ''
  });

  try {
    const response = await request(app)
      .post('/api/import/url')
      .send({ url: 'https://example.com/news/article' });

    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'crawl4ai');
    assert.equal(response.body.filename, 'example.com-article.txt');
    assert.equal(response.body.totalLines, 3);

    const importedText = fs.readFileSync(path.join(uploadsDir, response.body.filename), 'utf-8');
    assert.match(importedText, /これはテスト記事です。/);
    assert.match(importedText, /環境への影響を説明します。/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/import/url removes page chrome from Crawl4AI article markdown', async () => {
  const originalFetch = globalThis.fetch;
  const title = '\u6226\u4e89\u3068\u74b0\u5883';
  const firstParagraph = '\u3053\u308c\u306f\u672c\u6587\u306e\u6700\u521d\u306e\u6bb5\u843d\u3067\u3059\u3002';
  const secondParagraph = '\u3053\u308c\u306f\u672c\u6587\u306e\u7d9a\u304d\u3067\u3059\u3002';
  const thirdParagraph = '\u3053\u308c\u306f\u30b5\u30a4\u30c9\u30d0\u30fc\u5f8c\u306e\u672c\u6587\u3067\u3059\u3002';

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      success: true,
      results: [{
        success: true,
        metadata: {
          title: `${title} | Example`
        },
        markdown: {
          raw_markdown: [
            'Privacy Center',
            'Skip to main content',
            title,
            'Business',
            'Culture',
            'Latest',
            'Author Name',
            '2026.05.03',
            title,
            firstParagraph,
            'Most Popular',
            'Business',
            '\u95a2\u4fc2\u306e\u306a\u3044\u898b\u51fa\u3057',
            'By SOMEONE',
            'Business',
            '\u5225\u306e\u95a2\u4fc2\u306e\u306a\u3044\u898b\u51fa\u3057',
            'By SOMEONE ELSE',
            'Business',
            '\u3082\u3046\u4e00\u3064\u95a2\u4fc2\u306e\u306a\u3044\u898b\u51fa\u3057',
            'By THIRD',
            secondParagraph,
            thirdParagraph,
            'Related Articles',
            '\u95a2\u9023\u8a18\u4e8b\u306e\u898b\u51fa\u3057'
          ].join('\n')
        }
      }]
    }),
    text: async () => ''
  });

  try {
    const response = await request(app)
      .post('/api/import/url')
      .send({ url: 'https://example.com/news/chrome' });

    assert.equal(response.status, 200);
    assert.equal(response.body.totalLines, 4);

    const importedLines = fs
      .readFileSync(path.join(uploadsDir, response.body.filename), 'utf-8')
      .trim()
      .split('\n');

    assert.deepEqual(importedLines, [
      title,
      firstParagraph,
      secondParagraph,
      thirdParagraph
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/import/:filename loads from books directory when import file is missing', async () => {
  const filename = 'completed.txt';
  fs.writeFileSync(path.join(booksDir, filename), 'line from books', 'utf-8');

  const response = await request(app).get(`/api/import/${filename}`);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.lines));
  assert.equal(response.body.lines[0], 'line from books');
  assert.equal(response.body.isCompletedBookView, true);
  assert.equal(response.body.sourceLocation, 'books');
});

test('GET /api/import/:filename marks completed view when .book exists even if import file exists', async () => {
  const filename = 'both.txt';
  fs.writeFileSync(path.join(uploadsDir, filename), 'line from imports', 'utf-8');
  fs.writeFileSync(path.join(booksDir, `${filename}.book`), JSON.stringify({ content: {} }), 'utf-8');

  const response = await request(app).get(`/api/import/${filename}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.isCompletedBookView, true);
});

test('GET /api/import/:filename loads originalLines from .book fallback', async () => {
  const filename = 'jsononly.txt';
  fs.writeFileSync(
    path.join(booksDir, `${filename}.book`),
    JSON.stringify({
      content: {
        originalLines: ['line a', 'line b']
      }
    }),
    'utf-8'
  );

  const response = await request(app).get(`/api/import/${filename}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.lines, ['line a', 'line b']);
  assert.equal(response.body.isCompletedBookView, true);
});

test('GET /api/import/:filename returns saved summary from .book file', async () => {
  const filename = 'summary.txt';
  fs.writeFileSync(
    path.join(booksDir, `${filename}.book`),
    JSON.stringify({
      content: {
        originalLines: ['line a', 'line b'],
        summary: {
          title: 'Space Launch Preview',
          sentences: ['One.', 'Two.', 'Three.'],
          generatedAt: '2026-03-29T00:00:00.000Z'
        }
      }
    }),
    'utf-8'
  );

  const response = await request(app).get(`/api/import/${filename}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.existingSummaryTitle, 'Space Launch Preview');
  assert.deepEqual(response.body.existingSummarySentences, ['One.', 'Two.', 'Three.']);
  assert.equal(response.body.existingSummaryGeneratedAt, '2026-03-29T00:00:00.000Z');
});

test('POST /api/import/:filename/summarize returns and persists summary', async () => {
  const filename = 'summarize-me.txt';
  fs.writeFileSync(path.join(uploadsDir, filename), '最初の文。\n次の文。', 'utf-8');

  const { default: ollamaService } = await import('../src/services/ollamaService.js');
  const originalSummarizeText = ollamaService.summarizeText;
  ollamaService.summarizeText = async () => ({
    summaryTitle: 'Launch Window Update',
    summarySentences: ['One.', 'Two.', 'Three.']
  });

  try {
    const response = await request(app).post(`/api/import/${filename}/summarize`).send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.summaryTitle, 'Launch Window Update');
    assert.deepEqual(response.body.summarySentences, ['One.', 'Two.', 'Three.']);

    const bookJson = JSON.parse(fs.readFileSync(path.join(booksDir, `${filename}.book`), 'utf-8'));
    assert.equal(bookJson.content.summary.title, 'Launch Window Update');
    assert.deepEqual(bookJson.content.summary.sentences, ['One.', 'Two.', 'Three.']);
  } finally {
    ollamaService.summarizeText = originalSummarizeText;
  }
});

test('POST /api/text-to-speech validates required text input', async () => {
  const response = await request(app)
    .post('/api/text-to-speech')
    .send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'No text provided for text-to-speech');
});

test('POST /api/import rejects non-txt uploads', async () => {
  const response = await request(app)
    .post('/api/import')
    .attach('file', Buffer.from('binary-content'), 'sample.pdf');

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Only .txt files are allowed');
});

test('POST /api/import accepts txt uploads', async () => {
  const response = await request(app)
    .post('/api/import')
    .attach('file', Buffer.from('こんにちは\n世界'), 'sample.txt');

  assert.equal(response.status, 200);
  assert.equal(response.body.originalname, 'sample.txt');
  assert.equal(response.body.autoProcessed, true);
  assert.ok(typeof response.body.filename === 'string' && response.body.filename.length > 0);
});

test('POST /api/import/:filename/save-sentence persists processed sentence for reload', async () => {
  const filename = 'persist.txt';
  fs.writeFileSync(path.join(uploadsDir, filename), 'これはテストです。', 'utf-8');

  const sentenceData = {
    tokens: [{ surface: 'これは', reading: 'これは', translation: 'this' }],
    fullSentenceTranslation: 'This is a test.',
    processingType: 'remote'
  };

  const saveResponse = await request(app)
    .post(`/api/import/${filename}/save-sentence`)
    .send({
      sentenceIndex: 0,
      sentenceData,
      verbMergeOptions: { mergePunctuation: true },
      timestamp: new Date().toISOString()
    });

  assert.equal(saveResponse.status, 200);
  assert.equal(saveResponse.body.success, true);

  const loadResponse = await request(app).get(`/api/import/${filename}`);
  assert.equal(loadResponse.status, 200);
  assert.ok(loadResponse.body.existingProcessedSentences);
  assert.deepEqual(loadResponse.body.existingProcessedSentences['0'], sentenceData);
});

test('POST /api/import/:filename/save stores processedSentences in .book file', async () => {
  const filename = 'save-all.txt';
  fs.writeFileSync(path.join(uploadsDir, filename), '保存テスト。', 'utf-8');

  const processedSentences = {
    0: {
      tokens: [{ surface: '保存', translation: 'save' }],
      fullSentenceTranslation: 'Save test.',
      processingType: 'remote'
    }
  };

  const saveResponse = await request(app)
    .post(`/api/import/${filename}/save`)
    .send({
      bookname: filename,
      originalLines: ['保存テスト。'],
      processedData: {},
      processedSentences,
      summaryTitle: 'Save Test Summary',
      summarySentences: ['One.', 'Two.', 'Three.'],
      summaryGeneratedAt: '2026-03-29T01:02:03.000Z',
      verbMergeOptions: { mergePunctuation: true },
      metadata: {
        savedAt: new Date().toISOString(),
        totalLines: 1,
        processedLines: 0,
        processedSentences: 1
      }
    });

  assert.equal(saveResponse.status, 200);
  const bookFilePath = path.join(booksDir, `${filename}.book`);
  assert.ok(fs.existsSync(bookFilePath));

  const bookJson = JSON.parse(fs.readFileSync(bookFilePath, 'utf-8'));
  assert.deepEqual(bookJson.content.processedSentences, processedSentences);
  assert.equal(bookJson.content.summary.title, 'Save Test Summary');
  assert.deepEqual(bookJson.content.summary.sentences, ['One.', 'Two.', 'Three.']);
  assert.equal(bookJson.content.summary.generatedAt, '2026-03-29T01:02:03.000Z');
  assert.equal(bookJson.metadata.processedSentences, 1);
  assert.equal(bookJson.metadata.status, 'reading');
  assert.equal(bookJson.metadata.completed, true);
  assert.equal(bookJson.metadata.savedToBooks, true);
});

test('POST /api/import/:filename/save-sentence works when only books copy exists', async () => {
  const filename = 'books-only.txt';
  fs.writeFileSync(path.join(booksDir, filename), 'books content', 'utf-8');

  const sentenceData = {
    tokens: [{ surface: '本', translation: 'book' }],
    fullSentenceTranslation: 'Book.',
    processingType: 'remote'
  };

  const response = await request(app)
    .post(`/api/import/${filename}/save-sentence`)
    .send({
      sentenceIndex: 0,
      sentenceData,
      verbMergeOptions: {},
      timestamp: new Date().toISOString()
    });

  assert.equal(response.status, 200);
  const stored = JSON.parse(fs.readFileSync(path.join(booksDir, `${filename}.book`), 'utf-8'));
  assert.deepEqual(stored.content.processedSentences['0'], sentenceData);
  assert.equal(stored.metadata.status, 'draft');
  assert.equal(stored.metadata.completed, false);
});
