import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

export default function ImportPage() {
  const { filename } = useParams();
  const [lines, setLines] = useState([]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef();

  useEffect(() => {
    if (filename) {
      axios.get(`/api/import/${filename}`).then(res => setLines(res.data.lines));
    }
  }, [filename]);

  const handleFileChange = e => setFile(e.target.files[0]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/import', formData);
      setMessage(`Uploaded: ${res.data.originalname}`);
      window.location.href = `/import/${res.data.filename}`;
    } catch (err) {
      setMessage('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleLineProcess = async (idx) => {
    setMessage('Processing...');
    // Placeholder for OpenAI integration
    setTimeout(() => setMessage('OpenAI integration pending'), 500);
  };

  const handleSave = async () => {
    setMessage('Saving...');
    try {
      await axios.post(`/api/import/${filename}/save`, { bookname: filename });
      setMessage('Saved to books!');
    } catch {
      setMessage('Save failed');
    }
  };

  return (
    <div className="container">
      <h2>Import Books</h2>
      {!filename && (
        <div>
          <input type="file" ref={fileInput} onChange={handleFileChange} accept=".txt" />
          <button onClick={handleUpload} disabled={uploading} className="btn">
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      )}
      {filename && (
        <div>
          <h3>File: {filename}</h3>
          <button onClick={handleSave} className="btn">Save to Books</button>
          <div className="import-lines">
            {lines.map((line, idx) => (
              <div key={idx} className="import-line">
                <span>{line}</span>
                <button onClick={() => handleLineProcess(idx)} className="btn-small">Process</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {message && <div style={{ marginTop: '1em', color: '#007bff' }}>{message}</div>}
    </div>
  );
}
