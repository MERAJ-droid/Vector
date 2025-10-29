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

export interface File {
  id: number;
  filename: string;
  content: string;
  language: string;
  isCollaborative: boolean;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
  snapshot?: number[];
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
