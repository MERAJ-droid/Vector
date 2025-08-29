import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@monaco-editor/react';
import { useAuth } from '../../context/AuthContext';
import { filesAPI } from '../../services/api';
import socketService from '../../services/socket';
import { File, SocketTextChangeEvent } from '../../types';
import './Editor.css';

const CodeEditor: React.FC = () => {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const editorRef = useRef<any>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (fileId) {
      loadFile(parseInt(fileId));
    }
  }, [fileId]);

  useEffect(() => {
    // Socket connection for real-time collaboration
    if (fileId && user) {
      socketService.connect();
      socketService.joinFile(fileId);

      const handleTextChange = (data: SocketTextChangeEvent) => {
        if (data.userId !== user.id.toString() && data.fileId === fileId) {
          // Update editor content from other users
          setContent(data.content);
          if (editorRef.current) {
            editorRef.current.setValue(data.content);
          }
        }
      };

      socketService.on('text-change', handleTextChange);

      return () => {
        socketService.off('text-change', handleTextChange);
        socketService.leaveFile(fileId);
      };
    }
  }, [fileId, user]);

  const loadFile = async (id: number) => {
    try {
      setIsLoading(true);
      const response = await filesAPI.getFile(id);
      setFile(response.file);
      setContent(response.file.content);
      setError('');
    } catch (error: any) {
      setError('Failed to load file');
      console.error('Load file error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveFile = async (newContent: string) => {
    if (!file || !fileId) return;

    try {
      setIsSaving(true);
      await filesAPI.updateFile(file.id, { content: newContent });
      setLastSaved(new Date());
      setError('');
    } catch (error: any) {
      setError('Failed to save file');
      console.error('Save file error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;

    setContent(value);

    // Broadcast changes to other users via socket
    if (fileId && user) {
      socketService.sendTextChange({
        fileId,
        content: value,
        userId: user.id.toString(),
      });
    }

    // Auto-save with debouncing
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveFile(value);
    }, 1000); // Save after 1 second of inactivity
  };

  const handleEditorDidMount = (editor: any) => {
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
          value={content}
          onChange={handleEditorChange}
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
