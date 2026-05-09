import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@monaco-editor/react';
import { useAuth } from '../../context/AuthContext';
import { filesAPI, projectsAPI } from '../../services/api';
import { File } from '../../types';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import type { editor as MonacoEditor } from 'monaco-editor';
import ActivityBar, { ActivityBarView } from './ActivityBar';
import Sidebar from './Sidebar';
import EditorTabs from './EditorTabs';
import EditorToolbar from './EditorToolbar';
import VersionBar from '../Versions/VersionBar';
import { sha256Hex } from '../../utils/hash';
import './VSCodeEditor.css';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Sequential sync phases for each file.
 * Transitions are strictly linear: Connecting → Syncing → Ready | Fallback.
 * Fallback is recoverable: a successful reconnect transitions back to Syncing.
 */
type FileSyncPhase = 'connecting' | 'syncing' | 'ready' | 'fallback';

/** Per-file display metadata — kept in React state for UI rendering */
interface OpenFileDisplay {
  file: File;
  isDirty: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
}

/** Long-lived Yjs objects — kept in refs, never in React state */
interface FileSyncState {
  fileId: number;
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  ytext: Y.Text;
  /** Current sync phase — stored in the ref so callbacks always read current value */
  phase: FileSyncPhase;
  /** SHA-256 hex hash of files.content from the REST response (optional — may be absent) */
  contentHash: string | undefined;
  /** Disposer: tear down everything for this file */
  destroy: () => void;
}

/** The currently active Monaco↔Yjs binding (one at a time) */
interface ActiveBinding {
  fileId: number;
  binding: MonacoBinding;
  destroy: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Tier-1 timeout (ms): show a "taking longer than expected" warning.
 * Phase stays at 'syncing'. Nothing is cancelled. UI signal only.
 */
const SYNC_WARN_TIMEOUT_MS = 5_000;

/**
 * Tier-2 timeout (ms): transition to fallback read-only mode.
 * Only fires if the WebSocket sync has not completed by this point.
 */
const SYNC_FALLBACK_TIMEOUT_MS = 15_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Palette of clearly-distinguishable blue-family cursor colours */
const CURSOR_COLOURS = [
  '#3b82f6', '#60a5fa', '#93c5fd',
  '#1d4ed8', '#2563eb', '#7dd3fc',
];

function pickCursorColour(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return CURSOR_COLOURS[Math.abs(hash) % CURSOR_COLOURS.length];
}

function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go',
    rs: 'rust', java: 'java', cs: 'csharp',
    cpp: 'cpp', c: 'c', h: 'c',
    json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', html: 'html', css: 'css',
    sql: 'sql', sh: 'shell',
  };
  return map[ext] ?? 'plaintext';
}

// ─── Component ───────────────────────────────────────────────────────────────

