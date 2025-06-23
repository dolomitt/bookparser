import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import MainPage from './pages/MainPage';
import ReadingPage from './pages/ReadingPage';
import ImportPage from './pages/ImportPage';

export default function App() {
  return (
    <div>
      <nav style={{ padding: '1em', background: '#222', color: '#fff' }}>
        <Link to="/" style={{ marginRight: 16, color: '#fff' }}>Books</Link>
        <Link to="/import" style={{ color: '#fff' }}>Import</Link>
      </nav>
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/read/:book" element={<ReadingPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/import/:filename" element={<ImportPage />} />
      </Routes>
    </div>
  );
}
