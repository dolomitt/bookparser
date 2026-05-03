import fs from 'node:fs';
import path from 'node:path';

const inputPath = path.resolve('.firecrawl/jlptgrammarlist-neocities-raw.json');
const outputPath = path.resolve('server/src/data/jlptGrammar.json');

const decodeHtml = (value) => String(value || '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));

const stripTags = (value) => decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const normalizePattern = (value) => stripTags(value)
  .replace(/\s+\d+$/, '')
  .replace(/\s+/g, ' ')
  .trim();

const removeNestedBlocks = (html) => String(html || '')
  .replace(/<div class="japanese-sentence">[\s\S]*?<\/div>/g, '')
  .replace(/<div class="english-meaning">[\s\S]*?<\/div>/g, '');

const rawPayload = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const rawHtml = rawPayload.rawHtml || '';
const levels = ['n5', 'n4', 'n3', 'n2', 'n1'];
const entries = [];

for (const [levelIndex, level] of levels.entries()) {
  const startMarker = `<div class="grammar-list ${level}">`;
  const start = rawHtml.indexOf(startMarker);
  if (start === -1) continue;

  const nextLevel = levels[levelIndex + 1];
  const nextMarker = nextLevel ? `<div class="grammar-list ${nextLevel}">` : null;
  const end = nextMarker ? rawHtml.indexOf(nextMarker, start + startMarker.length) : rawHtml.indexOf('<script', start);
  const sectionHtml = rawHtml.slice(start, end === -1 ? rawHtml.length : end);
  const itemRegex = /<div class="item">([\s\S]*?)(?=<div class="item">|<\/div>\s*$)/g;
  let match;

  while ((match = itemRegex.exec(sectionHtml))) {
    const itemHtml = match[1];
    const termMatch = itemHtml.match(/<span class="term">([\s\S]*?)<\/span>/);
    if (!termMatch) continue;

    const rawPattern = normalizePattern(termMatch[1]);
    if (!rawPattern || rawPattern === 'Verb Conjugation' || rawPattern === 'Transitive & Intransitive Verbs') {
      continue;
    }

    const withoutTerm = itemHtml.replace(/<span class="term">[\s\S]*?<\/span>/, '');
    const withoutCommon = withoutTerm.replace(/<span class="common">[\s\S]*?<\/span>/, '');
    const meaning = stripTags(removeNestedBlocks(withoutCommon));

    entries.push({
      level: level.toUpperCase(),
      pattern: rawPattern,
      variants: rawPattern.split('/').map((part) => part.trim()).filter(Boolean),
      meaning
    });
  }
}

const payload = {
  source: {
    title: 'JLPT Grammar List',
    url: rawPayload.metadata?.sourceURL || 'https://jlptgrammarlist.neocities.org/',
    scrapedAt: rawPayload.metadata?.cachedAt || new Date().toISOString()
  },
  levels: {
    N5: entries.filter((entry) => entry.level === 'N5').length,
    N4: entries.filter((entry) => entry.level === 'N4').length,
    N3: entries.filter((entry) => entry.level === 'N3').length,
    N2: entries.filter((entry) => entry.level === 'N2').length,
    N1: entries.filter((entry) => entry.level === 'N1').length
  },
  entries
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
console.log(`Wrote ${entries.length} JLPT grammar entries to ${outputPath}`);
console.log(payload.levels);
