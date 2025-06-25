import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  uploadDir: process.env.UPLOAD_DIR || './imports',
  booksDir: process.env.BOOKS_DIR || './books',
  
  ollama: {
    host: process.env.OLLAMA_HOST || '192.168.1.43',
    port: process.env.OLLAMA_PORT || '11434',
    model: process.env.OLLAMA_MODEL || 'gemma2:9b',
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
  console.log('OLLAMA_HOST:', config.ollama.host);
  console.log('OLLAMA_PORT:', config.ollama.port);
  console.log('OLLAMA_MODEL:', config.ollama.model);
  console.log('VOICEVOX_HOST:', config.voicevox.host);
  console.log('VOICEVOX_PORT:', config.voicevox.port);
  console.log('VOICEVOX_DEFAULT_SPEAKER:', config.voicevox.defaultSpeaker);
}
