import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { cacheBookText, getCachedBookText } from '../utils/offlineCache';

// Cookie utility functions for bookmarks
const setCookie = (name, value, days = 30) => {
  const expires = new Date();
  expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${JSON.stringify(value)};expires=${expires.toUTCString()};path=/`;
};

const getCookie = (name) => {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) {
      try {
        return JSON.parse(c.substring(nameEQ.length, c.length));
      } catch (e) {
        return null;
      }
    }
  }
  return null;
};

export default function ReadingPage() {
  const { book } = useParams();
  const [lines, setLines] = useState([]);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadBook = async () => {
      setMessage('');

      try {
        const response = await fetch(`/api/books/${book}`);
        if (!response.ok) throw new Error('Could not load book');

        const text = await response.text();
        await cacheBookText(book, text);

        if (!cancelled) {
          setLines(text.split('\n'));
        }
      } catch (error) {
        const cachedText = await getCachedBookText(book);

        if (!cancelled) {
          if (cachedText !== null) {
            setLines(cachedText.split('\n'));
            setMessage('Offline mode: loaded cached text from this device.');
          } else {
            setMessage('This book is not cached on this device yet.');
          }
        }
      }
    };

    loadBook();

    // Load progress from cookie-based bookmark
    const bookmark = getCookie(`bookmark_${book.replace('.book', '').replace('.txt', '')}`);
    if (bookmark && bookmark.position !== undefined) {
      setProgress(Number(bookmark.position));
    } else {
      // Fallback to localStorage for backward compatibility
      const saved = localStorage.getItem(`progress-${book}`);
      if (saved) setProgress(Number(saved));
    }

    return () => {
      cancelled = true;
    };
  }, [book]);

  const handleLineClick = (idx) => {
    setProgress(idx);

    // Save bookmark in cookie with enhanced data
    const bookmark = {
      book: book,
      position: idx,
      timestamp: new Date().toISOString(),
      totalLines: lines.length,
      progressPercent: lines.length > 0 ? Math.round((idx / lines.length) * 100) : 0
    };

    setCookie(`bookmark_${book.replace('.book', '').replace('.txt', '')}`, bookmark);

    // Also save to localStorage for backward compatibility
    localStorage.setItem(`progress-${book}`, idx);
  };

  return (
    <div className="container">
      <h2>{book}</h2>
      {message && <div className="note">{message}</div>}
      <div className="reading-area">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={idx === progress ? 'highlight' : ''}
            onClick={() => handleLineClick(idx)}
            style={{ cursor: 'pointer', padding: '4px 0' }}
          >
            {line}
          </div>
        ))}
      </div>
      <div style={{ marginTop: '1em' }}>Progress: Line {progress + 1} / {lines.length}</div>
    </div>
  );
}
