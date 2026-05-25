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
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredMarker, setHoveredMarker] = useState<{ version: Version; rect: DOMRect } | null>(null);

  const timelineRef = useRef<HTMLDivElement>(null);
  const contentCacheRef = useRef<Map<number, string>>(new Map());
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Time axis ──────────────────────────────────────────────────────────────

  const timeMin = useMemo(() => {
    if (versions.length === 0) return 0;
    return new Date(versions[0].createdAt).getTime();
  }, [versions]);

  const timeMax = useMemo(() => {
    if (versions.length === 0) return Date.now();
    // Always extend to now so the last version isn't flush with the right edge
    return Math.max(Date.now(), new Date(versions[versions.length - 1].createdAt).getTime() + 1000);
  }, [versions]);

  const timeSpan = timeMax - timeMin;

  const positionOf = useCallback((v: Version): number => {
    return calcPosition(v.createdAt, timeMin, timeSpan);
  }, [timeMin, timeSpan]);

  // ─── Session grouping ────────────────────────────────────────────────────────

  const sessions = useMemo((): Session[] => {
    return groupVersionsIntoSessions(versions).map(buildSession);
  }, [versions]);

  // ─── Nearest version to a 0–1 position ──────────────────────────────────────

  const findNearestVersion = useCallback((pct: number): Version | null => {
    if (versions.length === 0) return null;
    return versions.reduce((best, v) =>
      Math.abs(positionOf(v) - pct) < Math.abs(positionOf(best) - pct) ? v : best
    );
  }, [versions, positionOf]);

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

  // ─── Drag handling ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const nearest = findNearestVersion(pct);
      if (!nearest) return;
      setActiveVersion(prev => (prev?.id === nearest.id ? prev : nearest));
      const cached = contentCacheRef.current.get(nearest.id);
      if (cached !== undefined) {
        setPreviewContent(cached);
      } else {
        loadVersionContent(nearest);
      }
    };
    const onUp = () => setIsDragging(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, findNearestVersion, loadVersionContent]);

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

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.ts-marker, .ts-handle')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nearest = findNearestVersion(pct);
    if (nearest) handleMarkerClick(nearest);
  }, [findNearestVersion, handleMarkerClick]);

  const handleMarkerMouseEnter = useCallback((v: Version, e: React.MouseEvent<HTMLDivElement>) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredMarker({ version: v, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
  }, []);

  const handleMarkerMouseLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => setHoveredMarker(null), 200);
  }, []);

  // ─── Guard ────────────────────────────────────────────────────────────────────

  if (!fileId) return null;

  // ─── Render ───────────────────────────────────────────────────────────────────

  const showPreview = activeVersion !== null && mode === 'navigate';

  return (
    <div className="ts-scrubber">

      {/* ── Preview panel ── */}
      {showPreview && (
        <div className="ts-preview">
          <div className="ts-preview-header">
            <div className="ts-preview-meta">
              <span className="ts-preview-ver">v{activeVersion.versionNumber}</span>
              <span className="ts-preview-dot">·</span>
              <span className="ts-preview-time">{formatTimestamp(activeVersion.createdAt)}</span>
              <span className="ts-preview-dot">·</span>
              <span className="ts-preview-author">{activeVersion.createdBy.username}</span>
              {activeVersion.commitMessage && (
                <>
                  <span className="ts-preview-dot">·</span>
                  <span className="ts-preview-msg">
                    {activeVersion.description || stripTimestamp(activeVersion.commitMessage)}
                  </span>
                </>
              )}
            </div>
            <div className="ts-preview-actions">
              <button
                className="ts-action-btn"
                onClick={() => { setMode('diff'); setDiffVersion(activeVersion); }}
                title="Compare with current"
              >
                <SplitSquareHorizontal size={11} />
                Compare
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
                Failed to load version content
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
                  fontSize: 12,
                  renderLineHighlight: 'none',
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Rail ── */}
      <div className="ts-rail">

        {/* Affordance — always visible */}
        <div className="ts-afford">
          <GitCommit size={11} />
          <span className="ts-afford-label">
            {loading ? '…' : versions.length === 0 ? 'no versions' : `${versions.length}v`}
          </span>
        </div>

        {/* Timeline — the proportional time axis */}
        <div className="ts-timeline" ref={timelineRef} onClick={handleTimelineClick}>
          {/* Background track line */}
          <div className="ts-track" />

          {/* Session blocks */}
          {sessions.map((session, i) => {
            const left = positionOf(session.startVersion) * 100;
            const width = (positionOf(session.endVersion) - positionOf(session.startVersion)) * 100;
            return (
              <div
                key={i}
                className={`ts-block ts-block--${session.type}`}
                style={{ left: `${left}%`, width: `calc(${width}% + 4px)` }}
              />
            );
          })}

          {/* Version markers */}
          {versions.map(v => {
            const mType = getMarkerType(v);
            const isActive = activeVersion?.id === v.id;
            return (
              <div
                key={v.id}
                className={`ts-marker ts-marker--${mType}${isActive ? ' ts-marker--active' : ''}`}
                style={{ left: `${positionOf(v) * 100}%` }}
                onClick={e => { e.stopPropagation(); handleMarkerClick(v); }}
                onMouseEnter={e => handleMarkerMouseEnter(v, e)}
                onMouseLeave={handleMarkerMouseLeave}
              />
            );
          })}

          {/* Scrub handle */}
          {activeVersion && mode === 'navigate' && (
            <div
              className="ts-handle"
              style={{ left: `${positionOf(activeVersion) * 100}%` }}
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(true);
              }}
            />
          )}
        </div>

        {/* Mode controls */}
        <div className="ts-controls">
          {mode === 'diff' && (
            <span className="ts-mode-hint">click marker to diff</span>
          )}
          <button
            className={`ts-mode-btn${mode === 'navigate' ? ' active' : ''}`}
            onClick={e => {
              e.stopPropagation();
              setMode('navigate');
              setDiffVersion(null);
            }}
            title="Navigate — click or drag to preview a version"
          >
            <MousePointer2 size={11} />
          </button>
          <button
            className={`ts-mode-btn${mode === 'diff' ? ' active' : ''}`}
            onClick={e => {
              e.stopPropagation();
              setMode('diff');
              setActiveVersion(null);
              setPreviewContent(null);
            }}
            title="Compare — click a marker to open diff view"
          >
            <SplitSquareHorizontal size={11} />
          </button>
        </div>
      </div>

      {/* ── Marker tooltip ── */}
      {hoveredMarker && (
        <MarkerTooltip
          version={hoveredMarker.version}
          anchorRect={hoveredMarker.rect}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
          }}
          onMouseLeave={() => setHoveredMarker(null)}
          onRestore={() => {
            setHoveredMarker(null);
            handleRestore(hoveredMarker.version);
          }}
          onCompare={() => {
            setHoveredMarker(null);
            setMode('diff');
            setActiveVersion(null);
            setPreviewContent(null);
            setDiffVersion(hoveredMarker.version);
          }}
        />
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

