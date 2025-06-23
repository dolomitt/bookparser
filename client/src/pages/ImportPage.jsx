import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

export default function ImportPage() {
  const { filename } = useParams();
  const [lines, setLines] = useState([]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [lineMessages, setLineMessages] = useState({});
  const [processedLines, setProcessedLines] = useState({});
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
    console.log('Process button clicked for line index:', idx);
    console.log('Line text:', lines[idx]);

    // Set processing message for this specific line
    setLineMessages(prev => ({ ...prev, [idx]: 'Processing...' }));

    try {
      const requestData = {
        text: lines[idx],
        lineIndex: idx
      };
      console.log('Sending request to /api/parse with data:', requestData);

      const response = await axios.post('/api/parse', requestData);
      console.log('Received response:', response.data);

      // Set success message for this specific line
      setLineMessages(prev => ({ ...prev, [idx]: response.data.result }));

      // Store the processed tokens for interactive display
      if (response.data.analysis && response.data.analysis.tokens) {
        setProcessedLines(prev => ({ ...prev, [idx]: response.data.analysis.tokens }));
      }
    } catch (error) {
      console.error('Processing error:', error);
      console.error('Error response:', error.response?.data);

      // Set error message for this specific line
      setLineMessages(prev => ({
        ...prev,
        [idx]: `Error: ${error.response?.data?.error || error.message}`
      }));
    }
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

  // Component to render tokenized text with hover functionality
  const TokenizedText = ({ tokens }) => {
    return (
      <div style={{ marginTop: '5px', padding: '5px', backgroundColor: '#191919', borderRadius: '3px' }}>
        {tokens.map((token, tokenIdx) => {
          // Create enhanced tooltip with OpenAI data
          const tooltipText = [
            `Surface: ${token.surface}`,
            `Reading: ${token.reading || 'N/A'}`,
            `POS: ${token.pos}`,
            `Detail: ${token.pos_detail || 'N/A'}`,
            token.translation && token.translation !== 'N/A' ? `Translation: ${token.translation}` : '',
            token.contextualMeaning && token.contextualMeaning !== 'N/A' ? `Context: ${token.contextualMeaning}` : '',
            token.grammaticalRole && token.grammaticalRole !== token.pos ? `Grammar: ${token.grammaticalRole}` : ''
          ].filter(Boolean).join('\n');

          // Determine token color based on whether it has AI analysis
          const hasAIData = token.translation && token.translation !== 'N/A';
          const baseColor = hasAIData ? '#4a5568' : '#444';
          const hoverColor = hasAIData ? '#2b6cb0' : '#007bff';

          return (
            <span
              key={tokenIdx}
              style={{
                display: 'inline-block',
                margin: '1px',
                padding: '2px 4px',
                backgroundColor: baseColor,
                color: '#f2f2f2',
                borderRadius: '2px',
                cursor: 'pointer',
                fontSize: '0.9em',
                border: hasAIData ? '1px solid #4299e1' : 'none'
              }}
              title={tooltipText}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = hoverColor;
                e.target.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = baseColor;
                e.target.style.color = '#f2f2f2';
              }}
            >
              {token.surface}
            </span>
          );
        })}
      </div>
    );
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
                <div className="import-line-header">
                  <div className="import-line-content">
                    <span>{line}</span>
                  </div>
                  {line.trim() && (
                    <button onClick={() => handleLineProcess(idx)} className="btn-small">Process</button>
                  )}
                  {lineMessages[idx] && (
                    <span style={{ marginLeft: '10px', fontSize: '0.9em', color: lineMessages[idx].startsWith('Error') ? '#dc3545' : '#28a745' }}>
                      {lineMessages[idx]}
                    </span>
                  )}
                </div>
                {processedLines[idx] && (
                  <TokenizedText tokens={processedLines[idx]} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {message && <div style={{ marginTop: '1em', color: '#007bff' }}>{message}</div>}
    </div>
  );
}
