import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GitCommit, SplitSquareHorizontal, RotateCcw, X, MousePointer2 } from 'lucide-react';
import { versionsAPI, Version } from '../../services/versionsAPI';
import { filesAPI } from '../../services/api';
import { Editor } from '@monaco-editor/react';
import DiffViewer from './DiffViewer';
import './TimelineScrubber.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimelineScrubberProps {
  fileId?: number;
  language?: string;
  onRestore?: (versionId: number) => void;
}

export interface Session {
  startVersion: Version;
  endVersion: Version;
  versions: Version[];
  type: 'active' | 'restore' | 'manual';
}

export type MarkerType = 'session-end' | 'auto' | 'restore' | 'manual';
type ScrubMode = 'navigate' | 'diff';

export const SESSION_GAP_MS = 30 * 60 * 1000;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function getMarkerType(v: Version): MarkerType {
  const msg = (v.commitMessage || '').toLowerCase();
  if (msg.includes('restored')) return 'restore';
  if (
    msg.includes('session end') ||
    msg.includes('session checkpoint') ||
    msg.includes('auto-checkpoint')
  ) return 'session-end';
  if (msg.includes('auto-save') || msg.includes('checkpoint') || msg.includes('initial')) return 'auto';
  return 'manual';
}

export function buildSession(vers: Version[]): Session {
  const allMessages = vers.map(v => (v.commitMessage || '').toLowerCase());
  const hasRestore = allMessages.some(m => m.includes('restored'));
  const allAuto = allMessages.every(m =>
    /session end|session checkpoint|auto-checkpoint|auto-save|checkpoint|initial/.test(m)
  );
  return {
    startVersion: vers[0],
    endVersion: vers[vers.length - 1],
    versions: vers,
    type: hasRestore ? 'restore' : allAuto ? 'active' : 'manual',
  };
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Strip the auto-generated " — May 10, 01:15" timestamp suffix from commit messages
export function stripTimestamp(msg: string): string {
  return msg.replace(/\s*[—–-]\s*\w+\s+\d+,?\s+\d{1,2}:\d{2}\s*(AM|PM)?.*$/i, '').trim();
}

// Time-axis position: maps a version's createdAt to a 0–1 value within [timeMin, timeMax]
export function calcPosition(createdAt: string, timeMin: number, timeSpan: number): number {
  if (timeSpan === 0) return 0;
  return Math.max(0, Math.min(1, (new Date(createdAt).getTime() - timeMin) / timeSpan));
}

// Groups a sorted-ascending Version array into clusters separated by gapMs
export function groupVersionsIntoSessions(
  versions: Version[],
  gapMs: number = SESSION_GAP_MS
): Version[][] {
  if (versions.length === 0) return [];
  const groups: Version[][] = [];
  let current: Version[] = [versions[0]];
  for (let i = 1; i < versions.length; i++) {
    const gap =
      new Date(versions[i].createdAt).getTime() -
      new Date(versions[i - 1].createdAt).getTime();
    if (gap < gapMs) {
      current.push(versions[i]);
    } else {
      groups.push(current);
      current = [versions[i]];
    }
  }
  groups.push(current);
  return groups;
}

// ─── Component ────────────────────────────────────────────────────────────────

const TimelineScrubber: React.FC<TimelineScrubberProps> = ({ fileId, language, onRestore }) => {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentContent, setCurrentContent] = useState('');
  const [activeVersion, setActiveVersion] = useState<Version | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mode, setMode] = useState<ScrubMode>('navigate');
  const [diffVersion, setDiffVersion] = useState<Version | null>(null);

  const contentCacheRef = useRef<Map<number, string>>(new Map());
  const activeRowRef = useRef<HTMLDivElement>(null);

  // ─── Session grouping ────────────────────────────────────────────────────────

  const sessions = useMemo((): Session[] => {
    return groupVersionsIntoSessions(versions).map(buildSession);
  }, [versions]);

  // ─── Content loading (cached) ────────────────────────────────────────────────

  const loadVersionContent = useCallback(async (version: Version) => {
    if (!fileId) return;
    const cached = contentCacheRef.current.get(version.id);
    if (cached !== undefined) {
      setPreviewContent(cached);
      return;
    }
    setPreviewLoading(true);
    try {
      const data = await versionsAPI.getVersionContent(fileId, version.id);
      contentCacheRef.current.set(version.id, data.version.content);
      setPreviewContent(data.version.content);
    } catch {
      setPreviewContent(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [fileId]);

  // ─── Fetch on fileId change ──────────────────────────────────────────────────

  useEffect(() => {
    if (!fileId) {
      setVersions([]);
      setActiveVersion(null);
      setPreviewContent(null);
      setDiffVersion(null);
      setMode('navigate');
      contentCacheRef.current.clear();
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      versionsAPI.getVersions(fileId),
      filesAPI.getFile(fileId),
    ])
      .then(([verData, fileData]) => {
        if (cancelled) return;
        const sorted = [...verData.versions].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        setVersions(sorted);
        setCurrentContent(fileData.file.content || '');
      })
      .catch(() => { if (!cancelled) setVersions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fileId]);

  // Scroll active row into view when it changes
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeVersion?.id]);

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const handleRestore = useCallback(async (version: Version) => {
    if (!fileId) return;
    if (!window.confirm(`Restore to v${version.versionNumber}?`)) return;
    try {
      await versionsAPI.restoreVersion(fileId, version.id);
      onRestore?.(version.id);
      const verData = await versionsAPI.getVersions(fileId);
      const sorted = [...verData.versions].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setVersions(sorted);
      setActiveVersion(null);
      setPreviewContent(null);
      contentCacheRef.current.clear();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to restore version');
    }
  }, [fileId, onRestore]);

  const handleMarkerClick = useCallback((v: Version) => {
    if (mode === 'diff') {
      setDiffVersion(v);
      return;
    }
    setActiveVersion(v);
    loadVersionContent(v);
  }, [mode, loadVersionContent]);

  // ─── Guard ────────────────────────────────────────────────────────────────────

  if (!fileId) return null;

  // ─── Render ───────────────────────────────────────────────────────────────────

  const showPreview = activeVersion !== null && mode === 'navigate';

  // Sessions newest-first for display
  const displaySessions = [...sessions].reverse();

  const sessionLabel = (type: Session['type']) => {
    if (type === 'restore') return 'restored';
    if (type === 'manual') return 'checkpoint';
    return 'session';
  };

  return (
    <div className="ts-sidebar">

      {/* ── Header ── */}
      <div className="ts-sidebar-header">
        <div className="ts-sidebar-title">
          <GitCommit size={11} />
          <span>HISTORY</span>
          {versions.length > 0 && (
            <span className="ts-count">{versions.length}</span>
          )}
        </div>
        <div className="ts-controls">
          {mode === 'diff' && <span className="ts-mode-hint">click to diff</span>}
          <button
            className={`ts-mode-btn${mode === 'navigate' ? ' active' : ''}`}
            onClick={() => { setMode('navigate'); setDiffVersion(null); }}
            title="Navigate — click to preview a version"
          >
            <MousePointer2 size={11} />
          </button>
          <button
            className={`ts-mode-btn${mode === 'diff' ? ' active' : ''}`}
            onClick={() => { setMode('diff'); setActiveVersion(null); setPreviewContent(null); }}
            title="Compare — click a version to open diff view"
          >
            <SplitSquareHorizontal size={11} />
          </button>
        </div>
      </div>

      {/* ── Version list ── */}
      <div className="ts-list">
        {loading && <div className="ts-empty">Loading…</div>}
        {!loading && versions.length === 0 && (
          <div className="ts-empty">No versions yet</div>
        )}

        {displaySessions.map((session, si) => (
          <div key={si} className={`ts-session-group ts-session-group--${session.type}`}>
            <div className="ts-session-header">
              <span className="ts-session-date">
                {new Date(session.endVersion.createdAt).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric',
                })}
              </span>
              <span className={`ts-session-badge ts-session-badge--${session.type}`}>
                {sessionLabel(session.type)}
              </span>
            </div>

            {[...session.versions].reverse().map(v => {
              const mType = getMarkerType(v);
              const isActive = activeVersion?.id === v.id;
              const label = v.description || (v.commitMessage ? stripTimestamp(v.commitMessage) : null);
              return (
                <div
                  key={v.id}
                  ref={isActive ? activeRowRef : undefined}
                  className={`ts-row ts-row--${mType}${isActive ? ' ts-row--active' : ''}`}
                  onClick={() => handleMarkerClick(v)}
                >
                  <div className="ts-row-marker" />
                  <div className="ts-row-body">
                    <div className="ts-row-top">
                      <span className="ts-row-ver">v{v.versionNumber}</span>
                      <span className="ts-row-rel">{formatRelative(v.createdAt)}</span>
                      <span className="ts-row-author">{v.createdBy.username}</span>
                    </div>
                    {label && <div className="ts-row-msg">{label}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Preview panel (bottom of sidebar) ── */}
      {showPreview && (
        <div className="ts-sidebar-preview">
          <div className="ts-preview-header">
            <div className="ts-preview-meta">
              <span className="ts-preview-ver">v{activeVersion.versionNumber}</span>
              <span className="ts-preview-dot">·</span>
              <span className="ts-preview-time">
                {formatTimestamp(activeVersion.createdAt)}
              </span>
            </div>
            <div className="ts-preview-actions">
              <button
                className="ts-action-btn"
                onClick={() => { setMode('diff'); setDiffVersion(activeVersion); }}
                title="Compare with current"
              >
                <SplitSquareHorizontal size={11} />
              </button>
              <button
                className="ts-action-btn ts-action-restore"
                onClick={() => handleRestore(activeVersion)}
                title="Restore to this version"
              >
                <RotateCcw size={11} />
                Restore
              </button>
              <button
                className="ts-action-btn ts-action-close"
                onClick={() => { setActiveVersion(null); setPreviewContent(null); }}
                title="Close preview"
              >
                <X size={11} />
              </button>
            </div>
          </div>
          <div className="ts-preview-editor">
            {previewLoading && (
              <div className="ts-preview-placeholder">Loading…</div>
            )}
            {!previewLoading && previewContent === null && (
              <div className="ts-preview-placeholder ts-preview-error">
                Failed to load content
              </div>
            )}
            {!previewLoading && previewContent !== null && (
              <Editor
                key={activeVersion.id}
                height="100%"
                language={language || 'plaintext'}
                value={previewContent}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  automaticLayout: true,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  fontSize: 11,
                  renderLineHighlight: 'none',
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── DiffViewer ── */}
      {mode === 'diff' && diffVersion && (
        <DiffViewer
          fileId={fileId}
          versionId={diffVersion.id}
          currentContent={currentContent}
          onClose={() => setDiffVersion(null)}
        />
      )}
    </div>
  );
};

export default TimelineScrubber;