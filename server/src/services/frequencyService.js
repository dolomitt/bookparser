import fs from 'fs';
import path from 'path';

class FrequencyService {
    constructor() {
        this.frequencyData = new Map();
        this.initialized = false;
        console.log('[Frequency] FrequencyService constructor called');
        this.initializeFrequencyData();
    }

    // Initialize frequency data from multiple sources
    async initializeFrequencyData() {
        try {
            console.log('[Frequency] Initializing Japanese word frequency data...');

            // Load built-in frequency data (common words)
            this.loadBuiltInFrequencyData();

            // Try to load external frequency data if available
            await this.loadExternalFrequencyData();

            this.initialized = true;
            console.log(`[Frequency] ✅ Frequency data initialized with ${this.frequencyData.size} entries`);
        } catch (error) {
            console.error('[Frequency] ❌ Failed to initialize frequency data:', error);
            // Continue with built-in data only
            this.initialized = true;
        }
    }

    // Load built-in frequency data for common Japanese words
    loadBuiltInFrequencyData() {
        // Common Japanese words with frequency ranks (lower number = more frequent)
        const commonWords = [
            // Top 100 most frequent words
            ['の', 1], ['に', 2], ['は', 3], ['を', 4], ['た', 5], ['が', 6], ['で', 7], ['て', 8], ['と', 9], ['し', 10],
            ['れ', 11], ['さ', 12], ['ある', 13], ['いる', 14], ['も', 15], ['する', 16], ['から', 17], ['な', 18], ['こと', 19], ['として', 20],
            ['い', 21], ['や', 22], ['れる', 23], ['など', 24], ['なっ', 25], ['ない', 26], ['この', 27], ['ため', 28], ['その', 29], ['あっ', 30],
            ['よう', 31], ['また', 32], ['もの', 33], ['という', 34], ['あり', 35], ['まで', 36], ['られ', 37], ['なる', 38], ['へ', 39], ['か', 40],
            ['だ', 41], ['これ', 42], ['によって', 43], ['により', 44], ['おり', 45], ['より', 46], ['による', 47], ['ず', 48], ['なり', 49], ['られる', 50],

            // Common verbs (51-100)
            ['見る', 51], ['行く', 52], ['来る', 53], ['言う', 54], ['思う', 55], ['出る', 56], ['入る', 57], ['取る', 58], ['持つ', 59], ['作る', 60],
            ['使う', 61], ['知る', 62], ['聞く', 63], ['読む', 64], ['書く', 65], ['話す', 66], ['立つ', 67], ['座る', 68], ['歩く', 69], ['走る', 70],
            ['食べる', 71], ['飲む', 72], ['寝る', 73], ['起きる', 74], ['働く', 75], ['学ぶ', 76], ['教える', 77], ['買う', 78], ['売る', 79], ['開く', 80],
            ['閉める', 81], ['始める', 82], ['終わる', 83], ['続ける', 84], ['止める', 85], ['待つ', 86], ['急ぐ', 87], ['遅れる', 88], ['忘れる', 89], ['覚える', 90],
            ['考える', 91], ['決める', 92], ['選ぶ', 93], ['変える', 94], ['直す', 95], ['壊す', 96], ['作る', 97], ['建てる', 98], ['住む', 99], ['帰る', 100],

            // Common nouns (101-200)
            ['人', 101], ['時', 102], ['年', 103], ['日', 104], ['月', 105], ['週', 106], ['時間', 107], ['分', 108], ['秒', 109], ['今', 110],
            ['昨日', 111], ['明日', 112], ['朝', 113], ['昼', 114], ['夜', 115], ['午前', 116], ['午後', 117], ['家', 118], ['部屋', 119], ['学校', 120],
            ['会社', 121], ['店', 122], ['病院', 123], ['駅', 124], ['空港', 125], ['公園', 126], ['図書館', 127], ['銀行', 128], ['郵便局', 129], ['市場', 130],
            ['道', 131], ['街', 132], ['町', 133], ['村', 134], ['国', 135], ['世界', 136], ['地球', 137], ['空', 138], ['海', 139], ['山', 140],
            ['川', 141], ['森', 142], ['木', 143], ['花', 144], ['草', 145], ['動物', 146], ['犬', 147], ['猫', 148], ['鳥', 149], ['魚', 150],

            // Common adjectives (151-200)
            ['大きい', 151], ['小さい', 152], ['高い', 153], ['低い', 154], ['長い', 155], ['短い', 156], ['広い', 157], ['狭い', 158], ['新しい', 159], ['古い', 160],
            ['若い', 161], ['美しい', 162], ['きれい', 163], ['汚い', 164], ['明るい', 165], ['暗い', 166], ['暖かい', 167], ['涼しい', 168], ['暑い', 169], ['寒い', 170],
            ['重い', 171], ['軽い', 172], ['強い', 173], ['弱い', 174], ['速い', 175], ['遅い', 176], ['早い', 177], ['忙しい', 178], ['静か', 179], ['うるさい', 180],
            ['簡単', 181], ['難しい', 182], ['易しい', 183], ['複雑', 184], ['便利', 185], ['不便', 186], ['安全', 187], ['危険', 188], ['正しい', 189], ['間違い', 190],
            ['良い', 191], ['悪い', 192], ['いい', 193], ['だめ', 194], ['素晴らしい', 195], ['最高', 196], ['最低', 197], ['普通', 198], ['特別', 199], ['一般', 200],

            // Numbers and counters (201-250)
            ['一', 201], ['二', 202], ['三', 203], ['四', 204], ['五', 205], ['六', 206], ['七', 207], ['八', 208], ['九', 209], ['十', 210],
            ['百', 211], ['千', 212], ['万', 213], ['億', 214], ['兆', 215], ['個', 216], ['本', 217], ['枚', 218], ['匹', 219], ['台', 220],
            ['冊', 221], ['杯', 222], ['回', 223], ['度', 224], ['番', 225], ['第', 226], ['最初', 227], ['最後', 228], ['次', 229], ['前', 230],
            ['後', 231], ['左', 232], ['右', 233], ['上', 234], ['下', 235], ['中', 236], ['外', 237], ['内', 238], ['近く', 239], ['遠く', 240],
            ['ここ', 241], ['そこ', 242], ['あそこ', 243], ['どこ', 244], ['いつ', 245], ['なぜ', 246], ['どう', 247], ['どの', 248], ['どれ', 249], ['だれ', 250],

            // Common particles and grammar words (already included above, but adding more)
            ['について', 251], ['に対して', 252], ['に関して', 253], ['によると', 254], ['によれば', 255], ['にとって', 256], ['として', 257], ['ところで', 258], ['ところが', 259], ['しかし', 260],
            ['でも', 261], ['けれど', 262], ['けれども', 263], ['だから', 264], ['そして', 265], ['それで', 266], ['それから', 267], ['それに', 268], ['また', 269], ['さらに', 270],

            // Body parts and family (271-300)
            ['頭', 271], ['顔', 272], ['目', 273], ['鼻', 274], ['口', 275], ['耳', 276], ['手', 277], ['足', 278], ['体', 279], ['心', 280],
            ['父', 281], ['母', 282], ['兄', 283], ['姉', 284], ['弟', 285], ['妹', 286], ['息子', 287], ['娘', 288], ['夫', 289], ['妻', 290],
            ['祖父', 291], ['祖母', 292], ['孫', 293], ['親', 294], ['子供', 295], ['赤ちゃん', 296], ['大人', 297], ['男', 298], ['女', 299], ['友達', 300]
        ];

        commonWords.forEach(([word, rank]) => {
            this.frequencyData.set(word, rank);
        });

        console.log(`[Frequency] Loaded ${commonWords.length} built-in frequency entries`);
    }

