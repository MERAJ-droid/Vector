import axios from 'axios';

const API_URL = 'http://localhost:5000/api/versions';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export interface Version {
  id: number;
  versionNumber: number;
  commitMessage: string | null;
  fileSize: number;
  createdAt: string;
  createdBy: {
    id: number;
    username: string;
  };
}

export interface VersionContent extends Version {
  content: string;
  filename: string;
  language: string;
}

export const versionsAPI = {
  // Get all versions of a file
  async getVersions(fileId: number): Promise<{ versions: Version[] }> {
    const response = await axios.get(`${API_URL}/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Get content of a specific version
  async getVersionContent(fileId: number, versionId: number): Promise<{ version: VersionContent }> {
    const response = await axios.get(`${API_URL}/${fileId}/${versionId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Create a manual checkpoint
  async createCheckpoint(fileId: number, content: string, commitMessage?: string): Promise<{ message: string; version: { id: number; versionNumber: number; createdAt: string } }> {
    const response = await axios.post(
      `${API_URL}/${fileId}/create`,
      { content, commitMessage },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Restore file to a specific version
  async restoreVersion(fileId: number, versionId: number): Promise<{ message: string; restoredTo: number; newVersion: number }> {
    const response = await axios.post(
      `${API_URL}/${fileId}/restore/${versionId}`,
      {},
      { headers: getAuthHeader() }
    );
    return response.data;
  },
};
