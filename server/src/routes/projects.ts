import express from 'express';
import pool from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all projects for authenticated user
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      'SELECT id, project_name, created_at, updated_at FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC',
      [userId]
    );

    res.json({
      projects: result.rows
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific project details
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const projectId = parseInt(req.params.id);

    if (isNaN(projectId)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    const result = await pool.query(
      'SELECT id, project_name, created_at, updated_at FROM projects WHERE id = $1 AND owner_id = $2',
      [projectId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({
      project: result.rows[0]
    });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new project
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { projectName } = req.body;

    if (!projectName || projectName.trim().length === 0) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    // Check if project name already exists for this user
    const existingProject = await pool.query(
      'SELECT id FROM projects WHERE owner_id = $1 AND project_name = $2',
      [userId, projectName.trim()]
    );

    if (existingProject.rows.length > 0) {
      return res.status(400).json({ error: 'Project name already exists' });
    }

    const result = await pool.query(
      'INSERT INTO projects (owner_id, project_name) VALUES ($1, $2) RETURNING id, project_name, created_at, updated_at',
      [userId, projectName.trim()]
    );

    const project = result.rows[0];

    res.status(201).json({
      message: 'Project created successfully',
      project
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get files for a specific project
router.get('/:id/files', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const projectId = parseInt(req.params.id);

    if (isNaN(projectId)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    // Verify project ownership
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND owner_id = $2',
      [projectId, userId]
    );

    if (projectCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get files
    const result = await pool.query(
      'SELECT id, filename, language, is_collaborative, created_at, updated_at FROM files WHERE project_id = $1 ORDER BY filename',
      [projectId]
    );

    res.json({
      files: result.rows
    });
  } catch (error) {
    console.error('Get project files error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new file in project
router.post('/:id/files', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const projectId = parseInt(req.params.id);
    const { filename, language, content = '', isCollaborative = false } = req.body;

    if (isNaN(projectId)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    if (!filename || filename.trim().length === 0) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Verify project ownership
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND owner_id = $2',
      [projectId, userId]
    );

    if (projectCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if filename already exists in project
    const existingFile = await pool.query(
      'SELECT id FROM files WHERE project_id = $1 AND filename = $2',
      [projectId, filename.trim()]
    );

    if (existingFile.rows.length > 0) {
      return res.status(400).json({ error: 'File with this name already exists in project' });
    }

    const result = await pool.query(
      'INSERT INTO files (project_id, filename, content, language, is_collaborative) VALUES ($1, $2, $3, $4, $5) RETURNING id, filename, language, is_collaborative, created_at, updated_at',
      [projectId, filename.trim(), content, language, isCollaborative]
    );

    const file = result.rows[0];

    res.status(201).json({
      message: 'File created successfully',
      file
    });
  } catch (error) {
    console.error('Create file error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
