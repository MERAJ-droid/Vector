import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export interface Collaborator {
  id: number;
  username: string;
  email: string;
  permissionLevel: 'owner' | 'editor' | 'viewer';
  grantedBy: string;
  sharedAt: string;
}

export interface SharedFile {
  id: number;
  filename: string;
  language: string;
  isCollaborative: boolean;
  projectName: string;
  ownerUsername: string;
  sharedBy: string;
  permissionLevel: 'owner' | 'editor' | 'viewer';
  createdAt: string;
  updatedAt: string;
}

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { headers: { Authorization: `Bearer ${token}` } };
};

export const sharingAPI = {
  /**
   * Share a file with another user
   */
  shareFile: async (fileId: number, username: string, permissionLevel: 'editor' | 'viewer') => {
    const response = await axios.post(
      `${API_URL}/sharing/${fileId}/share`,
      { username, permissionLevel },
      getAuthHeader()
    );
    return response.data;
  },

  /**
   * Get all collaborators for a file
   */
  getCollaborators: async (fileId: number): Promise<{ collaborators: Collaborator[] }> => {
    const response = await axios.get(
      `${API_URL}/sharing/${fileId}/collaborators`,
      getAuthHeader()
    );
    return response.data;
  },

  /**
   * Update a collaborator's permission level
   */
  updatePermission: async (fileId: number, userId: number, permissionLevel: 'editor' | 'viewer') => {
    const response = await axios.put(
      `${API_URL}/sharing/${fileId}/permissions/${userId}`,
      { permissionLevel },
      getAuthHeader()
    );
    return response.data;
  },

  /**
   * Remove a collaborator's access
   */
  removeCollaborator: async (fileId: number, userId: number) => {
    const response = await axios.delete(
      `${API_URL}/sharing/${fileId}/permissions/${userId}`,
      getAuthHeader()
    );
    return response.data;
  },

  /**
   * Get all files shared with the current user
   */
  getSharedWithMe: async (): Promise<{ sharedFiles: SharedFile[] }> => {
    const response = await axios.get(
      `${API_URL}/sharing/shared-with-me`,
      getAuthHeader()
    );
    return response.data;
  }
};
