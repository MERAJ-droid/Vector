import React, { useEffect, useState } from 'react';
import { X, GitCommit, Plus, Minus, RefreshCw, Loader } from 'lucide-react';
import { aiAPI, ProvenanceEvent, ProvenanceResult } from '../../services/api';
import './ProvenancePanel.css';

interface ProvenancePanelProps {
  fileId: number;
  lineContent: string;
  onClose: () => void;
  onSeekToVersion: (versionNumber: number) => void;
}

const ACTION_ICONS = {
  added: <Plus size={10} />,
  removed: <Minus size={10} />,
  're-added': <RefreshCw size={10} />,
};

const ACTION_LABELS = {
  added: 'Added',
  removed: 'Removed',
  're-added': 'Re-added',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

const ProvenancePanel: React.FC<ProvenancePanelProps> = ({
  fileId,
  lineContent,
  onClose,
  onSeekToVersion,
}) => {
  const [result, setResult] = useState<ProvenanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setError(null);

    aiAPI.fetchProvenance(fileId, lineContent)
      .then(data => { if (!cancelled) setResult(data); })
      .catch(err => {
        if (!cancelled) {
          setError(err?.response?.data?.error || err.message || 'Failed to load provenance');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [fileId, lineContent]);

  return (
    <div className="prov-panel">
      {/* Header */}
      <div className="prov-header">
        <div className="prov-title">
          <GitCommit size={12} />
          <span>Why does this line exist?</span>
        </div>
        <button className="prov-close" onClick={onClose} title="Close">
          <X size={13} />
        </button>
      </div>

      {/* Queried line preview */}
      <div className="prov-line-preview">
        <code>{lineContent.trim()}</code>
      </div>

      {/* Body */}
      <div className="prov-body">
        {loading && (
          <div className="prov-loading">
            <Loader size={14} className="prov-spinner" />
            <span>Analysing version history…</span>
          </div>
        )}

        {!loading && error && (
          <div className="prov-error">{error}</div>
        )}

        {!loading && result && (
          <>
            {/* AI narrative */}
            <div className="prov-narrative">{result.narrative}</div>

            {/* Version timeline */}
            {result.history.length > 0 && (
              <div className="prov-timeline">
                <div className="prov-timeline-label">Version history</div>
                {result.history.map((event: ProvenanceEvent, i: number) => (
                  <button
                    key={i}
                    className={`prov-event prov-event--${event.action}`}
                    onClick={() => onSeekToVersion(event.versionNumber)}
                    title={`Jump to v${event.versionNumber} in timeline`}
                  >
                    <span className="prov-event-icon">
                      {ACTION_ICONS[event.action]}
                    </span>
                    <span className="prov-event-action">
                      {ACTION_LABELS[event.action]}
                    </span>
                    <span className="prov-event-meta">
                      v{event.versionNumber} · {event.by} · {formatDate(event.at)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {result.history.length === 0 && !result.narrative.startsWith('Not enough') && (
              <div className="prov-empty">
                This line was not found in any version checkpoint.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ProvenancePanel;