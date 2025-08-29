import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { projectsAPI } from '../../services/api';
import './Projects.css';

const CreateFile: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [filename, setFilename] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [content, setContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const languageOptions = [
    { value: 'javascript', label: 'JavaScript (.js)', template: '// JavaScript file\nconsole.log("Hello, World!");' },
    { value: 'typescript', label: 'TypeScript (.ts)', template: '// TypeScript file\nconst message: string = "Hello, World!";\nconsole.log(message);' },
    { value: 'python', label: 'Python (.py)', template: '# Python file\nprint("Hello, World!")' },
    { value: 'java', label: 'Java (.java)', template: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}' },
    { value: 'cpp', label: 'C++ (.cpp)', template: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}' },
    { value: 'html', label: 'HTML (.html)', template: '<!DOCTYPE html>\n<html>\n<head>\n    <title>Page Title</title>\n</head>\n<body>\n    <h1>Hello, World!</h1>\n</body>\n</html>' },
    { value: 'css', label: 'CSS (.css)', template: '/* CSS file */\nbody {\n    font-family: Arial, sans-serif;\n    margin: 0;\n    padding: 20px;\n}' },
    { value: 'markdown', label: 'Markdown (.md)', template: '# Markdown File\n\nThis is a **markdown** file.\n\n- Item 1\n- Item 2\n- Item 3' },
    { value: 'json', label: 'JSON (.json)', template: '{\n  "name": "example",\n  "version": "1.0.0",\n  "description": "Example JSON file"\n}' },
    { value: 'plaintext', label: 'Plain Text (.txt)', template: 'This is a plain text file.' },
  ];

  const getFileExtension = (lang: string): string => {
    const extensions: { [key: string]: string } = {
      javascript: '.js',
      typescript: '.ts',
      python: '.py',
      java: '.java',
      cpp: '.cpp',
      html: '.html',
      css: '.css',
      markdown: '.md',
      json: '.json',
      plaintext: '.txt',
    };
    return extensions[lang] || '.txt';
  };

  const handleLanguageChange = (newLanguage: string) => {
    setLanguage(newLanguage);
    const template = languageOptions.find(opt => opt.value === newLanguage)?.template || '';
    setContent(template);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !filename.trim()) return;

    try {
      setIsCreating(true);
      setError('');

      const response = await projectsAPI.createFile(parseInt(projectId), {
        filename: filename.trim() + getFileExtension(language),
        content,
        language,
      });

      // Redirect to the new file in the editor
      navigate(`/editor/${response.file.id}`);
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to create file');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="create-file-page">
      <div className="create-file-container">
        <header className="create-file-header">
          <button 
            onClick={() => navigate('/dashboard')}
            className="back-btn"
          >
            ← Back to Dashboard
          </button>
          <h1>Create New File</h1>
        </header>

        <form onSubmit={handleSubmit} className="create-file-form">
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label htmlFor="language">File Type</label>
            <select
              id="language"
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              disabled={isCreating}
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="filename">File Name</label>
            <div className="filename-input">
              <input
                type="text"
                id="filename"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder={`Enter filename (without extension)`}
                disabled={isCreating}
                autoFocus
              />
              <span className="file-extension">{getFileExtension(language)}</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="content">Initial Content</label>
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter initial file content..."
              rows={12}
              disabled={isCreating}
            />
          </div>

          <div className="form-actions">
            <button 
              type="button" 
              onClick={() => navigate('/dashboard')}
              className="cancel-btn"
              disabled={isCreating}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="create-btn"
              disabled={isCreating || !filename.trim()}
            >
              {isCreating ? 'Creating...' : 'Create File'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateFile;
