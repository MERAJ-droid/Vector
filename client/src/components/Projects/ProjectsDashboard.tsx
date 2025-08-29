import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { projectsAPI } from '../../services/api';
import { Project, File } from '../../types';
import './Projects.css';

interface ProjectWithFiles extends Project {
  files?: File[];
  showFiles?: boolean;
}

const ProjectsDashboard: React.FC = () => {
  const [projects, setProjects] = useState<ProjectWithFiles[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setIsLoading(true);
      const response = await projectsAPI.getProjects();
      setProjects(response.projects.map(p => ({ ...p, showFiles: false })));
    } catch (error: any) {
      setError('Failed to load projects');
      console.error('Load projects error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      setIsCreating(true);
      const response = await projectsAPI.createProject({ projectName: newProjectName.trim() });
      setProjects(prev => [{ ...response.project, showFiles: false }, ...prev]);
      setNewProjectName('');
      setShowCreateProject(false);
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  const toggleProjectFiles = async (projectId: number) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    if (project.showFiles) {
      // Hide files
      setProjects(prev => prev.map(p => 
        p.id === projectId ? { ...p, showFiles: false } : p
      ));
    } else {
      // Load and show files
      try {
        const response = await projectsAPI.getProjectFiles(projectId);
        setProjects(prev => prev.map(p => 
          p.id === projectId 
            ? { ...p, files: response.files, showFiles: true }
            : p
        ));
      } catch (error) {
        setError('Failed to load project files');
      }
    }
  };

  const openFile = (fileId: number) => {
    navigate(`/editor/${fileId}`);
  };

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner">Loading projects...</div>
      </div>
    );
  }

  return (
    <div className="projects-dashboard">
      <header className="dashboard-header">
        <h1>Vector</h1>
        <div className="user-info">
          <span>Welcome, {user?.username}!</span>
          <button onClick={logout} className="logout-btn">Logout</button>
        </div>
      </header>

      <main className="projects-content">
        <div className="projects-header">
          <h2>Your Projects</h2>
          <button 
            onClick={() => setShowCreateProject(true)} 
            className="create-project-btn"
          >
            + New Project
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        {showCreateProject && (
          <div className="create-project-modal">
            <div className="modal-content">
              <h3>Create New Project</h3>
              <form onSubmit={createProject}>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Enter project name"
                  autoFocus
                  disabled={isCreating}
                />
                <div className="modal-actions">
                  <button type="submit" disabled={isCreating || !newProjectName.trim()}>
                    {isCreating ? 'Creating...' : 'Create'}
                  </button>
                  <button 
                    type="button" 
                    onClick={() => {
                      setShowCreateProject(false);
                      setNewProjectName('');
                    }}
                    disabled={isCreating}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="projects-list">
          {projects.length === 0 ? (
            <div className="empty-state">
              <h3>No projects yet</h3>
              <p>Create your first project to get started with Vector</p>
              <button 
                onClick={() => setShowCreateProject(true)} 
                className="create-project-btn"
              >
                Create Project
              </button>
            </div>
          ) : (
            projects.map((project) => (
              <div key={project.id} className="project-card">
                <div className="project-info">
                  <h3>{project.project_name}</h3>
                  <p>Created {new Date(project.created_at).toLocaleDateString()}</p>
                </div>
                <div className="project-actions">
                  <button 
                    onClick={() => toggleProjectFiles(project.id)}
                    className="toggle-files-btn"
                  >
                    {project.showFiles ? 'Hide Files' : 'Show Files'}
                  </button>
                </div>
                
                {project.showFiles && (
                  <div className="project-files">
                    {project.files && project.files.length > 0 ? (
                        <>
                      <div className="files-list">
                        {project.files.map((file) => (
                          <div 
                            key={file.id} 
                            className="file-item"
                            onClick={() => openFile(file.id)}
                          >
                            <span className="file-name">{file.filename}</span>
                            <span className="file-language">{file.language}</span>
                          </div>
                        ))}
                      </div>
                      <button 
                            onClick={() => navigate(`/project/${project.id}/new-file`)}
                            className="create-file-btn"
                        >
                            + Add File
                        </button>
                        </>
                                
                    ) : (
                      <div className="no-files">
                        <p>No files in this project</p>
                        <button 
                          onClick={() => navigate(`/project/${project.id}/new-file`)}
                          className="create-file-btn"
                        >
                          Create First File
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
};

export default ProjectsDashboard;
