import React, { useEffect, useState, useCallback } from 'react';
import { sharingAPI, Collaborator } from '../../services/sharingAPI';
import './ShareModal.css';

interface CollaboratorsListProps {
  fileId: number;
  currentUserId?: number;
  onUpdate?: () => void;
}

const CollaboratorsList: React.FC<CollaboratorsListProps> = ({ 
  fileId, 
  currentUserId, 
  onUpdate 
}) => {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCollaborators = useCallback(async () => {
    try {
      setLoading(true);
      const data = await sharingAPI.getCollaborators(fileId);
      setCollaborators(data.collaborators);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load collaborators');
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    loadCollaborators();
  }, [loadCollaborators]);

  const handlePermissionChange = async (userId: number, newPermission: 'editor' | 'viewer') => {
    try {
      await sharingAPI.updatePermission(fileId, userId, newPermission);
      await loadCollaborators();
      if (onUpdate) onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update permission');
    }
  };

  const handleRemove = async (userId: number, username: string) => {
    if (!window.confirm(`Remove ${username}'s access to this file?`)) {
      return;
    }

    try {
      await sharingAPI.removeCollaborator(fileId, userId);
      await loadCollaborators();
      if (onUpdate) onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to remove collaborator');
    }
  };

  if (loading) {
    return (
      <div className="collaborators-container">
        <div className="empty-state">
          <div className="empty-state-icon">⏳</div>
          <p>Loading collaborators...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="collaborators-container">
        <div className="error-message">{error}</div>
      </div>
    );
  }

  const owner = collaborators.find(c => c.permissionLevel === 'owner');
  const others = collaborators.filter(c => c.permissionLevel !== 'owner');
  const isOwner = owner && currentUserId && owner.id === currentUserId;

  return (
    <div className="collaborators-container">
      <div className="collaborators-header">
        <h3>Collaborators ({collaborators.length})</h3>
      </div>

      {collaborators.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <p>No collaborators yet</p>
        </div>
      ) : (
        <div className="collaborators-list">
          {/* Owner */}
          {owner && (
            <div className="collaborator-item">
              <div className="collaborator-info">
                <div className="collaborator-name">
                  {owner.username}
                  <span className="permission-badge owner">Owner</span>
                  {owner.id === currentUserId && <span style={{ marginLeft: 8, color: '#999' }}>(You)</span>}
                </div>
                <div className="collaborator-meta">
                  {owner.email}
                </div>
              </div>
            </div>
          )}

          {/* Other collaborators */}
          {others.map((collaborator) => {
            const isCurrentUser = currentUserId && collaborator.id === currentUserId;
            const canModify = isOwner && !isCurrentUser;

            return (
              <div key={collaborator.id} className="collaborator-item">
                <div className="collaborator-info">
                  <div className="collaborator-name">
                    {collaborator.username}
                    <span className={`permission-badge ${collaborator.permissionLevel}`}>
                      {collaborator.permissionLevel}
                    </span>
                    {isCurrentUser && <span style={{ marginLeft: 8, color: '#999' }}>(You)</span>}
                  </div>
                  <div className="collaborator-meta">
                    {collaborator.email} • 
                    {collaborator.grantedBy && ` Shared by ${collaborator.grantedBy}`}
                  </div>
                </div>

                {canModify && (
                  <div className="collaborator-actions">
                    <select
                      value={collaborator.permissionLevel}
                      onChange={(e) => handlePermissionChange(
                        collaborator.id,
                        e.target.value as 'editor' | 'viewer'
                      )}
                      className="permission-select"
                      style={{
                        padding: '6px 10px',
                        background: '#2a2a2a',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: '#fff',
                        fontSize: '12px'
                      }}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>

                    <button
                      onClick={() => handleRemove(collaborator.id, collaborator.username)}
                      className="icon-button danger"
                      title="Remove access"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CollaboratorsList;
