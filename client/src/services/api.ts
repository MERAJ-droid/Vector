import axios, { AxiosResponse } from 'axios';
import {
  AuthResponse,
  ProjectsResponse,
  FilesResponse,
  FileResponse,
  ProjectResponse,
  CreateProjectRequest,
  CreateFileRequest,
  UpdateFileRequest,
} from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  register: async (username: string, email: string, password: string): Promise<AuthResponse> => {
    const response: AxiosResponse<AuthResponse> = await api.post('/auth/register', {
      username,
      email,
      password,
    });
    return response.data;
  },

  login: async (username: string, password: string): Promise<AuthResponse> => {
    const response: AxiosResponse<AuthResponse> = await api.post('/auth/login', {
      username,
      password,
    });
    return response.data;
  },
};

export const projectsAPI = {
  getProjects: async (): Promise<ProjectsResponse> => {
    const response: AxiosResponse<ProjectsResponse> = await api.get('/projects');
    return response.data;
  },

  getProject: async (id: number): Promise<ProjectResponse> => {
    const response: AxiosResponse<ProjectResponse> = await api.get(`/projects/${id}`);
    return response.data;
  },

  createProject: async (data: CreateProjectRequest): Promise<ProjectResponse> => {
    const response: AxiosResponse<ProjectResponse> = await api.post('/projects', data);
    return response.data;
  },

  getProjectFiles: async (projectId: number): Promise<FilesResponse> => {
    const response: AxiosResponse<FilesResponse> = await api.get(`/projects/${projectId}/files`);
    return response.data;
  },

  createFile: async (projectId: number, data: CreateFileRequest): Promise<FileResponse> => {
    const response: AxiosResponse<FileResponse> = await api.post(`/projects/${projectId}/files`, data);
    return response.data;
  },
};

export const filesAPI = {
  getFile: async (id: number): Promise<FileResponse> => {
    const response: AxiosResponse<FileResponse> = await api.get(`/files/${id}`);
    return response.data;
  },

  updateFile: async (id: number, data: UpdateFileRequest): Promise<FileResponse> => {
    const response: AxiosResponse<FileResponse> = await api.put(`/files/${id}`, data);
    return response.data;
  },
};

export const healthAPI = {
  check: async (): Promise<{ status: string; timestamp: string }> => {
    const response = await api.get('/health');
    return response.data;
  },
};

export default api;