const VSCodeEditor: React.FC = () => {
  const { fileId: routeFileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // ── UI / display state ──────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ActivityBarView>('files');
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const [openFiles, setOpenFiles] = useState<Map<number, OpenFileDisplay>>(new Map());
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectFiles, setProjectFiles] = useState<File[]>([]);
  const [connectedUsers, setConnectedUsers] = useState(0);
  const [connectionStatus, setConnectionStatus] =
    useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Refs: own Yjs & Monaco lifetime ─────────────────────────────────────
  /** Mounted Monaco editor instance */
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  /**
   * Map of fileId → FileSyncState.
   * Kept alive across tab switches so peers stay connected while the file is open.
   * Destroyed only when the tab is explicitly closed.
   */
  const fileSyncMap = useRef<Map<number, FileSyncState>>(new Map());

  /**
   * The single MonacoBinding that's currently live.
   * Replaced atomically every time the active tab changes.
   */
  const activeBindingRef = useRef<ActiveBinding | null>(null);

  /** Auto-save interval handle, cleared on file switch */
  const saveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // CORE: Destroy and recreate the MonacoBinding when the active file changes
  // ─────────────────────────────────────────────────────────────────────────

  const tearDownActiveBinding = useCallback(() => {
    if (activeBindingRef.current) {
      activeBindingRef.current.destroy();
      activeBindingRef.current = null;
    }
    if (saveIntervalRef.current) {
      clearInterval(saveIntervalRef.current);
      saveIntervalRef.current = null;
    }
  }, []);

  /**
   * createBinding: wire the Monaco editor to the Yjs state for `fileId`.
   * Called from the activeFileId effect (Fix A) and from handleEditorMount.
   */
  const createBinding = useCallback((fileId: number, editor: MonacoEditor.IStandaloneCodeEditor) => {
    const sync = fileSyncMap.current.get(fileId);
    if (!sync) return;

    const model = editor.getModel();
    if (!model) return;

    console.log(`[CREATE-BINDING] fileId=${fileId}`);

    // Wipe previous binding atomically
    tearDownActiveBinding();

    const binding = new MonacoBinding(
      sync.ytext,
      model,
      new Set([editor]),
      sync.provider.awareness
    );

    // Patch the MonacoBinding instance's own destroy() method to be idempotent.
    // y-monaco registers editor.onDidDispose(() => this.destroy()) in its
    // constructor. When key={activeFileId} unmounts the old Monaco editor,
    // onDidDispose fires and calls binding.destroy() directly on the instance —
    // bypassing any wrapper we put on activeBindingRef.current.destroy.
    // tearDownActiveBinding() then calls binding.destroy() a second time,
    // producing "Tried to remove event handler that doesn't exist".
    // Patching the instance method means both call paths share the same flag.
    const originalDestroy = binding.destroy.bind(binding);
    let bindingDestroyed = false;
    binding.destroy = () => {
      if (!bindingDestroyed) {
        bindingDestroyed = true;
        originalDestroy();
      }
    };

    activeBindingRef.current = { fileId, binding, destroy: () => binding.destroy() };

    // Auto-save every 5 s (only for the active file)
    saveIntervalRef.current = setInterval(() => {
      saveFile(fileId);
    }, 5000);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tearDownActiveBinding]);

  // ── Sync phase UI state (React state drives banners; refs drive logic) ──────
  const [syncPhase, setSyncPhase] = useState<FileSyncPhase>('connecting');
  const [showSlowWarning, setShowSlowWarning] = useState(false);

  /**
   * Stable ref that always holds the current active file id.
   * Used by async callbacks (onSync, enterFallback, onStatusChange) to
   * determine whether they are still operating on the visible file.
   * React state (activeFileId) is stale in closures; this ref is not.
   */
  const activeFileIdRef = useRef<number | null>(null);

  /**
   * ensureFileSyncState — sequential four-phase state machine.
   *
   * Phases: Connecting → Syncing → Ready | Fallback
   * Fallback is recoverable: reconnect transitions back to Syncing.
   *
   * FIX 1: provider is created with connect:false. ALL listeners are attached
   * before provider.connect() is called, ensuring the sync event cannot fire
   * before onSync is registered regardless of how fast the server responds.
   *
   * FIX 2: every async callback that touches editorRef.current checks
   * activeFileIdRef.current === file.id before mutating the visible editor.
   * Callbacks for inactive files update per-file state in fileSyncMap only.
   *
   * INVARIANT: file.content (REST string) is NEVER inserted into the Y.Doc.
   * Only the YJS sync delivers authoritative document content.
   * file.content is used only in Fallback mode (read-only Monaco setValue).
   *
   * NOTE: handleVersionRestore destroys and reopens the file, which re-enters
   * this function fresh. The hash verification check will produce a mismatch
   * immediately after a version restore because the YJS server still holds the
   * pre-restore CRDT state until Redis/memory are flushed. This is a known
   * expected failure that Workstream 2 will resolve. Do not add a workaround
   * for the restore path here.
   */
  const ensureFileSyncState = useCallback(
    async (file: File): Promise<FileSyncState> => {
      if (fileSyncMap.current.has(file.id)) {
        return fileSyncMap.current.get(file.id)!;
      }

      // ── Phase: Connecting ────────────────────────────────────────────────
      // Extract only metadata from the REST response.
      // file.content is intentionally not stored in any variable here.
      const restContentHash: string | undefined = file.contentHash;
      const isReadOnly = file.permission ? !file.permission.canWrite : false;

      setSyncPhase('connecting');
      setShowSlowWarning(false);

      const ydoc = new Y.Doc();
      const ytext = ydoc.getText('monaco');

      // ── FIX 1: create provider with connect:false ─────────────────────────
      // All event listeners must be attached before connect() is called.
      // With connect:true the WebSocket handshake starts immediately and the
      // sync event can fire before provider.on('sync', onSync) is reached,
      // silently dropping it and leaving the phase stuck at 'connecting'.
      const provider = new WebsocketProvider(
        'ws://localhost:1234',
        `file-${file.id}`,
        ydoc,
        { connect: false }  // ← deliberately not connecting yet
      );

      if (user) {
        provider.awareness.setLocalStateField('user', {
          name: user.username,
          color: pickCursorColour(user.username),
        });
      }

      // Build the FileSyncState immediately so reconnection callbacks have
      // access to it. Phase starts at 'connecting' and is updated via the ref.
      const syncState: FileSyncState = {
        fileId: file.id,
        ydoc,
        provider,
        ytext,
        phase: 'connecting',
        contentHash: restContentHash,
        destroy: () => {
          // 1. Cancel both timeout timers
          if (warnTimerRef.current) { clearTimeout(warnTimerRef.current); warnTimerRef.current = null; }
          if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
          // 2. Remove provider event listeners — guarded by registration flags.
          //    onSync removes itself inside its own body (provider.off inside onSync).
          //    If sync has already completed, onSyncRegistered is false and this
          //    call would produce "Tried to remove event handler that doesn't exist".
          if (onSyncRegistered.current) {
            provider.off('sync', onSync);
            onSyncRegistered.current = false;
          }
          provider.off('status', onStatusChange);
          // 3. Tear down the provider and Y.Doc
          provider.awareness.setLocalState(null);
          provider.disconnect();
          provider.destroy();
          ydoc.destroy();
          // 4. Remove from the shared map
          fileSyncMap.current.delete(file.id);
        },
      };

      // Timer refs stored on the syncState closure so destroy() can cancel them.
      const warnTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
      const fallbackTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
      // Tracks whether provider.on('sync', onSync) is currently registered.
      // onSync removes itself when it fires; destroy() checks this to avoid
      // calling provider.off('sync', onSync) a second time (which produces
      // "Tried to remove event handler that doesn't exist" from y-js EventHandler).
      const onSyncRegistered = { current: false };

      // ── Awareness: connected user count ──────────────────────────────────
      provider.awareness.on('change', () => {
        const unique = new Set(
          Array.from(provider.awareness.getStates().values())
            .filter((s: any) => s.user)
            .map((s: any) => s.user.name)
        );
        setConnectedUsers(unique.size);
      });

      // ── Dirty flag ───────────────────────────────────────────────────────
      ytext.observe(() => {
        setOpenFiles(prev => {
          const next = new Map(prev);
          const entry = next.get(file.id);
          if (entry && !entry.isDirty) next.set(file.id, { ...entry, isDirty: true });
          return next;
        });
      });

      /**
       * enterFallback: transition to read-only mode using the REST content.
       * Called only from the tier-2 timer.
       *
       * FIX 2: guards editorRef.current access with activeFileIdRef.
       * If this file is no longer the active tab, the phase transition is
       * recorded in syncState but the visible editor is not touched.
       */
      const enterFallback = () => {
        if (syncState.phase === 'ready') return;
        syncState.phase = 'fallback';
        setShowSlowWarning(false);

        const isActive = activeFileIdRef.current === file.id;
        if (isActive) {
          setSyncPhase('fallback');
          console.warn(`[SYNC-FALLBACK] fileId=${file.id}`);
          if (editorRef.current) {
            editorRef.current.getModel()?.setValue(file.content ?? '');
            editorRef.current.updateOptions({ readOnly: true });
          }
        } else {
          console.warn(`[SYNC-FALLBACK-IGNORED-INACTIVE] fileId=${file.id} activeFileId=${activeFileIdRef.current}`);
          // Phase recorded; visible editor belongs to a different file — do not touch it.
        }
      };

      /**
       * Status handler — also handles reconnection from fallback.
       *
       * FIX 2: guards all editorRef.current and setSyncPhase calls with
       * activeFileIdRef so an inactive file's reconnect does not clear the
       * currently visible editor or show incorrect phase banners.
       */
      const onStatusChange = ({ status }: { status: string }) => {
        // Connection status badge is per-editor (not per-file) — only update
        // it for the active file to avoid showing the wrong file's status.
        if (activeFileIdRef.current === file.id) {
          setConnectionStatus(status as any);
        }

        if (status === 'connected') {
          const currentPhase = syncState.phase;
          const isActive = activeFileIdRef.current === file.id;

          if (currentPhase === 'connecting') {
            // ── Phase: Syncing ────────────────────────────────────────────
            syncState.phase = 'syncing';
            if (isActive) setSyncPhase('syncing');

            // Tier-1 timer: warning banner only, no phase change
            warnTimerRef.current = setTimeout(() => {
              if (syncState.phase === 'syncing' && activeFileIdRef.current === file.id) {
                setShowSlowWarning(true);
              }
            }, SYNC_WARN_TIMEOUT_MS);

            // Tier-2 timer: actual fallback transition
            fallbackTimerRef.current = setTimeout(() => {
              if (syncState.phase === 'syncing') {
                enterFallback();
              }
            }, SYNC_FALLBACK_TIMEOUT_MS);

          } else if (currentPhase === 'fallback') {
            // ── Reconnection from fallback ────────────────────────────────
            syncState.phase = 'syncing';

            if (isActive) {
              console.log(`[SYNC-RECONNECT] fileId=${file.id} — reconnected from fallback`);
              setSyncPhase('syncing');
              setShowSlowWarning(false);
              // Clear REST fallback content and restore editor to writable.
              if (editorRef.current) {
                editorRef.current.getModel()?.setValue('');
                editorRef.current.updateOptions({ readOnly: isReadOnly });
              }
            } else {
              console.log(`[SYNC-IGNORED-INACTIVE] fileId=${file.id} activeFileId=${activeFileIdRef.current} — reconnect from fallback, editor not touched`);
            }

            // Restart timers regardless of active state — the file is reconnecting.
            if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
            if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);

            warnTimerRef.current = setTimeout(() => {
              if (syncState.phase === 'syncing' && activeFileIdRef.current === file.id) {
                setShowSlowWarning(true);
              }
            }, SYNC_WARN_TIMEOUT_MS);

            fallbackTimerRef.current = setTimeout(() => {
              if (syncState.phase === 'syncing') enterFallback();
            }, SYNC_FALLBACK_TIMEOUT_MS);
          }
        }
      };

      /**
       * onSync handler — the ONLY path to the 'ready' phase.
       *
       * FIX 2: guards createBinding and all editorRef.current mutations with
       * activeFileIdRef so file A's sync completing after a switch to file B
       * does not bind file A's ytext to file B's editor.
       */
      const onSync = async (synced: boolean) => {
        console.log(`[SYNC-EVENT] fileId=${file.id} synced=${synced}`);
        if (!synced) return;
        if (syncState.phase !== 'syncing') return;

        // Cancel both timers.
        if (warnTimerRef.current) { clearTimeout(warnTimerRef.current); warnTimerRef.current = null; }
        if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }

        provider.off('sync', onSync);
        onSyncRegistered.current = false;

        // ── Integrity verification ────────────────────────────────────────
        const ydocContent = ytext.toString();

        if (restContentHash === undefined) {
          console.warn(
            `[SYNC-VERIFY] fileId=${file.id} — contentHash absent, skipping hash comparison.`
          );
        } else {
          const ydocHash = await sha256Hex(ydocContent);

          if (ydocHash === restContentHash) {
            console.log(`[SYNC-VERIFY] fileId=${file.id} hash=MATCH`);
          } else {
            // Hash mismatch: Y.Doc content and PostgreSQL files.content differ.
            // This is EXPECTED in normal operation: Redis (and therefore Y.Doc) is
            // ahead of PostgreSQL whenever there are unsaved edits (diffMs < 0 in
            // [REDIS-STALENESS] logs). The 5-second auto-save closes this gap.
            //
            // A reload here causes an infinite loop because the mismatch persists
            // until the next auto-save completes. The background staleness eviction
            // in getYDoc handles the only case that warrants intervention (Redis
            // older than PG, i.e. stale content). Log and continue.
            console.warn(
              `[SYNC-VERIFY] fileId=${file.id} ydocHash=${ydocHash} restHash=${restContentHash} decision=MISMATCH_CONTINUE`
            );
          }
        }

        // ── Phase: Ready ──────────────────────────────────────────────────
        syncState.phase = 'ready';

        if (activeFileIdRef.current !== file.id) {
          // This file is no longer the active tab.
          // Phase is recorded as 'ready' in syncState.
          // handleEditorMount will call createBinding when the user switches back.
          console.log(`[SYNC-IGNORED-INACTIVE] fileId=${file.id} activeFileId=${activeFileIdRef.current} — sync complete, tab inactive, binding deferred`);
          return;
        }

        // This file is the active tab. Check whether the editor is mounted.
        // editorRef.current is null during the remount gap between:
        //   effect cleanup (clears editorRef.current)
        //   and handleEditorMount (sets editorRef.current to the new instance).
        // In that gap, defer binding to handleEditorMount.
        console.log(`[SYNC-READY] fileId=${file.id}`);
        setSyncPhase('ready');
        setShowSlowWarning(false);

        if (!editorRef.current) {
          // Remount gap: editor is being replaced. handleEditorMount will
          // see phase === 'ready' and call createBinding with the fresh instance.
          console.log(`[SYNC-READY-DEFERRED] fileId=${file.id} — editorRef.current is null (remount in progress), binding deferred to handleEditorMount`);
          return;
        }

        editorRef.current.updateOptions({ readOnly: isReadOnly });
        createBinding(file.id, editorRef.current);
      };

      // ── FIX 1: attach ALL listeners before connecting ─────────────────────
      // Order: status → sync. Both must exist before any network activity.
      console.log(`[SYNC-SETUP] fileId=${file.id} listeners attached`);
      provider.on('status', onStatusChange);
      provider.on('sync', onSync);
      onSyncRegistered.current = true; // flag: onSync is now registered

      // NOW connect — listeners are guaranteed to be in place.
      console.log(`[SYNC-CONNECT] fileId=${file.id}`);
      provider.connect();

      fileSyncMap.current.set(file.id, syncState);
      return syncState;
    },
    [user, createBinding]
  );

  // ── Effect: react to active file tab change ───────────────────────────────
  // OWNER: UI state only. Editor mutations live exclusively in handleEditorMount.
  //
  // With key={activeFileId} on <Editor>, React remounts Monaco on every tab
  // switch. handleEditorMount fires with the correct new editor instance.
  // The effect must NOT call createBinding — editorRef.current at effect-run
  // time is the OLD instance (remount has not fired yet), so binding here
  // would wire new ytext to a model that is already being destroyed.
  useEffect(() => {
    // 1. Keep ref in sync FIRST — async callbacks read this to detect inactive files.
    activeFileIdRef.current = activeFileId;

    console.log(`[TAB-SWITCH] activeFileId=${activeFileId}`);

    if (!activeFileId) {
      tearDownActiveBinding();
      return;
    }

    const openFile = openFiles.get(activeFileId);
    if (!openFile) return;

    // 2. Ensure Yjs state exists. No-op if the file is already in fileSyncMap.
    ensureFileSyncState(openFile.file);

    // 3. Drive the overlay/banner UI immediately so the correct phase is visible
    //    before handleEditorMount fires. This is pure React state — no editor access.
    const existingSync = fileSyncMap.current.get(activeFileId);
    if (existingSync) {
      const phase = existingSync.phase;
      console.log(`[TAB-SWITCH-BIND] fileId=${activeFileId} phase=${phase}`);
      setSyncPhase(phase);
      setShowSlowWarning(false);
    }

    return () => {
      // Clear editorRef before the new key-based Monaco instance mounts.
      // This is the only action needed here:
      //   - Tab switch binding cleanup: createBinding() calls tearDownActiveBinding()
      //     as its first action before creating the new binding.
      //   - File close (null): tearDownActiveBinding() is called in the effect body's
      //     early return branch, not here.
      //   - Component unmount: handled by the useEffect([], []) cleanup below.
      // Calling tearDownActiveBinding() here is redundant in all three cases and
      // causes React 18 Strict Mode's double-invoke to destroy a freshly created
      // binding (producing the ytext.unobserve "handler doesn't exist" warning).
      editorRef.current = null;
    };
    // openFiles intentionally omitted — we only need the file metadata once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId]);

  // ─────────────────────────────────────────────────────────────────────────
  // Editor mount handler
  // ─────────────────────────────────────────────────────────────────────────
  // SOLE OWNER of all editor mutations (createBinding, setValue, updateOptions).
  // Fires on every tab switch because <Editor key={activeFileId}> remounts Monaco.
  // Receives the correct new editor instance as its argument — no stale-ref risk.
  const handleEditorMount = useCallback(
    (editor: MonacoEditor.IStandaloneCodeEditor) => {
      editorRef.current = editor;
      console.log(`[HANDLE-MOUNT] activeFileId=${activeFileId}`);

      if (!activeFileId) return;

      const sync = fileSyncMap.current.get(activeFileId);
      if (!sync) {
        // No sync state yet — ensureFileSyncState is still setting up.
        // onSync will call createBinding when sync completes.
        return;
      }

      const { phase } = sync;
      console.log(`[TAB-SWITCH-BIND] fileId=${activeFileId} phase=${phase} (mount)`);

      if (phase === 'ready') {
        createBinding(activeFileId, editor);
      } else if (phase === 'fallback') {
        console.log(`[FALLBACK-APPLY] fileId=${activeFileId}`);
        editor.getModel()?.setValue(
          openFiles.get(activeFileId)?.file.content ?? ''
        );
        editor.updateOptions({ readOnly: true });
      }
      // connecting / syncing: onSync fires createBinding when sync completes.
      // The overlay covers the blank editor during this window.
    },
    [activeFileId, createBinding, openFiles]
  );


  // ── Component unmount: tear down all open Yjs connections ────────────────
  useEffect(() => {
    // Capture the ref value at effect-registration time for the cleanup closure
    const syncMap = fileSyncMap.current;
    return () => {
      tearDownActiveBinding();
      syncMap.forEach(s => s.destroy());
      syncMap.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // File management
  // ─────────────────────────────────────────────────────────────────────────

  const loadProjectFiles = useCallback(async (projId: number) => {
    try {
      const res = await projectsAPI.getProjectFiles(projId);
      setProjectFiles(res.files);
    } catch {
      /* silent */
    }
  }, []);

  const openFile = useCallback(async (file: File) => {
    // If already open, just switch to it
    if (openFiles.has(file.id)) {
      setActiveFileId(file.id);
      return;
    }
    setOpenFiles(prev => new Map(prev).set(file.id, {
      file,
      isDirty: false,
      isSaving: false,
      lastSaved: null,
    }));
    setActiveFileId(file.id);
  }, [openFiles]);

  const closeFile = useCallback(async (id: number) => {
    const entry = openFiles.get(id);
    if (!entry) return;

    if (entry.isDirty) {
      if (!window.confirm(`"${entry.file.filename}" has unsaved changes. Close anyway?`)) return;
    }

    // If this is the active file, tear down its binding first
    if (activeFileId === id) tearDownActiveBinding();

    // Destroy Yjs state permanently
    fileSyncMap.current.get(id)?.destroy();

    const next = new Map(openFiles);
    next.delete(id);
    setOpenFiles(next);

    if (activeFileId === id) {
      const remaining = Array.from(next.keys());
      setActiveFileId(remaining.length > 0 ? remaining[0] : null);
    }
  }, [openFiles, activeFileId, tearDownActiveBinding]);

  const loadAndOpenFile = useCallback(async (id: number) => {
    try {
      setIsLoading(true);
      const res = await filesAPI.getFile(id);
      const file = res.file;
      if (file.project_id) {
        setProjectId(file.project_id);
        await loadProjectFiles(file.project_id);
      }
      await openFile(file);
      setError('');
    } catch {
      setError('Failed to load file');
    } finally {
      setIsLoading(false);
    }
  }, [loadProjectFiles, openFile]);

  useEffect(() => {
    if (routeFileId) loadAndOpenFile(parseInt(routeFileId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeFileId]);

  // ─────────────────────────────────────────────────────────────────────────
  // Save
  // ─────────────────────────────────────────────────────────────────────────

  const saveFile = useCallback(async (fileId: number) => {
    const entry = openFiles.get(fileId);
    const sync = fileSyncMap.current.get(fileId);
    if (!entry || !sync) return;
    if (entry.file.permission && !entry.file.permission.canWrite) return;

    setOpenFiles(prev => {
      const m = new Map(prev);
      const e = m.get(fileId);
      if (e) m.set(fileId, { ...e, isSaving: true });
      return m;
    });

    try {
      const content = sync.ytext.toString();
      await filesAPI.updateFile(fileId, { content });
      setOpenFiles(prev => {
        const m = new Map(prev);
        const e = m.get(fileId);
        if (e) m.set(fileId, { ...e, isSaving: false, isDirty: false, lastSaved: new Date() });
        return m;
      });
    } catch {
      setOpenFiles(prev => {
        const m = new Map(prev);
        const e = m.get(fileId);
        if (e) m.set(fileId, { ...e, isSaving: false });
        return m;
      });
    }
  }, [openFiles]);

  // ─────────────────────────────────────────────────────────────────────────
  // Version restore
  // ─────────────────────────────────────────────────────────────────────────

  const handleVersionRestore = useCallback(async (_versionId: number) => {
    if (!activeFileId) return;
    // Destroy current sync so the restored content gets seeded fresh on reconnect
    tearDownActiveBinding();
    fileSyncMap.current.get(activeFileId)?.destroy();
    await loadAndOpenFile(activeFileId);
  }, [activeFileId, tearDownActiveBinding, loadAndOpenFile]);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────────────────

  const activeFile = activeFileId ? openFiles.get(activeFileId) : null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="vscode-editor loading">
        <div className="loading-message">Loading...</div>
      </div>
    );
  }

  if (error && !activeFile) {
    return (
      <div className="vscode-editor error">
        <div className="error-message">
          <h3>Error</h3>
          <p>{error}</p>
          <button onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="vscode-editor">
      <ActivityBar activeView={activeView} onViewChange={setActiveView} />

      {activeView && (
        <Sidebar
          activeView={activeView}
          projectId={projectId || undefined}
          fileId={activeFileId || undefined}
          currentFileId={activeFileId || undefined}
          connectedUsers={connectedUsers}
          onFileSelect={id => {
            const file = projectFiles.find(f => f.id === id);
            if (file) openFile(file);
          }}
          onShareClick={() => { }}
          onClose={() => setActiveView(null)}
        />
      )}

      <div className="editor-main">
        {/* ── Tab bar ── */}
        <EditorTabs
          tabs={Array.from(openFiles.values()).map(e => ({
            fileId: e.file.id,
            filename: e.file.filename,
            isDirty: e.isDirty,
          }))}
          activeTabId={activeFileId || 0}
          onTabClick={setActiveFileId}
          onTabClose={closeFile}
        />

        {/* ── Version timeline ── */}
        <VersionBar
          fileId={activeFileId || undefined}
          onRestore={handleVersionRestore}
        />

        {activeFile && (
          <>
            {/* ── Status toolbar ── */}
            <EditorToolbar
              filename={activeFile.file.filename}
              connectionStatus={connectionStatus}
              isSaving={activeFile.isSaving}
              lastSaved={activeFile.lastSaved}
              permissionLevel={activeFile.file.permission?.level}
              fileId={activeFile.file.id}
              onVersionRestore={handleVersionRestore}
            />

            {/* ── Tier-1 slow-connection warning (3000ms, phase stays 'syncing') ── */}
            {showSlowWarning && syncPhase === 'syncing' && (
              <div className="sync-warning-banner">
                <span className="banner-icon">⚠</span>
                Connection is taking longer than expected — still trying&hellip;
              </div>
            )}

            {/* ── Tier-2 fallback banner (8000ms, read-only mode) ── */}
            {syncPhase === 'fallback' && (
              <div className="sync-fallback-banner">
                <span className="banner-icon">⚡</span>
                Live collaboration unavailable — viewing last known content in read-only mode.
                Reconnecting automatically&hellip;
              </div>
            )}

            {/* ── Monaco Editor ──────────────────────────────────────────────
              Single stable editor instance. Binding swapped via ref lifecycle.
              readOnly driven by syncPhase in fallback; otherwise by permission.
              The sync-overlay sits on top of Monaco during connecting|syncing
              phases, preventing the user from seeing a blank editor during the
              initial sync window or during the fallback→syncing reconnection
              (when the model is cleared before onSync repopulates it).
            ─────────────────────────────────────────────────────────────── */}
            <div className="editor-container">
              {(syncPhase === 'connecting' || syncPhase === 'syncing') && (
                <div className="sync-overlay" aria-label="Connecting to collaboration server">
                  <div className="sync-overlay-spinner" />
                  <span>
                    {syncPhase === 'connecting' ? 'Connecting…' : 'Syncing document…'}
                  </span>
                </div>
              )}
              {/* Fix B: key={activeFileId} forces Monaco to remount on every tab
                  switch. This guarantees: (1) handleEditorMount fires for each
                  file, (2) the previous file's ytext cannot leak into the new
                  model, (3) createBinding in the effect and in handleEditorMount
                  are both safe to call (tearDownActiveBinding is idempotent). */}
              <Editor
                key={activeFileId}
                height="100%"
                language={getLanguageFromFilename(activeFile.file.filename) || activeFile.file.language}
                theme="vs-dark"
                defaultValue=""
                options={{
                  minimap: { enabled: true },
                  fontSize: 14,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
                  fontLigatures: true,
                  wordWrap: 'on',
                  automaticLayout: true,
                  lineHeight: 22,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  smoothScrolling: true,
                  renderLineHighlight: 'gutter',
                  scrollBeyondLastLine: false,
                  readOnly: syncPhase === 'fallback'
                    ? true
                    : (activeFile.file.permission ? !activeFile.file.permission.canWrite : false),
                }}
                onMount={handleEditorMount}
              />
            </div>
          </>
        )}

        {!activeFile && (
          <div className="no-file-open">
            <h2>No File Open</h2>
            <p>Select a file from the explorer to start editing</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VSCodeEditor;
