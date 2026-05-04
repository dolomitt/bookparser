import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const sourceUrl = 'https://raw.githubusercontent.com/wkei/jlpt-vocab-api/main/data-source/db/all.json';
const outputPath = path.resolve('server/src/data/jlptVocabulary.json');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'bookparser-jlpt-vocabulary-downloader'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Request failed: ${response.statusCode} ${response.statusMessage}`));
        response.resume();
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function normalizeEntry(entry) {
  const level = Number(entry?.level);
  const word = String(entry?.word || '').trim();
  const reading = String(entry?.furigana || '').trim();
  const meaning = String(entry?.meaning || '').trim();

  if (!word || !Number.isInteger(level) || level < 1 || level > 5) {
    return null;
  }

  const variants = Array.from(new Set([word, reading].filter(Boolean)));

  return {
    level: `N${level}`,
    word,
    reading,
    meaning,
    romaji: String(entry?.romaji || '').trim(),
    variants
  };
}

const rawEntries = await fetchJson(sourceUrl);
if (!Array.isArray(rawEntries)) {
  throw new Error('Expected source JSON to be an array');
}

const entries = rawEntries
  .map(normalizeEntry)
  .filter(Boolean);

const levels = entries.reduce((counts, entry) => {
  counts[entry.level] = (counts[entry.level] || 0) + 1;
  return counts;
}, {});

const payload = {
  source: {
    title: 'JLPT-VOCAB-API data-source',
    url: 'https://github.com/wkei/jlpt-vocab-api/tree/main/data-source',
    rawUrl: sourceUrl,
    downloadedAt: new Date().toISOString()
  },
  levels,
  entries
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

console.log(`Wrote ${entries.length} JLPT vocabulary entries to ${outputPath}`);
console.log(JSON.stringify(levels));
