import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function MainPage() {
  const [books, setBooks] = useState([]);
  const [imports, setImports] = useState([]);

  useEffect(() => {
    fetch('/api/books').then(res => res.json()).then(setBooks);
    fetch('/api/imports').then(res => res.json()).then(setImports);
  }, []);

  // Separate .book files from regular text files
  const processedBooks = books.filter(book => book.endsWith('.book'));
  const processedBaseNames = new Set(processedBooks.map((book) => book.replace(/\.book$/, '')));
  const regularBooks = books.filter((book) =>
    !book.endsWith('.book') &&
    book !== '.gitkeep' &&
    !processedBaseNames.has(book)
  );

  return (
    <div className="home-container">
      {/* Hero Section */}
      <div className="hero-section">
        <h1 className="hero-title">📚 Japanese Reading Parser</h1>
        <p className="hero-subtitle">
          Advanced Japanese text analysis with AI-powered translations, verb merging, and furigana support
        </p>
        <div className="hero-stats">
          <div className="stat-card">
            <div className="stat-number">{processedBooks.length + regularBooks.length}</div>
            <div className="stat-label">Reading</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{imports.length}</div>
            <div className="stat-label">Drafts</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{processedBooks.length}</div>
            <div className="stat-label">Reading</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <Link to="/import" className="action-card primary">
          <div className="action-icon">📖</div>
          <div className="action-content">
            <h3>New Draft</h3>
            <p>Upload a text file or add an article URL</p>
          </div>
        </Link>
      </div>

        {/* Reading and drafts grid */}
      <div className="content-grid">
        {/* Reading Resources */}
        {processedBooks.length > 0 && (
          <div className="section-card">
            <div className="section-header">
              <h2>📊 Reading</h2>
              <span className="section-count">{processedBooks.length}</span>
            </div>
            <div className="books-grid">
              {processedBooks.map(book => {
                const displayName = book.replace('.book', '');
                return (
                  <Link
                    key={book}
                    to={`/import/${encodeURIComponent(displayName)}?view=book`}
                    className="book-card processed"
                  >
                    <div className="book-icon">🔍</div>
                    <div className="book-info">
                      <h4>{displayName}</h4>
                      <span className="book-type">Reading</span>
                    </div>
                    <div className="book-arrow">→</div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Plain text reading resources */}
        {regularBooks.length > 0 && (
          <div className="section-card">
            <div className="section-header">
              <h2>📄 Plain Text Reading</h2>
              <span className="section-count">{regularBooks.length}</span>
            </div>
            <div className="books-grid">
              {regularBooks.map(book => (
                <Link
                  key={book}
                  to={`/read/${encodeURIComponent(book)}`}
                  className="book-card regular"
                >
                  <div className="book-icon">📝</div>
                  <div className="book-info">
                    <h4>{book}</h4>
                    <span className="book-type">Plain Text</span>
                  </div>
                  <div className="book-arrow">→</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Drafts */}
        {imports.length > 0 && (
          <div className="section-card">
            <div className="section-header">
              <h2>⚡ Drafts</h2>
              <span className="section-count">{imports.length}</span>
            </div>
            <div className="books-grid">
              {imports.map(file => (
                <Link
                  key={file}
                  to={`/import/${encodeURIComponent(file)}`}
                  className="book-card import"
                >
                  <div className="book-icon">⏳</div>
                  <div className="book-info">
                    <h4>{file}</h4>
                    <span className="book-type">Draft</span>
                  </div>
                  <div className="book-arrow">→</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {books.length === 0 && imports.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">📚</div>
            <h3>No reading yet</h3>
            <p>Start by creating your first draft</p>
            <Link to="/import" className="btn">Create Draft</Link>
          </div>
        )}
      </div>
    </div>
  );
}