    // Load BCCWJ (Balanced Corpus of Contemporary Written Japanese) frequency data
    async loadBCCWJData() {
        const bccwjPath = path.join(process.cwd(), 'BCCWJ_frequencylist_suw_ver1_0.tsv');

        if (!fs.existsSync(bccwjPath)) {
            console.log('[Frequency] BCCWJ file not found, skipping BCCWJ data loading');
            return;
        }

        try {
            console.log('[Frequency] Loading BCCWJ frequency data...');

            // Read file in chunks to avoid memory issues
            const stream = fs.createReadStream(bccwjPath, { encoding: 'utf8' });
            let buffer = '';
            let lineCount = 0;
            let loadedCount = 0;
            const maxEntries = 50000; // Limit to top 50k most frequent words

            return new Promise((resolve, reject) => {
                stream.on('data', (chunk) => {
                    buffer += chunk;
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep incomplete line in buffer

                    for (const line of lines) {
                        lineCount++;

                        // Skip header line
                        if (lineCount === 1) continue;

                        // Stop after loading enough entries
                        if (loadedCount >= maxEntries) {
                            stream.destroy();
                            break;
                        }

                        try {
                            const entry = this.parseBCCWJLine(line);
                            if (entry) {
                                // Use the frequency count from BCCWJ, convert to rank
                                // Higher frequency = lower rank number (more frequent)
                                const rank = this.frequencyToRank(entry.frequency, loadedCount + 1);

                                this.frequencyData.set(entry.lemma, rank);

                                // Also add the surface form if different
                                if (entry.lForm && entry.lForm !== entry.lemma) {
                                    this.frequencyData.set(entry.lForm, rank);
                                }

                                // Debug: log first few entries
                                if (loadedCount < 10) {
                                    console.log(`[Frequency] Entry ${loadedCount + 1}: "${entry.lemma}" (${entry.lForm}) freq=${entry.frequency} -> rank=${rank}`);
                                }

                                loadedCount++;
                            }
                        } catch (error) {
                            // Skip malformed lines
                            continue;
                        }
                    }
                });

                stream.on('end', () => {
                    console.log(`[Frequency] ✅ Loaded ${loadedCount} BCCWJ frequency entries`);
                    resolve();
                });

                stream.on('error', (error) => {
                    console.log(`[Frequency] ⚠️ Error reading BCCWJ file:`, error.message);
                    resolve(); // Continue with other data sources
                });
            });

        } catch (error) {
            console.log(`[Frequency] ⚠️ Could not load BCCWJ data:`, error.message);
        }
    }

