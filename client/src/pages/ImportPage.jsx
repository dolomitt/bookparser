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
  const [verbMergeOptions, setVerbMergeOptions] = useState({
    mergeAuxiliaryVerbs: true,
    mergeVerbParticles: true,
    mergeVerbSuffixes: true,
    mergeTeForm: true,
    mergeMasuForm: true,
    mergeAllInflections: true,
    mergePunctuation: true,
    useCompoundDetection: false
  });
  const [showVerbOptions, setShowVerbOptions] = useState(false);
  const fileInput = useRef();

  useEffect(() => {
    if (filename) {
      axios.get(`/api/import/${filename}`).then(res => {
        setLines(res.data.lines);

        // Load existing processed data if available
        if (res.data.existingProcessedData && Object.keys(res.data.existingProcessedData).length > 0) {
          setProcessedLines(res.data.existingProcessedData);
          console.log(`Loaded ${Object.keys(res.data.existingProcessedData).length} previously processed lines`);

          // Set success messages for previously processed lines
          const messages = {};
          Object.keys(res.data.existingProcessedData).forEach(lineIndex => {
            messages[lineIndex] = 'Previously processed';
          });
          setLineMessages(messages);
        }

        // Load existing verb merge options if available
        if (res.data.existingVerbMergeOptions && Object.keys(res.data.existingVerbMergeOptions).length > 0) {
          setVerbMergeOptions(prev => ({
            ...prev,
            ...res.data.existingVerbMergeOptions
          }));
          console.log('Loaded existing verb merge options:', res.data.existingVerbMergeOptions);
        }
      });
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
    console.log('Verb merge options:', verbMergeOptions);

    // Set processing message for this specific line
    setLineMessages(prev => ({ ...prev, [idx]: 'Processing...' }));

    try {
      const requestData = {
        text: lines[idx],
        lineIndex: idx,
        verbMergeOptions: verbMergeOptions,
        allLines: lines
      };
      console.log('Sending request to /api/parse with data:', requestData);

      const response = await axios.post('/api/parse', requestData);
      console.log('Received response:', response.data);

      // Set success message for this specific line
      setLineMessages(prev => ({ ...prev, [idx]: response.data.result }));

      // Store the processed tokens and full line translation for interactive display
      if (response.data.analysis && response.data.analysis.tokens) {
        const lineData = {
          tokens: response.data.analysis.tokens,
          fullLineTranslation: response.data.fullLineTranslation || 'N/A'
        };
        setProcessedLines(prev => {
          const updatedLines = { ...prev, [idx]: lineData };

          // Auto-save after processing
          setTimeout(() => {
            autoSave(idx, lineData);
          }, 100);

          return updatedLines;
        });
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

  const handleVerbOptionChange = (option, value) => {
    setVerbMergeOptions(prev => ({
      ...prev,
      [option]: value
    }));
  };

  const autoSave = async (lineIndex, lineData) => {
    try {
      // Save only the specific line that was processed
      const saveData = {
        lineIndex: lineIndex,
        lineData: lineData,
        verbMergeOptions: verbMergeOptions,
        timestamp: new Date().toISOString()
      };

      await axios.post(`/api/import/${filename}/save-line`, saveData);
      console.log(`Auto-saved line ${lineIndex}`);
    } catch (error) {
      console.error('Auto-save error:', error);
    }
  };

  const handleSave = async () => {
    setMessage('Saving...');
    try {
      // Prepare the complete book data with all processed information
      const bookData = {
        bookname: filename,
        originalLines: lines,
        processedData: processedLines,
        verbMergeOptions: verbMergeOptions,
        metadata: {
          totalLines: lines.length,
          processedLines: Object.keys(processedLines).length,
          savedAt: new Date().toISOString()
        }
      };

      await axios.post(`/api/import/${filename}/save`, bookData);
      setMessage('Saved to books with all processed data!');
    } catch (error) {
      console.error('Save error:', error);
      setMessage('Save failed');
    }
  };

  // Function to check if a character is kanji
  const isKanji = (char) => {
    const code = char.charCodeAt(0);
    return (code >= 0x4e00 && code <= 0x9faf) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x20000 && code <= 0x2a6df); // CJK Extension B
  };

  // Function to check if token contains kanji
  const hasKanji = (text) => {
    return text.split('').some(char => isKanji(char));
  };

  // Component to render tokenized text with hover functionality and ruby text
  const TokenizedText = ({ tokens }) => {
    return (
      <div style={{ marginTop: '5px', padding: '5px', backgroundColor: '#191919', borderRadius: '3px' }}>
        {tokens.map((token, tokenIdx) => {
          // Check if this is a merged verb (from server-side processing)
          const isMergedVerb = token.pos === '動詞' && (token.pos_detail === 'compound' || token.pos_detail === 'inflected');
          const isPunctuation = token.pos === '記号';
          const shouldShowRuby = hasKanji(token.surface) && token.reading && token.reading !== token.surface;

          // Create enhanced tooltip with OpenAI data and merge info (no POS)
          const tooltipText = [
            `Surface: ${token.surface}`,
            `Reading: ${token.reading || 'N/A'}`,
            isMergedVerb ? '🔗 Merged Verb Token' : '',
            token.translation && token.translation !== 'N/A' ? `Translation: ${token.translation}` : '',
            token.contextualMeaning && token.contextualMeaning !== 'N/A' ? `Context: ${token.contextualMeaning}` : '',
            token.grammaticalRole && token.grammaticalRole !== token.pos ? `Grammar: ${token.grammaticalRole}` : ''
          ].filter(Boolean).join('\n');

          // Determine token color based on type and AI analysis - only show on hover
          const hasAIData = token.translation && token.translation !== 'N/A';
          let baseColor, hoverColor;

          if (isPunctuation) {
            // Punctuation gets no highlighting, just neutral colors
            baseColor = 'transparent';
            hoverColor = '#333';
          } else if (isMergedVerb) {
            // Special styling for merged verbs - only on hover
            baseColor = 'transparent';
            hoverColor = hasAIData ? '#4a7c59' : '#2d7d32';
          } else if (token.pos === '動詞') {
            // Regular verb styling - only on hover
            baseColor = 'transparent';
            hoverColor = hasAIData ? '#6b46c1' : '#7c3aed';
          } else {
            // Default styling - only on hover
            baseColor = 'transparent';
            hoverColor = hasAIData ? '#2b6cb0' : '#007bff';
          }

          const tokenContent = (
            <>
              {shouldShowRuby ? (
                <ruby style={{ fontSize: 'inherit' }}>
                  {token.surface}
                  <rt style={{
                    fontSize: '0.75em',
                    color: '#ccc',
                    fontWeight: 'normal'
                  }}>
                    {token.reading}
                  </rt>
                </ruby>
              ) : (
                token.surface
              )}
            </>
          );

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
                cursor: isPunctuation ? 'default' : 'pointer',
                fontSize: '0.9em',
                border: 'none',
                fontWeight: isMergedVerb ? 'bold' : 'normal',
                transition: 'background-color 0.2s ease'
              }}
              title={isPunctuation ? '' : tooltipText}
              onMouseEnter={(e) => {
                if (!isPunctuation) {
                  e.target.style.backgroundColor = hoverColor;
                  e.target.style.color = 'white';
                }
              }}
              onMouseLeave={(e) => {
                if (!isPunctuation) {
                  e.target.style.backgroundColor = baseColor;
                  e.target.style.color = '#f2f2f2';
                }
              }}
            >
              {tokenContent}
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
          <div style={{ marginBottom: '20px' }}>
            <button onClick={handleSave} className="btn">Save to Books</button>
            <button
              onClick={() => setShowVerbOptions(!showVerbOptions)}
              className="btn"
              style={{ marginLeft: '10px' }}
            >
              {showVerbOptions ? 'Hide' : 'Show'} Verb Options
            </button>
          </div>

          {showVerbOptions && (
            <div style={{
              marginBottom: '20px',
              padding: '15px',
              backgroundColor: '#2a2a2a',
              borderRadius: '5px',
              border: '1px solid #444'
            }}>
              <h4 style={{ marginTop: '0', color: '#fff' }}>Japanese Verb Tokenization Options</h4>
              <p style={{ fontSize: '0.9em', color: '#ccc', marginBottom: '15px' }}>
                Configure how Japanese verbs are merged to keep them as single tokens:
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeAuxiliaryVerbs}
                    onChange={(e) => handleVerbOptionChange('mergeAuxiliaryVerbs', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Merge Auxiliary Verbs (助動詞)
                </label>

                <label style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeVerbParticles}
                    onChange={(e) => handleVerbOptionChange('mergeVerbParticles', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Merge Verb Particles (助詞)
                </label>

                <label style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeVerbSuffixes}
                    onChange={(e) => handleVerbOptionChange('mergeVerbSuffixes', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Merge Verb Suffixes (接尾)
                </label>

                <label style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeTeForm}
                    onChange={(e) => handleVerbOptionChange('mergeTeForm', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Merge Te-form (て/で)
                </label>

                <label style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeMasuForm}
                    onChange={(e) => handleVerbOptionChange('mergeMasuForm', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Merge Masu-form (ます/ました)
                </label>

                <label style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeAllInflections}
                    onChange={(e) => handleVerbOptionChange('mergeAllInflections', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Merge ALL Inflections (Complete)
                </label>

                <label style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergePunctuation}
                    onChange={(e) => handleVerbOptionChange('mergePunctuation', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Merge Punctuation (記号)
                </label>

                <label style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.useCompoundDetection}
                    onChange={(e) => handleVerbOptionChange('useCompoundDetection', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Detect Compound Verbs
                </label>
              </div>

              <div style={{ marginTop: '15px', fontSize: '0.8em', color: '#aaa' }}>
                <strong>Examples of Complete Inflection Merging:</strong><br />
                • Te-form: 食べて → single token instead of 食べ + て<br />
                • Masu-form: 食べます → single token instead of 食べ + ます<br />
                • Past: 食べた → single token instead of 食べ + た<br />
                • Negative: 食べない → single token instead of 食べ + ない<br />
                • Conditional: 食べれば → single token instead of 食べ + れば<br />
                • Potential: 食べられる → single token instead of 食べ + られる<br />
                • Compound: 食べ込む → single token for compound verb patterns<br />
                <strong>Note:</strong> "Merge ALL Inflections" captures comprehensive verb forms including auxiliary verbs, particles, and all conjugation patterns.
              </div>
            </div>
          )}

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
                  <div>
                    <TokenizedText tokens={processedLines[idx].tokens || processedLines[idx]} />
                    {processedLines[idx].fullLineTranslation && processedLines[idx].fullLineTranslation !== 'N/A' && (
                      <div style={{
                        marginTop: '10px',
                        padding: '10px',
                        backgroundColor: '#2a2a2a',
                        borderRadius: '5px',
                        border: '1px solid #444',
                        borderLeft: '4px solid #4fc3f7'
                      }}>
                        <div style={{
                          fontSize: '0.8em',
                          color: '#888',
                          marginBottom: '5px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          Translation
                        </div>
                        <div style={{
                          color: '#f2f2f2',
                          fontSize: '1em',
                          lineHeight: '1.4'
                        }}>
                          {processedLines[idx].fullLineTranslation}
                        </div>
                      </div>
                    )}
                  </div>
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
