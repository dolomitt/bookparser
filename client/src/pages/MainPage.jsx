import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  cacheResourceList,
  getCachedBookItems,
  getCachedImportItems,
  getCachedResourceList
} from '../utils/offlineCache';

function ResourceCard({
  to,
  className,
  icon,
  title,
  filename,
  type,
  wordCount,
  difficultyLevel,
  onDelete,
  deleting
}) {
  const showFilename = filename && title !== filename;
  const stats = [
    Number.isInteger(wordCount) && wordCount > 0 ? `${wordCount.toLocaleString()} words` : null,
    difficultyLevel ? `JLPT ${difficultyLevel}` : null
  ].filter(Boolean);

  return (
    <div className={`book-card ${className}`}>
      <Link to={to} className="book-card-main">
        <div className="book-icon">{icon}</div>
        <div className="book-info">
          <h4>{title}</h4>
          {showFilename && <div className="book-filename">{filename}</div>}
          {stats.length > 0 && <div className="book-stats">{stats.join(' · ')}</div>}
          <span className="book-type">{type}</span>
        </div>
        <div className="book-arrow">→</div>
      </Link>
      <button
        type="button"
        className="book-delete-btn"
        onClick={onDelete}
        disabled={deleting}
        title={`Delete ${title}`}
        aria-label={`Delete ${title}`}
      >
        ×
      </button>
    </div>
  );
}

