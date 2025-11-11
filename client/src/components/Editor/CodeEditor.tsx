import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@monaco-editor/react';
import { useAuth } from '../../context/AuthContext';
import { filesAPI } from '../../services/api';
import { File } from '../../types';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
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
  const wsRef = useRef<WebSocket | null>(null);
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
      if (wsRef.current) {
        wsRef.current.close();
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

    console.log('🔧 Setting up Yjs with custom sync protocol');

    // Create Yjs document
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText('monaco');

    // Connect to WebSocket server
    const roomName = `file-${fileId}`;
    const ws = new WebSocket(`ws://localhost:1234/${roomName}`);
    wsRef.current = ws;
    
    console.log(`🌐 Connecting to room: "${roomName}"`);
    console.log(`� Doc ID: ${ydoc.guid}`);

    let isSynced = false;

    ws.onopen = () => {
      console.log('✅ WebSocket connected');
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data;
      
      // Convert blob to array buffer if needed
      if (data instanceof Blob) {
        data.arrayBuffer().then((buffer: ArrayBuffer) => {
          handleYjsMessage(new Uint8Array(buffer));
        });
      } else if (data instanceof ArrayBuffer) {
        handleYjsMessage(new Uint8Array(data));
      }
    };

    const handleYjsMessage = (message: Uint8Array) => {
      const decoder = decoding.createDecoder(message);
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);

      console.log(`� Received message type: ${messageType}`);

      switch (messageType) {
        case syncProtocol.messageYjsSyncStep1:
          // Server sent sync step 1, respond with sync step 2
          encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep2);
          syncProtocol.readSyncStep1(decoder, encoder, ydoc);
          ws.send(encoding.toUint8Array(encoder));
          console.log('📤 Sent SyncStep2 response');
          break;

        case syncProtocol.messageYjsSyncStep2:
          // Server sent sync step 2, apply it
          syncProtocol.readSyncStep2(decoder, ydoc, null);
          console.log('✅ Applied SyncStep2 from server');
          
          if (!isSynced) {
            isSynced = true;
            console.log('🎉 Initial sync complete!');
            
            // If document is empty, insert file content
            if (ytext.length === 0 && file.content) {
              ytext.insert(0, file.content);
              console.log('📄 Inserted initial file content');
            } else {
              console.log(`✅ Document already has content: ${ytext.length} chars`);
            }
          }
          break;

        case syncProtocol.messageYjsUpdate:
          // Server sent an update from another client
          syncProtocol.readUpdate(decoder, ydoc, 'server');
          console.log('📝 Applied update from another client');
          break;
      }
    };

    // Send updates when document changes
    ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin !== 'server' && ws.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
        encoding.writeVarUint8Array(encoder, update);
        ws.send(encoding.toUint8Array(encoder));
        console.log(`� Sent update (${update.length} bytes)`);
      }
      
      // Auto-save snapshots periodically
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveSnapshot();
      }, 2000);
    });

    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('👋 WebSocket disconnected');
    };

    // Create Monaco binding
    const model = editor.getModel();
    if (model) {
      const binding = new MonacoBinding(ytext, model);
      bindingRef.current = binding;
    }

    console.log('✅ Yjs setup complete');
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
