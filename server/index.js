import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

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

// Placeholder for OpenAI processing endpoint
app.post('/api/parse', async (req, res) => {
  // TODO: Integrate OpenAI API here
  res.json({ result: 'OpenAI integration pending' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
