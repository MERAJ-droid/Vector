import React, { useEffect, useState, useCallback } from 'react';
import { versionsAPI, Version } from '../../services/versionsAPI';
import './VersionHistory.css';

interface VersionHistoryProps {
  fileId: number;
  currentVersion?: number;
  onRestore: (versionId: number) => void;
  onViewVersion: (versionId: number) => void;
  onClose: () => void;
}

const VersionHistory: React.FC<VersionHistoryProps> = ({ 
  fileId, 
  currentVersion,
  onRestore, 
  onViewVersion,
  onClose 
}) => {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const loadVersions = useCallback(async () => {
    try {
      setLoading(true);
      const data = await versionsAPI.getVersions(fileId);
      setVersions(data.versions);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load version history');
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const handleRestore = async (versionId: number, versionNumber: number) => {
    if (!window.confirm(`Restore to version ${versionNumber}? This will create a new version with the content from version ${versionNumber}.`)) {
      return;
    }

    try {
      await versionsAPI.restoreVersion(fileId, versionId);
      onRestore(versionId);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to restore version');
      console.error('Error restoring version:', err);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (loading) {
    return (
      <div className="version-history-panel">
        <div className="version-history-header">
          <h3>Version History</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="version-history-loading">
          <div className="loading-spinner">Loading versions...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="version-history-panel">
      <div className="version-history-header">
        <h3>Version History</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {error && (
        <div className="version-history-error">
          <span>⚠️ {error}</span>
        </div>
      )}

      <div className="versions-list">
        {versions.length === 0 ? (
          <div className="empty-state">
            <p>📝 No versions yet</p>
            <span>Versions are created automatically when you save</span>
          </div>
        ) : (
          versions.map((version, index) => (
            <div
              key={version.id}
              className={`version-item ${selectedVersion === version.id ? 'selected' : ''} ${index === 0 ? 'latest' : ''}`}
              onClick={() => setSelectedVersion(version.id)}
            >
              <div className="version-header">
                <span className="version-number">
                  v{version.versionNumber}
                  {index === 0 && <span className="latest-badge">Latest</span>}
                </span>
                <span className="version-time">{formatDate(version.createdAt)}</span>
              </div>

              <div className="version-info">
                <span className="version-author">👤 {version.createdBy.username}</span>
                <span className="version-size">📦 {formatFileSize(version.fileSize)}</span>
              </div>

              {version.commitMessage && (
                <div className="version-message">
                  💬 {version.commitMessage}
                </div>
              )}

              <div className="version-actions">
                <button
                  className="view-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewVersion(version.id);
                  }}
                >
                  👁️ View
                </button>
                {index !== 0 && (
                  <button
                    className="restore-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRestore(version.id, version.versionNumber);
                    }}
                  >
                    ↩️ Restore
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default VersionHistory;
