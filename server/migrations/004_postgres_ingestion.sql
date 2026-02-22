-- ============================================
-- PostgreSQL Ingestion Support
-- ============================================

CREATE SCHEMA IF NOT EXISTS ingestion_snapshots;

CREATE TABLE IF NOT EXISTS postgres_import_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')),
    stage VARCHAR(50) NOT NULL,
    import_mode VARCHAR(20) NOT NULL CHECK (import_mode IN ('full', 'incremental')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    progress JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postgres_import_jobs_workspace ON postgres_import_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_postgres_import_jobs_connection ON postgres_import_jobs(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_postgres_import_jobs_status ON postgres_import_jobs(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_postgres_import_jobs_single_active
    ON postgres_import_jobs(connection_id)
    WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS postgres_import_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES postgres_import_jobs(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    host VARCHAR(255) NOT NULL,
    database_name VARCHAR(255) NOT NULL,
    schema_name VARCHAR(255) NOT NULL,
    table_name VARCHAR(255) NOT NULL,
    row_count BIGINT NOT NULL DEFAULT 0,
    column_count INTEGER NOT NULL DEFAULT 0,
    import_mode VARCHAR(20) NOT NULL CHECK (import_mode IN ('full', 'incremental')),
    last_sync_time TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postgres_import_runs_connection ON postgres_import_runs(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_postgres_import_runs_job ON postgres_import_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_postgres_import_runs_status ON postgres_import_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS postgres_table_sync_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    schema_name VARCHAR(255) NOT NULL,
    table_name VARCHAR(255) NOT NULL,
    snapshot_table_name VARCHAR(255) NOT NULL,
    incremental_column VARCHAR(255),
    incremental_kind VARCHAR(20) CHECK (incremental_kind IN ('timestamp', 'id')),
    pk_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    upsert_key_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_sync_time TIMESTAMPTZ,
    last_sync_value TEXT,
    last_job_id UUID REFERENCES postgres_import_jobs(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'success', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id, schema_name, table_name)
);

CREATE INDEX IF NOT EXISTS idx_postgres_table_sync_state_connection ON postgres_table_sync_state(connection_id);
CREATE INDEX IF NOT EXISTS idx_postgres_table_sync_state_status ON postgres_table_sync_state(status, updated_at DESC);

DROP TRIGGER IF EXISTS trigger_update_postgres_import_jobs ON postgres_import_jobs;
CREATE TRIGGER trigger_update_postgres_import_jobs
BEFORE UPDATE ON postgres_import_jobs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_postgres_table_sync_state ON postgres_table_sync_state;
CREATE TRIGGER trigger_update_postgres_table_sync_state
BEFORE UPDATE ON postgres_table_sync_state
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
