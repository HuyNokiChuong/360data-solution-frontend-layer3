-- Add RLS metadata to share tables
ALTER TABLE dashboard_shares
ADD COLUMN IF NOT EXISTS allowed_page_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE dashboard_shares
ADD COLUMN IF NOT EXISTS rls_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE folder_shares
ADD COLUMN IF NOT EXISTS rls_config JSONB NOT NULL DEFAULT '{}'::jsonb;
