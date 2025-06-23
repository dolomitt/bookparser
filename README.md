# Bookparser Website

A web application to help users read Japanese books with reading support, powered by Node.js, Express, React, and OpenAI API.

## Features
- Book list and import management
- Reading view with furigana, explanations, and translations
- Import and parse books line-by-line
- Upload and process TXT files
- Mobile-friendly, responsive, dark mode

## Getting Started
1. Copy `.env.example` to `.env` and set your OpenAI API key
2. Run `npm install` in the root, `server`, and `client` folders
3. Start development: `npm run dev`

## Folder Structure
- `/server` — Express backend (API, file handling, OpenAI integration)
- `/client` — React frontend (UI)
- `/books` — Book storage
- `/imports` — Import progress

## Requirements
- Node.js 18+
- OpenAI API key

---
See `website_requirements.txt` for detailed requirements.
