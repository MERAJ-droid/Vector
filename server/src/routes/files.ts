import express from 'express';
import pool from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { PermissionRequest, requireViewer, requireEditor } from '../middleware/permissions';

const router = express.Router();

// Get file details and content
router.get('/:id', authenticateToken, requireViewer, async (req: PermissionRequest, res) => {
  try {
    const fileId = parseInt(req.params.id);

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    // Get file details.
    // encode(digest(f.content, 'sha256'), 'hex') computes a SHA-256 hex hash of the stored
    // content at query time using pgcrypto. The client uses this hash to verify that the
    // Y.Doc content after YJS sync matches what PostgreSQL considers authoritative.
    // pgcrypto is enabled via runMigrations.ts before any query that relies on it.
    const result = await pool.query(`
      SELECT f.id, f.project_id, f.filename, f.content, f.language, f.is_collaborative, f.created_at, f.updated_at, p.project_name,
             u.username as owner_username,
             encode(digest(COALESCE(f.content, ''), 'sha256'), 'hex') AS content_hash
      FROM files f
      JOIN projects p ON f.project_id = p.id
      JOIN users u ON p.owner_id = u.id
      WHERE f.id = $1
    `, [fileId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    // Get the latest snapshot if available
    const snapshotResult = await pool.query(
      'SELECT snapshot_data FROM yjs_snapshots WHERE file_id = $1 ORDER BY sequence_number DESC LIMIT 1',
      [fileId]
    );

    const response: any = {
      file: {
        id: file.id,
        project_id: file.project_id,
        filename: file.filename,
        content: file.content,
        language: file.language,
        isCollaborative: file.is_collaborative,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
        projectName: file.project_name,
        ownerUsername: file.owner_username,
        permission: req.filePermission,
        // SHA-256 hex hash of files.content computed in PostgreSQL via pgcrypto.
        // Used by the client after YJS sync to verify Y.Doc integrity.
        // COALESCE(content, '') ensures a stable hash even for empty/null files.
        contentHash: file.content_hash,
      }
    };

    // Include snapshot data if available
    if (snapshotResult.rows.length > 0) {
      response.file.snapshot = Array.from(snapshotResult.rows[0].snapshot_data);
      console.log(`📥 Loaded snapshot for file ${fileId}`);
    }

    res.json(response);
  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update file content (Phase 2 - supports both regular updates and Yjs snapshots)
router.put('/:id', authenticateToken, requireEditor, async (req: PermissionRequest, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const { content, language, snapshot } = req.body;

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    // If snapshot data is provided, save it to yjs_snapshots table
    if (snapshot && Array.isArray(snapshot)) {
      const snapshotBuffer = Buffer.from(snapshot);
      
      // Get the next sequence number
      const sequenceResult = await pool.query(
        'SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_sequence FROM yjs_snapshots WHERE file_id = $1',
        [fileId]
      );
      const nextSequence = sequenceResult.rows[0].next_sequence;

      // Save the snapshot
      await pool.query(
        'INSERT INTO yjs_snapshots (file_id, snapshot_data, sequence_number) VALUES ($1, $2, $3)',
        [fileId, snapshotBuffer, nextSequence]
      );

      console.log(`💾 Saved Yjs snapshot for file ${fileId}, sequence ${nextSequence}`);
    }

    // Update file content in the files table
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (content !== undefined) {
      updateFields.push(`content = $${paramCount++}`);
      updateValues.push(content);
    }

    if (language !== undefined) {
      updateFields.push(`language = $${paramCount++}`);
      updateValues.push(language);
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(fileId);

    const result = await pool.query(`
      UPDATE files 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, filename, content, language, is_collaborative, updated_at
    `, updateValues);

    const updatedFile = result.rows[0];

    // Auto-create version if content changed
    if (content !== undefined) {
      try {
        // Get next version number
        const versionResult = await pool.query(
          'SELECT get_next_version_number($1) as version_number',
          [fileId]
        );
        const versionNumber = versionResult.rows[0].version_number;

        // Create version entry with conflict handling
        // If another connection already created this version number, skip it
        const insertResult = await pool.query(
          `INSERT INTO file_versions (file_id, content, version_number, created_by, commit_message, file_size)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (file_id, version_number) DO NOTHING
          RETURNING version_number`,
          [
            fileId, 
            content, 
            versionNumber, 
            req.user!.id, 
            'Auto-save checkpoint', 
            Buffer.byteLength(content, 'utf8')
          ]
        );

        // Only log if we actually created a version (not skipped due to conflict)
        if (insertResult.rows.length > 0) {
          console.log(`📸 Auto-created version ${versionNumber} for file ${fileId}`);
        } else {
          console.log(`⏭️  Skipped duplicate version ${versionNumber} for file ${fileId} (race condition)`);
        }
      } catch (versionError) {
        console.error('Error creating version:', versionError);
        // Don't fail the file update if version creation fails
      }
    }

    res.json({
      message: 'File updated successfully',
      file: {
        id: updatedFile.id,
        filename: updatedFile.filename,
        content: updatedFile.content,
        language: updatedFile.language,
        isCollaborative: updatedFile.is_collaborative,
        updatedAt: updatedFile.updated_at
      }
    });
  } catch (error) {
    console.error('Update file error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create Yjs snapshot (stub for Phase 2 preparation)
router.post('/:id/snapshot', authenticateToken, requireEditor, async (req: PermissionRequest, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const { snapshotData } = req.body;

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    if (!snapshotData) {
      return res.status(400).json({ error: 'Snapshot data is required' });
    }

    // Get the next sequence number
    const sequenceResult = await pool.query(
      'SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_sequence FROM yjs_snapshots WHERE file_id = $1',
      [fileId]
    );
    const nextSequence = sequenceResult.rows[0].next_sequence;

    // Store snapshot (for now, storing as text - in Phase 2 this will be binary data)
    const result = await pool.query(
      'INSERT INTO yjs_snapshots (file_id, snapshot_data, sequence_number) VALUES ($1, $2, $3) RETURNING id, created_at',
      [fileId, Buffer.from(snapshotData), nextSequence]
    );

    const snapshot = result.rows[0];

    res.status(201).json({
      message: 'Snapshot saved successfully',
      snapshot: {
        id: snapshot.id,
        fileId,
        sequenceNumber: nextSequence,
        createdAt: snapshot.created_at
      }
    });
  } catch (error) {
    console.error('Create snapshot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get latest Yjs snapshot (stub for Phase 2 preparation)
router.get('/:id/snapshot', authenticateToken, requireViewer, async (req: PermissionRequest, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const { latest } = req.query;

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    let query = 'SELECT id, snapshot_data, sequence_number, created_at FROM yjs_snapshots WHERE file_id = $1';
    let params = [fileId];

    if (latest === 'true') {
      query += ' ORDER BY sequence_number DESC LIMIT 1';
    } else {
      query += ' ORDER BY sequence_number ASC';
    }

    const result = await pool.query(query, params);

    if (latest === 'true' && result.rows.length === 0) {
      return res.status(404).json({ error: 'No snapshots found for this file' });
    }

    const snapshots = result.rows.map(row => ({
      id: row.id,
      fileId,
      snapshotData: row.snapshot_data.toString(), // Convert buffer back to string for now
      sequenceNumber: row.sequence_number,
      createdAt: row.created_at
    }));

    res.json({
      snapshots: latest === 'true' ? snapshots[0] : snapshots
    });
  } catch (error) {
    console.error('Get snapshot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
