import React, { useState } from 'react';
import './ShareModal.css';

interface ShareModalProps {
  fileId: number;
  filename: string;
  onClose: () => void;
  onShare: (username: string, permissionLevel: 'editor' | 'viewer') => Promise<void>;
}

const ShareModal: React.FC<ShareModalProps> = ({ fileId, filename, onClose, onShare }) => {
  const [username, setUsername] = useState('');
  const [permissionLevel, setPermissionLevel] = useState<'editor' | 'viewer'>('viewer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await onShare(username, permissionLevel);
      setSuccess(`Successfully shared with ${username}`);
      setUsername('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to share file');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Share "{filename}"</h2>
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="share-form">
          <div className="form-group">
            <label htmlFor="username">
              Username <span className="required">*</span>
            </label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="permission">Permission Level</label>
            <select
              id="permission"
              value={permissionLevel}
              onChange={(e) => setPermissionLevel(e.target.value as 'editor' | 'viewer')}
              disabled={loading}
            >
              <option value="viewer">Viewer (Read-only)</option>
              <option value="editor">Editor (Can edit)</option>
            </select>
            <small className="help-text">
              {permissionLevel === 'viewer'
                ? 'User can view the file but cannot make changes'
                : 'User can view and edit the file'}
            </small>
          </div>

          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <div className="modal-actions">
            <button
              type="button"
              onClick={onClose}
              className="button button-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={loading || !username.trim()}
            >
              {loading ? 'Sharing...' : 'Share'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ShareModal;
