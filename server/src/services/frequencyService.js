import fs from 'fs';
import path from 'path';

class FrequencyService {
    constructor() {
        this.frequencyData = new Map(); // lemma -> frequency (highest)
        this.readingData = new Map(); // lemma -> { kun: {reading, frequency}, on: {reading, frequency} }
        this.initialized = false;
        console.log('[Frequency] FrequencyService constructor called');
        this.initializeFrequencyData();
    }

    // Initialize frequency data from BCCWJ file only
    async initializeFrequencyData() {
        try {
            console.log('[Frequency] Initializing Japanese word frequency data...');
            await this.loadBCCWJData();
            this.initialized = true;
            console.log(`[Frequency] ✅ Frequency data initialized with ${this.frequencyData.size} entries`);
        } catch (error) {
            console.error('[Frequency] ❌ Failed to initialize frequency data:', error);
            this.initialized = true;
        }
    }

    // Load BCCWJ frequency data
    async loadBCCWJData() {
        const bccwjPath = path.join(process.cwd(), 'BCCWJ_frequencylist_suw_ver1_0.tsv');

        if (!fs.existsSync(bccwjPath)) {
            console.log('[Frequency] BCCWJ file not found');
            return;
        }

        try {
            console.log('[Frequency] Loading BCCWJ frequency data...');

            const stream = fs.createReadStream(bccwjPath, { encoding: 'utf8' });
            let buffer = '';
            let lineCount = 0;
            let loadedCount = 0;

            return new Promise((resolve) => {
                stream.on('data', (chunk) => {
                    buffer += chunk;
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        lineCount++;

                        // Skip header line
                        if (lineCount === 1) continue;

                        const columns = line.split('\t');
                        if (columns.length >= 7) {
                            const lForm = columns[1]; // Surface form (reading)
                            const lemma = columns[2]; // Base form
                            const wType = columns[5]; // Reading type (和/漢)
                            const frequency = parseInt(columns[6]); // Frequency count

                            if (lemma && frequency > 0 && lForm && wType) {
                                // Store reading-specific data
                                if (!this.readingData.has(lemma)) {
                                    this.readingData.set(lemma, { kun: null, on: null });
                                }

                                const readingInfo = this.readingData.get(lemma);

                                if (wType === '和') {
                                    // Japanese/kun reading
                                    if (!readingInfo.kun || frequency > readingInfo.kun.frequency) {
                                        readingInfo.kun = { reading: lForm, frequency: frequency };
                                    }
                                } else if (wType === '漢') {
                                    // Chinese/on reading
                                    if (!readingInfo.on || frequency > readingInfo.on.frequency) {
                                        readingInfo.on = { reading: lForm, frequency: frequency };
                                    }
                                }

                                // Keep the highest frequency overall for fallback
                                if (!this.frequencyData.has(lemma) || frequency > this.frequencyData.get(lemma)) {
                                    this.frequencyData.set(lemma, frequency);

                                    // Debug: log only specific word "僕" for testing
                                    if (lemma === '僕') {
                                        console.log(`[Frequency] Updated: lemma="${lemma}" frequency=${frequency} wType=${wType} reading=${lForm}`);
                                    }
                                }

                                loadedCount++;
                            }
                        }
                    }
                });

                stream.on('end', () => {
                    console.log(`[Frequency] ✅ Loaded ${loadedCount} BCCWJ frequency entries`);
                    resolve();
                });

                stream.on('error', (error) => {
                    console.log(`[Frequency] ⚠️ Error reading BCCWJ file:`, error.message);
                    resolve();
                });
            });

        } catch (error) {
            console.log(`[Frequency] ⚠️ Could not load BCCWJ data:`, error.message);
        }
    }

    // Get frequency for a word - context-aware reading matching
    getFrequency(word, lemma = null, reading = null) {
        if (!this.initialized) {
            return null;
        }

        // If we have both lemma and reading, try to match the specific reading type
        if (lemma && reading && this.readingData.has(lemma)) {
            const readingInfo = this.readingData.get(lemma);

            // Convert reading to katakana for comparison (BCCWJ uses katakana)
            const katakanaReading = this.hiraganaToKatakana(reading);

            // Try to match kun reading first (和)
            if (readingInfo.kun && readingInfo.kun.reading === katakanaReading) {
                return readingInfo.kun.frequency;
            }

            // Try to match on reading (漢)
            if (readingInfo.on && readingInfo.on.reading === katakanaReading) {
                return readingInfo.on.frequency;
            }

            // Debug logging for specific word
            if (lemma === '僕') {
                console.log(`[Frequency] Context lookup for "${lemma}" reading="${reading}" (${katakanaReading})`);
                console.log(`[Frequency] Available readings:`, readingInfo);
            }
        }

        // Fallback to highest frequency for the lemma
        if (lemma && this.frequencyData.has(lemma)) {
            return this.frequencyData.get(lemma);
        }

        // Check word directly
        if (this.frequencyData.has(word)) {
            return this.frequencyData.get(word);
        }

        return null; // Not found
    }

    // Convert hiragana to katakana for reading comparison
    hiraganaToKatakana(str) {
        if (!str) return str;
        return str.replace(/[\u3041-\u3096]/g, function (match) {
            const chr = match.charCodeAt(0) + 0x60;
            return String.fromCharCode(chr);
        });
    }

    // Check if word is frequent enough to hide furigana
    shouldHideFurigana(word, lemma = null, reading = null, threshold = 1000) {
        const frequency = this.getFrequency(word, lemma, reading);
        return frequency !== null && frequency >= threshold;
    }

    // Get frequency category
    getFrequencyCategory(word, lemma = null, reading = null) {
        const frequency = this.getFrequency(word, lemma, reading);

        if (frequency === null) {
            return 'unknown';
        } else if (frequency >= 100000) {
            return 'very_common';
        } else if (frequency >= 10000) {
            return 'common';
        } else if (frequency >= 1000) {
            return 'somewhat_common';
        } else if (frequency >= 100) {
            return 'uncommon';
        } else {
            return 'rare';
        }
    }
}

export default new FrequencyService();
