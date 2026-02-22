-- ============================================
-- Table definition metadata + history backup
-- ============================================

ALTER TABLE synced_tables
    ADD COLUMN IF NOT EXISTS ai_definition_source VARCHAR(20),
    ADD COLUMN IF NOT EXISTS ai_definition_provider VARCHAR(50),
    ADD COLUMN IF NOT EXISTS ai_definition_model_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS ai_definition_confidence NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS ai_definition_signals JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'synced_tables_ai_definition_source_check'
          AND conrelid = 'synced_tables'::regclass
    ) THEN
        ALTER TABLE synced_tables
            ADD CONSTRAINT synced_tables_ai_definition_source_check
            CHECK (
                ai_definition_source IS NULL
                OR ai_definition_source IN ('ai', 'heuristic', 'manual')
            );
    END IF;
END $$;

UPDATE synced_tables
SET ai_definition_source = 'manual'
WHERE ai_definition IS NOT NULL
  AND COALESCE(ai_definition_source, '') = '';

CREATE TABLE IF NOT EXISTS synced_table_definition_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    synced_table_id UUID REFERENCES synced_tables(id) ON DELETE SET NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    dataset_name VARCHAR(255),
    table_name VARCHAR(255) NOT NULL,
    old_definition TEXT,
    new_definition TEXT,
    old_source VARCHAR(20),
    new_source VARCHAR(20),
    provider VARCHAR(50),
    model_id VARCHAR(120),
    confidence NUMERIC(5,4),
    signals JSONB NOT NULL DEFAULT '[]'::jsonb,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    change_reason VARCHAR(50) NOT NULL DEFAULT 'system',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synced_table_definition_history_workspace
    ON synced_table_definition_history(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synced_table_definition_history_table
    ON synced_table_definition_history(synced_table_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synced_table_definition_history_connection
    ON synced_table_definition_history(connection_id, created_at DESC);
