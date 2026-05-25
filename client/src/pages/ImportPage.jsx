import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import './ImportPage.css';
import {
  cacheImportPayload,
  getCachedImportPayload,
  updateCachedImportSentence
} from '../utils/offlineCache';

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

const JLPT_LEVEL_RANK = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
const TOKEN_SPACING = {
  AFTER_WORDS_PARTICLES: 'afterWordsParticles',
  NONE: 'none'
};
const READING_FONT_SCALE = {
  DEFAULT: 1,
  MIN: 0.85,
  MAX: 1.5,
  STEP: 0.05
};

const getSpeechTagsFromResponse = (responseData = {}) => {
  const rawTags = responseData.speechTags || responseData.analysis?.speechTags || [];
  return Array.isArray(rawTags)
    ? rawTags.filter((tag) => typeof tag === 'string' && tag.trim()).slice(0, 2)
    : [];
};
const WORD_SPACE_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞', '接頭詞']);
const PARTICLE_POS = '助詞';
const PUNCTUATION_POS = '記号';

const isKnownJlptGrammar = (token, jlptSettings = {}) => {
  const knownLevel = jlptSettings.knownLevel;
  const grammarLevel = token?.jlptGrammar?.level;
  if (!knownLevel || !grammarLevel) return false;
  return JLPT_LEVEL_RANK[grammarLevel] <= JLPT_LEVEL_RANK[knownLevel];
};

const getDisplayToken = (token = {}) => {
  if (
    token.surface === '未' &&
    token.reading === 'み' &&
    /Sheep|Ram|Goat|zodiac|south-southwest|lunar calendar/i.test(token.translation || '')
  ) {
    return {
      ...token,
      translation: 'not yet; un-; non-; before',
      contextualMeaning: 'not yet; un-; non-',
      jlptVocabulary: null,
      vocabularyJlptLevel: null
    };
  }

  return token;
};

const isPunctuationToken = (token = {}) => (
  token.pos === PUNCTUATION_POS ||
  token.surface === '」' ||
  token.surface === '、' ||
  token.surface === '。'
);

const shouldAddDisplaySpace = (token = {}, nextToken = null, spacingMode = TOKEN_SPACING.NONE) => {
  if (spacingMode !== TOKEN_SPACING.AFTER_WORDS_PARTICLES || !nextToken) return false;
  if (isPunctuationToken(token) || isPunctuationToken(nextToken)) return false;
  if (nextToken.pos_detail === '接尾' || nextToken.pos_detail_1 === '接尾') return false;
  return WORD_SPACE_POS.has(token.pos) || token.pos === PARTICLE_POS;
};

const clampReadingFontScale = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return READING_FONT_SCALE.DEFAULT;

  const clamped = Math.min(
    READING_FONT_SCALE.MAX,
    Math.max(READING_FONT_SCALE.MIN, numericValue)
  );
  return Math.round(clamped * 100) / 100;
};