export default function MainPage() {
  const [books, setBooks] = useState([]);
  const [imports, setImports] = useState([]);
  const [deletingResource, setDeletingResource] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    const mergeByFilename = (primary = [], fallback = []) => {
      const seen = new Set();
      return [...primary, ...fallback].filter((item) => {
        const filename = typeof item === 'string' ? item : item?.filename;
        if (!filename || seen.has(filename)) return false;
        seen.add(filename);
        return true;
      });
    };

    const loadLists = async () => {
      try {
        const [booksResponse, importsResponse] = await Promise.all([
          fetch('/api/books'),
          fetch('/api/imports')
        ]);

        if (!booksResponse.ok || !importsResponse.ok) {
          throw new Error('Could not load reading list');
        }

        const [nextBooks, nextImports] = await Promise.all([
          booksResponse.json(),
          importsResponse.json()
        ]);

        await Promise.all([
          cacheResourceList('books', nextBooks),
          cacheResourceList('imports', nextImports)
        ]);

        if (!cancelled) {
          setBooks(nextBooks);
          setImports(nextImports);
        }
      } catch (error) {
        const [cachedBooks, cachedImports, openedBooks, openedImports] = await Promise.all([
          getCachedResourceList('books'),
          getCachedResourceList('imports'),
          getCachedBookItems(),
          getCachedImportItems()
        ]);

        if (!cancelled) {
          setBooks(mergeByFilename(cachedBooks || [], openedBooks));
          setImports(mergeByFilename(cachedImports || [], openedImports));
          setMessage('Offline mode: showing reading cached on this device.');
        }
      }
    };

    loadLists();

    return () => {
      cancelled = true;
    };
  }, []);

  const normalizeListItem = (item) => {
    if (typeof item === 'string') {
      return {
        filename: item,
        displayTitle: item,
        summaryTitle: null,
        importedAt: null,
        wordCount: null,
        difficultyLevel: null,
        offlineOnly: false,
        jlptTaggedCount: null,
        jlptLevelCounts: {},
        jlptVocabularyCounts: {},
        jlptGrammarCounts: {}
      };
    }

    const filename = String(item?.filename || item?.name || '').trim();
    const displayTitle = String(item?.displayTitle || item?.summaryTitle || filename).trim();
    return {
      filename,
      displayTitle: displayTitle || filename,
      summaryTitle: item?.summaryTitle || null,
      importedAt: item?.importedAt || item?.updatedAt || null,
      wordCount: Number.isInteger(item?.wordCount) ? item.wordCount : null,
      difficultyLevel: item?.difficultyLevel || null,
      offlineOnly: item?.offlineOnly || false,
      jlptTaggedCount: Number.isInteger(item?.jlptTaggedCount) ? item.jlptTaggedCount : null,
      jlptLevelCounts: item?.jlptLevelCounts || item?.jlptGrammarCounts || {},
      jlptVocabularyCounts: item?.jlptVocabularyCounts || {},
      jlptGrammarCounts: item?.jlptGrammarCounts || {}
    };
  };

  const bookItems = books.map(normalizeListItem).filter((book) => book.filename);
  const getItemTime = (item) => {
    const time = Date.parse(item?.importedAt || '');
    return Number.isFinite(time) ? time : 0;
  };
  const importItems = imports
    .map(normalizeListItem)
    .filter((file) => file.filename)
    .sort((a, b) => getItemTime(b) - getItemTime(a));

  // Separate .book files from regular text files
  const processedBooks = bookItems.filter(book => book.filename.endsWith('.book'));
  const processedBaseNames = new Set(processedBooks.map((book) => book.filename.replace(/\.book$/, '')));
  const regularBooks = bookItems.filter((book) =>
    !book.filename.endsWith('.book') &&
    book.filename !== '.gitkeep' &&
    !processedBaseNames.has(book.filename)
  );

  const handleDeleteResource = async ({ filename, title, kind }) => {
    const label = title || filename;
    const confirmed = window.confirm(`Delete "${label}"?\n\nThis removes the saved resource from the main page.`);
    if (!confirmed) return;

    const resourceKey = `${kind}:${filename}`;
    setDeletingResource(resourceKey);
    setMessage('');

    try {
      const endpoint = kind === 'draft'
        ? `/api/import/${encodeURIComponent(filename)}`
        : `/api/books/${encodeURIComponent(filename)}`;
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to delete resource');
      }

      if (kind === 'draft') {
        setImports((current) => current.filter((item) => normalizeListItem(item).filename !== filename));
      } else {
        setBooks((current) => current.filter((item) => normalizeListItem(item).filename !== filename));
      }
      setMessage(`Deleted "${label}".`);
    } catch (error) {
      setMessage(`Delete failed: ${error.message}`);
    } finally {
      setDeletingResource(null);
    }
  };

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
            <div className="stat-number">{importItems.length}</div>
            <div className="stat-label">Drafts</div>
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
        {message && <div className="home-message">{message}</div>}

        {/* Reading Resources */}
        {processedBooks.length > 0 && (
          <div className="section-card">
            <div className="section-header">
              <h2>📊 Reading</h2>
              <span className="section-count">{processedBooks.length}</span>
            </div>
            <div className="books-grid">
              {processedBooks.map(book => {
                const filename = book.filename;
                const originalName = filename.replace('.book', '');
                const displayName = book.displayTitle || originalName;
                return (
                  <ResourceCard
                    key={filename}
                    to={`/import/${encodeURIComponent(originalName)}?view=book`}
                    className="processed"
                    icon="🔍"
                    title={displayName}
                    filename={originalName}
                    type={book.offlineOnly ? 'Reading (offline)' : 'Reading'}
                    wordCount={book.wordCount}
                    difficultyLevel={book.difficultyLevel}
                    deleting={deletingResource === `reading:${filename}`}
                    onDelete={() => handleDeleteResource({
                      filename,
                      title: displayName,
                      kind: 'reading'
                    })}
                  />
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
                <ResourceCard
                  key={book.filename}
                  to={`/read/${encodeURIComponent(book.filename)}`}
                  className="regular"
                  icon="📝"
                  title={book.displayTitle || book.filename}
                  filename={book.filename}
                  type={book.offlineOnly ? 'Plain Text (offline)' : 'Plain Text'}
                  wordCount={book.wordCount}
                  difficultyLevel={book.difficultyLevel}
                  deleting={deletingResource === `reading:${book.filename}`}
                  onDelete={() => handleDeleteResource({
                    filename: book.filename,
                    title: book.displayTitle || book.filename,
                    kind: 'reading'
                  })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Drafts */}
        {importItems.length > 0 && (
          <div className="section-card">
            <div className="section-header">
              <h2>⚡ Drafts</h2>
              <span className="section-count">{importItems.length}</span>
            </div>
            <div className="books-grid">
              {importItems.map(file => (
                <ResourceCard
                  key={file.filename}
                  to={`/import/${encodeURIComponent(file.filename)}`}
                  className="import"
                  icon="⏳"
                  title={file.displayTitle || file.filename}
                  filename={file.filename}
                  type={file.offlineOnly ? 'Draft (offline)' : 'Draft'}
                  wordCount={file.wordCount}
                  difficultyLevel={file.difficultyLevel}
                  deleting={deletingResource === `draft:${file.filename}`}
                  onDelete={() => handleDeleteResource({
                    filename: file.filename,
                    title: file.displayTitle || file.filename,
                    kind: 'draft'
                  })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {bookItems.length === 0 && importItems.length === 0 && (
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
