-- ============================================
-- Excel Import Support
-- ============================================

ALTER TABLE synced_tables
    ADD COLUMN IF NOT EXISTS column_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS upload_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_sheet_name VARCHAR(255);

CREATE TABLE IF NOT EXISTS excel_sheet_rows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    synced_table_id UUID NOT NULL REFERENCES synced_tables(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    row_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (synced_table_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_excel_sheet_rows_table ON excel_sheet_rows(synced_table_id);
CREATE INDEX IF NOT EXISTS idx_excel_sheet_rows_table_row ON excel_sheet_rows(synced_table_id, row_index);
