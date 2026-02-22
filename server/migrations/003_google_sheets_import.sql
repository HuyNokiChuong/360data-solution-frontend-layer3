-- ============================================
-- Google Sheets Import Support
-- ============================================

ALTER TABLE synced_tables
    ADD COLUMN IF NOT EXISTS source_file_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS source_sheet_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_synced_tables_conn_source_file
    ON synced_tables(connection_id, source_file_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_synced_tables_conn_file_sheet_unique_active
    ON synced_tables(connection_id, source_file_id, source_sheet_id)
    WHERE source_file_id IS NOT NULL
      AND source_sheet_id IS NOT NULL
      AND is_deleted = FALSE;

