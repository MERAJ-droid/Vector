import React from 'react';
import { Wifi, WifiOff, Loader2, CheckCircle2, Shield, Eye, Crown } from 'lucide-react';
import './EditorToolbar.css';

interface EditorToolbarProps {
  filename: string;
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  isSaving: boolean;
  lastSaved: Date | null;
  permissionLevel?: string;
  fileId?: number;
  onVersionRestore?: (versionId: number) => void;
}

const EditorToolbar: React.FC<EditorToolbarProps> = ({
  filename,
  connectionStatus,
  isSaving,
  lastSaved,
  permissionLevel,
}) => {
  const ConnectionIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Wifi size={12} className="conn-icon connected" />;
      case 'connecting':
        return <Loader2 size={12} className="conn-icon connecting spin" />;
      case 'disconnected':
      default:
        return <WifiOff size={12} className="conn-icon disconnected" />;
    }
  };

  const PermIcon = () => {
    switch (permissionLevel) {
      case 'owner': return <Crown size={12} className="perm-icon" />;
      case 'editor': return <Shield size={12} className="perm-icon" />;
      case 'viewer': return <Eye size={12} className="perm-icon" />;
      default: return null;
    }
  };

  return (
    <div className="editor-toolbar">
      <div className="toolbar-left">
        <span className="toolbar-breadcrumb">{filename}</span>
      </div>

      <div className="toolbar-right">
        {permissionLevel && (
          <div className="toolbar-badge" title={`Permission: ${permissionLevel}`}>
            <PermIcon />
            <span>{permissionLevel}</span>
          </div>
        )}

        <div
          className={`toolbar-badge conn-badge ${connectionStatus}`}
          title={`Connection: ${connectionStatus}`}
        >
          <ConnectionIcon />
          <span>{connectionStatus}</span>
        </div>

        {isSaving && (
          <div className="toolbar-badge save-badge">
            <Loader2 size={12} className="spin" />
            <span>Saving</span>
          </div>
        )}

        {lastSaved && !isSaving && (
          <div className="toolbar-badge" title={`Saved: ${lastSaved.toLocaleString()}`}>
            <CheckCircle2 size={12} className="saved-icon" />
            <span>{lastSaved.toLocaleTimeString()}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditorToolbar;