// ─── Marker Tooltip ───────────────────────────────────────────────────────────

interface MarkerTooltipProps {
  version: Version;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onRestore: () => void;
  onCompare: () => void;
}

const MarkerTooltip: React.FC<MarkerTooltipProps> = ({
  version,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  onRestore,
  onCompare,
}) => {
  const left = Math.max(4, Math.min(window.innerWidth - 224, anchorRect.left - 80));
  const top = anchorRect.bottom + 6;
  const label = version.description || (version.commitMessage ? stripTimestamp(version.commitMessage) : null);

  return (
    <div
      className="ts-tooltip"
      style={{ position: 'fixed', left, top, zIndex: 9999 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="ts-tooltip-header">
        <span className="ts-tooltip-ver">v{version.versionNumber}</span>
        <span className="ts-tooltip-time">{formatTimestamp(version.createdAt)}</span>
      </div>
      <div className="ts-tooltip-author">
        {version.createdBy.username} · {formatRelative(version.createdAt)}
      </div>
      {label && <div className="ts-tooltip-msg">{label}</div>}
      <div className="ts-tooltip-actions">
        <button className="ts-tooltip-btn" onClick={onRestore}>
          <RotateCcw size={10} /> Restore
        </button>
        <button className="ts-tooltip-btn" onClick={onCompare}>
          <SplitSquareHorizontal size={10} /> Compare
        </button>
      </div>
    </div>
  );
};

export default TimelineScrubber;