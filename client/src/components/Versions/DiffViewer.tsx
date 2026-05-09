import React, { useEffect, useState, useCallback } from 'react';
import { versionsAPI, VersionContent } from '../../services/versionsAPI';
import { Editor } from '@monaco-editor/react';
import './DiffViewer.css';

interface DiffViewerProps {
  fileId: number;
  versionId: number;
  currentContent: string;
  onClose: () => void;
}

const DiffViewer: React.FC<DiffViewerProps> = ({ fileId, versionId, currentContent, onClose }) => {
  const [version, setVersion] = useState<VersionContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<'diff' | 'version'>('diff');

  // Ensure currentContent is never undefined
  const safeCurrentContent = currentContent || '';

  const loadVersion = useCallback(async () => {
    try {
      setLoading(true);
      const data = await versionsAPI.getVersionContent(fileId, versionId);
      setVersion(data.version);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load version');
    } finally {
      setLoading(false);
    }
  }, [fileId, versionId]);

  useEffect(() => {
    loadVersion();
  }, [loadVersion]);

  if (loading) {
    return (
      <div className="diff-viewer-overlay">
        <div className="diff-viewer-modal">
          <div className="diff-viewer-header">
            <h3>Loading Version...</h3>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
          <div className="diff-viewer-loading">
            <div className="loading-spinner">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !version) {
    return (
      <div className="diff-viewer-overlay">
        <div className="diff-viewer-modal">
          <div className="diff-viewer-header">
            <h3>Error</h3>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
          <div className="diff-viewer-error">
            <span>⚠️ {error || 'Version not found'}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-viewer-overlay" onClick={onClose}>
      <div className="diff-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-viewer-header">
          <div className="version-info">
            <h3>Version {version.versionNumber}</h3>
            <div className="version-meta">
              <span>👤 {version.createdBy.username}</span>
              <span>📅 {new Date(version.createdAt).toLocaleString()}</span>
            </div>
            {version.commitMessage && (
              <div className="commit-message">💬 {version.commitMessage}</div>
            )}
          </div>
          <div className="viewer-controls">
            <div className="view-toggle">
              <button
                className={`toggle-btn ${viewMode === 'diff' ? 'active' : ''}`}
                onClick={() => setViewMode('diff')}
              >
                ⚖️ Compare
              </button>
              <button
                className={`toggle-btn ${viewMode === 'version' ? 'active' : ''}`}
                onClick={() => setViewMode('version')}
              >
                👁️ View Only
              </button>
            </div>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="diff-viewer-content">
          {viewMode === 'diff' ? (
            <div className="side-by-side-diff">
              <div className="diff-panel">
                <div className="diff-panel-header">Version {version.versionNumber} (Old)</div>
                <Editor
                  key={`old-${versionId}`}
                  height="calc(100vh - 240px)"
                  language={version.language}
                  value={version.content}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    automaticLayout: true,
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
              <div className="diff-panel">
                <div className="diff-panel-header">Current Version (New)</div>
                <Editor
                  key={`current-${versionId}-${safeCurrentContent.length}`}
                  height="calc(100vh - 240px)"
                  language={version.language}
                  value={safeCurrentContent}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    automaticLayout: true,
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
            </div>
          ) : (
            <Editor
              key={`version-${versionId}`}
              height="calc(100vh - 200px)"
              language={version.language}
              value={version.content}
              theme="vs-dark"
              options={{
                readOnly: true,
                automaticLayout: true,
                minimap: { enabled: true },
                lineNumbers: 'on',
                wordWrap: 'on',
              }}
            />
          )}
        </div>

        <div className="diff-viewer-legend">
          {viewMode === 'diff' ? (
            <>
              <span className="legend-item">
                <span className="legend-icon">📜</span> Version {version.versionNumber} vs Current
              </span>
            </>
          ) : (
            <span className="legend-note">Viewing version {version.versionNumber} content</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;
