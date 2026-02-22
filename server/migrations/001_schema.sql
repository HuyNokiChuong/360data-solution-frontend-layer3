-- ============================================
-- 360data Solutions - Database Schema
-- Target: PostgreSQL 14+
-- Database: bidata @ 103.249.116.116:5433
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. WORKSPACES (multi-tenant by email domain)
-- ============================================
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_domain ON workspaces(domain);

-- ============================================
-- 2. USERS
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'Viewer' CHECK (role IN ('Admin', 'Editor', 'Viewer')),
    status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Active', 'Pending', 'Disabled')),
    job_title VARCHAR(255),
    phone_number VARCHAR(50),
    company_size VARCHAR(50),
    level VARCHAR(50),
    department VARCHAR(100),
    industry VARCHAR(100),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================
-- 3. CONNECTIONS (data warehouse connections)
-- ============================================
CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('BigQuery', 'Snowflake', 'Redshift', 'PostgreSQL', 'Excel', 'GoogleSheets')),
    auth_type VARCHAR(50) NOT NULL DEFAULT 'GoogleMail' CHECK (auth_type IN ('GoogleMail', 'ServiceAccount', 'Password')),
    email VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'Connected' CHECK (status IN ('Connected', 'Error', 'Syncing')),
    project_id VARCHAR(255),
    service_account_key TEXT,
    table_count INTEGER NOT NULL DEFAULT 0,
    config JSONB DEFAULT '{}',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connections_workspace ON connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_connections_created_by ON connections(created_by);

-- ============================================
-- 4. SYNCED_TABLES (tables within connections)
-- ============================================
CREATE TABLE IF NOT EXISTS synced_tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    table_name VARCHAR(255) NOT NULL,
    dataset_name VARCHAR(255),
    row_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Disabled')),
    last_sync TIMESTAMPTZ DEFAULT NOW(),
    schema_def JSONB DEFAULT '[]',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synced_tables_connection ON synced_tables(connection_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_synced_tables_unique ON synced_tables(connection_id, dataset_name, table_name);

-- ============================================
-- 5. FOLDERS (dashboard organization)
-- ============================================
CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    icon VARCHAR(50),
    color VARCHAR(20),
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

-- ============================================
-- 6. DASHBOARDS
-- ============================================
CREATE TABLE IF NOT EXISTS dashboards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    data_source_id VARCHAR(255),
    data_source_name VARCHAR(255),
    enable_cross_filter BOOLEAN DEFAULT FALSE,
    -- Store full widget/page state as JSONB for flexibility
    pages JSONB DEFAULT '[]',
    widgets JSONB DEFAULT '[]',
    active_page_id VARCHAR(255),
    global_filters JSONB DEFAULT '[]',
    calculated_fields JSONB DEFAULT '[]',
    quick_measures JSONB DEFAULT '[]',
    layout JSONB DEFAULT '{}',
    theme JSONB DEFAULT '{}',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboards_workspace ON dashboards(workspace_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_folder ON dashboards(folder_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_created_by ON dashboards(created_by);

-- ============================================
-- 7. DASHBOARD_SHARES
-- ============================================
CREATE TABLE IF NOT EXISTS dashboard_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL, -- stores email for cross-reference
    permission VARCHAR(20) NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'admin')),
    shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(dashboard_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_shares_dashboard ON dashboard_shares(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_shares_user ON dashboard_shares(user_id);

-- ============================================
-- 8. FOLDER_SHARES
-- ============================================
CREATE TABLE IF NOT EXISTS folder_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    permission VARCHAR(20) NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'admin')),
    shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(folder_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_shares_folder ON folder_shares(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_shares_user ON folder_shares(user_id);

-- ============================================
-- 9. AI_SESSIONS (Ask AI conversations)
-- ============================================
CREATE TABLE IF NOT EXISTS ai_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL DEFAULT 'Data Exploration Hub',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_user ON ai_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_workspace ON ai_sessions(workspace_id);

-- ============================================
-- 10. AI_MESSAGES (individual messages)
-- ============================================
CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    visual_data JSONB,
    sql_trace TEXT,
    execution_time REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_created ON ai_messages(created_at);

-- ============================================
-- 11. AI_SETTINGS (per user/workspace)
-- ============================================
CREATE TABLE IF NOT EXISTS ai_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- 'gemini', 'openai', 'anthropic'
    api_key_encrypted TEXT,
    model_id VARCHAR(100),
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ai_settings_user ON ai_settings(user_id);

-- ============================================
-- 12. AUDIT_LOGS
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255),
    details JSONB DEFAULT '{}',
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============================================
-- Updated at trigger function
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables with updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY['workspaces', 'users', 'connections', 'folders', 'dashboards', 'ai_sessions', 'ai_settings'])
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trigger_update_%I ON %I;
            CREATE TRIGGER trigger_update_%I
            BEFORE UPDATE ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        ', t, t, t, t);
    END LOOP;
END;
$$;
