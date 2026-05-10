import React, { useState, useEffect, useCallback } from 'react';
import { versionsAPI, Version } from '../../services/versionsAPI';
import { filesAPI } from '../../services/api';
import DiffViewer from './DiffViewer';
import './CompactVersionHistory.css';

type ViewMode = 'hover' | 'click';

interface CompactVersionHistoryProps {
  fileId: number;
  onClose: () => void;
  currentVersion?: number;
  onBeforeRestore?: () => void;
  onRestore?: (versionId: number) => void;
  onViewVersion?: (versionId: number) => void;
}

const CompactVersionHistory: React.FC<CompactVersionHistoryProps> = ({
  fileId,
  onClose,
  currentVersion,
  onBeforeRestore,
  onRestore,
  onViewVersion,
}) => {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('hover');
  const [hoveredVersion, setHoveredVersion] = useState<Version | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [currentContent, setCurrentContent] = useState<string>('');

  const loadVersions = useCallback(async () => {
    try {
      setLoading(true);
      const data = await versionsAPI.getVersions(fileId);
      setVersions(data.versions);
      
      // Also load current file content
      const fileData = await filesAPI.getFile(fileId);
      setCurrentContent(fileData.file.content || '');
      
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const handleVersionClick = (version: Version) => {
    if (viewMode === 'click') {
      setSelectedVersion(version);
      setShowDiff(true);
    }
  };

  const handleRestore = async (version: Version) => {
    if (!window.confirm('Are you sure you want to restore this version? Current unsaved changes will be lost.')) {
      return;
    }

    try {
      if (onBeforeRestore) {
        onBeforeRestore();
      }
      await versionsAPI.restoreVersion(fileId, version.id);
      onRestore?.(version.id);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to restore version');
      console.error('Error restoring version:', err);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (showDiff && selectedVersion) {
    return (
      <div className="compact-version-modal">
        <div className="compact-version-content">
          <div className="modal-header">
            <h3>Version {selectedVersion.versionNumber} Diff</h3>
            <button onClick={() => setShowDiff(false)} className="close-button">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
              </svg>
            </button>
          </div>
          <DiffViewer
            versionId={selectedVersion.id}
            fileId={fileId}
            currentContent={currentContent}
            onClose={() => setShowDiff(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="compact-version-history">
      <div className="compact-history-header">
        <div className="header-left">
          <h3>Version History</h3>
          <div className="view-mode-toggle">
            <button
              className={`mode-button ${viewMode === 'hover' ? 'active' : ''}`}
              onClick={() => setViewMode('hover')}
              title="Hover to preview"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 3C4.5 3 1.5 5.5 0 8c1.5 2.5 4.5 5 8 5s6.5-2.5 8-5c-1.5-2.5-4.5-5-8-5zm0 8c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3-1.3 3-3 3z"/>
              </svg>
            </button>
            <button
              className={`mode-button ${viewMode === 'click' ? 'active' : ''}`}
              onClick={() => setViewMode('click')}
              title="Click to view diff"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 3v10h10V3H3zm9 9H4V4h8v8z"/><path d="M5 6h6v1H5zm0 2h6v1H5zm0 2h4v1H5z"/>
              </svg>
            </button>
          </div>
        </div>
        <button onClick={onClose} className="close-button">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
          </svg>
        </button>
      </div>

      <div className="compact-versions-list">
        {loading && <div className="loading-text">Loading versions...</div>}
        {error && <div className="error-text">{error}</div>}
        
        {!loading && !error && versions.length === 0 && (
          <div className="no-versions">No versions available</div>
        )}

        {!loading && versions.length > 0 && (
          <div className="versions-table">
            <div className="table-header">
              <span className="col-version">Ver</span>
              <span className="col-date">Date</span>
              <span className="col-size">Size</span>
              <span className="col-actions">Actions</span>
            </div>
            <div className="table-body">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className={`version-row ${selectedVersion?.id === version.id ? 'selected' : ''}`}
                  onMouseEnter={() => viewMode === 'hover' && setHoveredVersion(version)}
                  onMouseLeave={() => viewMode === 'hover' && setHoveredVersion(null)}
                  onClick={() => handleVersionClick(version)}
                >
                  <span className="col-version">#{version.versionNumber}</span>
                  <span className="col-date" title={new Date(version.createdAt).toLocaleString()}>
                    {formatDate(version.createdAt)}
                  </span>
                  <span className="col-size">{version.fileSize} bytes</span>
                  <span className="col-actions">
                    <button
                      className="action-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleVersionClick(version);
                      }}
                      title="View"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 3C4.5 3 1.5 5.5 0 8c1.5 2.5 4.5 5 8 5s6.5-2.5 8-5c-1.5-2.5-4.5-5-8-5zm0 8c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3-1.3 3-3 3z"/>
                      </svg>
                    </button>
                    <button
                      className="action-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRestore(version);
                      }}
                      title="Restore"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 3a5 5 0 0 0-5 5h2a3 3 0 0 1 6 0v1l-1.5-1.5L8 9l3 3-3 3-1.5-1.5L8 12v-1a5 5 0 0 0-5-5H1a7 7 0 0 1 14 0v1l-1.5-1.5L12 7l3 3-3 3-1.5-1.5L12 10V9a7 7 0 0 0-7-7z"/>
                      </svg>
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {viewMode === 'hover' && hoveredVersion && (
        <div className="hover-preview">
          <div className="preview-header">
            Version #{hoveredVersion.versionNumber}
          </div>
          <pre className="preview-content">
            Loading content...
          </pre>
        </div>
      )}
    </div>
  );
};

export default CompactVersionHistory;
