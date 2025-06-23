import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function MainPage() {
  const [books, setBooks] = useState([]);
  const [imports, setImports] = useState([]);

  useEffect(() => {
    fetch('/api/books').then(res => res.json()).then(setBooks);
    fetch('/api/imports').then(res => res.json()).then(setImports);
  }, []);

  return (
    <div className="container">
      <h2>Books</h2>
      <ul>
        {books.map(book => (
          <li key={book}>
            <Link to={`/read/${encodeURIComponent(book)}`}>{book}</Link>
          </li>
        ))}
      </ul>
      <h2>Imports in Progress</h2>
      <ul>
        {imports.map(file => (
          <li key={file}>
            <Link to={`/import/${encodeURIComponent(file)}`}>{file}</Link>
          </li>
        ))}
      </ul>
      <Link to="/import" className="btn">Import New Book</Link>
    </div>
  );
}
