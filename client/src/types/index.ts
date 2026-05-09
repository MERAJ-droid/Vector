export interface User {
  id: number;
  username: string;
  email: string;
  createdAt?: string;
}

export interface Project {
  id: number;
  project_name: string;
  created_at: string;
  updated_at: string;
}

export interface FilePermission {
  level: 'owner' | 'editor' | 'viewer';
  canRead: boolean;
  canWrite: boolean;
  canShare: boolean;
  canDelete: boolean;
}

export interface File {
  id: number;
  project_id?: number;
  filename: string;
  content: string;
  language: string;
  isCollaborative: boolean;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
  snapshot?: number[];
  /**
   * SHA-256 hex hash of files.content computed in PostgreSQL via pgcrypto at query time.
   * Present only on responses from GET /files/:id after the pgcrypto migration has run.
   * Optional: the client state machine skips hash verification with a warning log when absent,
   * rather than treating absence as a sync inconsistency.
   */
  contentHash?: string;
  permission?: FilePermission;
}

export interface AuthResponse {
  message: string;
  token: string;
  user: User;
}

export interface ApiResponse<T> {
  message?: string;
  data?: T;
  error?: string;
}

export interface ProjectsResponse {
  projects: Project[];
}

export interface FilesResponse {
  files: File[];
}

export interface FileResponse {
  file: File;
}

export interface ProjectResponse {
  project: Project;
}

export interface SocketTextChangeEvent {
  fileId: string;
  content: string;
  userId: string;
}

export interface CreateProjectRequest {
  projectName: string;
}

export interface CreateFileRequest {
  filename: string;
  content?: string;
  language?: string;
  isCollaborative?: boolean;
}

export interface UpdateFileRequest {
  content?: string;
  language?: string;
  snapshot?: number[];
}
