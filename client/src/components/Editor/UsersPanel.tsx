import React, { useState } from 'react';
import { Radio, UserPlus, Link2, Shield, Eye, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ShareModal from '../Sharing/ShareModal';
import CollaboratorsList from '../Sharing/CollaboratorsList';
import './UsersPanel.css';

interface UsersPanelProps {
  fileId?: number;
  connectedUsers?: number;
  onShareClick?: () => void;
}

const UsersPanel: React.FC<UsersPanelProps> = ({ fileId, connectedUsers = 0 }) => {
  const { user } = useAuth();
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(true);

  if (!fileId) {
    return (
      <div className="users-panel">
        <div className="users-empty">
          <Users2Icon />
          <p>Open a file to manage collaboration</p>
        </div>
      </div>
    );
  }

  return (
    <div className="users-panel">
      {/* Live status */}
      <div className="users-section">
        <div className="section-label">LIVE</div>
        <div className="live-status-row">
          <Radio size={13} className="status-icon pulse" />
          <span className="live-count">
            {connectedUsers} {connectedUsers === 1 ? 'user' : 'users'} online
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="panel-divider" />

      {/* Collaborators */}
      <div className="users-section">
        <div className="section-header-row">
          <div className="section-label">ACCESS</div>
          <button
            className="section-toggle"
            onClick={() => setShowCollaborators(!showCollaborators)}
            title={showCollaborators ? 'Collapse' : 'Expand'}
          >
            {showCollaborators ? <Eye size={12} /> : <Eye size={12} style={{ opacity: 0.4 }} />}
          </button>
        </div>
        {showCollaborators && (
          <div className="collaborators-wrap">
            <CollaboratorsList
              fileId={fileId}
              currentUserId={user?.id}
              onUpdate={() => { }}
            />
          </div>
        )}
      </div>

      <div className="panel-divider" />

      {/* Share actions */}
      <div className="users-section">
        <div className="section-label">SHARE</div>
        <div className="share-actions">
          <button className="share-action-btn" onClick={() => setShowShareModal(true)}>
            <UserPlus size={13} />
            <span>Invite by email</span>
          </button>
          <button
            className="share-action-btn"
            title="Copy link"
            onClick={() => navigator.clipboard?.writeText(window.location.href)}
          >
            <Link2 size={13} />
            <span>Copy link</span>
          </button>
        </div>
        <div className="permission-legend">
          <span className="legend-item"><Shield size={11} /> Owner</span>
          <span className="legend-item"><Eye size={11} /> Viewer</span>
          <span className="legend-item"><Trash2 size={11} style={{ color: 'var(--color-text-muted)' }} /> Remove</span>
        </div>
      </div>

      {showShareModal && (
        <ShareModal
          fileId={fileId}
          filename="Current File"
          onClose={() => setShowShareModal(false)}
          onShare={async () => { }}
        />
      )}
    </div>
  );
};

// Inline placeholder icon for empty state
const Users2Icon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export default UsersPanel;
