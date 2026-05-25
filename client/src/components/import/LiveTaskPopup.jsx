import React from 'react';

export default function LiveTaskPopup({ popup, onClose }) {
  if (!popup?.visible) {
    return null;
  }

  return (
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
          <strong>{popup.title || 'AI Live'}</strong>{' '}
          {Number.isInteger(popup.sentenceIndex)
            ? `(R: sentence ${popup.sentenceIndex})`
            : '(R: page processing)'}
          <div style={{ fontSize: '0.8em', color: '#9ecae1' }}>
            Status: {popup.status}
          </div>
        </div>
        <button
          onClick={onClose}
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
        {popup.content || 'Waiting for streamed response...'}
      </div>
    </div>
  );
}
