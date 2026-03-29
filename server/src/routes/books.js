import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

const router = express.Router();

// List all books
router.get('/', (req, res) => {
  fs.readdir(config.booksDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read books directory' });
    res.json(files);
  });
});

// Read a specific saved book text payload.
router.get('/:book', (req, res) => {
  const requestedName = req.params.book;
  const safeName = path.basename(requestedName);

  if (safeName !== requestedName) {
    return res.status(400).json({ error: 'Invalid book path' });
  }

  const bookPath = path.join(config.booksDir, safeName);
  if (!fs.existsSync(bookPath)) {
    return res.status(404).json({ error: 'Book not found' });
  }

  try {
    const raw = fs.readFileSync(bookPath, 'utf-8');

    // When reading a .book JSON file directly, expose original text lines.
    if (safeName.endsWith('.book')) {
      const parsed = JSON.parse(raw);
      const originalLines = parsed?.content?.originalLines;
      const asText = Array.isArray(originalLines) ? originalLines.join('\n') : '';
      res.type('text/plain').send(asText);
      return;
    }

    res.type('text/plain').send(raw);
  } catch (error) {
    console.error('Error reading book:', error);
    res.status(500).json({ error: 'Failed to read book' });
  }
});

export default router;
