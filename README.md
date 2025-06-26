# Bookparser - Japanese Reading Assistant

A comprehensive web application designed to help users read Japanese books with advanced language learning support, powered by Node.js, Express, React, OpenAI API, and VOICEVOX text-to-speech.

## ✨ Features

### 📚 Book Management
- **Book Library**: View and manage your collection of Japanese books
- **Import System**: Upload and process TXT files with line-by-line parsing
- **Progress Tracking**: Automatic saving of reading progress and processing state
- **Flexible Storage**: Books saved in both original text and enhanced JSON formats

### 🔤 Advanced Text Processing
- **Kuromoji Integration**: Japanese morphological analysis and tokenization
- **JMDict Dictionary**: Offline Japanese-English dictionary lookups
- **OpenAI Enhancement**: AI-powered translations and contextual explanations
- **Smart Token Merging**: Configurable verb inflection and compound word detection
- **Furigana Support**: Automatic hiragana readings for kanji compounds

### 🎧 Audio Features
- **VOICEVOX Integration**: High-quality Japanese text-to-speech
- **Montreal Forced Aligner (MFA)**: Enhanced audio-text timing alignment
- **Dual Timing Methods**: Mora-level (VoiceVox) and word-level (MFA) synchronization
- **Multiple Speakers**: Configurable voice options
- **Audio Controls**: Play, pause, and seek functionality

### 📱 User Experience
- **Responsive Design**: Mobile-friendly interface with touch support
- **Dark Mode**: Eye-friendly reading experience
- **Real-time Processing**: Live text analysis and translation
- **Auto-save**: Automatic progress preservation
- **Context-aware**: Previous/next sentence context for better translations

### 🛠️ Processing Options
- **Local vs Remote**: Choose between offline dictionary or AI-enhanced processing
- **Customizable Merging**: Fine-tune verb inflection and compound word detection
- **Batch Processing**: Process multiple sentences efficiently
- **Flexible Export**: Save processed books with full analysis data

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- OpenAI API key (optional, for enhanced translations)
- VOICEVOX engine (optional, for text-to-speech)

### Installation

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd bookparser
   npm install
   cd server && npm install
   cd ../client && npm install
   ```

2. **Configure environment**
   ```bash
   # Copy example environment file
   cp .example.env server/.env
   
   # Edit server/.env with your settings:
   # OPENAI_API_KEY=your_openai_api_key_here
   # VOICEVOX_HOST=localhost (if running VOICEVOX locally)
   # VOICEVOX_PORT=50021
   ```

3. **Start development servers**
   ```bash
   # From project root - starts both client and server
   npm run dev
   
   # Or start individually:
   npm run server  # Backend only
   npm run client  # Frontend only
   ```

4. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:5000

## 📁 Project Structure

```
bookparser/
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── constants/      # UI constants and configuration
│   │   ├── hooks/         # Custom React hooks (audio player, etc.)
│   │   ├── pages/         # Main page components
│   │   ├── utils/         # Text processing utilities
│   │   └── App.jsx        # Main application component
│   └── package.json
├── server/                # Express backend
│   ├── index.js          # Main server with all API endpoints
│   ├── books/            # Processed book storage
│   ├── imports/          # Temporary import files
│   ├── jmdict-db/        # JMDict dictionary database
│   └── package.json
├── samples/              # Sample text files for testing
└── README.md            # This file
```

Samples were taken from 
https://www.aozora.gr.jp/cards/000009/files/8_31220.html


## 🔧 Configuration

### Environment Variables (server/.env)
```bash
# Server Configuration
PORT=5000
UPLOAD_DIR=./imports
BOOKS_DIR=./books