function TokenizedText({ tokens, sentenceIndex, isCurrentReading = false, onBookmark, jlptSettings = {}, tokenSpacing = TOKEN_SPACING.NONE }) {
  const [activePopup, setActivePopup] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, top: null, bottom: null });
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
    const viewportHeight = window.innerHeight;

    let x = rect.left + (rect.width / 2);
    const popupWidth = 440;
    const estimatedPopupHeight = 240;
    const gap = 24;
    const margin = 12;

    if (x - popupWidth / 2 < margin) {
      x = popupWidth / 2 + margin;
    } else if (x + popupWidth / 2 > viewportWidth - margin) {
      x = viewportWidth - popupWidth / 2 - margin;
    }

    let top = null;
    let bottom = viewportHeight - rect.top + gap;
    if (rect.top - estimatedPopupHeight - gap < margin) {
      top = Math.min(rect.bottom + gap, viewportHeight - estimatedPopupHeight - margin);
      bottom = null;
    }

    console.log('Popup position:', { x, top, bottom });
    console.log('Current activePopup:', activePopup);

    setPopupPosition({ x, top, bottom });
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
      {tokens.map((rawToken, tokenIdx) => {
        const token = getDisplayToken(rawToken);
        const nextToken = tokenIdx + 1 < tokens.length ? getDisplayToken(tokens[tokenIdx + 1]) : null;
        const isMergedVerb = token.pos === '動詞' && (token.pos_detail === 'compound' || token.pos_detail === 'inflected');
        const isPunctuation = isPunctuationToken(token);
        const addDisplaySpace = shouldAddDisplaySpace(token, nextToken, tokenSpacing);
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
                  fontSize: '0.52em',
                  color: '#d6d6d6',
                  fontWeight: 'normal',
                  lineHeight: '1.1',
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
        const tokenJlptGrammar = token.jlptGrammar || null;
        const showJlptGrammar = jlptSettings.showGrammar !== false && !!tokenJlptGrammar;
        const shouldFilterKnownJlptGrammar =
          showJlptGrammar &&
          jlptSettings.hideKnownGrammar !== false &&
          isKnownJlptGrammar(token, jlptSettings);
        const hasVisibleJlptGrammar = showJlptGrammar && !shouldFilterKnownJlptGrammar;
        const expressionMeta = expressionMetaByToken[tokenIdx];
        const hasExpression = !!expressionMeta && !shouldFilterKnownJlptGrammar;
        const hasGrammarHighlight = hasExpression || hasVisibleJlptGrammar;
        const isExpressionHovered = hasExpression && hoveredExpressionId === expressionMeta.id;
        const isTokenHovered = hoveredTokenIdx === tokenIdx && !isPunctuation;

        return (
          <span
            key={tokenIdx}
            data-token={`${sentenceIndex}-${tokenIdx}`}
            style={{
              '--token-margin': addDisplaySpace ? '0 0.35em 0 0' : '0',
              display: 'inline-block',
              margin: 'var(--token-margin)',
              padding: '0 2px',
              backgroundColor: isActive && !isPunctuation
                ? activeColor
                : (isBookmarkToken
                  ? 'rgba(156, 39, 176, 0.18)'
                  : (isTokenHovered
                    ? 'rgba(79, 195, 247, 0.22)'
                    : 'transparent')),
              color: isActive && !isPunctuation ? 'white' : tokenColor,
              borderRadius: '2px',
              cursor: isPunctuation ? 'default' : 'pointer',
              fontSize: '1em',
              border: 'none',
              fontWeight: 'normal',
              transition: 'background-color 0.2s ease, color 0.2s ease',
              minHeight: '0',
              minWidth: '0',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              lineHeight: 'inherit',
              textDecorationLine: hasGrammarHighlight ? 'underline' : 'none',
              textDecorationColor: hasGrammarHighlight
                ? (isExpressionHovered ? '#ffd166' : 'rgba(255, 209, 102, 0.75)')
                : 'transparent',
              textDecorationThickness: hasGrammarHighlight ? '3px' : 'auto',
              textUnderlineOffset: hasGrammarHighlight ? '0.14em' : 'auto',
              borderTop: '1px solid transparent',
              borderBottom: '1px solid transparent',
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
          const token = getDisplayToken(tokens[tokenIdx]);
          if (!token) return null;

          const tokenJlptGrammar = token.jlptGrammar || null;
          const showJlptGrammar = jlptSettings.showGrammar !== false && !!tokenJlptGrammar;
          const shouldFilterKnownJlptGrammar =
            showJlptGrammar &&
            jlptSettings.hideKnownGrammar !== false &&
            isKnownJlptGrammar(token, jlptSettings);
          const hasVisibleJlptGrammar = showJlptGrammar && !shouldFilterKnownJlptGrammar;
          const hasExpression = !!token.expressionSurface && !shouldFilterKnownJlptGrammar;
          const contextualMeaning =
            token.contextualMeaning && token.contextualMeaning !== 'N/A' ? token.contextualMeaning : null;
          const dictionaryMeaning =
            token.translation && token.translation !== 'N/A' ? token.translation : null;
          const primaryMeaning = hasExpression
            ? (token.expressionMeaning || contextualMeaning || dictionaryMeaning || 'N/A')
            : (hasVisibleJlptGrammar
              ? (tokenJlptGrammar.meaning || contextualMeaning || dictionaryMeaning || 'N/A')
              : (contextualMeaning || dictionaryMeaning || 'N/A'));
          const shouldShowReading = token.reading && token.reading !== token.surface;
          const expressionLabel = hasExpression
            ? (token.expressionSource === 'ai' ? 'Set phrase (AI)' : 'Set phrase')
            : null;

          return (
            <div
              className="token-popup"
              style={window.innerWidth <= 768 ? {
                position: 'fixed',
                left: '12px',
                right: '12px',
                bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                transform: 'none',
                maxWidth: 'none',
                minWidth: '0',
                maxHeight: 'min(52vh, calc(100dvh - 120px))',
                overflowY: 'auto',
              } : {
                position: 'fixed',
                left: `${popupPosition.x}px`,
                ...(popupPosition.top !== null
                  ? { top: `${popupPosition.top}px` }
                  : { bottom: `${popupPosition.bottom}px` }),
                transform: 'translateX(-50%)',
              }}
            >
              <div className="token-popup-header">
                {token.surface}
              </div>

              {shouldShowReading && (
                <div className="token-popup-reading">
                  {token.reading}
                </div>
              )}

              {hasExpression && (
                <div className="token-popup-pattern">
                  <strong>{expressionLabel}:</strong> {token.expressionSurface}
                </div>
              )}

              {hasVisibleJlptGrammar && (
                <div className="token-popup-pattern">
                  <strong>JLPT {tokenJlptGrammar.level}:</strong> {tokenJlptGrammar.pattern}
                </div>
              )}

              {primaryMeaning && primaryMeaning !== 'N/A' && (
                <div className="token-popup-meaning">
                  <strong>{hasExpression || hasVisibleJlptGrammar ? 'Meaning' : 'In this sentence'}:</strong> {primaryMeaning}
                </div>
              )}

              {!hasExpression && dictionaryMeaning && contextualMeaning && dictionaryMeaning !== contextualMeaning && (
                <div className="token-popup-secondary">
                  <strong>Base:</strong> {dictionaryMeaning}
                </div>
              )}

              {hasExpression && token.expressionNote && (
                <div className="token-popup-secondary">
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
  const [lineMetadata, setLineMetadata] = useState([]);
  const [sentences, setSentences] = useState([]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [articleUrl, setArticleUrl] = useState('');
  const [urlImporting, setUrlImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [sentenceMessages, setSentenceMessages] = useState({});
  const [ttsGeneratingSentences, setTtsGeneratingSentences] = useState({});
  const [processedSentences, setProcessedSentences] = useState({});
  const [processingSentences, setProcessingSentences] = useState({});
  const [pageAiProcessing, setPageAiProcessing] = useState(false);
  const [pageTtsGenerating, setPageTtsGenerating] = useState(false);
  const [pageTtsPlaying, setPageTtsPlaying] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState({
    checking: true,
    available: false,
    model: '',
    endpoints: [],
    message: 'Checking AI engine'
  });
  const [activeSentenceNotes, setActiveSentenceNotes] = useState(null);
  const [activeSentenceControls, setActiveSentenceControls] = useState(null);
  const [activeTranslationSentence, setActiveTranslationSentence] = useState(null);
  const [isCompletedBookView, setIsCompletedBookView] = useState(false);
  const [bookSummaryTitle, setBookSummaryTitle] = useState('');
  const [bookSummarySentences, setBookSummarySentences] = useState([]);
  const [bookSummaryGeneratedAt, setBookSummaryGeneratedAt] = useState(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const pageAiRunRef = useRef(0);
  const pageTtsRunRef = useRef(0);
  const pageTtsPlayRunRef = useRef(0);
  const aiPageTaskSourceRef = useRef(null);
  const ttsPageTaskSourceRef = useRef(null);
  const [ollamaStreamPopup, setOllamaStreamPopup] = useState({
    visible: false,
    title: 'AI Live',
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

  const [jlptSettings, setJlptSettings] = useState(() => {
    const saved = getCookie('jlptSettings');
    return saved || {
      knownLevel: '',
      hideKnownGrammar: true,
      showGrammar: true
    };
  });

  const [tokenSpacing, setTokenSpacing] = useState(() => {
    return getCookie('tokenSpacing') || TOKEN_SPACING.AFTER_WORDS_PARTICLES;
  });

  const [readingFontScale, setReadingFontScale] = useState(() => {
    return clampReadingFontScale(getCookie('readingFontScale') || READING_FONT_SCALE.DEFAULT);
  });

  const [showJlptOptions, setShowJlptOptions] = useState(() => {
    const saved = getCookie('showJlptOptions');
    return saved !== null ? saved : false;
  });

  const [showDisplayOptions, setShowDisplayOptions] = useState(() => {
    const saved = getCookie('showDisplayOptions');
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

  function closeAiPageTaskStream() {
    if (aiPageTaskSourceRef.current) {
      aiPageTaskSourceRef.current.close();
      aiPageTaskSourceRef.current = null;
    }
  }

  function closeTtsPageTaskStream() {
    if (ttsPageTaskSourceRef.current) {
      ttsPageTaskSourceRef.current.close();
      ttsPageTaskSourceRef.current = null;
    }
  }

  function getAiPageTaskPopupContent(task = null) {
    if (!task || !Array.isArray(task.logs) || task.logs.length === 0) {
      return '';
    }

    return task.logs
      .map((entry) => String(entry?.message || '').trim())
      .filter(Boolean)
      .join('\n');
  }

  function getAiPageTaskStatusLabel(task = null) {
    if (!task) return 'idle';
    const completed = Number(task.completedCount || 0);
    const total = Number(task.totalSentences || 0);

    if (task.status === 'completed') {
      return `page ${task.currentPage}: completed`;
    }
    if (task.status === 'failed') {
      return `page ${task.currentPage}: failed`;
    }
    return `page ${task.currentPage}: ${completed}/${total}`;
  }

  function applyAiPageTaskSnapshot(task = null) {
    if (!task) {
      setPageAiProcessing(false);
      setProcessingSentences({});
      return;
    }

    const isRunning = task.status === 'running';
    const completed = Number(task.completedCount || 0);
    const total = Number(task.totalSentences || 0);
    const processed = Number(task.processedCount || 0);
    const skipped = Number(task.skippedCount || 0);
    const errors = Number(task.errorCount || 0);

    setPageAiProcessing(isRunning);
    setProcessingSentences(
      isRunning && Number.isInteger(task.activeSentenceIndex)
        ? { [task.activeSentenceIndex]: true }
        : {}
    );

    if (isRunning) {
      setMessage(`AI processing page ${task.currentPage}: ${completed}/${total}`);
    } else if (task.status === 'completed') {
      setMessage(`AI page processing done: ${processed} processed, ${skipped} skipped, ${errors} errors`);
    } else if (task.status === 'failed') {
      setMessage(task.lastError ? `AI page processing failed: ${task.lastError}` : 'AI page processing failed');
    }

    setOllamaStreamPopup((prev) => ({
      ...prev,
      visible: true,
      title: 'AI Live',
      sentenceIndex: Number.isInteger(task.activeSentenceIndex) ? task.activeSentenceIndex : null,
      status: getAiPageTaskStatusLabel(task),
      content: getAiPageTaskPopupContent(task)
    }));
  }

  function attachAiPageTaskStream(draftFilename) {
    if (!draftFilename) return;
    closeAiPageTaskStream();

    const source = new EventSource(`/api/import/${encodeURIComponent(draftFilename)}/ai-page-task/stream`);
    aiPageTaskSourceRef.current = source;

    source.addEventListener('snapshot', (event) => {
      try {
        const task = JSON.parse(event.data);
        applyAiPageTaskSnapshot(task);
        if (task?.status !== 'running') {
          closeAiPageTaskStream();
        }
      } catch (error) {
        console.warn('Failed to parse AI page task snapshot:', error);
      }
    });

    source.addEventListener('sentence-complete', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.sentenceData && Number.isInteger(payload?.sentenceIndex)) {
          setProcessedSentences((prev) => ({
            ...prev,
            [payload.sentenceIndex]: payload.sentenceData
          }));
        }
      } catch (error) {
        console.warn('Failed to parse AI page task sentence update:', error);
      }
    });

    source.addEventListener('done', (event) => {
      try {
        const task = JSON.parse(event.data);
        applyAiPageTaskSnapshot(task);
      } catch (error) {
        console.warn('Failed to parse AI page task completion:', error);
      } finally {
        closeAiPageTaskStream();
      }
    });

    source.addEventListener('failed', (event) => {
      try {
        const task = JSON.parse(event.data);
        applyAiPageTaskSnapshot(task);
      } catch (error) {
        console.warn('Failed to parse AI page task failure:', error);
      } finally {
        closeAiPageTaskStream();
      }
    });

    source.onerror = () => {
      if (!aiPageTaskSourceRef.current) {
        return;
      }
    };
  }

  function getTtsPageTaskPopupContent(task = null) {
    if (!task || !Array.isArray(task.logs) || task.logs.length === 0) {
      return '';
    }

    return task.logs
      .map((entry) => String(entry?.message || '').trim())
      .filter(Boolean)
      .join('\n');
  }

  function getTtsPageTaskStatusLabel(task = null) {
    if (!task) return 'idle';
    const completed = Number(task.completedCount || 0);
    const total = Number(task.totalSentences || 0);

    if (task.status === 'completed') {
      return `page ${task.currentPage}: completed`;
    }
    if (task.status === 'failed') {
      return `page ${task.currentPage}: failed`;
    }
    return `page ${task.currentPage}: ${completed}/${total}`;
  }

  function applyTtsPageTaskSnapshot(task = null) {
    if (!task) {
      setPageTtsGenerating(false);
      setTtsGeneratingSentences({});
      return;
    }

    const isRunning = task.status === 'running';
    const completed = Number(task.completedCount || 0);
    const total = Number(task.totalSentences || 0);
    const generated = Number(task.generatedCount || 0);
    const errors = Number(task.errorCount || 0);

    setPageTtsGenerating(isRunning);
    setTtsGeneratingSentences(
      isRunning && Number.isInteger(task.activeSentenceIndex)
        ? { [task.activeSentenceIndex]: true }
        : {}
    );

    if (isRunning) {
      setMessage(`Generating page audio ${task.currentPage}: ${completed}/${total}`);
    } else if (task.status === 'completed') {
      setMessage(
        errors > 0
          ? `Page audio done: ${generated} generated, ${errors} errors`
          : `Page audio cached: ${generated} sentences`
      );
    } else if (task.status === 'failed') {
      setMessage(task.lastError ? `Page audio failed: ${task.lastError}` : 'Page audio failed');
    }

    setOllamaStreamPopup((prev) => ({
      ...prev,
      visible: true,
      title: 'Audio Live',
      sentenceIndex: Number.isInteger(task.activeSentenceIndex) ? task.activeSentenceIndex : null,
      status: getTtsPageTaskStatusLabel(task),
      content: getTtsPageTaskPopupContent(task)
    }));
  }

  function attachTtsPageTaskStream(draftFilename) {
    if (!draftFilename) return;
    closeTtsPageTaskStream();

    const source = new EventSource(`/api/text-to-speech/draft/${encodeURIComponent(draftFilename)}/page-task/stream`);
    ttsPageTaskSourceRef.current = source;

    source.addEventListener('snapshot', (event) => {
      try {
        const task = JSON.parse(event.data);
        applyTtsPageTaskSnapshot(task);
        if (task?.status !== 'running') {
          closeTtsPageTaskStream();
        }
      } catch (error) {
        console.warn('Failed to parse audio page task snapshot:', error);
      }
    });

    source.addEventListener('done', (event) => {
      try {
        const task = JSON.parse(event.data);
        applyTtsPageTaskSnapshot(task);
      } catch (error) {
        console.warn('Failed to parse audio page task completion:', error);
      } finally {
        closeTtsPageTaskStream();
      }
    });

    source.addEventListener('failed', (event) => {
      try {
        const task = JSON.parse(event.data);
        applyTtsPageTaskSnapshot(task);
      } catch (error) {
        console.warn('Failed to parse audio page task failure:', error);
      } finally {
        closeTtsPageTaskStream();
      }
    });

    source.onerror = () => {
      if (!ttsPageTaskSourceRef.current) {
        return;
      }
    };
  }

  useEffect(() => {
    let cancelled = false;

    const loadOllamaStatus = async () => {
      try {
        const response = await axios.get('/api/ollama/status');
        if (cancelled) return;

        const endpoints = Array.isArray(response.data?.endpoints) ? response.data.endpoints : [];
        const firstUnavailable = endpoints.find((endpoint) => !endpoint.healthy);
        setOllamaStatus({
          checking: false,
          available: Boolean(response.data?.available),
          model: response.data?.model || '',
          endpoints,
          message: response.data?.available
            ? 'AI engine ready'
            : (firstUnavailable?.reason || 'AI engine unavailable')
        });
      } catch (error) {
        if (cancelled) return;
        setOllamaStatus({
          checking: false,
          available: false,
          model: '',
          endpoints: [],
          message: error.response?.data?.details || error.message || 'AI engine unavailable'
        });
      }
    };

    loadOllamaStatus();
    const intervalId = window.setInterval(loadOllamaStatus, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    pageAiRunRef.current += 1;
    closeAiPageTaskStream();
    closeTtsPageTaskStream();
    setInitialLoadComplete(false);
    setIsCompletedBookView(isBookViewHint);
    setPageAiProcessing(false);
    setPageTtsGenerating(false);
    setMessage('');
    setLines([]);
    setLineMetadata([]);
    setSentences([]);
    setProcessedSentences({});
    setProcessingSentences({});
    setSentenceMessages({});
    setBookSummaryTitle('');
    setBookSummarySentences([]);
    setBookSummaryGeneratedAt(null);
    setCurrentPage(1);
    setCurrentReadingPosition(null);
    setActiveSentenceNotes(null);
    setActiveSentenceControls(null);
    setActiveTranslationSentence(null);
    setOllamaStreamPopup({
      visible: false,
      title: 'AI Live',
      sentenceIndex: null,
      status: 'idle',
      content: ''
    });
  }, [filename, isBookViewHint]);

  useEffect(() => (
    () => {
      closeAiPageTaskStream();
      closeTtsPageTaskStream();
    }
  ), []);

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

  useEffect(() => {
    const handleTranslationDocumentClick = (event) => {
      if (activeTranslationSentence === null) return;

      const clickedTranslationButton = event.target.closest('.sentence-btn.translation');
      if (!clickedTranslationButton) {
        setActiveTranslationSentence(null);
      }
    };

    if (activeTranslationSentence !== null) {
      document.addEventListener('click', handleTranslationDocumentClick, true);
      document.addEventListener('touchstart', handleTranslationDocumentClick, true);
    }

    return () => {
      document.removeEventListener('click', handleTranslationDocumentClick, true);
      document.removeEventListener('touchstart', handleTranslationDocumentClick, true);
    };
  }, [activeTranslationSentence]);

  useEffect(() => {
    const handleOutsideControlsClick = (event) => {
      if (activeSentenceControls === null) return;

      const clickedInsideControls = event.target.closest('.sentence-edit-controls');
      if (!clickedInsideControls) {
        setActiveSentenceControls(null);
      }
    };

    if (activeSentenceControls !== null) {
      document.addEventListener('click', handleOutsideControlsClick, true);
      document.addEventListener('touchstart', handleOutsideControlsClick, true);
    }

    return () => {
      document.removeEventListener('click', handleOutsideControlsClick, true);
      document.removeEventListener('touchstart', handleOutsideControlsClick, true);
    };
  }, [activeSentenceControls]);

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

  useEffect(() => {
    setCookie('jlptSettings', jlptSettings);
  }, [jlptSettings]);

  useEffect(() => {
    setCookie('tokenSpacing', tokenSpacing);
  }, [tokenSpacing]);

  useEffect(() => {
    setCookie('readingFontScale', readingFontScale);
  }, [readingFontScale]);

  useEffect(() => {
    setCookie('showJlptOptions', showJlptOptions);
  }, [showJlptOptions]);

  useEffect(() => {
    setCookie('showDisplayOptions', showDisplayOptions);
  }, [showDisplayOptions]);

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

  const getLineSourceStyle = (sourceLineMetadata, lineIndex) => (
    sourceLineMetadata?.[lineIndex] && typeof sourceLineMetadata[lineIndex] === 'object'
      ? sourceLineMetadata[lineIndex]
      : {}
  );

  const buildSentencesFromLines = (sourceLines, sourceLineMetadata = []) => {
    const allSentences = [];

    sourceLines.forEach((line, lineIndex) => {
      const sourceStyle = getLineSourceStyle(sourceLineMetadata, lineIndex);

      if (line.trim()) {
        const lineSentences = splitIntoSentences(line);
        lineSentences.forEach((sentence, sentenceIndexInLine) => {
          allSentences.push({
            text: sentence,
            originalLineIndex: lineIndex,
            originalLine: line,
            sourceStyle,
            sentenceIndexInLine
          });
        });
        allSentences.push({
          text: '',
          originalLineIndex: lineIndex,
          originalLine: line,
          sourceStyle,
          isLineBreak: true
        });
      } else {
        allSentences.push({
          text: '',
          originalLineIndex: lineIndex,
          originalLine: line,
          sourceStyle,
          isLineBreak: true
        });
      }
    });

    return allSentences;
  };

  const reindexAfterSentenceDelete = (indexedValues, deletedIndex) => {
    const reindexed = {};

    Object.entries(indexedValues || {}).forEach(([key, value]) => {
      const index = Number(key);
      if (!Number.isInteger(index) || index === deletedIndex) return;
      reindexed[index > deletedIndex ? index - 1 : index] = value;
    });

    return reindexed;
  };

  useEffect(() => {
    let cancelled = false;
    let autoProcessTimer = null;

    if (!filename) {
      setInitialLoadComplete(true);
      return () => {
        cancelled = true;
      };
    }

    if (!initialLoadComplete) {
      console.log('Initial load for:', filename);
      const applyFileData = (data, { fromCache = false, aiTask = null } = {}) => {
        console.log('File data loaded:', data);
        const isImportSource = data?.sourceLocation === 'imports';
        const shouldUseCompletedView = isBookViewHint || (!isImportSource && !!data.isCompletedBookView);
        setIsCompletedBookView(shouldUseCompletedView);
        setBookSummaryTitle(String(data.existingSummaryTitle || '').trim());
        setBookSummarySentences(
          Array.isArray(data.existingSummarySentences)
            ? data.existingSummarySentences.map((sentence) => String(sentence || '').trim()).filter(Boolean)
            : []
        );
        setBookSummaryGeneratedAt(data.existingSummaryGeneratedAt || null);
        setLines(data.lines);
        const loadedLineMetadata = Array.isArray(data.lineMetadata) ? data.lineMetadata : [];
        setLineMetadata(loadedLineMetadata);

        const allSentences = buildSentencesFromLines(data.lines, loadedLineMetadata);

        setSentences(allSentences);
        console.log(`Split ${data.lines.length} lines into ${allSentences.length} sentences`);

        const existingProcessedSentences = data.existingProcessedSentences || {};

        // Load existing processed sentences if available
        if (Object.keys(existingProcessedSentences).length > 0) {
          console.log('Loading existing processed sentences:', existingProcessedSentences);
          setProcessedSentences(existingProcessedSentences);
          console.log(`Loaded ${Object.keys(existingProcessedSentences).length} previously processed sentences`);
        } else {
          setProcessedSentences({});
        }

        // Load existing verb merge options if available
        if (data.existingVerbMergeOptions && Object.keys(data.existingVerbMergeOptions).length > 0) {
          setVerbMergeOptions(prev => ({
            ...prev,
            ...data.existingVerbMergeOptions
          }));
          console.log('Loaded existing verb merge options:', data.existingVerbMergeOptions);
        }

        setInitialLoadComplete(true);

        // Only auto-process if there are unprocessed sentences
        const unprocessedCount = allSentences.filter((s, i) => !s.isLineBreak && !existingProcessedSentences[i]).length;
        if (aiTask?.status === 'running') {
          applyAiPageTaskSnapshot(aiTask);
          attachAiPageTaskStream(filename);
        } else if (fromCache) {
          setMessage('Offline mode: loaded cached text from this device.');
        } else if (unprocessedCount > 0) {
          console.log(`Found ${unprocessedCount} unprocessed sentences, starting auto-processing...`);
          autoProcessTimer = setTimeout(() => {
            if (!cancelled) {
              autoProcessAllSentences(allSentences);
            }
          }, 100);
        } else {
          console.log('All sentences already processed, skipping auto-processing');
          setMessage('All sentences already processed - ready for reading!');
          setTimeout(() => setMessage(''), 3000);
        }
      };

      const loadFileData = async () => {
        try {
          const res = await axios.get(`/api/import/${filename}`);
          let aiTask = null;
          try {
            const taskResponse = await axios.get(`/api/import/${filename}/ai-page-task`);
            aiTask = taskResponse.data?.task || null;
          } catch (taskError) {
            if (taskError.response?.status !== 404) {
              console.warn('Failed to load AI page task status during initial load:', taskError);
            }
          }
          await cacheImportPayload(filename, res.data);
          if (!cancelled) {
            applyFileData(res.data, { aiTask });
          }
        } catch (error) {
          const cachedData = await getCachedImportPayload(filename);
          if (cancelled) return;

          if (cachedData) {
            applyFileData(cachedData, { fromCache: true });
            return;
          }

          console.error('Error loading file data:', error);
          setIsCompletedBookView(isBookViewHint);
          setBookSummaryTitle('');
          setBookSummarySentences([]);
          setBookSummaryGeneratedAt(null);
          setMessage('This text is not cached on this device yet.');
          setInitialLoadComplete(true);
        }
      };

      loadFileData();
    }

    return () => {
      cancelled = true;
      if (autoProcessTimer) {
        clearTimeout(autoProcessTimer);
      }
    };
  }, [filename, initialLoadComplete, isBookViewHint]);

  useEffect(() => {
    let cancelled = false;

    if (!filename || !initialLoadComplete) {
      return () => {
        cancelled = true;
      };
    }

    const syncAiPageTask = async () => {
      try {
        const response = await axios.get(`/api/import/${filename}/ai-page-task`);
        if (cancelled) return;

        const task = response.data?.task || null;
        if (task) {
          applyAiPageTaskSnapshot(task);
          if (task.status === 'running') {
            attachAiPageTaskStream(filename);
          } else {
            closeAiPageTaskStream();
          }
          return;
        }

        closeAiPageTaskStream();
        setPageAiProcessing(false);
        setProcessingSentences({});
      } catch (error) {
        if (cancelled) return;
        if (error.response?.status !== 404) {
          console.warn('Failed to load AI page task status:', error);
        }
        closeAiPageTaskStream();
        setPageAiProcessing(false);
        setProcessingSentences({});
      }
    };

    syncAiPageTask();

    return () => {
      cancelled = true;
    };
  }, [filename, initialLoadComplete]);

  useEffect(() => {
    let cancelled = false;

    if (!filename || !initialLoadComplete) {
      return () => {
        cancelled = true;
      };
    }

    const syncTtsPageTask = async () => {
      try {
        const response = await axios.get(`/api/text-to-speech/draft/${filename}/page-task`);
        if (cancelled) return;

        const task = response.data?.task || null;
        if (task) {
          applyTtsPageTaskSnapshot(task);
          if (task.status === 'running') {
            attachTtsPageTaskStream(filename);
          } else {
            closeTtsPageTaskStream();
          }
          return;
        }

        closeTtsPageTaskStream();
        setPageTtsGenerating(false);
        setTtsGeneratingSentences({});
      } catch (error) {
        if (cancelled) return;
        if (error.response?.status !== 404) {
          console.warn('Failed to load audio page task status:', error);
        }
        closeTtsPageTaskStream();
        setPageTtsGenerating(false);
        setTtsGeneratingSentences({});
      }
    };

    syncTtsPageTask();

    return () => {
      cancelled = true;
    };
  }, [filename, initialLoadComplete]);

  const handleFileChange = e => setFile(e.target.files[0]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/import', formData);

      if (res.data.autoProcessed) {
        setMessage(`Draft created: ${res.data.originalname} (${res.data.processedLines}/${res.data.totalLines} lines processed)`);
      } else if (res.data.error) {
        setMessage(`Draft created: ${res.data.originalname} - ${res.data.error}`);
      } else {
        setMessage(`Draft created: ${res.data.originalname}`);
      }

      navigate('/import/' + encodeURIComponent(res.data.filename));
    } catch (err) {
      setMessage('Draft creation failed');
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
    setMessage('Creating draft from article...');

    try {
      const res = await axios.post('/api/import/url', { url: trimmedUrl });
      setMessage(`Draft created: ${res.data.originalname || trimmedUrl} (${res.data.totalLines} lines)`);
      setArticleUrl('');
      navigate('/import/' + encodeURIComponent(res.data.filename));
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'URL import failed';
      const details = err.response?.data?.details;
      setMessage(details ? `${errorMessage}: ${details}` : errorMessage);
    } finally {
      setUrlImporting(false);
    }
  };

  const handleTextToSpeech = async (sentenceIndex, withTimings = false, options = {}) => {
    const sentence = sentences[sentenceIndex];
    if (!sentence || sentence.isLineBreak) return false;
    const waitForEnd = Boolean(options.waitForEnd);

    console.log('Text-to-speech button clicked for sentence index:', sentenceIndex);
    console.log('Sentence text:', sentence.text);
    console.log('With timings:', withTimings);

    // Auto-save bookmark when user interacts with sentence
    saveReadingBookmark(sentenceIndex);

    setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: '' }));
    setTtsGeneratingSentences(prev => ({ ...prev, [sentenceIndex]: true }));
    const playbackRate = Math.max(0.25, Math.min(4, Number(ttsOptions.speed) || 1));
    const playbackDelay = (seconds) => (seconds * 1000) / playbackRate;
    const speechTags = Array.isArray(processedSentences[sentenceIndex]?.speechTags)
      ? processedSentences[sentenceIndex].speechTags
      : [];

    try {
      if (withTimings) {
        // Request audio with VoiceVox timing data using TTS options
        const response = await axios.post('/api/text-to-speech', {
          text: sentence.text,
          speaker: ttsOptions.speaker,
          speechTags,
          speed: ttsOptions.speed,
          volume: ttsOptions.volume,
          includeTimings: true
        });

        console.log('Received audio and timing response from server');
        const { audio, timings, audioFormat, sampleRate, alignmentProvider } = response.data;
        const usesMeasuredTimings = ['mfa', 'qwen3', 'qwen', 'qwen-aligner'].includes(String(alignmentProvider || '').toLowerCase());
        const effectiveTimingStretch = usesMeasuredTimings ? 1 : ttsOptions.timingStretch;
        const effectiveCommaPauseDuration = usesMeasuredTimings ? 0 : ttsOptions.commaPauseDuration;

        // Log timing info for debugging
        console.log(`[TTS] Using ${alignmentProvider || 'provider'} timing data`);
        console.log(`[TTS] Timing points: ${timings.length}`);

        // Log original VoiceVox timings in a readable format
        console.log('=== ORIGINAL TTS TIMINGS ===');
        console.log('Mora | Text | Start-End | Duration');
        timings.forEach((timing, i) => {
          const text = timing.text || timing.mora || '';
          const duration = timing.endTime - timing.startTime;
          console.log(`${i.toString().padStart(2, '0')} | ${text.padEnd(4)} | ${timing.startTime.toFixed(3)}-${timing.endTime.toFixed(3)}s | ${duration.toFixed(3)}s`);
        });
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
        audioElement.volume = Math.max(0, Math.min(1, Number(ttsOptions.volume) || 1));
        audioElement.playbackRate = playbackRate;
        const audioFinished = waitForEnd
          ? new Promise((resolve) => {
              let resolved = false;
              const finish = () => {
                if (resolved) return;
                resolved = true;
                resolve();
              };
              audioElement.addEventListener('ended', finish, { once: true });
              audioElement.addEventListener('pause', finish, { once: true });
              audioElement.addEventListener('abort', finish, { once: true });
              audioElement.addEventListener('error', finish, { once: true });
            })
          : null;

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
                speechTags: getSpeechTagsFromResponse(response.data),
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
              audioElement.addEventListener('ended', () => {
                URL.revokeObjectURL(audioUrl);
              });
              await audioElement.play();
              if (audioFinished) await audioFinished;
              return true;
            }
          } catch (error) {
            console.error('Auto-processing error:', error);
            console.warn('Auto-processing failed, playing audio without highlighting');
            audioElement.addEventListener('ended', () => {
              URL.revokeObjectURL(audioUrl);
            });
            await audioElement.play();
            if (audioFinished) await audioFinished;
            return true;
          }
        }

        // Use VOICEVOX timing data to synchronize highlighting with actual audio
        const mapTimingsToTokens = (timings, tokens) => {
          console.log('[TIMING] Starting TTS timing mapping');
          console.log('[TIMING] Original text:', sentence.text);
          console.log('[TIMING] All tokens:', tokens.map((t, i) => `${i}:${t.surface}(${t.pos})`));
          console.log('[TIMING] TTS timings:', timings.length, 'entries');

          // Show detailed VOICEVOX timing data
          console.log('[TIMING] === TTS TIMING POINTS ===');
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
            console.log('[TIMING] No TTS timings available, using fallback');
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

          // Use actual TTS timing data
          const audioStartTime = timings[0].startTime;
          const audioEndTime = timings[timings.length - 1].endTime;
          const totalDuration = audioEndTime - audioStartTime;

          console.log(`[TIMING] TTS audio: ${audioStartTime.toFixed(3)}s - ${audioEndTime.toFixed(3)}s (${totalDuration.toFixed(3)}s total)`);

          // Create a mapping from text positions to timing data
          const textToTimingMap = new Map();
          let currentTextPos = 0;

          // Build a map of text positions to TTS timings
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
              // Use actual TTS timing
              startTime = Math.min(...overlappingTimings.map(t => t.startTime));
              endTime = Math.max(...overlappingTimings.map(t => t.endTime));
              rawDuration = endTime - startTime;

              console.log(`[TIMING] Token "${token.surface}" raw TTS timing: ${startTime.toFixed(3)}-${endTime.toFixed(3)}s (${rawDuration.toFixed(3)}s)`);
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
              hasTtsTiming: overlappingTimings.length > 0
            });
          });

          const tokenTimings = [];

          if (usesMeasuredTimings) {
            rawTokenTimings.forEach((timing) => {
              tokenTimings.push({
                tokenIndex: timing.tokenIndex,
                startTime: timing.startTime,
                endTime: timing.endTime,
                token: timing.token,
                sequenceIndex: timing.sequenceIndex,
                hasTtsTiming: timing.hasTtsTiming
              });
            });
          } else {
            // Second pass: ensure sequential non-overlapping timings for estimated timings.
            let currentTime = rawTokenTimings[0]?.startTime || 0;

            rawTokenTimings.forEach((timing) => {
              const startTime = currentTime;
              const stretchedDuration = timing.rawDuration * effectiveTimingStretch;
              const endTime = startTime + stretchedDuration;

              currentTime = endTime;

              console.log(`[TIMING] Token "${timing.token}" sequential timing: ${startTime.toFixed(3)}-${endTime.toFixed(3)}s (stretched by ${effectiveTimingStretch}x)`);

              tokenTimings.push({
                tokenIndex: timing.tokenIndex,
                startTime,
                endTime,
                token: timing.token,
                sequenceIndex: timing.sequenceIndex,
                hasTtsTiming: timing.hasTtsTiming
              });
            });
          }

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
                console.log(`[TIMING] Adding ${effectiveCommaPauseDuration}s pause after comma before token "${tokens[nextTokenIndex].surface}"`);

                // Shift all subsequent timings by the pause duration
                for (let i = nextTimingIndex; i < tokenTimings.length; i++) {
                  tokenTimings[i].startTime += effectiveCommaPauseDuration;
                  tokenTimings[i].endTime += effectiveCommaPauseDuration;
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
            const originalDuration = duration / effectiveTimingStretch;
            console.log(`${t.sequenceIndex.toString().padStart(2, '0')} | ${t.token.padEnd(4)} | ${t.startTime.toFixed(3)}-${t.endTime.toFixed(3)}s | ${duration.toFixed(3)}s | ${effectiveTimingStretch}x`);
          });

          console.log('[TIMING] Final token timings (after comma pauses):');
          tokenTimings.forEach(t => {
            console.log(`  ${t.sequenceIndex}: "${t.token}" ${t.startTime.toFixed(3)}-${t.endTime.toFixed(3)}s ${t.hasTtsTiming ? '(TTS)' : '(fallback)'}`);
          });

          return tokenTimings;
        };

        const tokenTimings = mapTimingsToTokens(timings, processedSentence.tokens);
        console.log('Token timings:', tokenTimings);

        let highlightAnimationFrame = null;

        const applyHighlight = (tokenTiming) => {
          if (currentHighlight) {
            currentHighlight.style.backgroundColor = 'transparent';
            currentHighlight.style.color = '';
          }

          if (!tokenTiming) {
            currentHighlight = null;
            return;
          }

          const tokenElement = document.querySelector(`[data-token="${sentenceIndex}-${tokenTiming.tokenIndex}"]`);
          if (tokenElement) {
            tokenElement.style.backgroundColor = '#ffeb3b';
            tokenElement.style.color = '#000';
            tokenElement.style.transition = 'background-color 0.1s ease, color 0.1s ease';
            tokenElement.style.borderRadius = '4px';
            currentHighlight = tokenElement;
          }
        };

        const stopHighlightLoop = () => {
          if (highlightAnimationFrame !== null) {
            cancelAnimationFrame(highlightAnimationFrame);
            highlightAnimationFrame = null;
          }
        };

        const updateHighlightFromAudioClock = () => {
          const currentTime = audioElement.currentTime;
          const activeTiming = tokenTimings.find((tokenTiming) => (
            currentTime >= tokenTiming.startTime &&
            currentTime < tokenTiming.endTime
          ));

          const currentTokenIndex = currentHighlight?.dataset?.token;
          const nextTokenIndex = activeTiming ? `${sentenceIndex}-${activeTiming.tokenIndex}` : null;

          if (currentTokenIndex !== nextTokenIndex) {
            applyHighlight(activeTiming);
          }

          if (!audioElement.paused && !audioElement.ended) {
            highlightAnimationFrame = requestAnimationFrame(updateHighlightFromAudioClock);
          }
        };

        // Clear highlights when audio ends
        audioElement.addEventListener('ended', () => {
          stopHighlightLoop();
          clearHighlights();
          URL.revokeObjectURL(audioUrl);
        });

        // Clear highlights if audio is paused/stopped
        audioElement.addEventListener('pause', () => {
          stopHighlightLoop();
          clearHighlights();
        });
        audioElement.addEventListener('abort', () => {
          stopHighlightLoop();
          clearHighlights();
        });

        audioElement.addEventListener('playing', () => {
          stopHighlightLoop();
          updateHighlightFromAudioClock();
        });

        await audioElement.play();
        if (audioFinished) await audioFinished;

      } else {
        // Original behavior - audio only
        const response = await axios.post('/api/text-to-speech', {
          text: sentence.text,
          speechTags,
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
        audio.volume = Math.max(0, Math.min(1, Number(ttsOptions.volume) || 1));
        audio.playbackRate = playbackRate;
        const audioFinished = waitForEnd
          ? new Promise((resolve) => {
              let resolved = false;
              const finish = () => {
                if (resolved) return;
                resolved = true;
                resolve();
              };
              audio.addEventListener('ended', finish, { once: true });
              audio.addEventListener('pause', finish, { once: true });
              audio.addEventListener('abort', finish, { once: true });
              audio.addEventListener('error', finish, { once: true });
            })
          : null;
        await audio.play();

        // Clean up the object URL after playing
        audio.addEventListener('ended', () => {
          URL.revokeObjectURL(audioUrl);
        });
        if (audioFinished) await audioFinished;
      }

      // Clear message after successful generation
      setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: '' }));
      return true;

    } catch (error) {
      console.error('Text-to-speech error:', error);

      let errorMessage = 'Speech generation failed';
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        errorMessage = 'Server not running. Please start the server with "npm run dev" in the bookparser directory.';
      } else if (error.response?.status === 503) {
        errorMessage = 'Cannot connect to speech engine';
      } else if (error.response?.status === 502) {
        errorMessage = 'Speech engine error';
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
      return false;
    } finally {
      setTtsGeneratingSentences(prev => {
        const updated = { ...prev };
        delete updated[sentenceIndex];
        return updated;
      });
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
          speechTags: getSpeechTagsFromResponse(responseData),
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

  const handleJlptOptionChange = (option, value) => {
    setJlptSettings(prev => ({
      ...prev,
      [option]: value
    }));
  };

  const handleReadingFontScaleChange = (delta) => {
    setReadingFontScale((current) => clampReadingFontScale(current + delta));
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
      await updateCachedImportSentence(filename, sentenceIndex, sentenceData, verbMergeOptions);
      console.log(`Auto-saved sentence ${sentenceIndex}`);
      return true;
    } catch (error) {
      console.error('Auto-save error:', error);
      return false;
    }
  };

  const handleDeleteSentence = async (sentenceIndex) => {
    if (!filename || isCompletedBookView) return;

    const sentence = sentences[sentenceIndex];
    if (!sentence || sentence.isLineBreak) return;

    const confirmed = window.confirm(`Delete this sentence?\n\n${sentence.text}`);
    if (!confirmed) return;

    try {
      const lineIndex = sentence.originalLineIndex;
      const updatedLines = [...lines];
      const lineSentences = splitIntoSentences(updatedLines[lineIndex] || '');
      const sentenceIndexInLine = Number.isInteger(sentence.sentenceIndexInLine)
        ? sentence.sentenceIndexInLine
        : sentences
          .slice(0, sentenceIndex)
          .filter((candidate) => !candidate.isLineBreak && candidate.originalLineIndex === lineIndex)
          .length;

      if (sentenceIndexInLine < 0 || sentenceIndexInLine >= lineSentences.length) {
        throw new Error('Could not locate sentence in source line');
      }

      lineSentences.splice(sentenceIndexInLine, 1);
      updatedLines[lineIndex] = lineSentences.join('');

      const updatedProcessedSentences = reindexAfterSentenceDelete(processedSentences, sentenceIndex);
      const updatedSentences = buildSentencesFromLines(updatedLines, lineMetadata);

      await axios.delete(`/api/import/${filename}/sentence/${sentenceIndex}`, {
        data: {
          originalLines: updatedLines,
          lineMetadata,
          processedSentences: updatedProcessedSentences,
          verbMergeOptions,
          timestamp: new Date().toISOString()
        }
      });

      setLines(updatedLines);
      setSentences(updatedSentences);
      setProcessedSentences(updatedProcessedSentences);
      setProcessingSentences(prev => reindexAfterSentenceDelete(prev, sentenceIndex));
      setSentenceMessages(prev => reindexAfterSentenceDelete(prev, sentenceIndex));
      setActiveSentenceNotes(prev => {
        if (prev === null || prev === sentenceIndex) return null;
        return prev > sentenceIndex ? prev - 1 : prev;
      });
      setCurrentReadingPosition(prev => {
        if (prev === null || prev === sentenceIndex) return null;
        return prev > sentenceIndex ? prev - 1 : prev;
      });

      const nextTotalSentences = updatedSentences.filter(s => !s.isLineBreak).length;
      const nextTotalPages = Math.max(1, Math.ceil(nextTotalSentences / sentencesPerPage));
      setCurrentPage(prev => Math.min(prev, nextTotalPages));
      setMessage('Sentence deleted.');
      setTimeout(() => setMessage(''), 2500);
    } catch (error) {
      console.error('Delete sentence error:', error);
      setSentenceMessages(prev => ({
        ...prev,
        [sentenceIndex]: `Error: ${error.response?.data?.error || error.message || 'Failed to delete sentence'}`
      }));
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
            speechTags: getSpeechTagsFromResponse(response.data),
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
              speechTags: getSpeechTagsFromResponse(response.data),
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

    if (ollamaStatus.checking || !ollamaStatus.available) {
      setMessage(`AI processing unavailable: ${ollamaStatus.message}`);
      return;
    }

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

    const sentenceRequests = pageSentenceEntries
      .map((entry) => ({
        sentenceIndex: entry.originalIndex,
        text: sentences[entry.originalIndex]?.text || ''
      }))
      .filter((entry) => entry.text.trim());

    const allSentenceTexts = sentences.map((s) => s.text);

    try {
      const response = await axios.post(`/api/import/${filename}/ai-page-task`, {
        currentPage,
        sentenceRequests,
        allSentences: allSentenceTexts,
        verbMergeOptions,
        frequencySettings
      });

      const task = response.data?.task || null;
      if (task) {
        applyAiPageTaskSnapshot(task);
        attachAiPageTaskStream(filename);
      }
    } catch (error) {
      console.error('Failed to start AI page task:', error);
      setPageAiProcessing(false);
      setProcessingSentences({});
      setMessage(error.response?.data?.error || error.message || 'Failed to start AI page processing');
    }
  };

  const handleGenerateAudioForCurrentPage = async () => {
    if (pageTtsGenerating || pageTtsPlaying) return;

    const pageSentenceEntries = paginatedSentences.filter((entry) => !entry.isLineBreak);
    const sentenceIndexesToGenerate = pageSentenceEntries
      .map((entry) => entry.originalIndex)
      .filter((sentenceIndex) => sentences[sentenceIndex]?.text?.trim());
    const totalPageSentences = sentenceIndexesToGenerate.length;

    if (totalPageSentences === 0) {
      setMessage('No sentences on this page to generate audio for');
      return;
    }

    const confirmed = window.confirm(
      `Generate and cache audio for all ${totalPageSentences} sentences on page ${currentPage}?`
    );
    if (!confirmed) return;

    const sentenceRequests = sentenceIndexesToGenerate.map((sentenceIndex) => ({
      sentenceIndex,
      text: sentences[sentenceIndex]?.text || '',
      speechTags: Array.isArray(processedSentences[sentenceIndex]?.speechTags)
        ? processedSentences[sentenceIndex].speechTags
        : []
    }));

    try {
      const response = await axios.post(`/api/text-to-speech/draft/${filename}/page-task`, {
        currentPage,
        sentenceRequests,
        ttsOptions: {
          speaker: ttsOptions.speaker,
          speed: ttsOptions.speed,
          volume: ttsOptions.volume
        }
      });

      const task = response.data?.task || null;
      if (task) {
        applyTtsPageTaskSnapshot(task);
        attachTtsPageTaskStream(filename);
      }
    } catch (error) {
      console.error('Failed to start audio page task:', error);
      setPageTtsGenerating(false);
      setTtsGeneratingSentences({});
      setMessage(error.response?.data?.error || error.message || 'Failed to start page audio generation');
    }
  };

  const handleReadCurrentPage = async () => {
    if (pageTtsPlaying || pageTtsGenerating) return;

    const pageSentenceEntries = paginatedSentences.filter((entry) => !entry.isLineBreak);
    const sentenceIndexesToRead = pageSentenceEntries
      .map((entry) => entry.originalIndex)
      .filter((sentenceIndex) => sentences[sentenceIndex]?.text?.trim());
    const totalPageSentences = sentenceIndexesToRead.length;

    if (totalPageSentences === 0) {
      setMessage('No sentences on this page to read');
      return;
    }

    const confirmed = window.confirm(
      `Read all ${totalPageSentences} sentences on page ${currentPage}?`
    );
    if (!confirmed) return;

    const runId = pageTtsPlayRunRef.current + 1;
    pageTtsPlayRunRef.current = runId;
    const isCurrentRun = () => pageTtsPlayRunRef.current === runId;

    setPageTtsPlaying(true);
    setMessage(`Reading page ${currentPage}: 0/${totalPageSentences}`);

    let playedCount = 0;
    let errorCount = 0;

    try {
      for (const sentenceIndex of sentenceIndexesToRead) {
        if (!isCurrentRun()) return;

        const sentenceElement = document.querySelector(`[data-sentence="${sentenceIndex}"]`);
        sentenceElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setMessage(`Reading page ${currentPage}: ${playedCount + errorCount + 1}/${totalPageSentences}`);
        const played = await handleTextToSpeech(sentenceIndex, true, { waitForEnd: true });

        if (played) {
          playedCount++;
        } else {
          errorCount++;
        }
      }

      if (!isCurrentRun()) return;

      setMessage(
        errorCount > 0
          ? `Page reading done: ${playedCount} played, ${errorCount} errors`
          : `Page reading done: ${playedCount} sentences`
      );
      setTimeout(() => {
        setMessage('');
      }, 6000);
    } finally {
      if (isCurrentRun()) {
        setPageTtsPlaying(false);
      }
    }
  };

  const handleGenerateSummary = async () => {
    if (!filename || isGeneratingSummary) return;

    setIsGeneratingSummary(true);
    setMessage('Generating title + 3-sentence summary with AI...');

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
        lineMetadata,
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
      setMessage('Moved to reading.');
    } catch (error) {
      console.error('Save error:', error);
      setMessage('Save failed');
    }
  };

  const getSentenceSourceClassName = (sentence) => {
    const style = sentence?.sourceStyle || {};
    const classes = [];

    if (style.block === 'heading') {
      classes.push('source-heading');
      const headingLevel = Number.parseInt(style.headingLevel, 10);
      if (Number.isInteger(headingLevel)) {
        classes.push(`source-heading-${Math.min(6, Math.max(1, headingLevel))}`);
      }
    }

    if (style.bold) {
      classes.push('source-bold');
    }

    return classes.join(' ');
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
        if (
          note.type === 'jlptGrammar' &&
          jlptSettings.hideKnownGrammar !== false &&
          note.jlptLevel &&
          jlptSettings.knownLevel &&
          JLPT_LEVEL_RANK[note.jlptLevel] <= JLPT_LEVEL_RANK[jlptSettings.knownLevel]
        ) {
          continue;
        }
      }

      const normalized = String(text).replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({
        text: normalized,
        type: typeof note === 'object' && note ? note.type || 'note' : 'note'
      });
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
  const displayTitle = String(bookSummaryTitle || '').trim() || filename;
  const visibleMessage = !filename && /^AI (processing page|page processing)/i.test(message)
    ? ''
    : message;
  const readingFontSize = `clamp(${(1.24 * readingFontScale).toFixed(2)}rem, ${(0.9 * readingFontScale).toFixed(2)}vw + ${(1 * readingFontScale).toFixed(2)}rem, ${(1.58 * readingFontScale).toFixed(2)}rem)`;
  const readingMobileFontSize = `${readingFontScale.toFixed(2)}rem`;
  const aiPageDisabled = pageAiProcessing;
  const aiPageTitle = ollamaStatus.available
    ? 'Run remote AI processing for all sentences on this page'
    : `AI engine unavailable: ${ollamaStatus.message}`;
  const pageTtsTitle = pageTtsGenerating
    ? 'Generating audio for this page'
    : 'Generate and cache TTS audio for every sentence on this page';
  const pageReadTitle = pageTtsPlaying
    ? 'Reading this page'
    : 'Read every sentence on this page in order';

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      // Scroll to top when changing pages
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="container">
      <h2>Drafts</h2>
      {!filename && (
        <div className="import-source-panel">
          <div className="import-source-row">
            <input type="file" ref={fileInput} onChange={handleFileChange} accept=".txt" />
            <button onClick={handleUpload} disabled={uploading} className="btn">
              {uploading ? 'Creating...' : 'Create Draft'}
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
              {urlImporting ? 'Creating...' : 'Create from URL'}
            </button>
          </div>
        </div>
      )}
      {filename && (
        <div>
          <h3 className="import-file-heading">
            <span className="import-display-title">{displayTitle}</span>
            <span className="import-file-name">{filename}</span>
          </h3>
          {bookSummarySentences.length > 0 && (
            <div className="import-summary-note">
              <div className="import-summary-title">Reading Summary (3 sentences)</div>
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
          <div className="controls-section">
            {!isCompletedBookView && (
              <button onClick={handleSave} className="btn">Move to Reading</button>
            )}
            {!isCompletedBookView && (
              <button
                onClick={handleRunAiForCurrentPage}
                className="btn"
                style={{ backgroundColor: aiPageDisabled ? '#64748b' : '#1d4ed8' }}
                disabled={aiPageDisabled}
                title={aiPageTitle}
              >
                {pageAiProcessing ? 'AI Page Running...' : `AI This Page (${currentPage})`}
              </button>
            )}
            <button
              onClick={handleGenerateAudioForCurrentPage}
              className="btn"
              style={{ backgroundColor: pageTtsGenerating ? '#64748b' : '#0f766e' }}
              disabled={pageTtsGenerating || pageTtsPlaying}
              title={pageTtsTitle}
            >
              {pageTtsGenerating ? 'Audio Page Running...' : `Audio This Page (${currentPage})`}
            </button>
            <button
              onClick={handleReadCurrentPage}
              className="btn"
              style={{ backgroundColor: pageTtsPlaying ? '#64748b' : '#b45309' }}
              disabled={pageTtsPlaying || pageTtsGenerating}
              title={pageReadTitle}
            >
              {pageTtsPlaying ? 'Reading Page...' : `Read This Page (${currentPage})`}
            </button>
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
              title="Generate a title and 3-sentence summary"
            >
              {isGeneratingSummary ? 'Summarizing...' : 'Generate Summary'}
            </button>
            <button
              onClick={() => setShowTtsOptions(!showTtsOptions)}
              className="btn option-toggle"
            >
              {showTtsOptions ? 'Hide' : 'Show'} TTS Options
            </button>
            <button
              onClick={() => setShowVerbOptions(!showVerbOptions)}
              className="btn option-toggle"
            >
              {showVerbOptions ? 'Hide' : 'Show'} Verb Options
            </button>
            <button
              onClick={() => setShowFrequencyOptions(!showFrequencyOptions)}
              className="btn option-toggle"
            >
              {showFrequencyOptions ? 'Hide' : 'Show'} Frequency Options
            </button>
            <button
              onClick={() => setShowJlptOptions(!showJlptOptions)}
              className="btn option-toggle"
            >
              {showJlptOptions ? 'Hide' : 'Show'} JLPT Grammar
            </button>
            <button
              onClick={() => setShowDisplayOptions(!showDisplayOptions)}
              className="btn option-toggle"
            >
              {showDisplayOptions ? 'Hide' : 'Show'} Display Options
            </button>
          </div>

          {showDisplayOptions && (
            <div className="options-panel">
              <h4>Display Options</h4>

              <div className="display-options-grid">
                <label className="display-option-group">
                  <span>Spaces</span>
                  <select
                    value={tokenSpacing}
                    onChange={(event) => setTokenSpacing(event.target.value)}
                  >
                    <option value={TOKEN_SPACING.AFTER_WORDS_PARTICLES}>After words, particles</option>
                    <option value={TOKEN_SPACING.NONE}>None</option>
                  </select>
                </label>

                <div className="display-option-group">
                  <span>Text size</span>
                  <div className="font-size-controls">
                    <button
                      type="button"
                      className="font-size-btn"
                      onClick={() => handleReadingFontScaleChange(-READING_FONT_SCALE.STEP)}
                      disabled={readingFontScale <= READING_FONT_SCALE.MIN}
                      aria-label="Decrease reading text size"
                      title="Decrease reading text size"
                    >
                      -
                    </button>
                    <span className="font-size-value">
                      {Math.round(readingFontScale * 100)}%
                    </span>
                    <button
                      type="button"
                      className="font-size-btn"
                      onClick={() => handleReadingFontScaleChange(READING_FONT_SCALE.STEP)}
                      disabled={readingFontScale >= READING_FONT_SCALE.MAX}
                      aria-label="Increase reading text size"
                      title="Increase reading text size"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
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

          {showJlptOptions && (
            <div className="options-panel">
              <h4>JLPT Grammar</h4>

              <div className="jlpt-options-grid">
                <label className="jlpt-option-group">
                  <span>Your level</span>
                  <select
                    value={jlptSettings.knownLevel}
                    onChange={(e) => handleJlptOptionChange('knownLevel', e.target.value)}
                  >
                    <option value="">None</option>
                    <option value="N5">N5</option>
                    <option value="N4">N4</option>
                    <option value="N3">N3</option>
                    <option value="N2">N2</option>
                    <option value="N1">N1</option>
                  </select>
                </label>

                <label className="jlpt-option-label">
                  <input
                    type="checkbox"
                    checked={jlptSettings.showGrammar !== false}
                    onChange={(e) => handleJlptOptionChange('showGrammar', e.target.checked)}
                  />
                  Show JLPT grammar markers
                </label>

                <label className="jlpt-option-label">
                  <input
                    type="checkbox"
                    checked={jlptSettings.hideKnownGrammar !== false}
                    onChange={(e) => handleJlptOptionChange('hideKnownGrammar', e.target.checked)}
                    disabled={!jlptSettings.knownLevel || jlptSettings.showGrammar === false}
                  />
                  Hide known grammar
                </label>
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
                  className="btn pagination-btn pagination-edge"
                  title="First page"
                  aria-label="First page"
                >
                  &lt;&lt;
                </button>
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="btn pagination-btn pagination-step"
                  title="Previous page"
                  aria-label="Previous page"
                >
                  &lt;
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
                        className={`btn pagination-btn pagination-page ${currentPage === pageNum ? 'active' : ''}`}
                        aria-label={`Page ${pageNum}`}
                        aria-current={currentPage === pageNum ? 'page' : undefined}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </span>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="btn pagination-btn pagination-step"
                  title="Next page"
                  aria-label="Next page"
                >
                  &gt;
                </button>
                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage === totalPages}
                  className="btn pagination-btn pagination-edge"
                  title="Last page"
                  aria-label="Last page"
                >
                  &gt;&gt;
                </button>
              </div>
            </>
          )}

          <div
            className="import-content"
            style={{
              '--reading-font-size': readingFontSize,
              '--reading-mobile-font-size': readingMobileFontSize
            }}
          >
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
          const showSentenceControls = sentence.text.trim() !== '」';
          const hasEditControls = !isCompletedBookView || hasSentenceNotes;
          const editControlsOpen = activeSentenceControls === sentenceIndex;
          const isGeneratingSpeech = Boolean(ttsGeneratingSentences[sentenceIndex]);
          const sentenceSourceClassName = getSentenceSourceClassName(sentence);
          const sentenceContainerClassName = ['sentence-container', sentenceSourceClassName]
            .filter(Boolean)
            .join(' ');
          const sentenceTextClassName = ['sentence-text', sentenceSourceClassName]
            .filter(Boolean)
            .join(' ');

              return (
                <span key={sentenceIndex} className={sentenceContainerClassName}>
                  {showSentenceControls && (
                    <span className="sentence-leading-controls">
                      <button
                        onClick={() => handleTextToSpeech(sentenceIndex, true)}
                        className={`sentence-btn play ${isGeneratingSpeech ? 'generating' : ''}`}
                        title={isGeneratingSpeech ? 'Generating audio' : 'Play sentence'}
                        aria-label={isGeneratingSpeech ? 'Generating audio' : 'Play sentence'}
                        aria-busy={isGeneratingSpeech}
                        disabled={isGeneratingSpeech}
                      >
                        ▶
                      </button>
                    </span>
                  )}

                  {isProcessed ? (
                    <span data-sentence={sentenceIndex} className={sentenceSourceClassName || undefined}>
                      <TokenizedText
                        tokens={isProcessed.tokens}
                        sentenceIndex={sentenceIndex}
                        isCurrentReading={isCurrentReading}
                        onBookmark={saveReadingBookmark}
                        jlptSettings={jlptSettings}
                        tokenSpacing={tokenSpacing}
                      />
                    </span>
                  ) : (
                    <span
                      data-sentence={sentenceIndex}
                      className={sentenceTextClassName}
                    >
                      {renderSentenceTextWithBookmark(sentence.text, isCurrentReading)}
                    </span>
                  )}

                  {showSentenceControls && (
                    <span className="sentence-controls">
                      {hasRemoteTranslation && (
                        <button
                          onClick={() => {
                            saveReadingBookmark(sentenceIndex);
                            setActiveTranslationSentence((prev) => (prev === sentenceIndex ? null : sentenceIndex));
                          }}
                          className={`sentence-btn translation ${activeTranslationSentence === sentenceIndex ? 'active' : ''}`}
                          title="Show sentence translation"
                          aria-label="Show sentence translation"
                          aria-expanded={activeTranslationSentence === sentenceIndex}
                        >
                          訳
                        </button>
                      )}

                      {hasEditControls && (
                        <span className="sentence-edit-controls">
                          <button
                            onClick={() => setActiveSentenceControls((prev) => (prev === sentenceIndex ? null : sentenceIndex))}
                            className={`sentence-btn edit ${editControlsOpen ? 'active' : ''}`}
                            title="Toggle sentence edit controls"
                            aria-label="Toggle sentence edit controls"
                            aria-expanded={editControlsOpen}
                          >
                            ⋯
                          </button>

                          {editControlsOpen && (
                            <span className="sentence-edit-menu">
                              {hasSentenceNotes && (
                                <button
                                  onClick={() => {
                                    saveReadingBookmark(sentenceIndex);
                                    setActiveSentenceNotes((prev) => (prev === sentenceIndex ? null : sentenceIndex));
                                  }}
                                  className="sentence-btn notes"
                                  title="Show sentence notes"
                                  aria-label="Show sentence notes"
                                >
                                  注
                                </button>
                              )}

                              {!isCompletedBookView && (
                                <button
                                  onClick={() => {
                                    setActiveSentenceControls(null);
                                    handleDeleteSentence(sentenceIndex);
                                  }}
                                  className="sentence-btn delete"
                                  title="Delete sentence"
                                  aria-label="Delete sentence"
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  )}

                  {/* Only error messages are shown as text now */}
                  {sentenceMessages[sentenceIndex] && (
                    <span className="sentence-status error">
                      {sentenceMessages[sentenceIndex]}
                    </span>
                  )}

                  {/* Translation popup */}
                  {hasRemoteTranslation && activeTranslationSentence === sentenceIndex && (
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
                        onClick={() => setActiveTranslationSentence(null)}
                        className="translation-popup-close"
                        aria-label="Close translation"
                      >
                        ×
                      </button>
                    </div>
                  )}

                  {hasSentenceNotes && activeSentenceNotes === sentenceIndex && (
                    <div className="sentence-notes-popup">
                      <div className="sentence-notes-title">Notes</div>
                      {sentenceNoteLines.map((line, noteIndex) => (
                        <div
                          key={`${sentenceIndex}-note-${noteIndex}`}
                          className={`sentence-note-line ${line.type === 'jlptGrammar' ? 'grammar' : ''}`}
                        >
                          {line.text}
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
              className="ollama-stream-popup"
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
                className="ollama-stream-popup-header"
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
                  <strong>{ollamaStreamPopup.title || 'AI Live'}</strong>{' '}
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
                className="ollama-stream-popup-body"
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
                className="btn pagination-btn pagination-edge"
                title="First page"
                aria-label="First page"
              >
                &lt;&lt;
              </button>
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="btn pagination-btn pagination-step"
                title="Previous page"
                aria-label="Previous page"
              >
                &lt;
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
                      className={`btn pagination-btn pagination-page ${currentPage === pageNum ? 'active' : ''}`}
                      aria-label={`Page ${pageNum}`}
                      aria-current={currentPage === pageNum ? 'page' : undefined}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </span>

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="btn pagination-btn pagination-step"
                title="Next page"
                aria-label="Next page"
              >
                &gt;
              </button>
              <button
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage === totalPages}
                className="btn pagination-btn pagination-edge"
                title="Last page"
                aria-label="Last page"
              >
                &gt;&gt;
              </button>
            </div>
          )}
        </div>
      )}
      {visibleMessage && <div className="message">{visibleMessage}</div>}
    </div>
  );
}
