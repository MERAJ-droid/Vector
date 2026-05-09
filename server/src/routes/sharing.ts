import express from 'express';
import pool from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

/**
 * Share a file with another user
 * POST /api/sharing/:fileId/share
 */
router.post('/:fileId/share', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const fileId = parseInt(req.params.fileId);
    const { username, permissionLevel } = req.body;

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    if (!['editor', 'viewer'].includes(permissionLevel)) {
      return res.status(400).json({ error: 'Permission level must be editor or viewer' });
    }

    // Check if requester has owner or editor permission
    const permissionCheck = await pool.query(`
      SELECT fp.permission_level
      FROM file_permissions fp
      WHERE fp.file_id = $1 AND fp.user_id = $2
    `, [fileId, userId]);

    if (permissionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const requesterPermission = permissionCheck.rows[0].permission_level;
    if (requesterPermission !== 'owner' && requesterPermission !== 'editor') {
      return res.status(403).json({ error: 'You must be owner or editor to share this file' });
    }

    // Only owners can grant editor permission
    if (permissionLevel === 'editor' && requesterPermission !== 'owner') {
      return res.status(403).json({ error: 'Only owners can grant editor permission' });
    }

    // Get the user to share with
    const userResult = await pool.query(
      'SELECT id, username FROM users WHERE username = $1',
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUserId = userResult.rows[0].id;

    // Check if user is trying to share with themselves
    if (targetUserId === userId) {
      return res.status(400).json({ error: 'Cannot share file with yourself' });
    }

    // Check if permission already exists
    const existingPermission = await pool.query(`
      SELECT id, permission_level FROM file_permissions
      WHERE file_id = $1 AND user_id = $2
    `, [fileId, targetUserId]);

    if (existingPermission.rows.length > 0) {
      // Update existing permission
      await pool.query(`
        UPDATE file_permissions
        SET permission_level = $1, granted_by = $2, updated_at = NOW()
        WHERE file_id = $3 AND user_id = $4
      `, [permissionLevel, userId, fileId, targetUserId]);

      return res.json({
        message: 'Permission updated successfully',
        user: userResult.rows[0],
        permissionLevel
      });
    }

    // Create new permission
    await pool.query(`
      INSERT INTO file_permissions (file_id, user_id, permission_level, granted_by)
      VALUES ($1, $2, $3, $4)
    `, [fileId, targetUserId, permissionLevel, userId]);

    res.json({
      message: 'File shared successfully',
      user: userResult.rows[0],
      permissionLevel
    });
  } catch (error) {
    console.error('Share file error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get all collaborators for a file
 * GET /api/sharing/:fileId/collaborators
 */
router.get('/:fileId/collaborators', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const fileId = parseInt(req.params.fileId);

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    // Check if user has access to this file
    const permissionCheck = await pool.query(`
      SELECT 1 FROM file_permissions
      WHERE file_id = $1 AND user_id = $2
    `, [fileId, userId]);

    if (permissionCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this file' });
    }

    // Get all collaborators
    const result = await pool.query(`
      SELECT 
        u.id,
        u.username,
        u.email,
        fp.permission_level,
        fp.created_at,
        grantor.username as granted_by_username
      FROM file_permissions fp
      JOIN users u ON fp.user_id = u.id
      LEFT JOIN users grantor ON fp.granted_by = grantor.id
      WHERE fp.file_id = $1
      ORDER BY 
        CASE fp.permission_level
          WHEN 'owner' THEN 1
          WHEN 'editor' THEN 2
          WHEN 'viewer' THEN 3
        END,
        u.username
    `, [fileId]);

    res.json({
      collaborators: result.rows.map(row => ({
        id: row.id,
        username: row.username,
        email: row.email,
        permissionLevel: row.permission_level,
        grantedBy: row.granted_by_username,
        sharedAt: row.created_at
      }))
    });
  } catch (error) {
    console.error('Get collaborators error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Update a user's permission level
 * PUT /api/sharing/:fileId/permissions/:targetUserId
 */
router.put('/:fileId/permissions/:targetUserId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const fileId = parseInt(req.params.fileId);
    const targetUserId = parseInt(req.params.targetUserId);
    const { permissionLevel } = req.body;

    if (isNaN(fileId) || isNaN(targetUserId)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    if (!['editor', 'viewer'].includes(permissionLevel)) {
      return res.status(400).json({ error: 'Permission level must be editor or viewer' });
    }

    // Check if requester is owner
    const ownerCheck = await pool.query(`
      SELECT 1 FROM file_permissions
      WHERE file_id = $1 AND user_id = $2 AND permission_level = 'owner'
    `, [fileId, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only file owner can update permissions' });
    }

    // Update permission
    const result = await pool.query(`
      UPDATE file_permissions
      SET permission_level = $1, updated_at = NOW()
      WHERE file_id = $2 AND user_id = $3 AND permission_level != 'owner'
      RETURNING *
    `, [permissionLevel, fileId, targetUserId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Permission not found or cannot modify owner' });
    }

    res.json({
      message: 'Permission updated successfully',
      permission: result.rows[0]
    });
  } catch (error) {
    console.error('Update permission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Remove a user's access to a file
 * DELETE /api/sharing/:fileId/permissions/:targetUserId
 */
router.delete('/:fileId/permissions/:targetUserId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const fileId = parseInt(req.params.fileId);
    const targetUserId = parseInt(req.params.targetUserId);

    if (isNaN(fileId) || isNaN(targetUserId)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    // Check if requester is owner
    const ownerCheck = await pool.query(`
      SELECT 1 FROM file_permissions
      WHERE file_id = $1 AND user_id = $2 AND permission_level = 'owner'
    `, [fileId, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only file owner can remove permissions' });
    }

    // Cannot remove owner permission
    const result = await pool.query(`
      DELETE FROM file_permissions
      WHERE file_id = $1 AND user_id = $2 AND permission_level != 'owner'
      RETURNING *
    `, [fileId, targetUserId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Permission not found or cannot remove owner' });
    }

    res.json({
      message: 'Access removed successfully'
    });
  } catch (error) {
    console.error('Remove permission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get all files shared with the current user
 * GET /api/sharing/shared-with-me
 */
router.get('/shared-with-me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const result = await pool.query(`
      SELECT 
        f.id,
        f.filename,
        f.language,
        f.is_collaborative,
        f.created_at,
        f.updated_at,
        p.project_name,
        fp.permission_level,
        owner.username as owner_username,
        grantor.username as shared_by_username
      FROM file_permissions fp
      JOIN files f ON fp.file_id = f.id
      JOIN projects p ON f.project_id = p.id
      JOIN users owner ON p.owner_id = owner.id
      LEFT JOIN users grantor ON fp.granted_by = grantor.id
      WHERE fp.user_id = $1 AND fp.permission_level != 'owner'
      ORDER BY f.updated_at DESC
    `, [userId]);

    res.json({
      sharedFiles: result.rows.map(row => ({
        id: row.id,
        filename: row.filename,
        language: row.language,
        isCollaborative: row.is_collaborative,
        projectName: row.project_name,
        ownerUsername: row.owner_username,
        sharedBy: row.shared_by_username,
        permissionLevel: row.permission_level,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    console.error('Get shared files error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
