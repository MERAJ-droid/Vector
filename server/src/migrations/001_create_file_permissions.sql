-- Phase 3: File Sharing & Permissions System
-- Migration: Create file_permissions table

-- Create enum type for permission levels
CREATE TYPE permission_level AS ENUM ('owner', 'editor', 'viewer');

-- Create file_permissions table
CREATE TABLE IF NOT EXISTS file_permissions (
  id SERIAL PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_level permission_level NOT NULL DEFAULT 'viewer',
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(file_id, user_id)
);

-- Create indexes for better query performance
CREATE INDEX idx_file_permissions_file_id ON file_permissions(file_id);
CREATE INDEX idx_file_permissions_user_id ON file_permissions(user_id);
CREATE INDEX idx_file_permissions_permission_level ON file_permissions(permission_level);
CREATE INDEX idx_file_permissions_file_user ON file_permissions(file_id, user_id);

-- Create trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_file_permissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER trigger_update_file_permissions_updated_at
BEFORE UPDATE ON file_permissions
FOR EACH ROW
EXECUTE FUNCTION update_file_permissions_updated_at();

-- Migrate existing files to have owners in file_permissions
-- This ensures backward compatibility with existing files
INSERT INTO file_permissions (file_id, user_id, permission_level, granted_by)
SELECT f.id, p.owner_id, 'owner'::permission_level, p.owner_id
FROM files f
JOIN projects p ON f.project_id = p.id
ON CONFLICT (file_id, user_id) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE file_permissions IS 'Stores file sharing permissions for collaborative editing';
COMMENT ON COLUMN file_permissions.permission_level IS 'owner: full control, editor: read/write, viewer: read-only';
COMMENT ON COLUMN file_permissions.granted_by IS 'User who granted this permission';
