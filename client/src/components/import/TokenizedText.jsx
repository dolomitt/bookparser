import React, { useEffect, useMemo, useState } from 'react';

import {
  getDisplayToken,
  isKnownJlptGrammar,
  TOKEN_SPACING
} from '../../pages/importPageShared';

const WORD_SPACE_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞', '接頭詞']);
const PARTICLE_POS = '助詞';
const PUNCTUATION_POS = '記号';

const isKanjiChar = (char) => {
  const code = char.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9faf) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df);
};

const hasKanji = (text) => text.split('').some((char) => isKanjiChar(char));

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

export default function TokenizedText({
  tokens,
  sentenceIndex,
  isCurrentReading = false,
  onBookmark,
  jlptSettings = {},
  tokenSpacing = TOKEN_SPACING.NONE
}) {
  const [activePopup, setActivePopup] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, top: null, bottom: null });
  const [hoveredExpressionId, setHoveredExpressionId] = useState(null);
  const [hoveredTokenIdx, setHoveredTokenIdx] = useState(null);

  const expressionMetaByToken = useMemo(() => {
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

      for (let i = start; i <= end; i += 1) {
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

  const closePopup = () => {
    setActivePopup(null);
  };

  const handleTokenClick = (event, token, tokenIdx) => {
    if (token.pos === '記号' || token.surface === '」') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (typeof onBookmark === 'function') {
      onBookmark(sentenceIndex);
    }

    const rect = event.currentTarget.getBoundingClientRect();
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

    setPopupPosition({ x, top, bottom });
    setActivePopup((current) => (current === `${sentenceIndex}-${tokenIdx}` ? null : `${sentenceIndex}-${tokenIdx}`));
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (activePopup !== null && !event.target.closest('.token-popup') && !event.target.closest('[data-token]')) {
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

        const tokenContent = shouldShowRuby ? (
          <ruby style={{ fontSize: 'inherit', pointerEvents: 'none' }}>
            {token.surface}
            <rt
              style={{
                fontSize: '0.52em',
                color: '#d6d6d6',
                fontWeight: 'normal',
                lineHeight: '1.1',
                pointerEvents: 'none'
              }}
            >
              {token.reading}
            </rt>
          </ruby>
        ) : token.surface;

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
            onClick={(event) => handleTokenClick(event, token, tokenIdx)}
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
            onTouchStart={(event) => {
              if (!isPunctuation) {
                event.preventDefault();
              }
            }}
          >
            {tokenContent}
          </span>
        );
      })}

      {activePopup !== null && activePopup.startsWith(`${sentenceIndex}-`) && (() => {
        const tokenIdx = parseInt(activePopup.split('-')[1], 10);
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
              overflowY: 'auto'
            } : {
              position: 'fixed',
              left: `${popupPosition.x}px`,
              ...(popupPosition.top !== null
                ? { top: `${popupPosition.top}px` }
                : { bottom: `${popupPosition.bottom}px` }),
              transform: 'translateX(-50%)'
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
      })()}
    </div>
  );
}
