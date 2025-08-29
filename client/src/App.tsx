import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import ProjectsDashboard from './components/Projects/ProjectsDashboard';
import CreateFile from './components/Projects/CreateFile';
import CodeEditor from './components/Editor/CodeEditor';
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

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
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
                  <CodeEditor />
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
