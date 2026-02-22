-- ============================================
-- Groups + table-level access + group share targets
-- ============================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS group_name VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_users_workspace_group_name
    ON users(workspace_id, group_name);

CREATE TABLE IF NOT EXISTS table_view_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    synced_table_id UUID NOT NULL REFERENCES synced_tables(id) ON DELETE CASCADE,
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('user', 'group')),
    target_id VARCHAR(255) NOT NULL,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, synced_table_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_table_view_permissions_workspace_table
    ON table_view_permissions(workspace_id, synced_table_id);

CREATE INDEX IF NOT EXISTS idx_table_view_permissions_target
    ON table_view_permissions(workspace_id, target_type, target_id);

DROP TRIGGER IF EXISTS trigger_update_table_view_permissions ON table_view_permissions;
CREATE TRIGGER trigger_update_table_view_permissions
BEFORE UPDATE ON table_view_permissions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE dashboard_shares
    ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS target_id VARCHAR(255);

UPDATE dashboard_shares
SET target_type = 'user'
WHERE target_type IS NULL;

UPDATE dashboard_shares
SET target_id = COALESCE(target_id, user_id)
WHERE target_id IS NULL;

ALTER TABLE dashboard_shares
    ALTER COLUMN target_type SET DEFAULT 'user';

ALTER TABLE dashboard_shares
    ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'dashboard_shares_target_type_check'
          AND conrelid = 'dashboard_shares'::regclass
    ) THEN
        ALTER TABLE dashboard_shares
            ADD CONSTRAINT dashboard_shares_target_type_check
            CHECK (target_type IN ('user', 'group'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_shares_target_unique
    ON dashboard_shares(dashboard_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_shares_target
    ON dashboard_shares(target_type, target_id);

ALTER TABLE folder_shares
    ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS target_id VARCHAR(255);

UPDATE folder_shares
SET target_type = 'user'
WHERE target_type IS NULL;

UPDATE folder_shares
SET target_id = COALESCE(target_id, user_id)
WHERE target_id IS NULL;

ALTER TABLE folder_shares
    ALTER COLUMN target_type SET DEFAULT 'user';

ALTER TABLE folder_shares
    ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'folder_shares_target_type_check'
          AND conrelid = 'folder_shares'::regclass
    ) THEN
        ALTER TABLE folder_shares
            ADD CONSTRAINT folder_shares_target_type_check
            CHECK (target_type IN ('user', 'group'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_shares_target_unique
    ON folder_shares(folder_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_folder_shares_target
    ON folder_shares(target_type, target_id);
