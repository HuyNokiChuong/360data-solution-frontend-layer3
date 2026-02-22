-- ============================================
-- AI table definition metadata
-- ============================================

ALTER TABLE synced_tables
    ADD COLUMN IF NOT EXISTS ai_definition TEXT,
    ADD COLUMN IF NOT EXISTS ai_definition_generated_at TIMESTAMPTZ;
