import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { AuthRequest } from './auth';

export interface PermissionRequest extends AuthRequest {
  filePermission?: {
    level: 'owner' | 'editor' | 'viewer';
    canRead: boolean;
    canWrite: boolean;
    canShare: boolean;
    canDelete: boolean;
  };
}

/**
 * Middleware to check if user has permission to access a file
 * Checks both ownership (via projects) and file_permissions table
 */
export const checkFilePermission = (requiredLevel?: 'owner' | 'editor' | 'viewer') => {
  return async (req: PermissionRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const fileId = parseInt(req.params.id || req.params.fileId);

      if (isNaN(fileId)) {
        return res.status(400).json({ error: 'Invalid file ID' });
      }

      // First check if user owns the file through project ownership
      const ownerResult = await pool.query(`
        SELECT p.owner_id
        FROM files f
        JOIN projects p ON f.project_id = p.id
        WHERE f.id = $1
      `, [fileId]);

      if (ownerResult.rows.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      let permissionLevel: 'owner' | 'editor' | 'viewer';

      // If user owns the project, they have owner permission
      if (ownerResult.rows[0].owner_id === userId) {
        permissionLevel = 'owner';
      } else {
        // Otherwise check file_permissions table
        const permissionResult = await pool.query(`
          SELECT fp.permission_level
          FROM file_permissions fp
          WHERE fp.file_id = $1 AND fp.user_id = $2
        `, [fileId, userId]);

        if (permissionResult.rows.length === 0) {
          return res.status(404).json({ error: 'File not found or access denied' });
        }

        permissionLevel = permissionResult.rows[0].permission_level as 'owner' | 'editor' | 'viewer';
      }

      // Check if user has required permission level
      if (requiredLevel) {
        const permissionHierarchy: Record<string, number> = {
          'viewer': 1,
          'editor': 2,
          'owner': 3
        };

        if (permissionHierarchy[permissionLevel] < permissionHierarchy[requiredLevel]) {
          return res.status(403).json({ 
            error: `This action requires ${requiredLevel} permission. You have ${permissionLevel} permission.` 
          });
        }
      }

      // Attach permission info to request
      req.filePermission = {
        level: permissionLevel,
        canRead: true, // All permission levels can read
        canWrite: permissionLevel === 'owner' || permissionLevel === 'editor',
        canShare: permissionLevel === 'owner' || permissionLevel === 'editor',
        canDelete: permissionLevel === 'owner'
      };

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

/**
 * Middleware to check if user is the file owner
 */
export const requireOwner = checkFilePermission('owner');

/**
 * Middleware to check if user can edit the file (owner or editor)
 */
export const requireEditor = checkFilePermission('editor');

/**
 * Middleware to check if user can view the file (any permission level)
 */
export const requireViewer = checkFilePermission('viewer');
