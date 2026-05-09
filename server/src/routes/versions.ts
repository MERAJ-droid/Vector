import express from 'express';
import pool from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { requireViewer, PermissionRequest } from '../middleware/permissions';

const router = express.Router();

/**
 * GET /api/versions/:fileId
 * Get all versions of a file
 */
router.get('/:fileId', authenticateToken, requireViewer, async (req: PermissionRequest, res) => {
  try {
    const fileId = parseInt(req.params.fileId);

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    // Get all versions for this file
    const result = await pool.query(
      `SELECT 
        fv.id,
        fv.version_number,
        fv.commit_message,
        fv.file_size,
        fv.created_at,
        u.username as created_by_username,
        u.id as created_by_id
      FROM file_versions fv
      JOIN users u ON fv.created_by = u.id
      WHERE fv.file_id = $1
      ORDER BY fv.version_number DESC`,
      [fileId]
    );

    res.json({
      versions: result.rows.map(row => ({
        id: row.id,
        versionNumber: row.version_number,
        commitMessage: row.commit_message,
        fileSize: row.file_size,
        createdAt: row.created_at,
        createdBy: {
          id: row.created_by_id,
          username: row.created_by_username
        }
      }))
    });
  } catch (error) {
    console.error('Get versions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/versions/:fileId/:versionId
 * Get content of a specific version
 */
router.get('/:fileId/:versionId', authenticateToken, requireViewer, async (req: PermissionRequest, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const versionId = parseInt(req.params.versionId);

    if (isNaN(fileId) || isNaN(versionId)) {
      return res.status(400).json({ error: 'Invalid file or version ID' });
    }

    // Get specific version content
    const result = await pool.query(
      `SELECT 
        fv.id,
        fv.content,
        fv.version_number,
        fv.commit_message,
        fv.file_size,
        fv.created_at,
        u.username as created_by_username,
        u.id as created_by_id,
        f.filename,
        f.language
      FROM file_versions fv
      JOIN users u ON fv.created_by = u.id
      JOIN files f ON fv.file_id = f.id
      WHERE fv.file_id = $1 AND fv.id = $2`,
      [fileId, versionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const version = result.rows[0];

    res.json({
      version: {
        id: version.id,
        content: version.content,
        versionNumber: version.version_number,
        commitMessage: version.commit_message,
        fileSize: version.file_size,
        createdAt: version.created_at,
        filename: version.filename,
        language: version.language,
        createdBy: {
          id: version.created_by_id,
          username: version.created_by_username
        }
      }
    });
  } catch (error) {
    console.error('Get version content error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/versions/:fileId/create
 * Create a new version checkpoint
 */
router.post('/:fileId/create', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const { content, commitMessage } = req.body;

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Get next version number
    const versionResult = await pool.query(
      'SELECT get_next_version_number($1) as version_number',
      [fileId]
    );

    const versionNumber = versionResult.rows[0].version_number;

    // Create new version
    const result = await pool.query(
      `INSERT INTO file_versions (file_id, content, version_number, created_by, commit_message, file_size)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, version_number, created_at`,
      [fileId, content, versionNumber, req.user!.id, commitMessage || null, Buffer.byteLength(content, 'utf8')]
    );

    res.json({
      message: 'Version created successfully',
      version: {
        id: result.rows[0].id,
        versionNumber: result.rows[0].version_number,
        createdAt: result.rows[0].created_at
      }
    });
  } catch (error) {
    console.error('Create version error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/versions/:fileId/restore/:versionId
 * Restore file to a specific version
 */
router.post('/:fileId/restore/:versionId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const versionId = parseInt(req.params.versionId);

    if (isNaN(fileId) || isNaN(versionId)) {
      return res.status(400).json({ error: 'Invalid file or version ID' });
    }

    // Get the version content
    const versionResult = await pool.query(
      'SELECT content, version_number FROM file_versions WHERE file_id = $1 AND id = $2',
      [fileId, versionId]
    );

    if (versionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const { content, version_number } = versionResult.rows[0];

    // Update the current file content
    await pool.query(
      'UPDATE files SET content = $1, updated_at = NOW() WHERE id = $2',
      [content, fileId]
    );

    // Create a new version entry for the restore action
    const nextVersionResult = await pool.query(
      'SELECT get_next_version_number($1) as version_number',
      [fileId]
    );

    const nextVersionNumber = nextVersionResult.rows[0].version_number;

    await pool.query(
      `INSERT INTO file_versions (file_id, content, version_number, created_by, commit_message, file_size)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [fileId, content, nextVersionNumber, req.user!.id, `Restored to version ${version_number}`, Buffer.byteLength(content, 'utf8')]
    );

    res.json({
      message: 'File restored successfully',
      restoredTo: version_number,
      newVersion: nextVersionNumber
    });
  } catch (error) {
    console.error('Restore version error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
