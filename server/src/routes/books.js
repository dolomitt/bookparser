import express from 'express';
import fs from 'fs';
import { config } from '../config/index.js';

const router = express.Router();

// List all books
router.get('/', (req, res) => {
  fs.readdir(config.booksDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read books directory' });
    res.json(files);
  });
});

export default router;
