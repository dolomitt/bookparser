import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function ImportPage() {
  const { filename } = useParams();
  const navigate = useNavigate();
  const [lines, setLines] = useState([]);
  const [sentences, setSentences] = useState([]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [sentenceMessages, setSentenceMessages] = useState({});
  const [processedSentences, setProcessedSentences] = useState({});
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
  
  // Function to split text into sentences using Japanese dot (。)
  const splitIntoSentences = (text) => {
    // Split by Japanese period (。) and preserve the period with each sentence
    const parts = text.split('。');
    const sentences = [];
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part) {
        // Add the period back except for the last part (which might not have one)
        const sentence = i < parts.length - 1 ? part + '。' : part;
        sentences.push(sentence);
      }
    }
    
    return sentences;
  };

  useEffect(() => {
    if (filename && !initialLoadComplete) {
      console.log('Initial load for:', filename);
      axios.get(`/api/import/${filename}`).then(res => {
        console.log('File data loaded:', res.data);
        setLines(res.data.lines);

        // Split all lines into sentences
        const allSentences = [];
        res.data.lines.forEach((line, lineIndex) => {
          if (line.trim()) {
            const lineSentences = splitIntoSentences(line);
            lineSentences.forEach((sentence, sentenceIndexInLine) => {
              allSentences.push({
                text: sentence,
                originalLineIndex: lineIndex,
                originalLine: line
              });
            });
            // Add a line break after each line that contains sentences
            allSentences.push({
              text: '',
              originalLineIndex: lineIndex,
              originalLine: line,
              isLineBreak: true
            });
          } else {
            // Preserve empty lines as line breaks
            allSentences.push({
              text: '',
              originalLineIndex: lineIndex,
              originalLine: line,
              isLineBreak: true
            });
          }
        });
        
        setSentences(allSentences);
        console.log(`Split ${res.data.lines.length} lines into ${allSentences.length} sentences`);

        // Load existing processed data if available (convert from line-based to sentence-based)
        if (res.data.existingProcessedData && Object.keys(res.data.existingProcessedData).length > 0) {
          console.log('Loading existing processed data:', res.data.existingProcessedData);
          // For now, we'll start fresh with sentence-based processing
          // TODO: Could implement migration from line-based to sentence-based data
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
        
        // Auto-process all sentences with local processing
        setTimeout(() => {
          autoProcessAllSentences(allSentences);
        }, 100);
      }).catch(error => {
        console.error('Error loading file data:', error);
        setInitialLoadComplete(true);
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

  const handleTextToSpeech = async (sentenceIndex, withTimings = false) => {
    const sentence = sentences[sentenceIndex];
    if (!sentence || sentence.isLineBreak) return;

    console.log('Text-to-speech button clicked for sentence index:', sentenceIndex);
    console.log('Sentence text:', sentence.text);
    console.log('With timings:', withTimings);

    // Set processing message for this specific sentence
    setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: 'Generating speech...' }));

    try {
      if (withTimings) {
        // Request audio with timing data
        const response = await axios.post('/api/text-to-speech', {
          text: sentence.text,
          includeTimings: true
        });

        console.log('Received audio and timing response from server');
        const { audio, timings, audioFormat, sampleRate } = response.data;

        // Convert base64 audio to blob
        const audioData = atob(audio);
        const audioArray = new Uint8Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          audioArray[i] = audioData.charCodeAt(i);
        }
        const audioBlob = new Blob([audioArray], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Create and play audio element
        const audioElement = new Audio(audioUrl);
        
        // Set up timing-based text highlighting
        let highlightTimeouts = [];
        let currentHighlight = null;
        
        const clearHighlights = () => {
          highlightTimeouts.forEach(timeout => clearTimeout(timeout));
          highlightTimeouts = [];
          if (currentHighlight) {
            currentHighlight.style.backgroundColor = 'transparent';
            currentHighlight = null;
          }
        };

        // Get the processed sentence data to access tokens
        let processedSentence = processedSentences[sentenceIndex];
        if (!processedSentence || !processedSentence.tokens) {
          console.log('No processed tokens available, running local processing first...');
          
          try {
            // Run local processing automatically
            const requestData = {
              text: sentence.text,
              sentenceIndex: sentenceIndex,
              verbMergeOptions: verbMergeOptions,
              allSentences: sentences.map(s => s.text),
              useRemoteProcessing: false // Use local processing
            };

            const response = await axios.post('/api/parse', requestData);
            
            if (response.data.analysis && response.data.analysis.tokens) {
              const sentenceData = {
                tokens: response.data.analysis.tokens,
                fullSentenceTranslation: response.data.fullSentenceTranslation || 'N/A',
                processingType: 'local'
              };
              
              // Update the processed sentences state
              setProcessedSentences(prev => ({ ...prev, [sentenceIndex]: sentenceData }));
              
              // Auto-save the processed data
              setTimeout(() => {
                autoSave(sentenceIndex, sentenceData);
              }, 100);
              
              // Use the newly processed sentence data
              processedSentence = sentenceData;
              console.log('Local processing completed, proceeding with highlighting');
            } else {
              console.warn('Local processing failed, playing audio without highlighting');
              audioElement.play();
              audioElement.addEventListener('ended', () => {
                URL.revokeObjectURL(audioUrl);
              });
              return;
            }
          } catch (error) {
            console.error('Auto-processing error:', error);
            console.warn('Auto-processing failed, playing audio without highlighting');
            audioElement.play();
            audioElement.addEventListener('ended', () => {
              URL.revokeObjectURL(audioUrl);
            });
            return;
          }
        }

        // Map timing data to tokens based on text positions
        const mapTimingsToTokens = (timings, tokens) => {
          const tokenTimings = [];
          let currentTextPos = 0;
          
          tokens.forEach((token, tokenIndex) => {
            const tokenStart = currentTextPos;
            const tokenEnd = currentTextPos + token.surface.length;
            
            // Find all timing points that overlap with this token
            const overlappingTimings = timings.filter(timing => 
              timing.textStart < tokenEnd && timing.textEnd > tokenStart
            );
            
            if (overlappingTimings.length > 0) {
              // Use the earliest start time and latest end time for this token
              const startTime = Math.min(...overlappingTimings.map(t => t.startTime));
              const endTime = Math.max(...overlappingTimings.map(t => t.endTime));
              
              tokenTimings.push({
                tokenIndex,
                startTime,
                endTime,
                token: token.surface
              });
            }
            
            currentTextPos = tokenEnd;
          });
          
          return tokenTimings;
        };

        const tokenTimings = mapTimingsToTokens(timings, processedSentence.tokens);
        console.log('Token timings:', tokenTimings);

        // Schedule highlighting for each token
        tokenTimings.forEach((tokenTiming) => {
          const timeout = setTimeout(() => {
            // Clear previous highlight
            if (currentHighlight) {
              currentHighlight.style.backgroundColor = 'transparent';
              currentHighlight.style.color = '';
            }
            
            // Find the specific token to highlight
            const tokenElement = document.querySelector(`[data-token="${sentenceIndex}-${tokenTiming.tokenIndex}"]`);
            if (tokenElement) {
              tokenElement.style.backgroundColor = '#ffeb3b';
              tokenElement.style.color = '#000';
              tokenElement.style.transition = 'background-color 0.1s ease, color 0.1s ease';
              tokenElement.style.borderRadius = '4px';
              // Don't change padding to avoid text movement
              currentHighlight = tokenElement;
            }
          }, tokenTiming.startTime * 1000); // Convert to milliseconds
          
          highlightTimeouts.push(timeout);
          
          // Schedule clearing of this specific highlight
          const clearTimeout = setTimeout(() => {
            const tokenElement = document.querySelector(`[data-token="${sentenceIndex}-${tokenTiming.tokenIndex}"]`);
            if (tokenElement) {
              tokenElement.style.backgroundColor = 'transparent';
              tokenElement.style.color = '';
            }
          }, tokenTiming.endTime * 1000);
          
          highlightTimeouts.push(clearTimeout);
        });

        // Clear highlights when audio ends
        audioElement.addEventListener('ended', () => {
          clearHighlights();
          URL.revokeObjectURL(audioUrl);
        });

        // Clear highlights if audio is paused/stopped
        audioElement.addEventListener('pause', clearHighlights);
        audioElement.addEventListener('abort', clearHighlights);

        audioElement.play();

      } else {
        // Original behavior - audio only
        const response = await axios.post('/api/text-to-speech', {
          text: sentence.text,
          includeTimings: false
        }, {
          responseType: 'blob'
        });

        console.log('Received audio response from server');

        // Create audio blob and play it
        const audioBlob = new Blob([response.data], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Create and play audio element
        const audio = new Audio(audioUrl);
        audio.play();

        // Clean up the object URL after playing
        audio.addEventListener('ended', () => {
          URL.revokeObjectURL(audioUrl);
        });
      }

      // Clear message after successful generation
      setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: '' }));

    } catch (error) {
      console.error('Text-to-speech error:', error);
      
      let errorMessage = 'Speech generation failed';
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        errorMessage = 'Server not running. Please start the server with "npm run dev" in the bookparser directory.';
      } else if (error.response?.status === 503) {
        errorMessage = 'Cannot connect to VOICEVOX engine';
      } else if (error.response?.status === 502) {
        errorMessage = 'VOICEVOX engine error';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else {
        errorMessage = `Speech error: ${error.message}`;
      }

      setSentenceMessages(prev => ({
        ...prev,
        [sentenceIndex]: errorMessage
      }));

      // Clear error message after 3 seconds
      setTimeout(() => {
        setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: '' }));
      }, 3000);
    }
  };

  const handleSentenceProcess = async (sentenceIndex, useRemoteProcessing = true) => {
    const sentence = sentences[sentenceIndex];
    if (!sentence || sentence.isLineBreak) return;

    console.log('Process button clicked for sentence index:', sentenceIndex);
    console.log('Sentence text:', sentence.text);
    console.log('Verb merge options:', verbMergeOptions);
    console.log('Use remote processing (OpenAI):', useRemoteProcessing);

    // Set processing message for this specific sentence
    const processingMessage = useRemoteProcessing ? 'Processing with AI...' : 'Processing locally...';
    setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: processingMessage }));

    try {
      const requestData = {
        text: sentence.text,
        sentenceIndex: sentenceIndex,
        verbMergeOptions: verbMergeOptions,
        allSentences: sentences.map(s => s.text),
        useRemoteProcessing: useRemoteProcessing
      };
      console.log('Sending request to /api/parse with data:', requestData);

      const response = await axios.post('/api/parse', requestData);
      console.log('Received response:', response.data);

      // Clear message for this specific sentence after successful processing
      setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: '' }));

      // Store the processed tokens and full sentence translation for interactive display
      if (response.data.analysis && response.data.analysis.tokens) {
        const sentenceData = {
          tokens: response.data.analysis.tokens,
          fullSentenceTranslation: response.data.fullSentenceTranslation || 'N/A',
          processingType: useRemoteProcessing ? 'remote' : 'local'
        };
        
        console.log('Setting processed sentence data for index:', sentenceIndex, sentenceData);
        
        setProcessedSentences(prev => {
          const updatedSentences = { ...prev, [sentenceIndex]: sentenceData };
          console.log('Updated processed sentences state:', updatedSentences);
          return updatedSentences;
        });

        // Auto-save after processing with a longer delay to ensure state is set
        setTimeout(() => {
          console.log('Auto-saving sentence:', sentenceIndex);
          autoSave(sentenceIndex, sentenceData);
        }, 500);
      }
    } catch (error) {
      console.error('Processing error:', error);
      console.error('Error response:', error.response?.data);

      // Set error message for this specific sentence with better network error handling
      let errorMessage = 'Unknown error';
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        errorMessage = 'Server not running. Please start the server with "npm run dev" in the bookparser directory.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else {
        errorMessage = error.message;
      }

      setSentenceMessages(prev => ({
        ...prev,
        [sentenceIndex]: `Error: ${errorMessage}`
      }));
    }
  };

  const handleVerbOptionChange = (option, value) => {
    setVerbMergeOptions(prev => ({
      ...prev,
      [option]: value
    }));
  };

  const autoSave = async (sentenceIndex, sentenceData) => {
    try {
      // Save only the specific sentence that was processed
      const saveData = {
        sentenceIndex: sentenceIndex,
        sentenceData: sentenceData,
        verbMergeOptions: verbMergeOptions,
        timestamp: new Date().toISOString()
      };

      await axios.post(`/api/import/${filename}/save-sentence`, saveData);
      console.log(`Auto-saved sentence ${sentenceIndex}`);
    } catch (error) {
      console.error('Auto-save error:', error);
    }
  };

  const autoProcessAllSentences = async (allSentences) => {
    console.log('Starting automatic local processing for all sentences...');
    setMessage('Auto-processing sentences with local dictionary...');
    
    let processedCount = 0;
    const totalSentences = allSentences.filter(s => !s.isLineBreak).length;
    
    for (let i = 0; i < allSentences.length; i++) {
      const sentence = allSentences[i];
      
      // Skip line breaks
      if (sentence.isLineBreak) continue;
      
      try {
        console.log(`Auto-processing sentence ${i}: "${sentence.text.substring(0, 30)}..."`);
        
        const requestData = {
          text: sentence.text,
          sentenceIndex: i,
          verbMergeOptions: verbMergeOptions,
          allSentences: allSentences.map(s => s.text),
          useRemoteProcessing: false // Use local processing only
        };

        const response = await axios.post('/api/parse', requestData);
        
        if (response.data.analysis && response.data.analysis.tokens) {
          const sentenceData = {
            tokens: response.data.analysis.tokens,
            fullSentenceTranslation: response.data.fullSentenceTranslation || 'N/A',
            processingType: 'local'
          };
          
          // Update the processed sentences state
          setProcessedSentences(prev => ({ ...prev, [i]: sentenceData }));
          
          // Auto-save the processed data
          setTimeout(() => {
            autoSave(i, sentenceData);
          }, 50);
          
          processedCount++;
          
          // Update progress message
          setMessage(`Auto-processing: ${processedCount}/${totalSentences} sentences completed`);
        }
        
        // Small delay to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (error) {
        console.error(`Error auto-processing sentence ${i}:`, error);
        // Continue with next sentence even if one fails
      }
    }
    
    console.log(`Auto-processing completed: ${processedCount}/${totalSentences} sentences processed`);
    setMessage(`Auto-processing completed: ${processedCount}/${totalSentences} sentences processed with local dictionary`);
    
    // Clear the message after 5 seconds
    setTimeout(() => {
      setMessage('');
    }, 5000);
  };

  const handleSave = async () => {
    setMessage('Saving...');
    try {
      // Prepare the complete book data with all processed information
      const bookData = {
        bookname: filename,
        originalLines: lines,
        processedSentences: processedSentences,
        sentences: sentences,
        verbMergeOptions: verbMergeOptions,
        metadata: {
          totalLines: lines.length,
          totalSentences: sentences.length,
          processedSentences: Object.keys(processedSentences).length,
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
  const TokenizedText = ({ tokens, sentenceIndex }) => {
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
      
      // Calculate initial position - bottom of popup should be 20 pixels above the click
      let x = rect.left + (rect.width / 2);
      let y = rect.top - 20; // Position so bottom of popup is 20px above click
      
      // Adjust for viewport boundaries
      const popupWidth = 320; // max-width from CSS
      
      // Keep popup within horizontal bounds
      if (x - popupWidth/2 < 10) {
        x = popupWidth/2 + 10;
      } else if (x + popupWidth/2 > viewportWidth - 10) {
        x = viewportWidth - popupWidth/2 - 10;
      }
      
      // Keep popup within vertical bounds - if not enough space above, show below
      if (y < 10) {
        y = rect.bottom + 20; // Show below token with 20px gap if not enough space above
      }

      console.log('Popup position:', { x, y });
      console.log('Current activePopup:', activePopup);

      setPopupPosition({ x, y });
      const newActivePopup = activePopup === `${sentenceIndex}-${tokenIdx}` ? null : `${sentenceIndex}-${tokenIdx}`;
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
      <div style={{ display: 'inline', position: 'relative' }}>
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

          const isActive = activePopup === `${sentenceIndex}-${tokenIdx}`;

          return (
            <span
              key={tokenIdx}
              data-token={`${sentenceIndex}-${tokenIdx}`}
              style={{
                display: 'inline-flex',
                margin: '0px 1px',
                padding: '2px 3px',
                backgroundColor: isActive && !isPunctuation ? activeColor : 'transparent',
                color: isActive && !isPunctuation ? 'white' : tokenColor,
                borderRadius: '2px',
                cursor: isPunctuation ? 'default' : 'pointer',
                fontSize: '1.1em',
                border: 'none',
                fontWeight: 'normal',
                transition: 'background-color 0.2s ease, color 0.2s ease',
                minHeight: '28px',
                minWidth: '16px',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                lineHeight: '1.5'
              }}
              onClick={(e) => handleTokenClick(e, token, tokenIdx)}
              onTouchStart={(e) => {
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
        {activePopup !== null && activePopup.startsWith(`${sentenceIndex}-`) && (
          (() => {
            const tokenIdx = parseInt(activePopup.split('-')[1]);
            const token = tokens[tokenIdx];
            if (!token) return null;

            return (
              <div
                className="token-popup"
                style={{
                  position: 'fixed',
                  left: `${popupPosition.x}px`,
                  bottom: `${window.innerHeight - popupPosition.y}px`,
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
                  {token.surface}
                </div>
                
                {token.reading && token.reading !== token.surface && (
                  <div style={{ marginBottom: '6px', color: '#ccc', fontSize: '0.85em' }}>
                    <strong>Reading:</strong> {token.reading}
                  </div>
                )}

                {token.pos === '動詞' && (token.pos_detail === 'compound' || token.pos_detail === 'inflected') && (
                  <div style={{ marginBottom: '6px', color: '#4a7c59', fontSize: '0.8em' }}>
                    🔗 Merged Verb Token
                  </div>
                )}

                {token.translation && token.translation !== 'N/A' && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Translation:</strong> {token.translation}
                  </div>
                )}

                {token.contextualMeaning && token.contextualMeaning !== 'N/A' && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Context:</strong> {token.contextualMeaning}
                  </div>
                )}

                {token.grammaticalRole && token.grammaticalRole !== token.pos && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Grammar:</strong> {token.grammaticalRole}
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
            );
          })()
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
            </div>
          )}

          <div className="import-content">
            <div style={{
              padding: '20px',
              backgroundColor: '#1a1a1a',
              borderRadius: '8px',
              border: '1px solid #444',
              fontSize: '1.1em',
              lineHeight: '1.8',
              color: '#f2f2f2'
            }}>
              {sentences.map((sentence, sentenceIndex) => {
                if (sentence.isLineBreak) {
                  return <br key={sentenceIndex} />;
                }

                const isProcessed = processedSentences[sentenceIndex];
                const hasRemoteTranslation = isProcessed && isProcessed.processingType === 'remote' && 
                  isProcessed.fullSentenceTranslation && isProcessed.fullSentenceTranslation !== 'N/A';

                return (
                  <span key={sentenceIndex} style={{ position: 'relative', display: 'inline' }}>
                    {isProcessed ? (
                      <span data-sentence={sentenceIndex}>
                        <TokenizedText tokens={isProcessed.tokens} sentenceIndex={sentenceIndex} />
                      </span>
                    ) : (
                      <span data-sentence={sentenceIndex} style={{ color: '#f2f2f2' }}>{sentence.text}</span>
                    )}
                    
                    {/* Processing buttons - inline after sentence */}
                    <span style={{ marginLeft: '8px', display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                      <button 
                        onClick={() => handleSentenceProcess(sentenceIndex, false)} 
                        style={{ 
                          backgroundColor: '#28a745', 
                          border: 'none',
                          color: 'white',
                          padding: '4px 6px',
                          fontSize: '0.8em',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          minWidth: '24px',
                          minHeight: '24px'
                        }}
                        title="Process using local dictionary only (JMDict)"
                      >
                        L
                      </button>
                      <button 
                        onClick={() => handleSentenceProcess(sentenceIndex, true)} 
                        style={{ 
                          backgroundColor: '#007bff', 
                          border: 'none',
                          color: 'white',
                          padding: '4px 6px',
                          fontSize: '0.8em',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          minWidth: '24px',
                          minHeight: '24px'
                        }}
                        title="Process using OpenAI for enhanced translations"
                      >
                        R
                      </button>
                      
                      {/* Text-to-speech with timing button */}
                      <button 
                        onClick={() => handleTextToSpeech(sentenceIndex, true)} 
                        style={{ 
                          backgroundColor: '#ff6b35', 
                          border: 'none',
                          color: 'white',
                          padding: '4px 6px',
                          fontSize: '0.8em',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          minWidth: '24px',
                          minHeight: '24px'
                        }}
                        title="Generate speech with real-time highlighting using VOICEVOX"
                      >
                        🔊
                      </button>
                      
                      {/* Translation popup button - only visible after remote processing */}
                      {hasRemoteTranslation && (
                        <button 
                          onClick={() => {
                            const popup = document.getElementById(`translation-popup-${sentenceIndex}`);
                            if (popup) {
                              popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
                            }
                          }}
                          style={{ 
                            backgroundColor: '#6c757d', 
                            border: 'none',
                            color: 'white',
                            padding: '4px 6px',
                            fontSize: '0.8em',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            minWidth: '24px',
                            minHeight: '24px'
                          }}
                          title="Show sentence translation"
                        >
                          💬
                        </button>
                      )}
                    </span>

                    {/* Processing status message */}
                    {sentenceMessages[sentenceIndex] && (
                      <span style={{ 
                        marginLeft: '8px',
                        fontSize: '0.8em', 
                        color: sentenceMessages[sentenceIndex].startsWith('Error') ? '#dc3545' : '#28a745',
                        fontWeight: 'bold'
                      }}>
                        {sentenceMessages[sentenceIndex]}
                      </span>
                    )}

                    {/* Translation popup */}
                    {hasRemoteTranslation && (
                      <div
                        id={`translation-popup-${sentenceIndex}`}
                        style={{
                          display: 'none',
                          position: 'absolute',
                          top: '100%',
                          left: '0',
                          marginTop: '8px',
                          padding: '12px',
                          backgroundColor: '#2a2a2a',
                          border: '2px solid #4fc3f7',
                          borderRadius: '6px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6)',
                          zIndex: 1000,
                          maxWidth: '400px',
                          fontSize: '0.9em',
                          color: '#f2f2f2',
                          lineHeight: '1.4'
                        }}
                      >
                        <div style={{
                          fontSize: '0.8em',
                          color: '#888',
                          marginBottom: '8px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          Translation
                        </div>
                        <div>
                          {isProcessed.fullSentenceTranslation}
                        </div>
                        <button
                          onClick={() => {
                            document.getElementById(`translation-popup-${sentenceIndex}`).style.display = 'none';
                          }}
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
                    
                    {' '} {/* Space between sentences */}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {message && <div style={{ marginTop: '1em', color: '#007bff' }}>{message}</div>}
    </div>
  );
}
