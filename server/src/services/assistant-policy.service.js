const ACTION_POLICY = {
    'nav.go_to_tab': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'bi.create_dashboard': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'bi.create_folder': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'bi.create_dashboard_report': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'bi.create_chart': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'bi.create_widget': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'bi.create_calculated_field': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'bi.update_widget': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'bi.delete_widget': { target: 'client', riskLevel: 'high', requiresConfirmation: true },
    'bi.delete_dashboard': { target: 'client', riskLevel: 'high', requiresConfirmation: true },
    'bi.undo': { target: 'client', riskLevel: 'low', requiresConfirmation: false },

    'connections.create_bigquery': { target: 'server', riskLevel: 'low', requiresConfirmation: false },
    'connections.create_postgres': { target: 'server', riskLevel: 'low', requiresConfirmation: false },
    'connections.delete_connection': { target: 'server', riskLevel: 'high', requiresConfirmation: true },

    'tables.toggle_status': { target: 'server', riskLevel: 'low', requiresConfirmation: false },
    'tables.delete': { target: 'server', riskLevel: 'high', requiresConfirmation: true },

    'data_modeling.auto_detect_relationships': { target: 'server', riskLevel: 'low', requiresConfirmation: false },
    'data_modeling.create_relationship': { target: 'server', riskLevel: 'low', requiresConfirmation: false },
    'data_modeling.delete_relationship': { target: 'server', riskLevel: 'high', requiresConfirmation: true },

    'users.invite': { target: 'server', riskLevel: 'low', requiresConfirmation: false },
    'users.update': { target: 'server', riskLevel: 'medium', requiresConfirmation: false },
    'users.toggle_status': { target: 'server', riskLevel: 'high', requiresConfirmation: true },
    'users.delete': { target: 'server', riskLevel: 'high', requiresConfirmation: true },

    'reports.new_session': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'reports.ask': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
    'reports.rerun_chart_sql': { target: 'client', riskLevel: 'low', requiresConfirmation: false },
};

const DEFAULT_ACTION = {
    target: 'client',
    riskLevel: 'medium',
    requiresConfirmation: false,
};

const MESSAGE_STATUSES = {
    PLANNED: 'planned',
    RUNNING: 'running',
    WAITING_INPUT: 'waiting_input',
    WAITING_CONFIRM: 'waiting_confirm',
    DONE: 'done',
    FAILED: 'failed',
};

const ACTION_STATUSES = {
    PLANNED: 'planned',
    WAITING_INPUT: 'waiting_input',
    WAITING_CONFIRM: 'waiting_confirm',
    RUNNING: 'running',
    APPROVED: 'approved',
    DONE: 'done',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    UNDONE: 'undone',
};

const getActionPolicy = (actionType) => {
    return ACTION_POLICY[actionType] || DEFAULT_ACTION;
};

const normalizePlannedAction = (action, stepIndex) => {
    const safeAction = action && typeof action === 'object' ? action : {};
    const actionType = String(safeAction.actionType || '').trim();
    const policy = getActionPolicy(actionType);
    const hasCatalogPolicy = Object.prototype.hasOwnProperty.call(ACTION_POLICY, actionType);

    return {
        stepIndex,
        actionType,
        target: hasCatalogPolicy ? policy.target : (safeAction.target || policy.target),
        riskLevel: hasCatalogPolicy ? policy.riskLevel : (safeAction.riskLevel || policy.riskLevel),
        requiresConfirmation: hasCatalogPolicy
            ? policy.requiresConfirmation
            : (typeof safeAction.requiresConfirmation === 'boolean'
                ? safeAction.requiresConfirmation
                : policy.requiresConfirmation),
        args: safeAction.args && typeof safeAction.args === 'object' ? safeAction.args : {},
        status: safeAction.status || ACTION_STATUSES.PLANNED,
    };
};

const normalizePlannedActions = (actions) => {
    if (!Array.isArray(actions)) return [];
    return actions
        .map((action, idx) => normalizePlannedAction(action, idx + 1))
        .filter((action) => action.actionType);
};

const collectPendingConfirmations = (actions) => {
    return (actions || []).filter((action) => action.requiresConfirmation === true);
};

const deriveAssistantMessageStatus = ({ missingInputs, actions }) => {
    if (Array.isArray(missingInputs) && missingInputs.length > 0) {
        return MESSAGE_STATUSES.WAITING_INPUT;
    }

    const list = Array.isArray(actions) ? actions : [];
    if (list.some((action) => action.status === ACTION_STATUSES.WAITING_INPUT)) {
        return MESSAGE_STATUSES.WAITING_INPUT;
    }
    if (list.some((action) => action.status === ACTION_STATUSES.FAILED)) {
        return MESSAGE_STATUSES.FAILED;
    }
    if (list.some((action) => action.status === ACTION_STATUSES.WAITING_CONFIRM)) {
        return MESSAGE_STATUSES.WAITING_CONFIRM;
    }
    if (list.some((action) => (
        action.status === ACTION_STATUSES.RUNNING
        || action.status === ACTION_STATUSES.PLANNED
        || action.status === ACTION_STATUSES.APPROVED
    ))) {
        return MESSAGE_STATUSES.RUNNING;
    }
    if (list.length === 0) {
        return MESSAGE_STATUSES.DONE;
    }
    if (list.every((action) => (
        action.status === ACTION_STATUSES.DONE
        || action.status === ACTION_STATUSES.CANCELLED
        || action.status === ACTION_STATUSES.UNDONE
    ))) {
        return MESSAGE_STATUSES.DONE;
    }

    return MESSAGE_STATUSES.RUNNING;
};

module.exports = {
    ACTION_POLICY,
    ACTION_STATUSES,
    MESSAGE_STATUSES,
    getActionPolicy,
    normalizePlannedAction,
    normalizePlannedActions,
    collectPendingConfirmations,
    deriveAssistantMessageStatus,
};
