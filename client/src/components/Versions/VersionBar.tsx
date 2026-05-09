import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    GitCommit,
    Eye,
    SplitSquareHorizontal,
    RotateCcw,
    X,
} from 'lucide-react';
import { versionsAPI, Version } from '../../services/versionsAPI';
import { filesAPI } from '../../services/api';
import DiffViewer from './DiffViewer';
import './VersionBar.css';

type DisplayMode = 'hover' | 'diff';

interface VersionBarProps {
    fileId?: number;
    onRestore?: (versionId: number) => void;
}

const VersionBar: React.FC<VersionBarProps> = ({ fileId, onRestore }) => {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<DisplayMode>('hover');
    const [versions, setVersions] = useState<Version[]>([]);
    const [loading, setLoading] = useState(false);
    const [hoveredVersion, setHoveredVersion] = useState<Version | null>(null);
    const [hoveredEl, setHoveredEl] = useState<HTMLElement | null>(null);
    const [diffVersion, setDiffVersion] = useState<Version | null>(null);
    const [currentContent, setCurrentContent] = useState('');
    const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        if (!fileId) return;
        try {
            setLoading(true);
            const [verData, fileData] = await Promise.all([
                versionsAPI.getVersions(fileId),
                filesAPI.getFile(fileId),
            ]);
            setVersions(verData.versions);
            setCurrentContent(fileData.file.content || '');
        } catch {
            /* silent */
        } finally {
            setLoading(false);
        }
    }, [fileId]);

    useEffect(() => {
        if (open && fileId) load();
    }, [open, fileId, load]);

    // Reset panel when file changes
    useEffect(() => {
        setOpen(false);
        setVersions([]);
        setDiffVersion(null);
    }, [fileId]);

    const handleToggle = () => setOpen((o) => !o);

    const handleChipMouseEnter = (v: Version, el: HTMLElement) => {
        if (mode !== 'hover') return;
        if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
        setHoveredVersion(v);
        setHoveredEl(el);
    };

    const handleChipMouseLeave = () => {
        if (mode !== 'hover') return;
        closeTimeoutRef.current = setTimeout(() => {
            setHoveredVersion(null);
            setHoveredEl(null);
        }, 150);
    };

    const handleChipClick = (v: Version) => {
        if (mode === 'diff') {
            setDiffVersion(v);
        }
    };

    const handleRestore = async (v: Version, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!fileId) return;
        if (!window.confirm(`Restore to v${v.versionNumber}?`)) return;
        try {
            await versionsAPI.restoreVersion(fileId, v.id);
            onRestore?.(v.id);
            await load();
        } catch {
            /* silent */
        }
    };

    const formatTime = (iso: string) => {
        const ms = Date.now() - new Date(iso).getTime();
        const m = Math.floor(ms / 60000);
        if (m < 1) return 'now';
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h`;
        return `${Math.floor(h / 24)}d`;
    };

    if (!fileId) return null;

    return (
        <div className="version-bar">
            {/* ── Trigger strip ── */}
            <div className="vbar-strip">
                <button
                    className={`vbar-trigger ${open ? 'active' : ''}`}
                    onClick={handleToggle}
                    title="Version timeline"
                >
                    <GitCommit size={14} />
                </button>

                {open && (
                    <div className="vbar-panel">
                        {/* Mode toggles */}
                        <div className="vbar-mode-toggles">
                            <button
                                className={`vbar-mode-btn ${mode === 'hover' ? 'active' : ''}`}
                                onClick={() => setMode('hover')}
                                title="Hover mode — preview on hover"
                            >
                                <Eye size={13} />
                            </button>
                            <button
                                className={`vbar-mode-btn ${mode === 'diff' ? 'active' : ''}`}
                                onClick={() => setMode('diff')}
                                title="Diff mode — click to open diff view"
                            >
                                <SplitSquareHorizontal size={13} />
                            </button>
                        </div>

                        <div className="vbar-divider" />

                        {/* Version chips */}
                        <div className="vbar-chips-scroll">
                            {loading && <span className="vbar-loading">Loading...</span>}
                            {!loading && versions.length === 0 && (
                                <span className="vbar-empty">No versions</span>
                            )}
                            {!loading && versions.map((v) => (
                                <div
                                    key={v.id}
                                    className={`vbar-chip ${mode === 'diff' ? 'clickable' : ''}`}
                                    onMouseEnter={(e) => handleChipMouseEnter(v, e.currentTarget)}
                                    onMouseLeave={handleChipMouseLeave}
                                    onClick={() => handleChipClick(v)}
                                    title={`Version ${v.versionNumber} · ${new Date(v.createdAt).toLocaleString()}`}
                                >
                                    <span className="chip-label">v{v.versionNumber}</span>
                                    <span className="chip-time">{formatTime(v.createdAt)}</span>

                                    {/* Per-chip hover actions */}
                                    <span className="chip-actions">
                                        <button
                                            className="chip-action-btn"
                                            title="Restore this version"
                                            onClick={(e) => handleRestore(v, e)}
                                        >
                                            <RotateCcw size={11} />
                                        </button>
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Close */}
                        <button className="vbar-close" onClick={() => setOpen(false)} title="Close">
                            <X size={13} />
                        </button>
                    </div>
                )}
            </div>

            {/* ── Hover mode popover ── */}
            {mode === 'hover' && hoveredVersion && hoveredEl && (
                <HoverPopover
                    version={hoveredVersion}
                    anchorEl={hoveredEl}
                    onMouseEnter={() => {
                        if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
                    }}
                    onMouseLeave={() => {
                        setHoveredVersion(null);
                        setHoveredEl(null);
                    }}
                />
            )}

            {/* ── Diff mode modal ── */}
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

/* ── Hover Popover ── */
interface HoverPopoverProps {
    version: Version;
    anchorEl: HTMLElement;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

const HoverPopover: React.FC<HoverPopoverProps> = ({
    version,
    anchorEl,
    onMouseEnter,
    onMouseLeave,
}) => {
    const rect = anchorEl.getBoundingClientRect();

    const style: React.CSSProperties = {
        position: 'fixed',
        top: rect.bottom + 6,
        left: rect.left,
        zIndex: 9999,
    };

    return (
        <div
            className="vbar-popover"
            style={style}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className="popover-header">
                <span className="popover-ver">v{version.versionNumber}</span>
                <span className="popover-date">{new Date(version.createdAt).toLocaleString()}</span>
            </div>
            <div className="popover-meta">{version.fileSize} bytes</div>
            {version.commitMessage && (
                <div className="popover-message">{version.commitMessage}</div>
            )}
            <div className="popover-hint">
                <Eye size={10} /> Hover mode — switch to <SplitSquareHorizontal size={10} /> for diff
            </div>
        </div>
    );
};

export default VersionBar;
