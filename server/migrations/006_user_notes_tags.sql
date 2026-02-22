-- ============================================
-- User notes and tags support
-- ============================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS note TEXT,
    ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

