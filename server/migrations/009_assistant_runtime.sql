-- ============================================
-- Assistant Runtime (Global + BI)
-- ============================================

CREATE TABLE IF NOT EXISTS assistant_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('global', 'bi')),
    title VARCHAR(500) NOT NULL DEFAULT 'Assistant Session',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_sessions_workspace_user
    ON assistant_sessions(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_assistant_sessions_workspace_user_created
    ON assistant_sessions(workspace_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_sessions_channel
    ON assistant_sessions(channel, created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'planned' CHECK (
        status IN ('planned', 'running', 'waiting_input', 'waiting_confirm', 'done', 'failed')
    ),
    model_provider VARCHAR(50),
    model_id VARCHAR(120),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_session
    ON assistant_messages(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_session_created
    ON assistant_messages(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_status
    ON assistant_messages(status, created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    target VARCHAR(20) NOT NULL CHECK (target IN ('server', 'client')),
    action_type VARCHAR(120) NOT NULL,
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
    requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    args_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'planned' CHECK (
        status IN ('planned', 'waiting_input', 'waiting_confirm', 'running', 'approved', 'done', 'failed', 'cancelled', 'undone')
    ),
    result_json JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_actions_workspace_like
    ON assistant_actions(session_id, message_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_assistant_actions_session_created
    ON assistant_actions(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_actions_status
    ON assistant_actions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_actions_action_type
    ON assistant_actions(action_type);

DROP TRIGGER IF EXISTS trigger_update_assistant_sessions ON assistant_sessions;
CREATE TRIGGER trigger_update_assistant_sessions
BEFORE UPDATE ON assistant_sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_assistant_messages ON assistant_messages;
CREATE TRIGGER trigger_update_assistant_messages
BEFORE UPDATE ON assistant_messages
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_assistant_actions ON assistant_actions;
CREATE TRIGGER trigger_update_assistant_actions
BEFORE UPDATE ON assistant_actions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
