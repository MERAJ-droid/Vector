import React, { useState, useRef } from 'react';
import { aiAPI } from '../../services/api';
import './TemporalQueryPanel.css';

interface Props {
  fileId: number;
  onSeekToVersion: (versionNumber: number) => void;
}

const TemporalQueryPanel: React.FC<Props> = ({ fileId, onSeekToVersion }) => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [navigateToVersion, setNavigateToVersion] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setAnswer(null);
    setNavigateToVersion(undefined);
    setError(null);
    try {
      const result = await aiAPI.askTemporalQuestion(fileId, q);
      setAnswer(result.answer);
      setNavigateToVersion(result.navigateToVersion);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Something went wrong. Is Ollama running?');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAsk();
  };

  return (
    <div className="tq-panel">
      <div className="tq-input-row">
        <input
          ref={inputRef}
          className="tq-input"
          type="text"
          placeholder="Ask about this file's history…"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          autoFocus
        />
        <button
          className="tq-ask-btn"
          onClick={handleAsk}
          disabled={!question.trim() || loading}
        >
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {loading && (
        <div className="tq-skeleton">
          <div className="tq-skeleton-line tq-skeleton-line--long" />
          <div className="tq-skeleton-line tq-skeleton-line--med" />
        </div>
      )}

      {error && <div className="tq-error">{error}</div>}

      {!loading && answer && (
        <div className="tq-answer">
          <p className="tq-answer-text">{answer}</p>
          {navigateToVersion !== undefined && (
            <button
              className="tq-jump-btn"
              onClick={() => onSeekToVersion(navigateToVersion)}
            >
              Jump to v{navigateToVersion} →
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default TemporalQueryPanel;