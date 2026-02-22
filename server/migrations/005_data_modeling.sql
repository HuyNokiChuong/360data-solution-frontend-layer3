-- ============================================
-- Data Modeling Semantic Layer
-- ============================================

CREATE TABLE IF NOT EXISTS data_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_data_models_workspace_default
    ON data_models(workspace_id)
    WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_data_models_workspace
    ON data_models(workspace_id);

CREATE TABLE IF NOT EXISTS model_tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    data_model_id UUID NOT NULL REFERENCES data_models(id) ON DELETE CASCADE,
    synced_table_id UUID NOT NULL REFERENCES synced_tables(id) ON DELETE CASCADE,
    table_name VARCHAR(255) NOT NULL,
    dataset_name VARCHAR(255),
    source_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    source_type VARCHAR(50) NOT NULL,
    runtime_engine VARCHAR(20) NOT NULL CHECK (runtime_engine IN ('bigquery', 'postgres')),
    runtime_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (data_model_id, synced_table_id)
);

CREATE INDEX IF NOT EXISTS idx_model_tables_data_model
    ON model_tables(data_model_id);

CREATE INDEX IF NOT EXISTS idx_model_tables_synced
    ON model_tables(synced_table_id);

CREATE TABLE IF NOT EXISTS model_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    data_model_id UUID NOT NULL REFERENCES data_models(id) ON DELETE CASCADE,
    from_table VARCHAR(255) NOT NULL,
    from_column VARCHAR(255) NOT NULL,
    to_table VARCHAR(255) NOT NULL,
    to_column VARCHAR(255) NOT NULL,
    from_table_id UUID NOT NULL REFERENCES model_tables(id) ON DELETE CASCADE,
    to_table_id UUID NOT NULL REFERENCES model_tables(id) ON DELETE CASCADE,
    relationship_type VARCHAR(10) NOT NULL CHECK (relationship_type IN ('1-1', '1-n', 'n-1', 'n-n')),
    cross_filter_direction VARCHAR(10) NOT NULL CHECK (cross_filter_direction IN ('single', 'both')),
    validation_status VARCHAR(20) NOT NULL DEFAULT 'valid' CHECK (validation_status IN ('valid', 'invalid')),
    invalid_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (data_model_id, from_table_id, from_column, to_table_id, to_column)
);

CREATE INDEX IF NOT EXISTS idx_model_relationships_data_model
    ON model_relationships(data_model_id);

CREATE INDEX IF NOT EXISTS idx_model_relationships_from
    ON model_relationships(from_table_id);

CREATE INDEX IF NOT EXISTS idx_model_relationships_to
    ON model_relationships(to_table_id);

CREATE TABLE IF NOT EXISTS model_runtime_tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    synced_table_id UUID NOT NULL REFERENCES synced_tables(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL,
    runtime_engine VARCHAR(20) NOT NULL CHECK (runtime_engine IN ('bigquery', 'postgres')),
    runtime_schema VARCHAR(255),
    runtime_table VARCHAR(255),
    runtime_ref TEXT,
    is_executable BOOLEAN NOT NULL DEFAULT TRUE,
    executable_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (synced_table_id)
);

CREATE INDEX IF NOT EXISTS idx_model_runtime_workspace
    ON model_runtime_tables(workspace_id);

CREATE INDEX IF NOT EXISTS idx_model_runtime_connection
    ON model_runtime_tables(connection_id);

DROP TRIGGER IF EXISTS trigger_update_data_models ON data_models;
CREATE TRIGGER trigger_update_data_models
BEFORE UPDATE ON data_models
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_model_tables ON model_tables;
CREATE TRIGGER trigger_update_model_tables
BEFORE UPDATE ON model_tables
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_model_relationships ON model_relationships;
CREATE TRIGGER trigger_update_model_relationships
BEFORE UPDATE ON model_relationships
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_model_runtime_tables ON model_runtime_tables;
CREATE TRIGGER trigger_update_model_runtime_tables
BEFORE UPDATE ON model_runtime_tables
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Backfill one default model per workspace.
INSERT INTO data_models (workspace_id, name, is_default)
SELECT w.id, CONCAT(COALESCE(w.name, w.domain), ' Default Model'), TRUE
FROM workspaces w
WHERE NOT EXISTS (
    SELECT 1
    FROM data_models dm
    WHERE dm.workspace_id = w.id
      AND dm.is_default = TRUE
);

