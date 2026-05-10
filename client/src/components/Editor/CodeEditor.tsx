import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@monaco-editor/react';
import { useAuth } from '../../context/AuthContext';
import { filesAPI } from '../../services/api';
import { sharingAPI } from '../../services/sharingAPI';
import { File } from '../../types';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from '../../utils/MonacoBinding';
import ShareModal from '../Sharing/ShareModal';
import CollaboratorsList from '../Sharing/CollaboratorsList';
import VersionHistory from '../Versions/VersionHistory';
import DiffViewer from '../Versions/DiffViewer';
import type { editor as MonacoEditor } from 'monaco-editor';
import './Editor.css';

const CodeEditor: React.FC = () => {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [viewingVersionId, setViewingVersionId] = useState<number | null>(null);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSettingUpRef = useRef<boolean>(false); // Prevent multiple simultaneous setups
  const lastSavedContentRef = useRef<string>('');

  useEffect(() => {
    if (fileId) {
      loadFile(parseInt(fileId));
    }

    return () => {
      // Cleanup on unmount
      console.log('🧹 Component unmounting - cleaning up Yjs...');
      isSettingUpRef.current = false;
      
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      if (providerRef.current) {
        // Explicitly remove awareness before destroying
        providerRef.current.awareness.setLocalState(null);
        providerRef.current.destroy();
        providerRef.current = null;
      }
      if (ydocRef.current) {
        ydocRef.current.destroy();
        ydocRef.current = null;
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (connectionCheckIntervalRef.current) {
        clearInterval(connectionCheckIntervalRef.current);
        connectionCheckIntervalRef.current = null;
      }
    };
  }, [fileId]);

  // Update editor readOnly state when file permission changes
  useEffect(() => {
    if (editorRef.current && file?.permission) {
      const isReadOnly = !file.permission.canWrite;
      console.log(`🔒 Permission changed - Setting editor readOnly to: ${isReadOnly} (permission: ${file.permission.level})`);
      
      // Force readOnly mode
      editorRef.current.updateOptions({
        readOnly: isReadOnly,
        // Additional safeguards
        cursorStyle: isReadOnly ? 'line-thin' : 'line',
      });
      
      // Also update MonacoBinding's readOnly mode
      if (bindingRef.current) {
        bindingRef.current.setReadOnlyMode(isReadOnly);
      }
      
      // For viewers, also block the editor model from accepting edits
      if (isReadOnly && editorRef.current.getModel()) {
        console.log('🚫 Viewer mode active - editor is completely read-only');
      }
    }
  }, [file?.permission]);

  const loadFile = async (id: number) => {
    try {
      setIsLoading(true);
      const response = await filesAPI.getFile(id);
      setFile(response.file);
      lastSavedContentRef.current = response.file.content || '';
      setError('');
    } catch (error: any) {
      setError('Failed to load file');
      console.error('Load file error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSnapshot = async () => {
    if (!file || !ydocRef.current) return;
    
    // Don't auto-save if user doesn't have write permission
    if (file.permission && !file.permission.canWrite) {
      console.log('⛔ Viewer cannot save - skipping auto-save');
      return;
    }

    const currentContent = ydocRef.current.getText('monaco').toString();
    
    // Only save if content actually changed
    if (currentContent === lastSavedContentRef.current) {
      console.log('⏭️ Content unchanged, skipping save');
      return;
    }

    try {
      setIsSaving(true);
      await filesAPI.updateFile(file.id, { 
        content: currentContent
      });
      
      lastSavedContentRef.current = currentContent;
      setLastSaved(new Date());
      setError('');
      console.log('💾 Content saved');
    } catch (error: any) {
      setError('Failed to save file');
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const setupYjs = async (editor: MonacoEditor.IStandaloneCodeEditor, file: File, skipInitialSync: boolean = false) => {
    if (!fileId) return;

    // GUARD: Prevent multiple simultaneous setups
    if (isSettingUpRef.current) {
      console.log('⏭️  Setup already in progress, skipping...');
      return;
    }
    isSettingUpRef.current = true;

    console.log('🔧 Setting up Yjs collaboration...');

    // CRITICAL: Clean up old connections first to prevent multiple connections!
    if (bindingRef.current) {
      console.log('🧹 Destroying old MonacoBinding...');
      bindingRef.current.destroy();
      bindingRef.current = null;
    }
    if (providerRef.current) {
      console.log('🧹 Destroying old WebsocketProvider...');
      // Explicitly remove our awareness state before destroying
      providerRef.current.awareness.setLocalState(null);
      providerRef.current.disconnect();
      providerRef.current.destroy();
      providerRef.current = null;
      
      // Wait for WebSocket to fully close before creating new connection
      console.log('⏳ Waiting for old connection to close...');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (ydocRef.current) {
      console.log('🧹 Destroying old Y.Doc...');
      ydocRef.current.destroy();
      ydocRef.current = null;
    }
    
    // Clear connection status check interval
    if (connectionCheckIntervalRef.current) {
      clearInterval(connectionCheckIntervalRef.current);
      connectionCheckIntervalRef.current = null;
    }

    // Create Yjs document
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText('monaco');

    // Connect using WebsocketProvider
    const roomName = `file-${fileId}`;
    const provider = new WebsocketProvider('ws://localhost:1234', roomName, ydoc);
    providerRef.current = provider;
    
    console.log(`🌐 Connecting to room: "${roomName}"`);
    console.log(`📄 Doc ID: ${ydoc.guid}`);


    // Set up user awareness (presence)
    if (user) {
      const clientId = `${user.username}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      provider.awareness.setLocalStateField('user', {
        name: user.username,
        color: getRandomColor(),
        clientId: clientId, // Unique ID for this tab/session
      });
      console.log(`👤 Set awareness for: ${user.username} (clientId: ${clientId})`);
    }

    // Track connected users - deduplicate by username for display
    provider.awareness.on('change', () => {
      const states = provider.awareness.getStates();
      
      // Only count states that have a user set (filter out empty/lingering states)
      const activeUsers = Array.from(states.values()).filter((state: any) => state.user?.name);
      
      // Deduplicate by username for display (but keep all connections active)
      const uniqueUsernames = new Set(activeUsers.map((state: any) => state.user?.name));
      const userCount = uniqueUsernames.size;
      setConnectedUsers(userCount);
      
      // Debug: show all connected users with client IDs
      const userDetails = activeUsers.map((state: any) => 
        `${state.user?.name}(${state.user?.clientId?.substr(-4)})`
      );
      console.log(`👥 ${userCount} unique user(s): [${Array.from(uniqueUsernames).join(', ')}]`);
      console.log(`   ${activeUsers.length} total sessions: [${userDetails.join(', ')}]`);
      console.log(`   (Total awareness states: ${states.size})`);
    });

    // Track connection status with timeout for failed connections
    let connectionAttempts = 0;
    let lastConnectedTime = Date.now();
    let currentStatus = 'connecting';

    provider.on('status', (event: any) => {
      console.log(`📡 WebSocket status: ${event.status}`);
      if (event.status === 'connected') {
        setConnectionStatus('connected');
        currentStatus = 'connected';
        connectionAttempts = 0;
        lastConnectedTime = Date.now();
      } else if (event.status === 'disconnected') {
        setConnectionStatus('disconnected');
        currentStatus = 'disconnected';
      } else {
        // Connecting status - always show connecting initially
        currentStatus = 'connecting';
        setConnectionStatus('connecting');
        connectionAttempts++;
      }
    });

    // Track connection errors to immediately show disconnected
    provider.on('connection-error', () => {
      console.log('❌ WebSocket connection error');
      connectionAttempts++;
      if (connectionAttempts > 1) {
        setConnectionStatus('disconnected');
      }
    });

    // Periodic check for stuck "connecting" state
    connectionCheckIntervalRef.current = setInterval(() => {
      const timeSinceLastConnection = Date.now() - lastConnectedTime;
      // If connecting for more than 5 seconds, mark as disconnected
      if (currentStatus === 'connecting' && timeSinceLastConnection > 5000) {
        console.log('⚠️ Connection timeout - marking as disconnected');
        setConnectionStatus('disconnected');
        currentStatus = 'disconnected';
      }
    }, 2000);

    provider.on('sync', (isSynced: boolean) => {
      console.log(`🔄 Sync status: ${isSynced}, ytext length: ${ytext.length}`);
      if (isSynced) {
        lastSavedContentRef.current = ytext.toString();
        console.log(`✅ Document synced with ${ytext.length} chars`);
      }
    });

    // Auto-save snapshots periodically
    ydoc.on('update', () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveSnapshot();
      }, 2000);
    });

    // Create Monaco binding immediately.
    // Monaco model already has the correct content set by the caller before setupYjs
    // (on restore) or starts empty and gets filled by the YJS delta observer (normal load).
    const model = editor.getModel();
    if (model && !model.isDisposed()) {
      console.log('🔗 Creating MonacoBinding...');
      const isReadOnly = file.permission ? !file.permission.canWrite : false;
      const binding = new MonacoBinding(ytext, model, provider.awareness, isReadOnly, skipInitialSync);
      bindingRef.current = binding;
      console.log(`✅ MonacoBinding created (readOnly: ${isReadOnly}, skipInitialSync: ${skipInitialSync})`);
    }

    isSettingUpRef.current = false;
    console.log('✅ Yjs setup complete');
  };

  const handleEditorDidMount = (editor: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    
    // Configure editor first
    editor.updateOptions({
      fontSize: 14,
      lineHeight: 21,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      automaticLayout: true,
    });

    // Setup Yjs collaboration after editor is mounted
    if (file) {
      // Check permission and set read-only mode AFTER Yjs setup
      const isReadOnly = file.permission ? !file.permission.canWrite : true;
      console.log(`📝 Editor mounted, setting readOnly: ${isReadOnly} (permission: ${file.permission?.level || 'loading'})`);
      
      // Call async setup (don't await to avoid blocking editor mount)
      setupYjs(editor, file).catch(err => console.error('Setup error:', err));
      
      // Apply readOnly AFTER Yjs setup to ensure it takes precedence
      setTimeout(() => {
        editor.updateOptions({ readOnly: isReadOnly });
        console.log(`🔒 ReadOnly enforced: ${isReadOnly}`);
      }, 100);
    }
  };

  const getLanguageFromFilename = (filename: string): string => {
    const extension = filename.split('.').pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'json': 'json',
      'xml': 'xml',
      'md': 'markdown',
      'sql': 'sql',
      'sh': 'shell',
      'yml': 'yaml',
      'yaml': 'yaml',
    };
    return languageMap[extension || ''] || 'plaintext';
  };

  const getRandomColor = (): string => {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', 
      '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const handleShare = async (username: string, permissionLevel: 'editor' | 'viewer') => {
    if (!file) return;
    await sharingAPI.shareFile(file.id, username, permissionLevel);
  };

  const handleRestoreVersion = async (versionId: number) => {
    if (!fileId) return;

    setShowVersionHistory(false);
    setViewingVersionId(null);

    // The restore API call in VersionHistory triggers a server-side Yjs transaction.
    // The server broadcasts a massive delta (delete all + insert restored content) 
    // to all connected clients.
    // The existing MonacoBinding will receive this delta and cleanly apply it 
    // to the editor automatically. No need to manually fetch, remount, or reconnect!
    console.log(`🔄 Version restore initiated. Waiting for Yjs sync...`);
  };

  const handleViewVersion = (versionId: number) => {
    const currentContent = ydocRef.current?.getText('monaco').toString() || file?.content || '';
    console.log(`📖 Opening version comparison - Current content length: ${currentContent.length}`);
    setViewingVersionId(versionId);
  };

  if (isLoading) {
    return (
      <div className="editor-loading">
        <div className="loading-spinner">Loading file...</div>
      </div>
    );
  }

  if (error && !file) {
    return (
      <div className="editor-error">
        <h3>Error</h3>
        <p>{error}</p>
        <button onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="code-editor">
      <header className="editor-header">
        <div className="editor-nav">
          <button 
            onClick={() => navigate('/dashboard')}
            className="back-btn"
          >
            ← Back to Dashboard
          </button>
          <div className="file-info">
            <h2>{file?.filename}</h2>
            {file?.projectName && <span className="project-name">in {file.projectName}</span>}
          </div>
        </div>
        <div className="editor-status">
          {file?.permission && (
            <span className={`permission-badge ${file.permission.level}`}>
              {file.permission.level === 'owner' && '👑 Owner'}
              {file.permission.level === 'editor' && '✏️ Editor'}
              {file.permission.level === 'viewer' && '👁️ Viewer'}
            </span>
          )}
          <span className={`connection-status ${connectionStatus}`} title={`Connection: ${connectionStatus}`}>
            {connectionStatus === 'connected' && '🟢 Connected'}
            {connectionStatus === 'connecting' && '🟡 Connecting...'}
            {connectionStatus === 'disconnected' && '🔴 Disconnected'}
          </span>
          <button
            onClick={() => setShowShareModal(true)}
            className="share-btn"
            title="Share this file"
          >
            🔗 Share
          </button>
          <button
            onClick={() => setShowCollaborators(!showCollaborators)}
            className="collaborators-btn"
            title="View collaborators"
          >
            👥 {connectedUsers} {connectedUsers === 1 ? 'user' : 'users'}
          </button>
          <button
            onClick={() => setShowVersionHistory(!showVersionHistory)}
            className="version-history-btn"
            title="View version history"
          >
            🕐 History
          </button>
          {isSaving && <span className="saving-indicator">Saving...</span>}
          {lastSaved && (
            <span className="last-saved">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          {error && <span className="error-indicator">⚠ {error}</span>}
        </div>
      </header>

      {showShareModal && file && (
        <ShareModal
          fileId={file.id}
          filename={file.filename}
          onClose={() => setShowShareModal(false)}
          onShare={handleShare}
        />
      )}

      {showCollaborators && file && (
        <CollaboratorsList
          fileId={file.id}
          currentUserId={user?.id}
          onUpdate={() => {/* Optionally refresh something */}}
        />
      )}

      {showVersionHistory && file && (
        <VersionHistory
          fileId={file.id}
          onRestore={handleRestoreVersion}
          onViewVersion={handleViewVersion}
          onClose={() => setShowVersionHistory(false)}
        />
      )}

      {viewingVersionId && file && (
        <DiffViewer
          fileId={file.id}
          versionId={viewingVersionId}
          currentContent={ydocRef.current?.getText('monaco').toString() || file.content}
          onClose={() => setViewingVersionId(null)}
        />
      )}

      <div className="editor-container">
        <Editor
          height="calc(100vh - 80px)"
          language={file ? getLanguageFromFilename(file.filename) : 'plaintext'}
          defaultValue=""
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            selectOnLineNumbers: true,
            roundedSelection: false,
            readOnly: file?.permission ? !file.permission.canWrite : true,
            cursorStyle: 'line',
            automaticLayout: true,
            glyphMargin: true,
            folding: true,
            lineNumbers: 'on',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            minimap: {
              enabled: true,
            },
          }}
        />
      </div>
    </div>
  );
};

export default CodeEditor;