    // Parse a single line from BCCWJ TSV file
    parseBCCWJLine(line) {
        const columns = line.split('\t');

        // BCCWJ columns based on the header we saw:
        // rank, lForm, lemma, pos, subLemma, wType, frequency, pmw, ...
        if (columns.length < 7) {
            return null;
        }

        const rank = parseInt(columns[0]);
        const lForm = columns[1]; // Surface form
        const lemma = columns[2]; // Base form
        const pos = columns[3]; // Part of speech
        const frequency = parseInt(columns[6]);
        const pmw = parseFloat(columns[7]); // Per million words

        // Skip if essential data is missing
        if (!rank || !lemma || !frequency) {
            return null;
        }

        // Skip punctuation and symbols for furigana purposes
        if (pos && pos.includes('記号')) {
            return null;
        }

        return {
            rank,
            lForm,
            lemma,
            pos,
            frequency,
            pmw
        };
    }

    // Try to load external frequency data from files
    async loadExternalFrequencyData() {
        // First try to load BCCWJ data if available
        await this.loadBCCWJData();

        const frequencyFiles = [
            'frequency_data.json',
            'japanese_frequency.txt',
            'bccwj_frequency.csv'
        ];

        for (const filename of frequencyFiles) {
            const filePath = path.join(process.cwd(), 'data', filename);

            if (fs.existsSync(filePath)) {
                try {
                    console.log(`[Frequency] Loading external frequency data from ${filename}...`);

                    if (filename.endsWith('.json')) {
                        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                        this.loadJsonFrequencyData(data);
                    } else if (filename.endsWith('.txt')) {
                        const data = fs.readFileSync(filePath, 'utf-8');
                        this.loadTextFrequencyData(data);
                    } else if (filename.endsWith('.csv')) {
                        const data = fs.readFileSync(filePath, 'utf-8');
                        this.loadCsvFrequencyData(data);
                    }

                    console.log(`[Frequency] Successfully loaded external data from ${filename}`);
                    break; // Use the first available file
                } catch (error) {
                    console.log(`[Frequency] Could not load ${filename}:`, error.message);
                }
            }
        }
    }

    // Load frequency data from JSON format
    loadJsonFrequencyData(data) {
        if (Array.isArray(data)) {
            data.forEach((item, index) => {
                if (typeof item === 'string') {
                    this.frequencyData.set(item, index + 1);
                } else if (item.word && item.frequency) {
                    this.frequencyData.set(item.word, item.frequency);
                } else if (item.word && item.rank) {
                    this.frequencyData.set(item.word, item.rank);
                }
            });
        } else if (typeof data === 'object') {
            Object.entries(data).forEach(([word, freq]) => {
                this.frequencyData.set(word, freq);
            });
        }
    }

