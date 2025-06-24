import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function ImportPage() {
  const { filename } = useParams();
  const navigate = useNavigate();
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

  // Separate useEffect for initial load only
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  
  useEffect(() => {
    if (filename && !initialLoadComplete) {
      console.log('Initial load for:', filename);
      axios.get(`/api/import/${filename}`).then(res => {
        console.log('File data loaded:', res.data);
        setLines(res.data.lines);

        // Load existing processed data if available
        if (res.data.existingProcessedData && Object.keys(res.data.existingProcessedData).length > 0) {
          console.log('Loading existing processed data:', res.data.existingProcessedData);
          setProcessedLines(res.data.existingProcessedData);
          console.log(`Loaded ${Object.keys(res.data.existingProcessedData).length} previously processed lines`);

          // Clear any existing messages for previously processed lines
          const messages = {};
          Object.keys(res.data.existingProcessedData).forEach(lineIndex => {
            messages[lineIndex] = '';
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
        
        setInitialLoadComplete(true);
      }).catch(error => {
        console.error('Error loading file data:', error);
        setInitialLoadComplete(true); // Set to true even on error to prevent infinite retries
      });
    }
  }, [filename, initialLoadComplete]);

  const handleFileChange = e => setFile(e.target.files[0]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/import', formData);
      setMessage(`Uploaded: ${res.data.originalname}`);
      navigate(`/import/${res.data.filename}`);
    } catch (err) {
      setMessage('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleLineProcess = async (idx, useRemoteProcessing = true) => {
    console.log('Process button clicked for line index:', idx);
    console.log('Line text:', lines[idx]);
    console.log('Verb merge options:', verbMergeOptions);
    console.log('Use remote processing (OpenAI):', useRemoteProcessing);

    // Set processing message for this specific line
    const processingMessage = useRemoteProcessing ? 'Processing with AI...' : 'Processing locally...';
    setLineMessages(prev => ({ ...prev, [idx]: processingMessage }));

    try {
      const requestData = {
        text: lines[idx],
        lineIndex: idx,
        verbMergeOptions: verbMergeOptions,
        allLines: lines,
        useRemoteProcessing: useRemoteProcessing
      };
      console.log('Sending request to /api/parse with data:', requestData);

      const response = await axios.post('/api/parse', requestData);
      console.log('Received response:', response.data);

      // Clear message for this specific line after successful processing
      setLineMessages(prev => ({ ...prev, [idx]: '' }));

      // Store the processed tokens and full line translation for interactive display
      if (response.data.analysis && response.data.analysis.tokens) {
        const lineData = {
          tokens: response.data.analysis.tokens,
          fullLineTranslation: response.data.fullLineTranslation || 'N/A',
          processingType: useRemoteProcessing ? 'remote' : 'local'
        };
        
        console.log('Setting processed line data for index:', idx, lineData);
        
        setProcessedLines(prev => {
          const updatedLines = { ...prev, [idx]: lineData };
          console.log('Updated processed lines state:', updatedLines);
          return updatedLines;
        });

        // Auto-save after processing with a longer delay to ensure state is set
        setTimeout(() => {
          console.log('Auto-saving line:', idx);
          autoSave(idx, lineData);
        }, 500);
      }
    } catch (error) {
      console.error('Processing error:', error);
      console.error('Error response:', error.response?.data);

      // Set error message for this specific line with better network error handling
      let errorMessage = 'Unknown error';
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        errorMessage = 'Server not running. Please start the server with "npm run dev" in the bookparser directory.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else {
        errorMessage = error.message;
      }

      setLineMessages(prev => ({
        ...prev,
        [idx]: `Error: ${errorMessage}`
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

  // Component to render tokenized text with mobile-friendly popup functionality and ruby text
  const TokenizedText = ({ tokens }) => {
    const [activePopup, setActivePopup] = useState(null);
    const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });

    const handleTokenClick = (e, token, tokenIdx) => {
      console.log('Token clicked:', token, 'Index:', tokenIdx);
      
      if (token.pos === '記号') {
        console.log('Skipping punctuation token');
        return; // Skip punctuation
      }

      e.preventDefault();
      e.stopPropagation();

      // Calculate popup position with better viewport handling
      const rect = e.currentTarget.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Calculate initial position
      let x = rect.left + (rect.width / 2);
      let y = rect.top - 10;
      
      // Adjust for viewport boundaries
      const popupWidth = 320; // max-width from CSS
      const popupHeight = 150; // estimated height
      
      // Keep popup within horizontal bounds
      if (x - popupWidth/2 < 10) {
        x = popupWidth/2 + 10;
      } else if (x + popupWidth/2 > viewportWidth - 10) {
        x = viewportWidth - popupWidth/2 - 10;
      }
      
      // Keep popup within vertical bounds
      if (y - popupHeight < 10) {
        y = rect.bottom + 10; // Show below token if not enough space above
      }

      console.log('Popup position:', { x, y });
      console.log('Current activePopup:', activePopup);
      console.log('Viewport:', { viewportWidth, viewportHeight });
      console.log('Token rect:', rect);

      setPopupPosition({ x, y });
      const newActivePopup = activePopup === tokenIdx ? null : tokenIdx;
      console.log('Setting activePopup to:', newActivePopup);
      setActivePopup(newActivePopup);
    };

    const closePopup = () => {
      console.log('Closing popup');
      setActivePopup(null);
    };

    // Close popup when clicking outside
    React.useEffect(() => {
      const handleClickOutside = (e) => {
        if (activePopup !== null && !e.target.closest('.token-popup') && !e.target.closest('[data-token]')) {
          console.log('Clicking outside popup, closing');
          closePopup();
        }
      };

      if (activePopup !== null) {
        document.addEventListener('click', handleClickOutside, true);
        document.addEventListener('touchstart', handleClickOutside, true);
      }

      return () => {
        document.removeEventListener('click', handleClickOutside, true);
        document.removeEventListener('touchstart', handleClickOutside, true);
      };
    }, [activePopup]);

    return (
      <div style={{ marginTop: '5px', padding: '5px', backgroundColor: '#191919', borderRadius: '3px', position: 'relative' }}>
        {tokens.map((token, tokenIdx) => {
          // Check if this is a merged verb (from server-side processing)
          const isMergedVerb = token.pos === '動詞' && (token.pos_detail === 'compound' || token.pos_detail === 'inflected');
          const isPunctuation = token.pos === '記号';
          const shouldShowRuby = hasKanji(token.surface) && token.reading && token.reading !== token.surface;
          const hasAIData = token.translation && token.translation !== 'N/A';

          // Determine token color based on type and AI analysis
          let tokenColor = '#f2f2f2';
          let activeColor;

          if (!isPunctuation) {
            if (isMergedVerb) {
              activeColor = hasAIData ? '#4a7c59' : '#2d7d32';
            } else if (token.pos === '動詞') {
              activeColor = hasAIData ? '#6b46c1' : '#7c3aed';
            } else {
              activeColor = hasAIData ? '#2b6cb0' : '#007bff';
            }
          }

          const tokenContent = (
            <>
              {shouldShowRuby ? (
                <ruby style={{ fontSize: 'inherit', pointerEvents: 'none' }}>
                  {token.surface}
                  <rt style={{
                    fontSize: '0.75em',
                    color: '#ccc',
                    fontWeight: 'normal',
                    pointerEvents: 'none'
                  }}>
                    {token.reading}
                  </rt>
                </ruby>
              ) : (
                token.surface
              )}
            </>
          );

          const isActive = activePopup === tokenIdx;

          return (
            <span
              key={tokenIdx}
              data-token={tokenIdx}
              style={{
                display: 'inline-flex',
                margin: '0px 1px', // Reduced margin for better readability
                padding: '2px 3px', // Reduced padding to match original text size
                backgroundColor: isActive && !isPunctuation ? activeColor : 'transparent',
                color: isActive && !isPunctuation ? 'white' : tokenColor,
                borderRadius: '2px',
                cursor: isPunctuation ? 'default' : 'pointer',
                fontSize: '1.1em', // Increased to match original text size
                border: 'none',
                fontWeight: 'normal',
                transition: 'background-color 0.2s ease, color 0.2s ease',
                minHeight: '28px', // Adjusted for better touch targets while keeping text size
                minWidth: '16px',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                lineHeight: '1.5' // Match original text line height
              }}
              onClick={(e) => handleTokenClick(e, token, tokenIdx)}
              onTouchStart={(e) => {
                // Prevent default touch behavior that might interfere
                if (!isPunctuation) {
                  e.preventDefault();
                }
              }}
            >
              {tokenContent}
            </span>
          );
        })}

        {/* Token popup for both mobile and desktop */}
        {activePopup !== null && tokens[activePopup] && (
          <div
            className="token-popup"
            style={{
              position: 'fixed',
              left: `${popupPosition.x}px`,
              top: `${popupPosition.y - 80}px`,
              transform: 'translateX(-50%)',
              backgroundColor: '#1a1a1a',
              border: '3px solid #4fc3f7',
              borderRadius: '8px',
              padding: '16px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8)',
              zIndex: 99999,
              maxWidth: '320px',
              minWidth: '220px',
              fontSize: '0.95em',
              color: '#f2f2f2',
              lineHeight: '1.5',
              pointerEvents: 'auto',
              display: 'block',
              visibility: 'visible'
            }}
          >
            <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#4fc3f7' }}>
              {tokens[activePopup].surface}
            </div>
            
            {tokens[activePopup].reading && tokens[activePopup].reading !== tokens[activePopup].surface && (
              <div style={{ marginBottom: '6px', color: '#ccc', fontSize: '0.85em' }}>
                <strong>Reading:</strong> {tokens[activePopup].reading}
              </div>
            )}

            {tokens[activePopup].pos === '動詞' && (tokens[activePopup].pos_detail === 'compound' || tokens[activePopup].pos_detail === 'inflected') && (
              <div style={{ marginBottom: '6px', color: '#4a7c59', fontSize: '0.8em' }}>
                🔗 Merged Verb Token
              </div>
            )}

            {tokens[activePopup].translation && tokens[activePopup].translation !== 'N/A' && (
              <div style={{ marginBottom: '6px' }}>
                <strong>Translation:</strong> {tokens[activePopup].translation}
              </div>
            )}

            {tokens[activePopup].contextualMeaning && tokens[activePopup].contextualMeaning !== 'N/A' && (
              <div style={{ marginBottom: '6px' }}>
                <strong>Context:</strong> {tokens[activePopup].contextualMeaning}
              </div>
            )}

            {tokens[activePopup].grammaticalRole && tokens[activePopup].grammaticalRole !== tokens[activePopup].pos && (
              <div style={{ marginBottom: '6px' }}>
                <strong>Grammar:</strong> {tokens[activePopup].grammaticalRole}
              </div>
            )}

            {/* Close button for mobile */}
            <button
              onClick={closePopup}
              style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: '16px',
                cursor: 'pointer',
                padding: '4px',
                lineHeight: '1'
              }}
            >
              ×
            </button>
          </div>
        )}
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
              <div key={idx} className="import-line" style={{ marginBottom: '20px', border: '1px solid #444', borderRadius: '8px', padding: '15px', backgroundColor: '#1a1a1a' }}>
                {/* Line number and controls section - always at top */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  marginBottom: '10px',
                  paddingBottom: '10px',
                  borderBottom: '1px solid #333'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '0.9em', color: '#888', fontWeight: 'bold' }}>
                      Line {idx + 1}
                    </span>
                    
                    {/* Action buttons - next to line number */}
                    {line.trim() && (
                      <div style={{ display: 'flex', gap: '2px' }}>
                        <button 
                          onClick={() => handleLineProcess(idx, false)} 
                          className="btn-small"
                          style={{ 
                            backgroundColor: '#28a745', 
                            borderColor: '#28a745',
                            padding: '6px 8px',
                            fontSize: '1em',
                            minHeight: '32px',
                            minWidth: '32px',
                            borderRadius: '4px'
                          }}
                          title="Process using local dictionary only (JMDict)"
                        >
                          📚
                        </button>
                        <button 
                          onClick={() => handleLineProcess(idx, true)} 
                          className="btn-small"
                          style={{ 
                            backgroundColor: '#007bff', 
                            borderColor: '#007bff',
                            padding: '6px 8px',
                            fontSize: '1em',
                            minHeight: '32px',
                            minWidth: '32px',
                            borderRadius: '4px'
                          }}
                          title="Process using OpenAI for enhanced translations"
                        >
                          🌐
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Processing status and type indicator */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {processedLines[idx] && (
                      <span style={{
                        fontSize: '0.75em',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        backgroundColor: processedLines[idx].processingType === 'remote' ? '#007bff' : '#28a745',
                        color: 'white'
                      }}>
                        {processedLines[idx].processingType === 'remote' ? '🌐 AI' : '📚 Local'}
                      </span>
                    )}
                    
                    {lineMessages[idx] && (
                      <span style={{ 
                        fontSize: '0.8em', 
                        color: lineMessages[idx].startsWith('Error') ? '#dc3545' : '#28a745',
                        fontWeight: 'bold'
                      }}>
                        {lineMessages[idx]}
                      </span>
                    )}
                  </div>
                </div>

                {/* Content section - show original line OR processed tokens */}
                <div className="import-line-content">
                  {processedLines[idx] ? (
                    // Show processed tokens instead of original line
                    <div>
                      <TokenizedText tokens={processedLines[idx].tokens || processedLines[idx]} />
                      {processedLines[idx].fullLineTranslation && processedLines[idx].fullLineTranslation !== 'N/A' && (
                        <div style={{
                          marginTop: '15px',
                          padding: '12px',
                          backgroundColor: '#2a2a2a',
                          borderRadius: '6px',
                          border: '1px solid #444',
                          borderLeft: processedLines[idx].processingType === 'remote' ? '4px solid #4fc3f7' : '4px solid #28a745'
                        }}>
                          <div style={{
                            fontSize: '0.8em',
                            color: '#888',
                            marginBottom: '8px',
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
                  ) : (
                    // Show original line text
                    <div style={{
                      padding: '10px',
                      backgroundColor: '#2a2a2a',
                      borderRadius: '4px',
                      fontSize: '1.1em',
                      lineHeight: '1.5',
                      color: '#f2f2f2'
                    }}>
                      {line}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {message && <div style={{ marginTop: '1em', color: '#007bff' }}>{message}</div>}
    </div>
  );
}
