import React from 'react';
import { X } from 'lucide-react';
import FileExplorer from './FileExplorer';
import SearchPanel from './SearchPanel';
import UsersPanel from './UsersPanel';
import { ActivityBarView } from './ActivityBar';
import './Sidebar.css';

const PANEL_TITLES: Record<NonNullable<ActivityBarView>, string> = {
  files: 'EXPLORER',
  search: 'SEARCH',
  users: 'COLLABORATION',
  extensions: 'EXTENSIONS',
  containers: 'CONTAINERS',
};

interface SidebarProps {
  activeView: ActivityBarView;
  projectId?: number;
  fileId?: number;
  currentFileId?: number;
  connectedUsers?: number;
  onFileSelect: (fileId: number) => void;
  onShareClick?: () => void;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  projectId,
  fileId,
  currentFileId,
  connectedUsers,
  onFileSelect,
  onShareClick,
  onClose,
}) => {
  if (!activeView) return null;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{PANEL_TITLES[activeView]}</span>
        <button className="sidebar-close-btn" onClick={onClose} title="Close sidebar">
          <X size={14} />
        </button>
      </div>

      <div className="sidebar-body">
        {activeView === 'files' && projectId && (
          <FileExplorer
            projectId={projectId}
            currentFileId={currentFileId}
            onFileSelect={onFileSelect}
          />
        )}

        {activeView === 'search' && (
          <SearchPanel projectId={projectId} onFileSelect={onFileSelect} />
        )}

        {activeView === 'users' && (
          <UsersPanel
            fileId={fileId}
            connectedUsers={connectedUsers}
            onShareClick={onShareClick}
          />
        )}

        {(activeView === 'extensions' || activeView === 'containers') && (
          <div className="sidebar-placeholder">
            <span>{PANEL_TITLES[activeView]}</span>
            <p>Coming soon</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
