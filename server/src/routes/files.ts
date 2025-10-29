import express from 'express';
import pool from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get file details and content
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const fileId = parseInt(req.params.id);

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    // Get file with project ownership verification
    const result = await pool.query(`
      SELECT f.id, f.filename, f.content, f.language, f.is_collaborative, f.created_at, f.updated_at, p.project_name
      FROM files f
      JOIN projects p ON f.project_id = p.id
      WHERE f.id = $1 AND p.owner_id = $2
    `, [fileId, userId]);

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
        filename: file.filename,
        content: file.content,
        language: file.language,
        isCollaborative: file.is_collaborative,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
        projectName: file.project_name
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
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const fileId = parseInt(req.params.id);
    const { content, language, snapshot } = req.body;

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    // Verify file ownership and get current state
    const fileCheck = await pool.query(`
      SELECT f.id, f.is_collaborative, f.project_id
      FROM files f
      JOIN projects p ON f.project_id = p.id
      WHERE f.id = $1 AND p.owner_id = $2
    `, [fileId, userId]);

    if (fileCheck.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = fileCheck.rows[0];

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
router.post('/:id/snapshot', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const fileId = parseInt(req.params.id);
    const { snapshotData } = req.body;

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    if (!snapshotData) {
      return res.status(400).json({ error: 'Snapshot data is required' });
    }

    // Verify file ownership
    const fileCheck = await pool.query(`
      SELECT f.id
      FROM files f
      JOIN projects p ON f.project_id = p.id
      WHERE f.id = $1 AND p.owner_id = $2
    `, [fileId, userId]);

    if (fileCheck.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
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
router.get('/:id/snapshot', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const fileId = parseInt(req.params.id);
    const { latest } = req.query;

    if (isNaN(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    // Verify file ownership
    const fileCheck = await pool.query(`
      SELECT f.id
      FROM files f
      JOIN projects p ON f.project_id = p.id
      WHERE f.id = $1 AND p.owner_id = $2
    `, [fileId, userId]);

    if (fileCheck.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
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
