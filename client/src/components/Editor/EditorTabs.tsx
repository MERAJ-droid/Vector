import React from 'react';
import { X, FileText } from 'lucide-react';
import './EditorTabs.css';

interface EditorTab {
  fileId: number;
  filename: string;
  isDirty: boolean;
}

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabId: number;
  onTabClick: (fileId: number) => void;
  onTabClose: (fileId: number) => void;
}

const EditorTabs: React.FC<EditorTabsProps> = ({ tabs, activeTabId, onTabClick, onTabClose }) => {
  const handleClose = (e: React.MouseEvent, fileId: number) => {
    e.stopPropagation();
    onTabClose(fileId);
  };

  if (tabs.length === 0) return <div className="editor-tabs empty" />;

  return (
    <div className="editor-tabs">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.fileId;
        return (
          <div
            key={tab.fileId}
            className={`editor-tab ${isActive ? 'active' : ''}`}
            onClick={() => onTabClick(tab.fileId)}
            title={tab.filename}
          >
            <FileText size={12} className="tab-file-icon" />
            <span className="tab-name">{tab.filename}</span>
            {tab.isDirty && <span className="dirty-dot" title="Unsaved changes" />}
            <button
              className="tab-close-btn"
              onClick={(e) => handleClose(e, tab.fileId)}
              title="Close"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default EditorTabs;
