-- Phase 4: File Version History Migration
-- Creates table to track file versions over time

-- Create file_versions table
CREATE TABLE IF NOT EXISTS file_versions (
  id SERIAL PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  commit_message TEXT,
  file_size INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ensure version numbers are unique per file
  UNIQUE(file_id, version_number)
);

-- Create indexes for performance
CREATE INDEX idx_file_versions_file_id ON file_versions(file_id);
CREATE INDEX idx_file_versions_created_at ON file_versions(created_at DESC);
CREATE INDEX idx_file_versions_created_by ON file_versions(created_by);

-- Add comments for documentation
COMMENT ON TABLE file_versions IS 'Stores historical versions of files for version control';
COMMENT ON COLUMN file_versions.version_number IS 'Sequential version number starting from 1';
COMMENT ON COLUMN file_versions.commit_message IS 'Optional message describing the changes';
COMMENT ON COLUMN file_versions.file_size IS 'Size of content in bytes';

-- Create initial versions for all existing files
-- This captures the current state as version 1
INSERT INTO file_versions (file_id, content, version_number, created_by, commit_message, file_size, created_at)
SELECT 
  f.id,
  f.content,
  1,
  p.owner_id,
  'Initial version',
  LENGTH(f.content),
  f.created_at
FROM files f
JOIN projects p ON f.project_id = p.id
WHERE NOT EXISTS (
  SELECT 1 FROM file_versions WHERE file_id = f.id
);

-- Create function to automatically increment version numbers
CREATE OR REPLACE FUNCTION get_next_version_number(p_file_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 
  INTO next_version
  FROM file_versions
  WHERE file_id = p_file_id;
  
  RETURN next_version;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_next_version_number IS 'Returns the next version number for a file';
