import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import './ImportPage.css';

// Cookie utility functions
const setCookie = (name, value, days = 30) => {
  const expires = new Date();
  expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${JSON.stringify(value)};expires=${expires.toUTCString()};path=/`;
};

const getCookie = (name) => {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) {
      try {
        return JSON.parse(c.substring(nameEQ.length, c.length));
      } catch (e) {
        return null;
      }
    }
  }
  return null;
};

const isKanjiChar = (char) => {
  const code = char.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9faf) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df);
};

const hasKanji = (text) => {
  return text.split('').some((char) => isKanjiChar(char));
};

function TokenizedText({ tokens, sentenceIndex, isCurrentReading = false, onBookmark }) {
  const [activePopup, setActivePopup] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [hoveredExpressionId, setHoveredExpressionId] = useState(null);
  const [hoveredTokenIdx, setHoveredTokenIdx] = useState(null);

  const expressionMetaByToken = React.useMemo(() => {
    const meta = {};
    let idx = 0;

    while (idx < tokens.length) {
      const token = tokens[idx];
      if (!token?.expressionSurface) {
        idx += 1;
        continue;
      }

      const expressionId = token.expressionId || `expr-${sentenceIndex}-${idx}-${token.expressionSurface}`;
      const start = idx;
      let end = idx;

      while (end + 1 < tokens.length) {
        const nextToken = tokens[end + 1];
        if (!nextToken?.expressionSurface) break;
        const nextExpressionId = nextToken.expressionId || expressionId;
        if (nextExpressionId !== expressionId) break;
        if (nextToken.expressionSurface !== token.expressionSurface) break;
        end += 1;
      }

      for (let i = start; i <= end; i++) {
        meta[i] = {
          id: expressionId,
          surface: token.expressionSurface,
          start,
          end
        };
      }

      idx = end + 1;
    }

    return meta;
  }, [tokens, sentenceIndex]);

  const handleTokenClick = (e, token, tokenIdx) => {
    console.log('Token clicked:', token, 'Index:', tokenIdx);

    if (token.pos === '記号' || token.surface === '」') {
      console.log('Skipping punctuation token or closing quote');
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (typeof onBookmark === 'function') {
      onBookmark(sentenceIndex);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    let x = rect.left + (rect.width / 2);
    let y = rect.top - 20;

    const popupWidth = 320;

    if (x - popupWidth / 2 < 10) {
      x = popupWidth / 2 + 10;
    } else if (x + popupWidth / 2 > viewportWidth - 10) {
      x = viewportWidth - popupWidth / 2 - 10;
    }

    if (y < 10) {
      y = rect.bottom + 20;
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
        const isMergedVerb = token.pos === '動詞' && (token.pos_detail === 'compound' || token.pos_detail === 'inflected');
        const isPunctuation = token.pos === '記号' || token.surface === '」';
        const shouldHideBasedOnFrequency = token.frequency && token.frequency.shouldHideFurigana;
        const shouldShowRuby = hasKanji(token.surface) && token.reading && token.reading !== token.surface && !shouldHideBasedOnFrequency;
        const hasAIData = token.translation && token.translation !== 'N/A';

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
        const isBookmarkToken = isCurrentReading && tokenIdx === 0;
        const expressionMeta = expressionMetaByToken[tokenIdx];
        const hasExpression = !!expressionMeta;
        const isExpressionHovered = hasExpression && hoveredExpressionId === expressionMeta.id;
        const isTokenHovered = hoveredTokenIdx === tokenIdx && !isPunctuation;

        return (
          <span
            key={tokenIdx}
            data-token={`${sentenceIndex}-${tokenIdx}`}
            style={{
              display: 'inline-flex',
              margin: '0px 1px',
              padding: '2px 3px',
              backgroundColor: isActive && !isPunctuation
                ? activeColor
                : (isBookmarkToken
                  ? 'rgba(156, 39, 176, 0.18)'
                  : (isTokenHovered
                    ? 'rgba(79, 195, 247, 0.22)'
                    : (hasExpression ? 'rgba(255, 209, 102, 0.12)' : 'transparent'))),
              color: isActive && !isPunctuation ? 'white' : tokenColor,
              borderRadius: '2px',
              cursor: isPunctuation ? 'default' : 'pointer',
              fontSize: '1.1em',
              border: 'none',
              fontWeight: hasExpression ? 600 : 'normal',
              transition: 'background-color 0.2s ease, color 0.2s ease',
              minHeight: '28px',
              minWidth: '16px',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              lineHeight: '1.5',
              textDecoration: 'none',
              borderTop: '1px solid transparent',
              borderBottom: '3px solid transparent',
              borderLeft: '1px solid transparent',
              borderRight: '1px solid transparent',
              borderTopLeftRadius: '0',
              borderBottomLeftRadius: '0',
              borderTopRightRadius: '0',
              borderBottomRightRadius: '0',
              boxShadow: isActive && !isPunctuation
                ? 'none'
                : (isBookmarkToken ? 'inset 0 -2px 0 rgba(206, 147, 216, 0.8)' : 'none')
            }}
            onClick={(e) => handleTokenClick(e, token, tokenIdx)}
            onMouseEnter={() => {
              setHoveredTokenIdx(tokenIdx);
              if (hasExpression) {
                setHoveredExpressionId(expressionMeta.id);
              }
            }}
            onMouseLeave={() => {
              setHoveredTokenIdx((current) => (current === tokenIdx ? null : current));
              if (hasExpression) {
                setHoveredExpressionId((current) => (current === expressionMeta.id ? null : current));
              }
            }}
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

      {activePopup !== null && activePopup.startsWith(`${sentenceIndex}-`) && (
        (() => {
          const tokenIdx = parseInt(activePopup.split('-')[1]);
          const token = tokens[tokenIdx];
          if (!token) return null;

          const hasExpression = !!token.expressionSurface;
          const contextualMeaning =
            token.contextualMeaning && token.contextualMeaning !== 'N/A' ? token.contextualMeaning : null;
          const dictionaryMeaning =
            token.translation && token.translation !== 'N/A' ? token.translation : null;
          const primaryMeaning = hasExpression
            ? (token.expressionMeaning || contextualMeaning || dictionaryMeaning || 'N/A')
            : (contextualMeaning || dictionaryMeaning || 'N/A');
          const shouldShowReading = token.reading && token.reading !== token.surface;
          const expressionLabel = hasExpression
            ? (token.expressionSource === 'ai' ? 'Set phrase (AI)' : 'Set phrase')
            : null;

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

              {shouldShowReading && (
                <div style={{ marginBottom: '6px', color: '#ccc', fontSize: '0.85em' }}>
                  {token.reading}
                </div>
              )}

              {hasExpression && (
                <div style={{ marginBottom: '8px', color: '#ffd166', fontSize: '0.85em' }}>
                  <strong>{expressionLabel}:</strong> {token.expressionSurface}
                </div>
              )}

              {primaryMeaning && primaryMeaning !== 'N/A' && (
                <div style={{ marginBottom: '6px' }}>
                  <strong>{hasExpression ? 'Meaning' : 'In this sentence'}:</strong> {primaryMeaning}
                </div>
              )}

              {!hasExpression && dictionaryMeaning && contextualMeaning && dictionaryMeaning !== contextualMeaning && (
                <div style={{ marginBottom: '6px', color: '#bdbdbd', fontSize: '0.82em' }}>
                  <strong>Base:</strong> {dictionaryMeaning}
                </div>
              )}

              {hasExpression && token.expressionNote && (
                <div style={{ marginBottom: '6px', color: '#bdbdbd', fontSize: '0.82em' }}>
                  {token.expressionNote}
                </div>
              )}

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
}

export default function ImportPage() {
  const { filename } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isBookViewHint = new URLSearchParams(location.search).get('view') === 'book';
  const [lines, setLines] = useState([]);
  const [sentences, setSentences] = useState([]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [articleUrl, setArticleUrl] = useState('');
  const [urlImporting, setUrlImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [sentenceMessages, setSentenceMessages] = useState({});
  const [processedSentences, setProcessedSentences] = useState({});
  const [processingSentences, setProcessingSentences] = useState({});
  const [pageAiProcessing, setPageAiProcessing] = useState(false);
  const [activeSentenceNotes, setActiveSentenceNotes] = useState(null);
  const [isCompletedBookView, setIsCompletedBookView] = useState(false);
  const [bookSummaryTitle, setBookSummaryTitle] = useState('');
  const [bookSummarySentences, setBookSummarySentences] = useState([]);
  const [bookSummaryGeneratedAt, setBookSummaryGeneratedAt] = useState(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [ollamaStreamPopup, setOllamaStreamPopup] = useState({
    visible: false,
    sentenceIndex: null,
    status: 'idle',
    content: ''
  });
  // Load settings from cookies with fallback to defaults
  const [verbMergeOptions, setVerbMergeOptions] = useState(() => {
    const saved = getCookie('verbMergeOptions');
    return saved || {
      mergeAuxiliaryVerbs: true,
      mergeVerbParticles: true,
      mergeVerbSuffixes: true,
      mergeTeForm: true,
      mergeMasuForm: true,
      mergeAllInflections: true,
      mergePunctuation: true,
      useCompoundDetection: false
    };
  });

  const [showVerbOptions, setShowVerbOptions] = useState(() => {
    const saved = getCookie('showVerbOptions');
    return saved !== null ? saved : false;
  });

  const [ttsOptions, setTtsOptions] = useState(() => {
    const saved = getCookie('ttsOptions');
    return saved || {
      speed: 1.0,
      speaker: 1,
      volume: 1.0,
      timingStretch: 1.2, // 20% increase in timing length
      commaPauseDuration: 0.5 // 0.5 second pause for commas
    };
  });

  const [showTtsOptions, setShowTtsOptions] = useState(() => {
    const saved = getCookie('showTtsOptions');
    return saved !== null ? saved : false;
  });

  const [frequencySettings, setFrequencySettings] = useState(() => {
    const saved = getCookie('frequencySettings');
    return saved || {
      hideFrequentFurigana: true,
      frequencyThreshold: 1000,
      alwaysShowUnknown: true,
      customFrequencyRules: {}
    };
  });

  const [showFrequencyOptions, setShowFrequencyOptions] = useState(() => {
    const saved = getCookie('showFrequencyOptions');
    return saved !== null ? saved : false;
  });

  const fileInput = useRef();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [sentencesPerPage] = useState(50); // Show 50 sentences per page

  // Separate useEffect for initial load only
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  // Bookmark state for reading position
  const [currentReadingPosition, setCurrentReadingPosition] = useState(null);

  useEffect(() => {
    setInitialLoadComplete(false);
    setIsCompletedBookView(isBookViewHint);
    setBookSummaryTitle('');
    setBookSummarySentences([]);
    setBookSummaryGeneratedAt(null);
    setCurrentPage(1);
    setActiveSentenceNotes(null);
    setOllamaStreamPopup({
      visible: false,
      sentenceIndex: null,
      status: 'idle',
      content: ''
    });
  }, [filename, isBookViewHint]);

  useEffect(() => {
    const handleOutsideNotesClick = (event) => {
      if (activeSentenceNotes === null) return;

      const clickedInsideNotes = event.target.closest('.sentence-notes-popup');
      const clickedNotesButton = event.target.closest('.sentence-btn.notes');
      if (!clickedInsideNotes && !clickedNotesButton) {
        setActiveSentenceNotes(null);
      }
    };

    if (activeSentenceNotes !== null) {
      document.addEventListener('click', handleOutsideNotesClick, true);
      document.addEventListener('touchstart', handleOutsideNotesClick, true);
    }

    return () => {
      document.removeEventListener('click', handleOutsideNotesClick, true);
      document.removeEventListener('touchstart', handleOutsideNotesClick, true);
    };
  }, [activeSentenceNotes]);

  // Load bookmark on initial load
  useEffect(() => {
    if (filename && initialLoadComplete) {
      const bookmark = getCookie(`bookmark_${filename.replace('.txt', '')}`);
      if (bookmark && bookmark.sentenceIndex !== undefined) {
        setCurrentReadingPosition(bookmark.sentenceIndex);
        // Navigate to the page containing this sentence
        const sentenceIndex = bookmark.sentenceIndex;
        const targetPage = Math.ceil((sentenceIndex + 1) / sentencesPerPage);
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        }
        console.log(`Loaded bookmark: sentence ${sentenceIndex}, page ${targetPage}`);
      }
    }
  }, [filename, initialLoadComplete, sentencesPerPage]);

  // Function to save reading position bookmark
  const saveReadingBookmark = (sentenceIndex) => {
    if (!filename) return;

    const bookmark = {
      book: filename,
      sentenceIndex: sentenceIndex,
      page: currentPage,
      timestamp: new Date().toISOString(),
      totalSentences: sentences.filter(s => !s.isLineBreak).length,
      progressPercent: sentences.length > 0 ? Math.round((sentenceIndex / sentences.length) * 100) : 0
    };

    setCookie(`bookmark_${filename.replace('.txt', '')}`, bookmark);
    setCurrentReadingPosition(sentenceIndex);
    console.log(`Saved reading bookmark: sentence ${sentenceIndex}`);
  };

  // Save settings to cookies when they change
  useEffect(() => {
    setCookie('verbMergeOptions', verbMergeOptions);
  }, [verbMergeOptions]);

  useEffect(() => {
    setCookie('showVerbOptions', showVerbOptions);
  }, [showVerbOptions]);

  useEffect(() => {
    setCookie('ttsOptions', ttsOptions);
  }, [ttsOptions]);

  useEffect(() => {
    setCookie('showTtsOptions', showTtsOptions);
  }, [showTtsOptions]);

  useEffect(() => {
    setCookie('frequencySettings', frequencySettings);
  }, [frequencySettings]);

  useEffect(() => {
    setCookie('showFrequencyOptions', showFrequencyOptions);
  }, [showFrequencyOptions]);

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
        const isImportSource = res.data?.sourceLocation === 'imports';
        const shouldUseCompletedView = isBookViewHint || (!isImportSource && !!res.data.isCompletedBookView);
        setIsCompletedBookView(shouldUseCompletedView);
        setBookSummaryTitle(String(res.data.existingSummaryTitle || '').trim());
        setBookSummarySentences(
          Array.isArray(res.data.existingSummarySentences)
            ? res.data.existingSummarySentences.map((sentence) => String(sentence || '').trim()).filter(Boolean)
            : []
        );
        setBookSummaryGeneratedAt(res.data.existingSummaryGeneratedAt || null);
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

        // Load existing processed sentences if available
        if (res.data.existingProcessedSentences && Object.keys(res.data.existingProcessedSentences).length > 0) {
          console.log('Loading existing processed sentences:', res.data.existingProcessedSentences);
          setProcessedSentences(res.data.existingProcessedSentences);
          console.log(`Loaded ${Object.keys(res.data.existingProcessedSentences).length} previously processed sentences`);
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

        // Only auto-process if there are unprocessed sentences
        const unprocessedCount = allSentences.filter((s, i) => !s.isLineBreak && !res.data.existingProcessedSentences[i]).length;
        if (unprocessedCount > 0) {
          console.log(`Found ${unprocessedCount} unprocessed sentences, starting auto-processing...`);
          setTimeout(() => {
            autoProcessAllSentences(allSentences);
          }, 100);
        } else {
          console.log('All sentences already processed, skipping auto-processing');
          setMessage('All sentences already processed - ready for reading!');
          setTimeout(() => setMessage(''), 3000);
        }
      }).catch(error => {
        console.error('Error loading file data:', error);
        setIsCompletedBookView(isBookViewHint);
        setBookSummaryTitle('');
        setBookSummarySentences([]);
        setBookSummaryGeneratedAt(null);
        setInitialLoadComplete(true);
      });
    }
  }, [filename, initialLoadComplete, isBookViewHint]);

  const handleFileChange = e => setFile(e.target.files[0]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/import', formData);

      if (res.data.autoProcessed) {
        setMessage(`✅ Uploaded and auto-processed: ${res.data.originalname} (${res.data.processedLines}/${res.data.totalLines} lines processed)`);
      } else if (res.data.error) {
        setMessage(`⚠️ Uploaded: ${res.data.originalname} - ${res.data.error}`);
      } else {
        setMessage(`Uploaded: ${res.data.originalname}`);
      }

      navigate(`/import/${res.data.filename}`);
    } catch (err) {
      setMessage('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleUrlImport = async () => {
    const trimmedUrl = articleUrl.trim();
    if (!trimmedUrl) {
      setMessage('Enter an article URL first');
      return;
    }

    setUrlImporting(true);
    setMessage('Importing article...');

    try {
      const res = await axios.post('/api/import/url', { url: trimmedUrl });
      setMessage(`Imported article: ${res.data.originalname || trimmedUrl} (${res.data.totalLines} lines)`);
      setArticleUrl('');
      navigate(`/import/${res.data.filename}`);
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'URL import failed';
      const details = err.response?.data?.details;
      setMessage(details ? `${errorMessage}: ${details}` : errorMessage);
    } finally {
      setUrlImporting(false);
    }
  };

  const handleTextToSpeech = async (sentenceIndex, withTimings = false) => {
    const sentence = sentences[sentenceIndex];
    if (!sentence || sentence.isLineBreak) return;

    console.log('Text-to-speech button clicked for sentence index:', sentenceIndex);
    console.log('Sentence text:', sentence.text);
    console.log('With timings:', withTimings);

    // Auto-save bookmark when user interacts with sentence
    saveReadingBookmark(sentenceIndex);

    // Set processing message for this specific sentence
    setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: 'Generating speech...' }));

    try {
      if (withTimings) {
        // Request audio with VoiceVox timing data using TTS options
        const response = await axios.post('/api/text-to-speech', {
          text: sentence.text,
          speaker: ttsOptions.speaker,
          speed: ttsOptions.speed,
          volume: ttsOptions.volume,
          includeTimings: true
        });

        console.log('Received audio and timing response from server');
        const { audio, timings, audioFormat, sampleRate } = response.data;

        // Log timing info for debugging
        console.log(`[VOICEVOX] Using VoiceVox timing data`);
        console.log(`[VOICEVOX] Timing points: ${timings.length} (mora-level)`);

        // Log original VoiceVox timings in a readable format
        console.log('=== ORIGINAL VOICEVOX TIMINGS ===');
        console.log('Mora | Text | Start-End | Duration');
        timings.forEach((timing, i) => {
          const text = timing.text || timing.mora || '';
          const duration = timing.endTime - timing.startTime;
          console.log(`${i.toString().padStart(2, '0')} | ${text.padEnd(4)} | ${timing.startTime.toFixed(3)}-${timing.endTime.toFixed(3)}s | ${duration.toFixed(3)}s`);
        });
        setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: '🔊 Using VoiceVox timing...' }));

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
          // Clear all timeouts
          highlightTimeouts.forEach(timeout => clearTimeout(timeout));
          highlightTimeouts = [];

          // Reset current highlight if any
          if (currentHighlight) {
            currentHighlight.style.backgroundColor = 'transparent';
            currentHighlight.style.color = '';
            currentHighlight = null;
          }

          // Reset all token highlights in this sentence to ensure none remain highlighted
          if (processedSentence && processedSentence.tokens) {
            processedSentence.tokens.forEach((token, tokenIndex) => {
              const tokenElement = document.querySelector(`[data-token="${sentenceIndex}-${tokenIndex}"]`);
              if (tokenElement) {
                tokenElement.style.backgroundColor = 'transparent';
                tokenElement.style.color = '';
              }
            });
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

        // Use VOICEVOX timing data to synchronize highlighting with actual audio
        const mapTimingsToTokens = (timings, tokens) => {
          console.log('[TIMING] Starting VOICEVOX timing mapping');
          console.log('[TIMING] Original text:', sentence.text);
          console.log('[TIMING] All tokens:', tokens.map((t, i) => `${i}:${t.surface}(${t.pos})`));
          console.log('[TIMING] VOICEVOX timings:', timings.length, 'entries');

          // Show detailed VOICEVOX timing data
          console.log('[TIMING] === VOICEVOX TIMING POINTS ===');
          timings.forEach((timing, index) => {
            console.log(`[TIMING] ${index}: ${timing.startTime.toFixed(3)}-${timing.endTime.toFixed(3)}s | text:"${timing.text || timing.mora || ''}" | textStart:${timing.textStart || 'N/A'} textEnd:${timing.textEnd || 'N/A'} | phraseIndex:${timing.phraseIndex || 'N/A'} moraIndex:${timing.moraIndex || 'N/A'}`);
          });
          console.log('[TIMING] === END TIMING POINTS ===');

          // Filter out punctuation tokens
          const nonPunctuationTokens = [];
          tokens.forEach((token, originalIndex) => {
            if (token.pos !== '記号') {
              nonPunctuationTokens.push({ ...token, originalIndex });
            }
          });

          console.log('[TIMING] Non-punctuation tokens:', nonPunctuationTokens.map(t => `${t.originalIndex}:${t.surface}`));

          if (nonPunctuationTokens.length === 0) {
            console.log('[TIMING] No tokens to highlight');
            return [];
          }

          if (!timings || timings.length === 0) {
            console.log('[TIMING] No VOICEVOX timings available, using fallback');
            // Fallback to simple timing
            const totalDuration = 3.0;
            const tokenDuration = totalDuration / nonPunctuationTokens.length;

            return nonPunctuationTokens.map((token, sequenceIndex) => {
              const startTime = sequenceIndex * tokenDuration;
              const endTime = startTime + tokenDuration;

              return {
                tokenIndex: token.originalIndex,
                startTime,
                endTime,
                token: token.surface,
                sequenceIndex
              };
            });
          }

          // Use actual VOICEVOX timing data
          const audioStartTime = timings[0].startTime;
          const audioEndTime = timings[timings.length - 1].endTime;
          const totalDuration = audioEndTime - audioStartTime;

          console.log(`[TIMING] VOICEVOX audio: ${audioStartTime.toFixed(3)}s - ${audioEndTime.toFixed(3)}s (${totalDuration.toFixed(3)}s total)`);

          // Create a mapping from text positions to timing data
          const textToTimingMap = new Map();
          let currentTextPos = 0;

          // Build a map of text positions to VOICEVOX timings
          timings.forEach((timing, index) => {
            const timingText = timing.text || timing.mora || '';
            if (timingText) {
              textToTimingMap.set(currentTextPos, timing);
              currentTextPos += timingText.length;
            }
          });

          console.log('[TIMING] Built text-to-timing map with', textToTimingMap.size, 'entries');

          // First pass: calculate raw timings for each token
          const rawTokenTimings = [];
          let textPosition = 0;

          nonPunctuationTokens.forEach((token, sequenceIndex) => {
            // Find the text position of this token in the original sentence
            let tokenTextPos = 0;
            for (let i = 0; i < token.originalIndex; i++) {
              tokenTextPos += tokens[i].surface.length;
            }

            console.log(`[TIMING] Token "${token.surface}" at text position ${tokenTextPos}`);

            // Find VOICEVOX timings that overlap with this token
            const tokenLength = token.surface.length;
            const overlappingTimings = timings.filter(timing => {
              const timingStart = timing.textStart || 0;
              const timingEnd = timing.textEnd || (timingStart + (timing.text?.length || 1));

              // Check if timing overlaps with token position
              return (timingStart < tokenTextPos + tokenLength && timingEnd > tokenTextPos);
            });

            let startTime, endTime, rawDuration;

            if (overlappingTimings.length > 0) {
              // Use actual VOICEVOX timing
              startTime = Math.min(...overlappingTimings.map(t => t.startTime));
              endTime = Math.max(...overlappingTimings.map(t => t.endTime));
              rawDuration = endTime - startTime;

              console.log(`[TIMING] Token "${token.surface}" raw VOICEVOX timing: ${startTime.toFixed(3)}-${endTime.toFixed(3)}s (${rawDuration.toFixed(3)}s)`);
            } else {
              // Fallback: distribute remaining time evenly
              const avgTokenDuration = totalDuration / nonPunctuationTokens.length;
              startTime = audioStartTime + (sequenceIndex * avgTokenDuration);
              endTime = startTime + avgTokenDuration;
              rawDuration = avgTokenDuration;

              console.log(`[TIMING] Token "${token.surface}" raw fallback timing: ${startTime.toFixed(3)}-${endTime.toFixed(3)}s (${rawDuration.toFixed(3)}s)`);
            }

            rawTokenTimings.push({
              tokenIndex: token.originalIndex,
              startTime,
              endTime,
              rawDuration,
              token: token.surface,
              sequenceIndex,
              hasVoicevoxTiming: overlappingTimings.length > 0
            });
          });

          // Second pass: ensure sequential non-overlapping timings
          const tokenTimings = [];
          let currentTime = rawTokenTimings[0]?.startTime || 0;

          rawTokenTimings.forEach((timing, index) => {
            // Start time is the current time marker
            const startTime = currentTime;

            // Apply timing stretch factor to the raw duration
            const stretchedDuration = timing.rawDuration * ttsOptions.timingStretch;

            // End time is start time plus stretched duration
            const endTime = startTime + stretchedDuration;

            // Update current time marker for next token
            currentTime = endTime;

            console.log(`[TIMING] Token "${timing.token}" sequential timing: ${startTime.toFixed(3)}-${endTime.toFixed(3)}s (stretched by ${ttsOptions.timingStretch}x)`);

            tokenTimings.push({
              tokenIndex: timing.tokenIndex,
              startTime,
              endTime,
              token: timing.token,
              sequenceIndex: timing.sequenceIndex,
              hasVoicevoxTiming: timing.hasVoicevoxTiming
            });
          });

          // Add pauses after commas
          // First, find all comma tokens
          const commaTokens = tokens.filter(token => token.surface === '、');

          // For each comma, find the next non-punctuation token and add a pause before it
          commaTokens.forEach(commaToken => {
            const commaIndex = tokens.indexOf(commaToken);

            // Find the next non-punctuation token after the comma
            let nextTokenIndex = -1;
            for (let i = commaIndex + 1; i < tokens.length; i++) {
              if (tokens[i].pos !== '記号') {
                nextTokenIndex = i;
                break;
              }
            }

            if (nextTokenIndex !== -1) {
              // Find this token in our tokenTimings array
              const nextTimingIndex = tokenTimings.findIndex(t => t.tokenIndex === nextTokenIndex);

              if (nextTimingIndex !== -1) {
                console.log(`[TIMING] Adding ${ttsOptions.commaPauseDuration}s pause after comma before token "${tokens[nextTokenIndex].surface}"`);

                // Shift all subsequent timings by the pause duration
                for (let i = nextTimingIndex; i < tokenTimings.length; i++) {
                  tokenTimings[i].startTime += ttsOptions.commaPauseDuration;
                  tokenTimings[i].endTime += ttsOptions.commaPauseDuration;
                }
              }
            }
          });

          // Sort by start time to ensure proper order
          tokenTimings.sort((a, b) => a.startTime - b.startTime);

          // Log stretched timings in a readable format
          console.log('=== STRETCHED TIMINGS (after applying stretch factor and comma pauses) ===');
          console.log('Token | Text | Start-End | Duration | Stretch');
          tokenTimings.forEach(t => {
            const duration = t.endTime - t.startTime;
            const originalDuration = duration / ttsOptions.timingStretch;
            console.log(`${t.sequenceIndex.toString().padStart(2, '0')} | ${t.token.padEnd(4)} | ${t.startTime.toFixed(3)}-${t.endTime.toFixed(3)}s | ${duration.toFixed(3)}s | ${ttsOptions.timingStretch}x`);
          });

          console.log('[TIMING] Final token timings (after comma pauses):');
          tokenTimings.forEach(t => {
            console.log(`  ${t.sequenceIndex}: "${t.token}" ${t.startTime.toFixed(3)}-${t.endTime.toFixed(3)}s ${t.hasVoicevoxTiming ? '(VOICEVOX)' : '(fallback)'}`);
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

    // Auto-save bookmark when user interacts with sentence
    saveReadingBookmark(sentenceIndex);

    // Instead of text message, set processing state for this sentence to make button blink
    setProcessingSentences(prev => ({ ...prev, [sentenceIndex]: true }));

    try {
      const requestData = {
        text: sentence.text,
        sentenceIndex: sentenceIndex,
        verbMergeOptions: verbMergeOptions,
        allSentences: sentences.map(s => s.text),
        useRemoteProcessing: useRemoteProcessing,
        frequencySettings: frequencySettings
      };
      console.log('Sending request to /api/parse with data:', requestData);

      let responseData;
      if (useRemoteProcessing) {
        setOllamaStreamPopup({
          visible: true,
          sentenceIndex: sentenceIndex,
          status: 'connecting',
          content: ''
        });

        const streamResponse = await fetch('/api/parse/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestData)
        });

        if (!streamResponse.ok || !streamResponse.body) {
          throw new Error(`Stream request failed with status ${streamResponse.status}`);
        }

        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalPayload = null;

        const consumeEventBlock = (block) => {
          if (!block.trim()) return;

          let eventType = 'message';
          const dataLines = [];
          const lines = block.split(/\r?\n/);

          lines.forEach((line) => {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          });

          if (dataLines.length === 0) return;

          let payload;
          try {
            payload = JSON.parse(dataLines.join('\n'));
          } catch (parseError) {
            console.warn('Failed to parse stream payload:', parseError);
            return;
          }

          if (eventType === 'status') {
            setOllamaStreamPopup(prev => ({
              ...prev,
              status: payload.message || 'streaming'
            }));
            return;
          }

          if (eventType === 'chunk') {
            setOllamaStreamPopup(prev => ({
              ...prev,
              status: 'streaming',
              content: prev.content + (payload.content || '')
            }));
            return;
          }

          if (eventType === 'final') {
            finalPayload = payload;
            setOllamaStreamPopup(prev => ({
              ...prev,
              status: 'finalizing',
              content: prev.content || payload.fullSentenceTranslation || JSON.stringify(payload, null, 2)
            }));
            return;
          }

          if (eventType === 'error') {
            throw new Error(payload.message || 'Streaming parse failed');
          }

          if (eventType === 'done') {
            setOllamaStreamPopup(prev => ({
              ...prev,
              status: 'completed'
            }));
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || '';
          blocks.forEach(consumeEventBlock);
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          consumeEventBlock(buffer);
        }

        if (!finalPayload) {
          throw new Error('No final parse payload received from stream');
        }

        responseData = finalPayload;
      } else {
        const response = await axios.post('/api/parse', requestData);
        responseData = response.data;
      }

      console.log('Received response:', responseData);

      // Clear processing state for this specific sentence
      setProcessingSentences(prev => {
        const updated = { ...prev };
        delete updated[sentenceIndex];
        return updated;
      });

      // Store the processed tokens and full sentence translation for interactive display
      if (responseData.analysis && responseData.analysis.tokens) {
        const sentenceData = {
          tokens: responseData.analysis.tokens,
          fullSentenceTranslation: responseData.fullSentenceTranslation || 'N/A',
          sentenceNotes: Array.isArray(responseData.sentenceNotes) ? responseData.sentenceNotes : [],
          processingType: useRemoteProcessing ? 'remote' : 'local'
        };

        console.log('Setting processed sentence data for index:', sentenceIndex, sentenceData);

        setProcessedSentences(prev => {
          const updatedSentences = { ...prev, [sentenceIndex]: sentenceData };
          console.log('Updated processed sentences state:', updatedSentences);
          return updatedSentences;
        });

        // Persist immediately so R results survive refresh/reload.
        console.log('Auto-saving sentence:', sentenceIndex);
        await autoSave(sentenceIndex, sentenceData);
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

      // Clear processing state and set error message
      setProcessingSentences(prev => {
        const updated = { ...prev };
        delete updated[sentenceIndex];
        return updated;
      });

      setSentenceMessages(prev => ({
        ...prev,
        [sentenceIndex]: `Error: ${errorMessage}`
      }));

      if (useRemoteProcessing) {
        setOllamaStreamPopup(prev => ({
          ...prev,
          status: 'error'
        }));
      }
    }
  };

  const handleVerbOptionChange = (option, value) => {
    setVerbMergeOptions(prev => ({
      ...prev,
      [option]: value
    }));
  };

  const handleTtsOptionChange = (option, value) => {
    setTtsOptions(prev => ({
      ...prev,
      [option]: value
    }));
  };

  const handleFrequencyOptionChange = (option, value) => {
    setFrequencySettings(prev => ({
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
      return true;
    } catch (error) {
      console.error('Auto-save error:', error);
      return false;
    }
  };

  const autoProcessAllSentences = async (allSentences) => {
    console.log('Starting automatic local processing for unprocessed sentences...');

    let processedCount = 0;
    let skippedCount = 0;
    const totalSentences = allSentences.filter(s => !s.isLineBreak).length;

    // Check how many sentences are already processed
    const alreadyProcessedCount = Object.keys(processedSentences).length;

    if (alreadyProcessedCount > 0) {
      console.log(`Found ${alreadyProcessedCount} already processed sentences, skipping auto-processing for those`);
      setMessage(`Found ${alreadyProcessedCount} already processed sentences. Processing remaining sentences...`);
    } else {
      setMessage('Auto-processing sentences with local dictionary...');
    }

    for (let i = 0; i < allSentences.length; i++) {
      const sentence = allSentences[i];

      // Skip line breaks
      if (sentence.isLineBreak) continue;

      // Skip already processed sentences
      if (processedSentences[i]) {
        skippedCount++;
        console.log(`Skipping sentence ${i} - already processed`);
        continue;
      }

      try {
        console.log(`Auto-processing sentence ${i}: "${sentence.text.substring(0, 30)}..."`);

        const requestData = {
          text: sentence.text,
          sentenceIndex: i,
          verbMergeOptions: verbMergeOptions,
          allSentences: allSentences.map(s => s.text),
          useRemoteProcessing: false, // Use local processing only
          frequencySettings: frequencySettings
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
          const totalProcessed = skippedCount + processedCount;
          setMessage(`Auto-processing: ${totalProcessed}/${totalSentences} sentences completed (${processedCount} new, ${skippedCount} existing)`);
        }

        // Small delay to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        console.error(`Error auto-processing sentence ${i}:`, error);
        // Continue with next sentence even if one fails
      }
    }

    const totalProcessed = skippedCount + processedCount;
    console.log(`Auto-processing completed: ${totalProcessed}/${totalSentences} sentences total (${processedCount} newly processed, ${skippedCount} already existed)`);

    if (processedCount > 0) {
      setMessage(`Auto-processing completed: ${processedCount} new sentences processed with local dictionary (${skippedCount} already existed)`);
    } else {
      setMessage(`All ${totalSentences} sentences were already processed - no new processing needed`);
    }

    // Clear the message after 5 seconds
    setTimeout(() => {
      setMessage('');
    }, 5000);
  };

  const handleReprocessAll = async () => {
    console.log('Starting reprocessing of all sentences with current settings...');

    const totalSentences = sentences.filter(s => !s.isLineBreak).length;

    if (totalSentences === 0) {
      setMessage('No sentences to reprocess');
      return;
    }

    // Confirm with user
    const confirmed = window.confirm(
      `This will reprocess all ${totalSentences} sentences with your current settings (verb options, frequency settings, etc.). This may take a few minutes. Continue?`
    );

    if (!confirmed) {
      return;
    }

    setMessage('Reprocessing all sentences with current settings...');

    let processedCount = 0;
    let errorCount = 0;

    // Clear existing processed sentences to force reprocessing
    setProcessedSentences({});

    // Process sentences in smaller batches to avoid overwhelming the server
    const batchSize = 5;
    const batches = [];

    // Create batches of non-line-break sentences
    const nonLineBreakSentences = [];
    for (let i = 0; i < sentences.length; i++) {
      if (!sentences[i].isLineBreak) {
        nonLineBreakSentences.push({ sentence: sentences[i], originalIndex: i });
      }
    }

    for (let i = 0; i < nonLineBreakSentences.length; i += batchSize) {
      batches.push(nonLineBreakSentences.slice(i, i + batchSize));
    }

    console.log(`Processing ${nonLineBreakSentences.length} sentences in ${batches.length} batches of ${batchSize}`);

    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);

      // Process all sentences in the current batch concurrently
      const batchPromises = batch.map(async ({ sentence, originalIndex }) => {
        try {
          console.log(`Reprocessing sentence ${originalIndex}: "${sentence.text.substring(0, 30)}..."`);

          const requestData = {
            text: sentence.text,
            sentenceIndex: originalIndex,
            verbMergeOptions: verbMergeOptions,
            allSentences: sentences.map(s => s.text),
            useRemoteProcessing: false, // Use local processing for speed
            frequencySettings: frequencySettings
          };

          const response = await axios.post('/api/parse', requestData);

          if (response.data.analysis && response.data.analysis.tokens) {
            const sentenceData = {
              tokens: response.data.analysis.tokens,
              fullSentenceTranslation: response.data.fullSentenceTranslation || 'N/A',
              processingType: 'local_reprocessed'
            };

            // Update the processed sentences state
            setProcessedSentences(prev => ({ ...prev, [originalIndex]: sentenceData }));

            // Auto-save the processed data with a small delay
            setTimeout(() => {
              autoSave(originalIndex, sentenceData);
            }, Math.random() * 100 + 50); // Random delay between 50-150ms

            return { success: true, index: originalIndex };
          } else {
            console.warn(`No tokens received for sentence ${originalIndex}`);
            return { success: false, index: originalIndex, error: 'No tokens received' };
          }
        } catch (error) {
          console.error(`Error reprocessing sentence ${originalIndex}:`, error);
          return { success: false, index: originalIndex, error: error.message };
        }
      });

      // Wait for all sentences in the batch to complete
      const batchResults = await Promise.allSettled(batchPromises);

      // Count successes and errors for this batch
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            processedCount++;
          } else {
            errorCount++;
          }
        } else {
          errorCount++;
          console.error('Batch promise rejected:', result.reason);
        }
      });

      // Update progress message
      setMessage(`Reprocessing: ${processedCount}/${totalSentences} sentences completed (batch ${batchIndex + 1}/${batches.length})`);

      // Small delay between batches to prevent overwhelming the server
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`Reprocessing completed: ${processedCount}/${totalSentences} sentences processed successfully, ${errorCount} errors`);

    if (errorCount > 0) {
      setMessage(`Reprocessing completed: ${processedCount}/${totalSentences} sentences processed (${errorCount} errors)`);
    } else {
      setMessage(`✅ Reprocessing completed: All ${processedCount} sentences processed with current settings`);
    }

    // Clear the message after 8 seconds (longer since this is important feedback)
    setTimeout(() => {
      setMessage('');
    }, 8000);
  };

  const handleRunAiForCurrentPage = async () => {
    if (pageAiProcessing) return;

    const pageSentenceEntries = paginatedSentences.filter((entry) => !entry.isLineBreak);
    const totalPageSentences = pageSentenceEntries.length;

    if (totalPageSentences === 0) {
      setMessage('No sentences on this page to process');
      return;
    }

    const confirmed = window.confirm(
      `Run AI processing for all ${totalPageSentences} sentences on page ${currentPage}?`
    );
    if (!confirmed) return;

    setPageAiProcessing(true);
    setMessage(`AI processing page ${currentPage}: 0/${totalPageSentences}`);
    setOllamaStreamPopup({
      visible: true,
      sentenceIndex: null,
      status: `page ${currentPage}: 0/${totalPageSentences}`,
      content: `Starting AI processing for page ${currentPage}...\n`
    });

    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const allSentenceTexts = sentences.map((s) => s.text);
    const sentenceIndexesToProcess = [];

    for (let i = 0; i < pageSentenceEntries.length; i++) {
      const sentenceIndex = pageSentenceEntries[i].originalIndex;
      const sentence = sentences[sentenceIndex];
      const existingSentenceData = processedSentences[sentenceIndex];

      if (!sentence || sentence.isLineBreak || !sentence.text?.trim()) {
        skippedCount++;
        continue;
      }

      // Skip already-remote results to save credits/time.
      if (existingSentenceData?.processingType === 'remote') {
        skippedCount++;
        continue;
      }

      sentenceIndexesToProcess.push(sentenceIndex);
    }

    const updateProgress = () => {
      const completed = processedCount + skippedCount + errorCount;
      setMessage(`AI processing page ${currentPage}: ${completed}/${totalPageSentences}`);
      setOllamaStreamPopup((prev) => ({
        ...prev,
        visible: true,
        status: `page ${currentPage}: ${completed}/${totalPageSentences}`,
        content: `${prev.content}Progress: ${completed}/${totalPageSentences} (${processedCount} done, ${skippedCount} skipped, ${errorCount} errors)\n`
      }));
    };

    updateProgress();

    let cursor = 0;
    const configuredConcurrency = Number(import.meta.env.VITE_AI_PAGE_CONCURRENCY || 4);
    const workerCount = Math.max(1, Math.min(configuredConcurrency, sentenceIndexesToProcess.length || 1));

    const runWorker = async () => {
      while (true) {
        const currentCursor = cursor;
        cursor += 1;
        if (currentCursor >= sentenceIndexesToProcess.length) {
          return;
        }

        const sentenceIndex = sentenceIndexesToProcess[currentCursor];
        const sentence = sentences[sentenceIndex];

        setProcessingSentences((prev) => ({ ...prev, [sentenceIndex]: true }));
        setOllamaStreamPopup((prev) => ({
          ...prev,
          visible: true,
          status: `page ${currentPage}: ${processedCount + skippedCount + errorCount}/${totalPageSentences}`,
          content: `${prev.content}Processing sentence ${sentenceIndex}...\n`
        }));

        try {
          const requestData = {
            text: sentence.text,
            sentenceIndex: sentenceIndex,
            verbMergeOptions: verbMergeOptions,
            allSentences: allSentenceTexts,
            useRemoteProcessing: true,
            frequencySettings: frequencySettings
          };

          const response = await axios.post('/api/parse', requestData);

          if (response.data.analysis && response.data.analysis.tokens) {
            const sentenceData = {
              tokens: response.data.analysis.tokens,
              fullSentenceTranslation: response.data.fullSentenceTranslation || 'N/A',
              sentenceNotes: Array.isArray(response.data.sentenceNotes) ? response.data.sentenceNotes : [],
              processingType: 'remote'
            };

            setProcessedSentences((prev) => ({ ...prev, [sentenceIndex]: sentenceData }));
            await autoSave(sentenceIndex, sentenceData);
            processedCount++;
          } else {
            errorCount++;
          }
        } catch (error) {
          console.error(`AI page processing failed for sentence ${sentenceIndex}:`, error);
          errorCount++;
          setOllamaStreamPopup((prev) => ({
            ...prev,
            visible: true,
            status: `page ${currentPage}: error`,
            content: `${prev.content}Error on sentence ${sentenceIndex}: ${error.message || 'unknown error'}\n`
          }));
        } finally {
          setProcessingSentences((prev) => {
            const updated = { ...prev };
            delete updated[sentenceIndex];
            return updated;
          });
          updateProgress();
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    if (errorCount > 0) {
      setMessage(
        `AI page processing done: ${processedCount} processed, ${skippedCount} skipped, ${errorCount} errors`
      );
    } else {
      setMessage(
        `AI page processing done: ${processedCount} processed, ${skippedCount} skipped`
      );
    }

    setOllamaStreamPopup((prev) => ({
      ...prev,
      visible: true,
      status: `page ${currentPage}: completed`,
      content: `${prev.content}Completed page ${currentPage}: ${processedCount} processed, ${skippedCount} skipped, ${errorCount} errors\n`
    }));

    setPageAiProcessing(false);
    setTimeout(() => {
      setMessage('');
    }, 6000);
  };

  const handleGenerateSummary = async () => {
    if (!filename || isGeneratingSummary) return;

    setIsGeneratingSummary(true);
    setMessage('Generating title + 3-sentence summary with Ollama...');

    try {
      const response = await axios.post(`/api/import/${filename}/summarize`);
      const nextSummarySentences = Array.isArray(response.data?.summarySentences)
        ? response.data.summarySentences.map((sentence) => String(sentence || '').trim()).filter(Boolean)
        : [];
      const nextSummaryTitle = String(response.data?.summaryTitle || '').trim();

      setBookSummaryTitle(nextSummaryTitle);
      setBookSummarySentences(nextSummarySentences);
      setBookSummaryGeneratedAt(response.data?.generatedAt || new Date().toISOString());
      setMessage('Summary generated.');
    } catch (error) {
      console.error('Summary generation failed:', error);
      setMessage('Failed to generate summary');
    } finally {
      setIsGeneratingSummary(false);
    }
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
        summaryTitle: bookSummaryTitle,
        summarySentences: bookSummarySentences,
        summaryGeneratedAt: bookSummaryGeneratedAt,
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

  const getSentenceNoteLines = (sentenceData) => {
    if (!sentenceData) return [];
    const raw = sentenceData.sentenceNotes || sentenceData.notes || [];
    if (!Array.isArray(raw)) return [];

    const lines = [];
    const seen = new Set();

    for (const note of raw) {
      let text = '';
      if (typeof note === 'string') {
        text = note;
      } else if (note && typeof note === 'object') {
        text = note.text || note.note || note.explanation || note.description || '';
      }

      const normalized = String(text).replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(normalized);
    }

    return lines.slice(0, 4);
  };

  const renderSentenceTextWithBookmark = (text, isCurrentReading) => {
    if (!isCurrentReading || !text) {
      return text;
    }

    const leadingWhitespace = text.match(/^\s*/)?.[0] || '';
    const content = text.slice(leadingWhitespace.length);
    if (!content) {
      return text;
    }

    const firstUnit = content[0];
    const rest = content.slice(1);

    return (
      <>
        {leadingWhitespace}
        <span className="sentence-first-bookmark">{firstUnit}</span>
        {rest}
      </>
    );
  };

  // Pagination calculations
  const totalSentences = sentences.filter(s => !s.isLineBreak).length;
  const totalPages = Math.ceil(totalSentences / sentencesPerPage);

  // Get sentences for current page
  const getPaginatedSentences = () => {
    let sentenceCount = 0;
    let startIndex = -1;
    let endIndex = -1;

    // Find start index for current page
    for (let i = 0; i < sentences.length; i++) {
      if (!sentences[i].isLineBreak) {
        sentenceCount++;
        if (sentenceCount === (currentPage - 1) * sentencesPerPage + 1) {
          startIndex = i;
          break;
        }
      }
    }

    // Find end index for current page
    sentenceCount = 0;
    for (let i = 0; i < sentences.length; i++) {
      if (!sentences[i].isLineBreak) {
        sentenceCount++;
        if (sentenceCount === currentPage * sentencesPerPage) {
          endIndex = i;
          break;
        }
      }
    }

    // If we didn't find an end index, use the last sentence
    if (endIndex === -1) {
      endIndex = sentences.length - 1;
    }

    // Include line breaks that fall within our range
    const result = [];
    for (let i = startIndex; i <= endIndex; i++) {
      if (i >= 0 && i < sentences.length) {
        result.push({ ...sentences[i], originalIndex: i });
      }
    }

    return result;
  };

  const paginatedSentences = sentences.length > 0 ? getPaginatedSentences() : [];

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      // Scroll to top when changing pages
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="container">
      <h2>Import Books</h2>
      {!filename && (
        <div className="import-source-panel">
          <div className="import-source-row">
            <input type="file" ref={fileInput} onChange={handleFileChange} accept=".txt" />
            <button onClick={handleUpload} disabled={uploading} className="btn">
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>

          <div className="import-source-separator">or</div>

          <div className="url-import-form">
            <input
              type="url"
              value={articleUrl}
              onChange={(event) => setArticleUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleUrlImport();
                }
              }}
              placeholder="https://wired.jp/article/the-unseen-impact-of-war-on-the-environment/"
              className="url-import-input"
            />
            <button
              onClick={handleUrlImport}
              disabled={urlImporting}
              className="btn"
            >
              {urlImporting ? 'Importing...' : 'Import URL'}
            </button>
          </div>
        </div>
      )}
      {filename && (
        <div>
          <h3>File: {filename}</h3>
          <div className="controls-section">
            {!isCompletedBookView && (
              <button onClick={handleSave} className="btn">Save to Books</button>
            )}
            {!isCompletedBookView && (
              <button
                onClick={handleRunAiForCurrentPage}
                className="btn"
                style={{ backgroundColor: '#1d4ed8' }}
                disabled={pageAiProcessing}
                title="Run remote AI processing for all sentences on this page"
              >
                {pageAiProcessing ? 'AI Page Running...' : `AI This Page (${currentPage})`}
              </button>
            )}
            {!isCompletedBookView && (
              <button
                onClick={() => handleReprocessAll()}
                className="btn"
                style={{ backgroundColor: '#28a745' }}
              >
                Reprocess All Sentences
              </button>
            )}
            <button
              onClick={handleGenerateSummary}
              className="btn"
              style={{ backgroundColor: '#7c3aed' }}
              disabled={isGeneratingSummary}
              title="Generate a title and 3-sentence summary for this book"
            >
              {isGeneratingSummary ? 'Summarizing...' : 'Generate Summary'}
            </button>
            <button
              onClick={() => setShowTtsOptions(!showTtsOptions)}
              className="btn"
            >
              {showTtsOptions ? 'Hide' : 'Show'} TTS Options
            </button>
            <button
              onClick={() => setShowVerbOptions(!showVerbOptions)}
              className="btn"
            >
              {showVerbOptions ? 'Hide' : 'Show'} Verb Options
            </button>
            <button
              onClick={() => setShowFrequencyOptions(!showFrequencyOptions)}
              className="btn"
            >
              {showFrequencyOptions ? 'Hide' : 'Show'} Frequency Options
            </button>
          </div>

          {bookSummarySentences.length > 0 && (
            <div className="import-summary-note">
              <div className="import-summary-title">Book Summary (3 sentences)</div>
              {bookSummaryTitle && (
                <div className="import-summary-potential-title">
                  Potential title: {bookSummaryTitle}
                </div>
              )}
              <ol className="import-summary-list">
                {bookSummarySentences.map((sentence, idx) => (
                  <li key={`summary-${idx}`}>{sentence}</li>
                ))}
              </ol>
              {bookSummaryGeneratedAt && (
                <div className="import-summary-meta">
                  Generated: {new Date(bookSummaryGeneratedAt).toLocaleString()}
                </div>
              )}
            </div>
          )}

          {showTtsOptions && (
            <div className="options-panel">
              <h4>Text-to-Speech Options</h4>
              <p>
                Configure VOICEVOX speech synthesis settings:
              </p>

              <div className="tts-options-grid">
                <div className="tts-option-group">
                  <label>
                    Speech Speed
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={ttsOptions.speed}
                    onChange={(e) => handleTtsOptionChange('speed', parseFloat(e.target.value))}
                  />
                  <div className="tts-option-value">
                    {ttsOptions.speed}x
                  </div>
                </div>

                <div className="tts-option-group">
                  <label>
                    Speaker Voice
                  </label>
                  <select
                    value={ttsOptions.speaker}
                    onChange={(e) => handleTtsOptionChange('speaker', parseInt(e.target.value))}
                  >
                    <option value={1}>Speaker 1 (四国めたん)</option>
                    <option value={2}>Speaker 2 (ずんだもん)</option>
                    <option value={3}>Speaker 3 (春日部つむぎ)</option>
                    <option value={8}>Speaker 8 (青山龍星)</option>
                    <option value={13}>Speaker 13 (白上虎太郎)</option>
                  </select>
                </div>

                <div className="tts-option-group">
                  <label>
                    Volume
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={ttsOptions.volume}
                    onChange={(e) => handleTtsOptionChange('volume', parseFloat(e.target.value))}
                  />
                  <div className="tts-option-value">
                    {Math.round(ttsOptions.volume * 100)}%
                  </div>
                </div>

                <div className="tts-option-group">
                  <label>
                    Timing Stretch
                  </label>
                  <input
                    type="range"
                    min="1.0"
                    max="3.0"
                    step="0.1"
                    value={ttsOptions.timingStretch}
                    onChange={(e) => handleTtsOptionChange('timingStretch', parseFloat(e.target.value))}
                  />
                  <div className="tts-option-value">
                    {ttsOptions.timingStretch}x
                  </div>
                </div>

                <div className="tts-option-group">
                  <label>
                    Comma Pause
                  </label>
                  <input
                    type="range"
                    min="0.0"
                    max="2.0"
                    step="0.1"
                    value={ttsOptions.commaPauseDuration}
                    onChange={(e) => handleTtsOptionChange('commaPauseDuration', parseFloat(e.target.value))}
                  />
                  <div className="tts-option-value">
                    {ttsOptions.commaPauseDuration}s
                  </div>
                </div>
              </div>

              <div className="note">
                <strong>Note:</strong> Speed and volume settings will be applied to future speech generation.
                Speaker selection requires VOICEVOX engine to support the selected voice.
              </div>
            </div>
          )}

          {showVerbOptions && (
            <div className="options-panel">
              <h4>Japanese Verb Tokenization Options</h4>
              <p>
                Configure how Japanese verbs are merged to keep them as single tokens:
              </p>

              <div className="verb-options-grid">
                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeAuxiliaryVerbs}
                    onChange={(e) => handleVerbOptionChange('mergeAuxiliaryVerbs', e.target.checked)}
                  />
                  Merge Auxiliary Verbs (助動詞)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeVerbParticles}
                    onChange={(e) => handleVerbOptionChange('mergeVerbParticles', e.target.checked)}
                  />
                  Merge Verb Particles (助詞)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeVerbSuffixes}
                    onChange={(e) => handleVerbOptionChange('mergeVerbSuffixes', e.target.checked)}
                  />
                  Merge Verb Suffixes (接尾)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeTeForm}
                    onChange={(e) => handleVerbOptionChange('mergeTeForm', e.target.checked)}
                  />
                  Merge Te-form (て/で)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeMasuForm}
                    onChange={(e) => handleVerbOptionChange('mergeMasuForm', e.target.checked)}
                  />
                  Merge Masu-form (ます/ました)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeAllInflections}
                    onChange={(e) => handleVerbOptionChange('mergeAllInflections', e.target.checked)}
                  />
                  Merge ALL Inflections (Complete)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergePunctuation}
                    onChange={(e) => handleVerbOptionChange('mergePunctuation', e.target.checked)}
                  />
                  Merge Punctuation (記号)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.useCompoundDetection}
                    onChange={(e) => handleVerbOptionChange('useCompoundDetection', e.target.checked)}
                  />
                  Detect Compound Verbs
                </label>
              </div>
            </div>
          )}

          {showFrequencyOptions && (
            <div className="options-panel">
              <h4>Furigana Frequency Options</h4>
              <p>
                Configure when to hide furigana based on word frequency:
              </p>

              <div className="frequency-options-grid">
                <label className="frequency-option-label">
                  <input
                    type="checkbox"
                    checked={frequencySettings.hideFrequentFurigana}
                    onChange={(e) => handleFrequencyOptionChange('hideFrequentFurigana', e.target.checked)}
                  />
                  Hide Furigana for Frequent Words
                </label>

                <div className="frequency-option-group">
                  <label>
                    Frequency Threshold (words ranked 1-{frequencySettings.frequencyThreshold} will hide furigana)
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="5000"
                    step="100"
                    value={frequencySettings.frequencyThreshold}
                    onChange={(e) => handleFrequencyOptionChange('frequencyThreshold', parseInt(e.target.value))}
                    disabled={!frequencySettings.hideFrequentFurigana}
                  />
                  <div className="frequency-option-value">
                    Top {frequencySettings.frequencyThreshold} words
                  </div>
                </div>

                <label className="frequency-option-label">
                  <input
                    type="checkbox"
                    checked={frequencySettings.alwaysShowUnknown}
                    onChange={(e) => handleFrequencyOptionChange('alwaysShowUnknown', e.target.checked)}
                  />
                  Always Show Furigana for Unknown Words
                </label>
              </div>

              <div className="note">
                <strong>Note:</strong> Frequency-based furigana hiding helps you focus on learning less common words while reducing visual clutter from words you already know.
                The frequency data is based on common Japanese text corpora.
              </div>
            </div>
          )}

          {/* Pagination info and controls - TOP */}
          {totalPages > 1 && (
            <>
              <div className="pagination-info">
                <span>
                  Page {currentPage} of {totalPages} ({totalSentences} total sentences)
                </span>
              </div>

              <div className="pagination-controls">
                <button
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage === 1}
                  className="btn pagination-btn"
                >
                  First
                </button>
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="btn pagination-btn"
                >
                  Previous
                </button>

                <span className="pagination-pages">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`btn pagination-btn ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </span>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="btn pagination-btn"
                >
                  Next
                </button>
                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage === totalPages}
                  className="btn pagination-btn"
                >
                  Last
                </button>
              </div>
            </>
          )}

          <div className="import-content">
            {paginatedSentences.map((sentence, index) => {
              const sentenceIndex = sentence.originalIndex;

              if (sentence.isLineBreak) {
                return <br key={sentenceIndex} />;
              }

          const isProcessed = processedSentences[sentenceIndex];
          const hasRemoteTranslation = isProcessed && isProcessed.processingType === 'remote' &&
            isProcessed.fullSentenceTranslation && isProcessed.fullSentenceTranslation !== 'N/A';
          const isCurrentReading = currentReadingPosition === sentenceIndex;
          const sentenceNoteLines = getSentenceNoteLines(isProcessed);
          const hasSentenceNotes = sentenceNoteLines.length > 0;

              return (
                <span key={sentenceIndex} className="sentence-container">
                  {isProcessed ? (
                    <span data-sentence={sentenceIndex}>
                      <TokenizedText
                        tokens={isProcessed.tokens}
                        sentenceIndex={sentenceIndex}
                        isCurrentReading={isCurrentReading}
                        onBookmark={saveReadingBookmark}
                      />
                    </span>
                  ) : (
                    <span
                      data-sentence={sentenceIndex}
                      className="sentence-text"
                    >
                      {renderSentenceTextWithBookmark(sentence.text, isCurrentReading)}
                    </span>
                  )}

                  {/* Processing buttons - inline after sentence - hide for sentences that are just closing quotes */}
                  {sentence.text.trim() !== '」' && (
                    <span className="sentence-controls">
                      {!isCompletedBookView && (
                        <button
                          onClick={() => handleSentenceProcess(sentenceIndex, true)}
                          className={`sentence-btn remote ${processingSentences[sentenceIndex] ? 'processing' : ''}`}
                          title="Process using Ollama with live streamed response"
                        >
                          R
                        </button>
                      )}

                      {hasSentenceNotes && (
                        <button
                          onClick={() => {
                            saveReadingBookmark(sentenceIndex);
                            setActiveSentenceNotes((prev) => (prev === sentenceIndex ? null : sentenceIndex));
                          }}
                          className="sentence-btn notes"
                          title="Show sentence notes"
                        >
                          📝
                        </button>
                      )}

                      {/* Text-to-speech with timing button */}
                      <button
                        onClick={() => handleTextToSpeech(sentenceIndex, true)}
                        className="sentence-btn tts"
                        title="Generate speech with real-time highlighting using VOICEVOX"
                      >
                        🔊
                      </button>

                      {/* Translation popup button - only visible after remote processing */}
                      {hasRemoteTranslation && (
                        <button
                          onClick={() => {
                            // Auto-save bookmark when user interacts with sentence
                            saveReadingBookmark(sentenceIndex);

                            const popup = document.getElementById(`translation-popup-${sentenceIndex}`);
                            if (popup) {
                              popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
                            }
                          }}
                          className="sentence-btn translation"
                          title="Show sentence translation"
                        >
                          💬
                        </button>
                      )}

                      {/* Bookmark button - hidden but functionality preserved through auto-save */}
                    </span>
                  )}

                  {/* Only error messages are shown as text now */}
                  {sentenceMessages[sentenceIndex] && (
                    <span className="sentence-status error">
                      {sentenceMessages[sentenceIndex]}
                    </span>
                  )}

                  {/* Translation popup */}
                  {hasRemoteTranslation && (
                    <div
                      id={`translation-popup-${sentenceIndex}`}
                      className="translation-popup"
                    >
                      <div className="translation-popup-label">
                        Translation
                      </div>
                      <div>
                        {isProcessed.fullSentenceTranslation}
                      </div>
                      <button
                        onClick={() => {
                          document.getElementById(`translation-popup-${sentenceIndex}`).style.display = 'none';
                        }}
                        className="translation-popup-close"
                      >
                        ×
                      </button>
                    </div>
                  )}

                  {hasSentenceNotes && activeSentenceNotes === sentenceIndex && (
                    <div className="sentence-notes-popup">
                      <div className="sentence-notes-title">Notes</div>
                      {sentenceNoteLines.map((line, noteIndex) => (
                        <div key={`${sentenceIndex}-note-${noteIndex}`} className="sentence-note-line">
                          {line}
                        </div>
                      ))}
                      <button
                        onClick={() => setActiveSentenceNotes(null)}
                        className="sentence-notes-close"
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

          {ollamaStreamPopup.visible && (
            <div
              style={{
                position: 'fixed',
                right: '16px',
                bottom: '16px',
                width: '420px',
                maxWidth: 'calc(100vw - 32px)',
                maxHeight: '55vh',
                background: '#121212',
                border: '2px solid #4fc3f7',
                borderRadius: '10px',
                boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6)',
                zIndex: 100000,
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <div
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid #2a2a2a',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  color: '#f2f2f2',
                  fontSize: '0.9em'
                }}
              >
                <div>
                  <strong>Ollama Live</strong>{' '}
                  {Number.isInteger(ollamaStreamPopup.sentenceIndex)
                    ? `(R: sentence ${ollamaStreamPopup.sentenceIndex})`
                    : '(R: page processing)'}
                  <div style={{ fontSize: '0.8em', color: '#9ecae1' }}>
                    Status: {ollamaStreamPopup.status}
                  </div>
                </div>
                <button
                  onClick={() => setOllamaStreamPopup(prev => ({ ...prev, visible: false }))}
                  style={{
                    background: 'transparent',
                    color: '#ccc',
                    border: 'none',
                    fontSize: '1.1em',
                    cursor: 'pointer'
                  }}
                  title="Close stream popup"
                >
                  ×
                </button>
              </div>
              <div
                style={{
                  padding: '12px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                  fontSize: '0.85em',
                  color: '#e6e6e6',
                  lineHeight: '1.4'
                }}
              >
                {ollamaStreamPopup.content || 'Waiting for streamed response...'}
              </div>
            </div>
          )}

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                onClick={() => handlePageChange(1)}
                disabled={currentPage === 1}
                className="btn pagination-btn"
              >
                First
              </button>
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="btn pagination-btn"
              >
                Previous
              </button>

              <span className="pagination-pages">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`btn pagination-btn ${currentPage === pageNum ? 'active' : ''}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </span>

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="btn pagination-btn"
              >
                Next
              </button>
              <button
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage === totalPages}
                className="btn pagination-btn"
              >
                Last
              </button>
            </div>
          )}
        </div>
      )}
      {message && <div className="message">{message}</div>}
    </div>
  );
}
