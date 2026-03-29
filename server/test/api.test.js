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

test('GET /api/imports returns files in import directory', async () => {
  const expectedFile = 'queued.txt';
  fs.writeFileSync(path.join(uploadsDir, expectedFile), 'line 1', 'utf-8');

  const response = await request(app).get('/api/imports');

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body));
  assert.ok(response.body.includes(expectedFile));
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
  assert.equal(bookJson.metadata.processedSentences, 1);
});
