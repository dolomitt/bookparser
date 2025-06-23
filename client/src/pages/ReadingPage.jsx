import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

export default function ReadingPage() {
  const { book } = useParams();
  const [lines, setLines] = useState([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    fetch(`/books/${book}`)
      .then(res => res.text())
      .then(text => setLines(text.split('\n')));
    // Load progress from localStorage
    const saved = localStorage.getItem(`progress-${book}`);
    if (saved) setProgress(Number(saved));
  }, [book]);

  const handleLineClick = (idx) => {
    setProgress(idx);
    localStorage.setItem(`progress-${book}`, idx);
  };

  return (
    <div className="container">
      <h2>{book}</h2>
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
      <div style={{marginTop: '1em'}}>Progress: Line {progress + 1} / {lines.length}</div>
    </div>
  );
}
