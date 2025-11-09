import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@monaco-editor/react';
import { useAuth } from '../../context/AuthContext';
import { filesAPI } from '../../services/api';
import { File } from '../../types';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from '../../utils/MonacoBinding';
import type { editor as MonacoEditor } from 'monaco-editor';
import './Editor.css';

const YJS_SERVER_URL = process.env.REACT_APP_YJS_URL || 'ws://localhost:1234';

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
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (fileId) {
      loadFile(parseInt(fileId));
    }

    return () => {
      // Cleanup on unmount
      if (bindingRef.current) {
        bindingRef.current.destroy();
      }
      if (providerRef.current) {
        providerRef.current.destroy();
      }
      if (ydocRef.current) {
        ydocRef.current.destroy();
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [fileId]);

  const loadFile = async (id: number) => {
    try {
      setIsLoading(true);
      const response = await filesAPI.getFile(id);
      setFile(response.file);
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

    try {
      setIsSaving(true);
      // TEMP: Snapshot saving disabled for testing
      // Just save regular content for now
      await filesAPI.updateFile(file.id, { 
        content: ydocRef.current.getText('monaco').toString()
      });
      
      setLastSaved(new Date());
      setError('');
    } catch (error: any) {
      setError('Failed to save file');
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const setupYjs = (editor: MonacoEditor.IStandaloneCodeEditor, file: File) => {
    if (!fileId) return;

    // Create Yjs document
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText('monaco');

    // Connect to Yjs WebSocket server FIRST
    const roomName = `file-${fileId}`;
    console.log(`🌐 Attempting to connect to Yjs room: "${roomName}"`);
    console.log(`📍 File ID: ${fileId}, File: ${file.filename}`);
    console.log(`🔗 Yjs Server URL: ${YJS_SERVER_URL}`);
    
    const provider = new WebsocketProvider(
      YJS_SERVER_URL,
      roomName,
      ydoc
    );
    providerRef.current = provider;
    
    // Log provider details
    console.log(`📦 Provider created - Room: "${provider.roomname}", Doc ID: ${ydoc.guid}`);

    // Only initialize content if document is empty after syncing
    provider.on('sync', (isSynced: boolean) => {
      if (isSynced && ytext.length === 0) {
        console.log('📄 First client - initializing with file content');
        ytext.insert(0, file.content || '');
      } else if (isSynced) {
        console.log('✅ Synced with existing Yjs document');
      }
    });

    // Monitor connection status
    provider.on('status', ({ status }: { status: string }) => {
      console.log('🔌 Yjs connection status:', status);
      if (status === 'connected') {
        console.log('✅ Connected to Yjs server on ws://localhost:1234');
        
        // Set awareness AFTER connection is established
        if (user) {
          const userColor = getRandomColor();
          provider.awareness.setLocalState({
            user: {
              name: user.username,
              id: user.id,
              color: userColor,
            }
          });
          console.log(`🎨 Local user set after connection: ${user.username} (${userColor})`);
        }
      } else if (status === 'disconnected') {
        console.error('❌ Disconnected from Yjs server');
      }
    });

    // Track connected users via awareness
    provider.awareness.on('change', (changes: any) => {
      const states = provider.awareness.getStates();
      
      // Filter out anonymous/stale clients
      let realUserCount = 0;
      const clients: any[] = [];
      states.forEach((state, clientId) => {
        if (state.user && state.user.name) {
          realUserCount++;
          const isLocal = clientId === provider.awareness.clientID;
          clients.push({ clientId, state, isLocal });
        }
      });
      
      console.log('👥 Awareness change detected - Active users:', realUserCount);
      setConnectedUsers(realUserCount);
      
      // Log all connected users for debugging
      console.log('📋 Active clients:');
      clients.forEach(({ clientId, state, isLocal }) => {
        console.log(`  ${isLocal ? '→' : ' '} Client ${clientId}:`, state.user, isLocal ? '(YOU)' : '');
      });
      
      // Log what changed
      if (changes.added && changes.added.length > 0) console.log('  ➕ Added clients:', changes.added);
      if (changes.updated && changes.updated.length > 0) console.log('  ♻️  Updated clients:', changes.updated);
      if (changes.removed && changes.removed.length > 0) console.log('  ➖ Removed clients:', changes.removed);
    });

    // Bind Yjs to Monaco Editor
    const model = editor.getModel();
    if (model) {
      const binding = new MonacoBinding(ytext, model, provider.awareness);
      bindingRef.current = binding;
    }

    // Auto-save snapshots periodically
    ydoc.on('update', () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveSnapshot();
      }, 2000); // Save after 2 seconds of inactivity
    });
  };

  const handleEditorDidMount = (editor: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    
    // Configure editor
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
      setupYjs(editor, file);
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
            <span className="project-name">in {file?.projectName}</span>
          </div>
        </div>
        
        <div className="editor-status">
          {connectedUsers > 1 && (
            <span className="collaborators">
              👥 {connectedUsers} {connectedUsers === 1 ? 'user' : 'users'} connected
            </span>
          )}
          {isSaving && <span className="saving-indicator">Saving...</span>}
          {lastSaved && (
            <span className="last-saved">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          {error && <span className="error-indicator">⚠ {error}</span>}
        </div>
      </header>

      <div className="editor-container">
        <Editor
          height="calc(100vh - 80px)"
          language={file ? getLanguageFromFilename(file.filename) : 'plaintext'}
          defaultValue={file?.content || ''}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            selectOnLineNumbers: true,
            roundedSelection: false,
            readOnly: false,
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
