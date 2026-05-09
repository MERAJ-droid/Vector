import React, { useState, useEffect } from 'react';
import { FileText, FileCode, FileJson, Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { projectsAPI } from '../../services/api';
import { File } from '../../types';
import './FileExplorer.css';

interface FileExplorerProps {
  projectId: number;
  currentFileId?: number;
  onFileSelect: (fileId: number) => void;
}

function getFileIcon(language: string) {
  switch (language?.toLowerCase()) {
    case 'javascript':
    case 'typescript':
    case 'jsx':
    case 'tsx':
      return <FileCode size={14} />;
    case 'json':
      return <FileJson size={14} />;
    default:
      return <FileText size={14} />;
  }
}

interface TreeNode {
  name: string;
  isFolder: boolean;
  children?: TreeNode[];
  file?: File;
  path: string;
}

function buildTree(files: File[]): TreeNode[] {
  const root: TreeNode[] = [];

  files.forEach((file) => {
    const parts = file.filename.split('/');
    if (parts.length === 1) {
      root.push({ name: file.filename, isFolder: false, file, path: file.filename });
    } else {
      // Multi-segment path — build folder nodes
      let current = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        let folder = current.find(n => n.isFolder && n.name === folderName);
        if (!folder) {
          folder = { name: folderName, isFolder: true, children: [], path: parts.slice(0, i + 1).join('/') };
          current.push(folder);
        }
        current = folder.children!;
      }
      current.push({ name: parts[parts.length - 1], isFolder: false, file, path: file.filename });
    }
  });

  return root;
}

interface TreeItemProps {
  node: TreeNode;
  currentFileId?: number;
  onFileSelect: (fileId: number) => void;
  depth?: number;
}

const TreeItem: React.FC<TreeItemProps> = ({ node, currentFileId, onFileSelect, depth = 0 }) => {
  const [open, setOpen] = useState(true);
  const indent = depth * 12;

  if (node.isFolder) {
    return (
      <div className="tree-folder">
        <div
          className="tree-row tree-folder-row"
          style={{ paddingLeft: `${8 + indent}px` }}
          onClick={() => setOpen(!open)}
        >
          <span className="tree-chevron">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="tree-icon folder-icon">
            {open ? <FolderOpen size={14} /> : <Folder size={14} />}
          </span>
          <span className="tree-label">{node.name}</span>
        </div>
        {open && node.children && (
          <div className="tree-children">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                currentFileId={currentFileId}
                onFileSelect={onFileSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = node.file && currentFileId === node.file.id;
  return (
    <div
      className={`tree-row tree-file-row ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: `${8 + indent + 16}px` }}
      onClick={() => node.file && onFileSelect(node.file.id)}
      title={node.name}
    >
      <span className="tree-icon file-icon">{getFileIcon(node.file?.language || '')}</span>
      <span className="tree-label">{node.name}</span>
    </div>
  );
};

const FileExplorer: React.FC<FileExplorerProps> = ({ projectId, currentFileId, onFileSelect }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const response = await projectsAPI.getProjectFiles(projectId);
        setFiles(response.files);
        setError('');
      } catch {
        setError('Failed to load files');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (loading) return <div className="explorer-state">Loading...</div>;
  if (error) return <div className="explorer-state error-text">{error}</div>;
  if (files.length === 0) return <div className="explorer-state muted">No files yet</div>;

  const tree = buildTree(files);

  return (
    <div className="file-explorer">
      <div className="explorer-section-label">PROJECT</div>
      <div className="file-tree">
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            currentFileId={currentFileId}
            onFileSelect={onFileSelect}
          />
        ))}
      </div>
    </div>
  );
};

export default FileExplorer;