# VOICEVOX Text-to-Speech (optional)
VOICEVOX_HOST=localhost
VOICEVOX_PORT=50021
VOICEVOX_DEFAULT_SPEAKER=13
```

### Processing Options
- **Local Processing**: Uses Kuromoji + JMDict for offline analysis
- **Remote Processing**: Adds OpenAI for enhanced translations and context
- **Hybrid Mode**: Combines dictionary lookups with AI enhancements

## 📖 Usage Guide

### Importing Books
1. Navigate to the Import page
2. Upload a Japanese text file (.txt)
3. Configure processing options (verb merging, AI enhancement)
4. Process sentences line by line or in batches
5. Save the processed book to your library

### Reading Books
1. Select a book from the main library
2. Use touch/click to interact with text
3. View furigana, translations, and explanations
4. Listen to audio pronunciation (if VOICEVOX configured)
5. Progress is automatically saved

### Advanced Features
- **Token Analysis**: Detailed grammatical breakdown of Japanese text
- **Context Awareness**: Translations consider surrounding sentences
- **Flexible Merging**: Customize how compound words and verb forms are handled
- **Audio Timing**: Synchronized highlighting during speech playback

## 🛠️ Technology Stack

### Frontend
- **React 18**: Modern UI framework
- **Material-UI**: Component library and theming
- **React Router**: Client-side routing
- **Axios**: HTTP client for API communication
- **Vite**: Fast development build tool

### Backend
- **Node.js**: JavaScript runtime
- **Express**: Web application framework
- **Kuromoji**: Japanese morphological analyzer
- **JMDict**: Japanese-English dictionary
- **OpenAI API**: AI-powered translations
- **Multer**: File upload handling

### External Services
- **OpenAI GPT-4**: Enhanced translations and explanations
- **VOICEVOX**: Japanese text-to-speech synthesis

## 🔍 API Endpoints

### Books Management
- `GET /api/books` - List all processed books
- `GET /api/imports` - List files in import queue

### Text Processing
- `POST /api/parse` - Process Japanese text with full analysis
- `POST /api/text-to-speech` - Generate audio with timing data
- `POST /api/text-to-speech/enhanced` - Enhanced TTS with MFA alignment
- `POST /api/text-to-speech/compare-alignment` - Compare alignment methods

### File Operations
- `POST /api/import` - Upload new text file
- `GET /api/import/:filename` - Get import file content
- `POST /api/import/:filename/save` - Save processed book
- `POST /api/import/:filename/save-line` - Auto-save individual line
- `POST /api/import/:filename/save-sentence` - Auto-save individual sentence

## 🧪 Development

### Code Organization
The project follows maintainable patterns with extracted constants, utilities, and custom hooks. See `MAINTAINABILITY.md` for detailed guidelines.

### Key Components
- **ImportPage**: Main processing interface with sentence-by-sentence analysis
- **ReadingPage**: Enhanced reading experience with interactive text
- **MainPage**: Book library and navigation
- **Audio Player Hook**: Reusable audio playback functionality

### Performance Features
- **Auto-save**: Prevents data loss during processing
- **Efficient Tokenization**: Optimized Japanese text analysis
- **Memory Management**: Proper cleanup of audio resources
- **Responsive UI**: Smooth interaction on mobile devices

## 🚀 Deployment

### Production Build
```bash
# Build client for production
cd client && npm run build

# Start production server
cd ../server && npm start
```

### Docker Support
Consider containerizing the application for easier deployment:
- Separate containers for client and server
- Volume mounts for book storage
- Environment variable configuration

## 🤝 Contributing

1. Follow the maintainability guidelines in `MAINTAINABILITY.md`
2. Keep components focused and under 200 lines
3. Use the established utility functions and constants
4. Test both local and remote processing modes
5. Ensure mobile compatibility

## 📄 License

This project is private and proprietary. See license file for details.

## 🎯 Advanced Features

### Montreal Forced Aligner Integration
For enhanced audio-text timing alignment, see the detailed [MFA Integration Guide](./MFA_INTEGRATION.md) which covers:
- Installation and setup of Montreal Forced Aligner
- Enhanced API endpoints for improved timing
- Comparison between VoiceVox and MFA alignment methods
- Troubleshooting and performance considerations

---

**Note**: This application is designed specifically for Japanese language learning and requires proper configuration of external services (OpenAI, VOICEVOX) for full functionality. The core features work offline using the integrated JMDict dictionary.
