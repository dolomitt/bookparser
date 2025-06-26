import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  uploadDir: process.env.UPLOAD_DIR || './imports',
  booksDir: process.env.BOOKS_DIR || './books',
  
  ollama: {
    host: process.env.BOOKPARSER_OLLAMA_HOST || '192.168.1.43',
    port: process.env.BOOKPARSER_OLLAMA_PORT || '11434',
    model: process.env.BOOKPARSER_OLLAMA_MODEL || 'gemma3:12b',
    timeout: parseInt(process.env.BOOKPARSER_OLLAMA_TIMEOUT) || 120000, // 120 seconds default
    maxRetries: parseInt(process.env.BOOKPARSER_OLLAMA_MAX_RETRIES) || 2,
    maxTokens: parseInt(process.env.BOOKPARSER_OLLAMA_MAX_TOKENS) || 10000, // Fixed response token limit
    get baseUrl() {
      return `http://${this.host}:${this.port}`;
    }
  },
  
  voicevox: {
    host: process.env.VOICEVOX_HOST || '192.168.1.43',
    port: process.env.VOICEVOX_PORT || '50021',
    defaultSpeaker: process.env.VOICEVOX_DEFAULT_SPEAKER || '1',
    get baseUrl() {
      return `http://${this.host}:${this.port}`;
    }
  }
};

// Log configuration on startup
export function logConfig() {
  console.log('Loaded configuration:');
  console.log('PORT:', config.port);
  console.log('UPLOAD_DIR:', config.uploadDir);
  console.log('BOOKS_DIR:', config.booksDir);
  console.log('BOOKPARSER_OLLAMA_HOST:', config.ollama.host);
  console.log('BOOKPARSER_OLLAMA_PORT:', config.ollama.port);
  console.log('BOOKPARSER_OLLAMA_MODEL:', config.ollama.model);
  console.log('BOOKPARSER_OLLAMA_TIMEOUT:', config.ollama.timeout + 'ms');
  console.log('BOOKPARSER_OLLAMA_MAX_RETRIES:', config.ollama.maxRetries);
  console.log('VOICEVOX_HOST:', config.voicevox.host);
  console.log('VOICEVOX_PORT:', config.voicevox.port);
  console.log('VOICEVOX_DEFAULT_SPEAKER:', config.voicevox.defaultSpeaker);
}
