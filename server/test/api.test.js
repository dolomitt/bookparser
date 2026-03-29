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
  app = serverModule.app;
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
