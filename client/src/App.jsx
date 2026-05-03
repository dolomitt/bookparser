import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import MainPage from './pages/MainPage';
import ReadingPage from './pages/ReadingPage';
import ImportPage from './pages/ImportPage';

export default function App() {
  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link to="/">Books</Link>
        <Link to="/import">Import</Link>
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