    // Load frequency data from text format (word per line or word:frequency)
    loadTextFrequencyData(data) {
        const lines = data.split('\n').filter(line => line.trim());
        lines.forEach((line, index) => {
            const parts = line.trim().split(/[\t:,]/);
            if (parts.length >= 2) {
                const word = parts[0].trim();
                const freq = parseInt(parts[1]) || (index + 1);
                this.frequencyData.set(word, freq);
            } else if (parts.length === 1) {
                const word = parts[0].trim();
                this.frequencyData.set(word, index + 1);
            }
        });
    }

    // Load frequency data from CSV format
    loadCsvFrequencyData(data) {
        const lines = data.split('\n').filter(line => line.trim());
        lines.forEach((line, index) => {
            if (index === 0) return; // Skip header

            const parts = line.split(',');
            if (parts.length >= 2) {
                const word = parts[0].trim().replace(/"/g, '');
                const freq = parseInt(parts[1]) || index;
                this.frequencyData.set(word, freq);
            }
        });
    }

    // Get frequency rank for a word (lower number = more frequent)
    getFrequencyRank(word) {
        if (!this.initialized) {
            return null;
        }

        // Direct lookup
        if (this.frequencyData.has(word)) {
            return this.frequencyData.get(word);
        }

        // Try basic form lookup (remove common endings)
        const basicForms = this.getBasicForms(word);
        for (const form of basicForms) {
            if (this.frequencyData.has(form)) {
                return this.frequencyData.get(form);
            }
        }

        return null; // Not found
    }

    // Generate possible basic forms of a word
    getBasicForms(word) {
        const forms = [word];

        // Remove common verb endings
        const verbEndings = ['る', 'た', 'て', 'だ', 'で', 'ない', 'ます', 'ました', 'ません', 'ませんでした'];
        verbEndings.forEach(ending => {
            if (word.endsWith(ending) && word.length > ending.length) {
                forms.push(word.slice(0, -ending.length));
            }
        });

        // Remove common adjective endings
        const adjEndings = ['い', 'かった', 'くない', 'くなかった'];
        adjEndings.forEach(ending => {
            if (word.endsWith(ending) && word.length > ending.length) {
                forms.push(word.slice(0, -ending.length));
            }
        });

        return [...new Set(forms)]; // Remove duplicates
    }

    // Check if a word is frequent enough to hide furigana
    shouldHideFurigana(word, frequencyThreshold = 1000) {
        const rank = this.getFrequencyRank(word);

        if (rank === null) {
            return false; // Unknown words show furigana
        }

        // Lower rank number = more frequent = hide furigana
        return rank <= frequencyThreshold;
    }

    // Get frequency category for a word
    getFrequencyCategory(word) {
        const rank = this.getFrequencyRank(word);

        if (rank === null) {
            return 'unknown';
        } else if (rank <= 100) {
            return 'very_common';
        } else if (rank <= 500) {
            return 'common';
        } else if (rank <= 1000) {
            return 'somewhat_common';
        } else if (rank <= 5000) {
            return 'uncommon';
        } else {
            return 'rare';
        }
    }

    // Convert frequency count to rank (higher frequency = lower rank number)
    frequencyToRank(frequency, fallbackRank) {
        // For BCCWJ data, the file is already sorted by frequency (highest first)
        // So we can use the line number as the rank
        // But we also want to consider the actual frequency value

        if (frequency >= 1000000) return 1;      // Very high frequency
        else if (frequency >= 500000) return 10;
        else if (frequency >= 100000) return 50;
        else if (frequency >= 50000) return 100;
        else if (frequency >= 10000) return 500;
        else if (frequency >= 5000) return 1000;
        else if (frequency >= 1000) return 2000;
        else if (frequency >= 500) return 5000;
        else if (frequency >= 100) return 10000;
        else if (frequency >= 50) return 20000;
        else if (frequency >= 10) return 50000;
        else return Math.min(fallbackRank, 100000); // Use position in file as fallback
    }

    // Get statistics about the frequency data
    getStats() {
        return {
            totalEntries: this.frequencyData.size,
            initialized: this.initialized,
            sampleEntries: Array.from(this.frequencyData.entries()).slice(0, 10)
        };
    }
}

export default new FrequencyService();
