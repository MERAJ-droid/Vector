import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import ProjectsDashboard from './components/Projects/ProjectsDashboard';
import CreateFile from './components/Projects/CreateFile';
import VSCodeEditor from './components/Editor/VSCodeEditor';
import './App.css';

// Protected Route wrapper
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

// ── Sync mismatch breadcrumb (written by VSCodeEditor before reload) ──────────

const MISMATCH_SS_KEY = 'collab_sync_mismatch';

interface MismatchBreadcrumb {
  fileId: number;
  ydocContentHash: string;
  restContentHash: string;
  timestamp: string;
}

/**
 * MismatchToast: non-blocking notification shown once after a hash-mismatch
 * reload. Mounts at the App root so it survives navigation and auth redirects.
 * The sessionStorage key is read and deleted here — VSCodeEditor does not
 * touch it after writing it (it calls window.location.reload() immediately).
 */
function MismatchToast() {
  const [toast, setToast] = useState<MismatchBreadcrumb | null>(null);

  // Runs once per application session (App mounts once, never unmounts).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(MISMATCH_SS_KEY);
      if (raw) {
        // Delete before parsing — the key is cleared regardless of parse outcome.
        sessionStorage.removeItem(MISMATCH_SS_KEY);
        setToast(JSON.parse(raw) as MismatchBreadcrumb);
      }
    } catch {
      sessionStorage.removeItem(MISMATCH_SS_KEY);
    }
  }, []);

  if (!toast) return null;

  return (
    <div
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '12px 16px', maxWidth: 360,
        background: '#1e1e2e',
        border: '1px solid rgba(99,102,241,0.4)',
        borderRadius: 6,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        fontFamily: 'var(--font-ui, system-ui)',
        animation: 'toast-slide-up 0.25s ease',
      }}
      role="status"
      aria-live="polite"
    >
      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>
        Editor recovered from a sync inconsistency
      </p>
      <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
        File {toast.fileId} had a content hash mismatch after sync
        ({toast.timestamp.slice(0, 19).replace('T', ' ')} UTC).
        The page was reloaded automatically.
      </p>
      <button
        onClick={() => setToast(null)}
        style={{
          alignSelf: 'flex-end', marginTop: 4, padding: '2px 10px',
          background: 'transparent',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 4, color: '#818cf8', fontSize: 11,
          fontFamily: 'inherit', cursor: 'pointer',
        }}
        aria-label="Dismiss sync notification"
      >
        Dismiss
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          {/* MismatchToast reads sessionStorage once on mount (App-level, not editor-level) */}
          <MismatchToast />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <ProjectsDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/project/:projectId/new-file"
              element={
                <ProtectedRoute>
                  <CreateFile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/editor/:fileId"
              element={
                <ProtectedRoute>
                  <VSCodeEditor />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