-- Backfill runtime catalog for BigQuery (direct query) and PostgreSQL snapshots.
INSERT INTO model_runtime_tables (
    workspace_id,
    synced_table_id,
    connection_id,
    source_type,
    runtime_engine,
    runtime_schema,
    runtime_table,
    runtime_ref,
    is_executable,
    executable_reason
)
SELECT
    c.workspace_id,
    st.id,
    c.id,
    c.type,
    CASE WHEN c.type = 'BigQuery' THEN 'bigquery' ELSE 'postgres' END,
    CASE
        WHEN c.type = 'BigQuery' THEN NULL
        WHEN c.type = 'PostgreSQL' THEN 'ingestion_snapshots'
        ELSE NULL
    END,
    CASE
        WHEN c.type = 'PostgreSQL' THEN pss.snapshot_table_name
        ELSE NULL
    END,
    CASE
        WHEN c.type = 'BigQuery' THEN
            CASE
                WHEN c.project_id IS NOT NULL AND c.project_id <> ''
                    THEN CONCAT('`', c.project_id, '.', st.dataset_name, '.', st.table_name, '`')
                ELSE CONCAT('`', st.dataset_name, '.', st.table_name, '`')
            END
        WHEN c.type = 'PostgreSQL' AND pss.snapshot_table_name IS NOT NULL
            THEN CONCAT('"ingestion_snapshots"."', pss.snapshot_table_name, '"')
        ELSE NULL
    END,
    CASE
        WHEN c.type = 'PostgreSQL' AND pss.snapshot_table_name IS NULL THEN FALSE
        ELSE TRUE
    END,
    CASE
        WHEN c.type = 'PostgreSQL' AND pss.snapshot_table_name IS NULL
            THEN 'PostgreSQL snapshot chưa sẵn sàng'
        ELSE NULL
    END
FROM synced_tables st
JOIN connections c ON c.id = st.connection_id
LEFT JOIN postgres_table_sync_state pss
    ON pss.connection_id = st.connection_id
   AND pss.schema_name = st.dataset_name
   AND pss.table_name = st.table_name
WHERE st.is_deleted = FALSE
  AND c.is_deleted = FALSE
  AND c.type IN ('BigQuery', 'PostgreSQL')
ON CONFLICT (synced_table_id)
DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    connection_id = EXCLUDED.connection_id,
    source_type = EXCLUDED.source_type,
    runtime_engine = EXCLUDED.runtime_engine,
    runtime_schema = EXCLUDED.runtime_schema,
    runtime_table = EXCLUDED.runtime_table,
    runtime_ref = EXCLUDED.runtime_ref,
    is_executable = EXCLUDED.is_executable,
    executable_reason = EXCLUDED.executable_reason,
    updated_at = NOW();

-- Backfill model tables from synced_tables into each workspace default model.
INSERT INTO model_tables (
    data_model_id,
    synced_table_id,
    table_name,
    dataset_name,
    source_id,
    source_type,
    runtime_engine,
    runtime_ref
)
SELECT
    dm.id,
    st.id,
    st.table_name,
    st.dataset_name,
    c.id,
    c.type,
    COALESCE(mrt.runtime_engine, CASE WHEN c.type = 'BigQuery' THEN 'bigquery' ELSE 'postgres' END),
    mrt.runtime_ref
FROM data_models dm
JOIN connections c ON c.workspace_id = dm.workspace_id AND c.is_deleted = FALSE
JOIN synced_tables st ON st.connection_id = c.id AND st.is_deleted = FALSE
LEFT JOIN model_runtime_tables mrt ON mrt.synced_table_id = st.id
WHERE dm.is_default = TRUE
ON CONFLICT (data_model_id, synced_table_id)
DO UPDATE SET
    table_name = EXCLUDED.table_name,
    dataset_name = EXCLUDED.dataset_name,
    source_id = EXCLUDED.source_id,
    source_type = EXCLUDED.source_type,
    runtime_engine = EXCLUDED.runtime_engine,
    runtime_ref = EXCLUDED.runtime_ref,
    updated_at = NOW();
