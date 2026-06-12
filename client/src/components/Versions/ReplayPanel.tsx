import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { X, Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import { versionsAPI, Version } from '../../services/versionsAPI';
import { aiAPI, ReplayVersionSummary } from '../../services/api';
import './ReplayPanel.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReplayPanelProps {
  fileId: number;
  language: string;
  versions: Version[];
  onClose: () => void;
}

type Speed = 1 | 2 | 4;

// ─── Simple line diff for decorations ────────────────────────────────────────

function findAddedLineNumbers(prevContent: string, currContent: string): number[] {
  const prevLines = new Set(
    prevContent.split('\n').map(l => l.trim()).filter(Boolean)
  );
  const currLines = currContent.split('\n');
  const added: number[] = [];
  currLines.forEach((line, i) => {
    if (line.trim() && !prevLines.has(line.trim())) {
      added.push(i + 1); // Monaco lines are 1-indexed
    }
  });
  return added;
}

// ─── Component ────────────────────────────────────────────────────────────────

const ReplayPanel: React.FC<ReplayPanelProps> = ({ fileId, language, versions, onClose }) => {
  // ── Content loading ──────────────────────────────────────────────────────
  const [contents, setContents] = useState<string[]>([]);
  const [contentsLoading, setContentsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Playback state ────────────────────────────────────────────────────────
  const [playIndex, setPlayIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  // ── Narration state ───────────────────────────────────────────────────────
  const [narrationText, setNarrationText] = useState('');
  const [narrationLoading, setNarrationLoading] = useState(true);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<ReplayVersionSummary[]>([]);

  // ── Monaco ref ────────────────────────────────────────────────────────────
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const decoCollectionRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const narrationEndRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load all version contents on mount ────────────────────────────────────
  useEffect(() => {
    if (versions.length === 0) return;
    let cancelled = false;
    setContentsLoading(true);

    const fetchAll = async () => {
      try {
        const results = await Promise.all(
          versions.map(v => versionsAPI.getVersionContent(fileId, v.id))
        );
        if (!cancelled) {
          setContents(results.map(r => r.version.content));
          setContentsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError('Failed to load version contents.');
          setContentsLoading(false);
        }
      }
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [fileId, versions]);

  // ── Start narration SSE stream on mount ───────────────────────────────────
  useEffect(() => {
    setNarrationLoading(true);
    const cleanup = aiAPI.streamReplayNarration(
      fileId,
      (s) => setSummaries(s),
      (token) => setNarrationText(prev => prev + token),
      (cached) => {
        setNarrationText(cached);
        setNarrationLoading(false);
      },
      () => setNarrationLoading(false),
      (msg) => {
        setNarrationError(msg);
        setNarrationLoading(false);
      }
    );
    return cleanup;
  }, [fileId]);

  // Auto-scroll narration as it streams
  useEffect(() => {
    narrationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [narrationText]);

  // ── Apply decorations when playIndex or contents change ───────────────────
  useEffect(() => {
    if (!editorRef.current || contents.length === 0) return;
    const curr = contents[playIndex] ?? '';
    const prev = playIndex > 0 ? (contents[playIndex - 1] ?? '') : '';

    const model = editorRef.current.getModel();
    if (!model) return;

    // Set content
    model.setValue(curr);

    // Apply added-line decorations
    const addedLines = playIndex > 0 ? findAddedLineNumbers(prev, curr) : [];
    const decorations = addedLines.map(lineNum => ({
      range: { startLineNumber: lineNum, startColumn: 1, endLineNumber: lineNum, endColumn: 1 },
      options: {
        isWholeLine: true,
        className: 'replay-added-line',
        linesDecorationsClassName: 'replay-added-gutter',
      },
    }));

    if (!decoCollectionRef.current) {
      decoCollectionRef.current = editorRef.current.createDecorationsCollection(decorations);
    } else {
      decoCollectionRef.current.set(decorations);
    }
  }, [playIndex, contents]);

  // ── Playback interval ────────────────────────────────────────────────────
  const msPerFrame = useCallback((): number => {
    if (speed === 4) return 500;
    if (speed === 2) return 1000;
    return 2000;
  }, [speed]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!isPlaying || contents.length === 0) return;

    intervalRef.current = setInterval(() => {
      setPlayIndex(prev => {
        if (prev >= contents.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, msPerFrame());

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed, contents.length, msPerFrame]);

  // Stop playback when we reach the end
  useEffect(() => {
    if (playIndex >= contents.length - 1 && contents.length > 0) {
      setIsPlaying(false);
    }
  }, [playIndex, contents.length]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleEditorMount = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    // Apply initial content
    if (contents.length > 0) {
      editor.getModel()?.setValue(contents[0] ?? '');
    }
  }, [contents]);

  const handlePrev = useCallback(() => {
    setIsPlaying(false);
    setPlayIndex(prev => Math.max(0, prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setIsPlaying(false);
    setPlayIndex(prev => Math.min(contents.length - 1, prev + 1));
  }, [contents.length]);

  const cycleSpeed = useCallback(() => {
    setSpeed(s => s === 1 ? 2 : s === 2 ? 4 : 1);
  }, []);

  // ── Keyboard: Escape to close ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentVersion = versions[playIndex];
  const totalVersions = versions.length;
  const isLoading = contentsLoading;

  return (
    <div className="replay-overlay" role="dialog" aria-label="Session Replay">
      {/* ── Header bar ── */}
      <div className="replay-header">
        <div className="replay-header-left">
          <span className="replay-title">Session Replay</span>
          {currentVersion && (
            <span className="replay-version-badge">
              v{currentVersion.versionNumber}
              <span className="replay-version-sep">·</span>
              {currentVersion.createdBy.username}
            </span>
          )}
        </div>
        <button className="replay-close-btn" onClick={onClose} title="Close (Esc)">
          <X size={14} />
        </button>
      </div>

      {/* ── Main body ── */}
      <div className="replay-body">
        {/* ── Editor column ── */}
        <div className="replay-editor-col">
          {isLoading ? (
            <div className="replay-loading">Loading version history…</div>
          ) : loadError ? (
            <div className="replay-error">{loadError}</div>
          ) : (
            <Editor
              height="100%"
              language={language || 'plaintext'}
              theme="vs-dark"
              defaultValue={contents[0] ?? ''}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                fontSize: 13,
                renderLineHighlight: 'none',
                automaticLayout: true,
              }}
              onMount={handleEditorMount}
            />
          )}
        </div>

        {/* ── Narration column ── */}
        <div className="replay-narration-col">
          <div className="replay-narration-header">Narration</div>
          <div className="replay-narration-body">
            {narrationError ? (
              <div className="replay-narration-error">{narrationError}</div>
            ) : narrationText ? (
              <>
                <p className="replay-narration-text">{narrationText}</p>
                {narrationLoading && <span className="replay-narration-cursor" />}
              </>
            ) : (
              <div className="replay-narration-skeleton">
                <div className="replay-skeleton-line" style={{ width: '92%' }} />
                <div className="replay-skeleton-line" style={{ width: '78%' }} />
                <div className="replay-skeleton-line" style={{ width: '85%' }} />
                <div className="replay-skeleton-line" style={{ width: '60%' }} />
              </div>
            )}
            <div ref={narrationEndRef} />
          </div>

          {/* Version summary list */}
          {summaries.length > 0 && (
            <div className="replay-summaries">
              {summaries.map((s, i) => (
                <button
                  key={s.versionNumber}
                  className={`replay-summary-row${i === playIndex ? ' active' : ''}`}
                  onClick={() => { setIsPlaying(false); setPlayIndex(i); }}
                >
                  <span className="replay-summary-ver">v{s.versionNumber}</span>
                  <span className="replay-summary-user">{s.username}</span>
                  <span className="replay-summary-diff">
                    {s.linesAdded > 0 && <span className="replay-added">+{s.linesAdded}</span>}
                    {s.linesRemoved > 0 && <span className="replay-removed">−{s.linesRemoved}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="replay-controls">
        <button
          className="replay-ctrl-btn"
          onClick={handlePrev}
          disabled={playIndex === 0}
          title="Previous version"
        >
          <ChevronLeft size={14} />
        </button>

        <button
          className="replay-ctrl-btn replay-ctrl-play"
          onClick={() => setIsPlaying(p => !p)}
          disabled={isLoading || totalVersions < 2}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>

        <button
          className="replay-ctrl-btn"
          onClick={handleNext}
          disabled={playIndex >= totalVersions - 1}
          title="Next version"
        >
          <ChevronRight size={14} />
        </button>

        <button className="replay-speed-btn" onClick={cycleSpeed} title="Playback speed">
          {speed}×
        </button>

        <span className="replay-progress">
          {isLoading ? 'Loading…' : `Version ${playIndex + 1} of ${totalVersions}`}
        </span>
      </div>
    </div>
  );
};

export default ReplayPanel;