const { query } = require('../config/db');
const {
    normalizePlannedActions,
    collectPendingConfirmations,
} = require('./assistant-policy.service');

const ACTION_TYPES = [
    'nav.go_to_tab',
    'bi.create_dashboard',
    'bi.create_folder',
    'bi.create_dashboard_report',
    'bi.create_chart',
    'bi.create_widget',
    'bi.create_calculated_field',
    'bi.update_widget',
    'bi.delete_widget',
    'bi.delete_dashboard',
    'bi.undo',
    'connections.create_bigquery',
    'connections.create_postgres',
    'connections.delete_connection',
    'tables.toggle_status',
    'tables.delete',
    'data_modeling.auto_detect_relationships',
    'data_modeling.create_relationship',
    'data_modeling.delete_relationship',
    'users.invite',
    'users.update',
    'users.toggle_status',
    'users.delete',
    'reports.new_session',
    'reports.ask',
    'reports.rerun_chart_sql',
];

const normalizeText = (value) => String(value || '').trim();
const normalizeToken = (value) => normalizeText(value).toLowerCase();
const lowerText = (value) => normalizeText(value).toLowerCase();
const containsAny = (text, tokens) => tokens.some((token) => text.includes(token));

const FALLBACK_ACTION_GUIDANCE = [
    'Tôi có thể thao tác trực tiếp theo module.',
    'Ví dụ:',
    '- "Tạo dashboard phân tích doanh thu và thêm widget KPI"',
    '- "Active lại user hieu@company.com"',
    '- "Tạo calculated field loi_nhuan = doanh_thu - chi_phi"',
    '- "Nối modeling: orders.customer_id -> customers.id"',
].join('\n');

const extractFirstQuotedText = (text) => {
    const match = String(text || '').match(/"([^"]+)"|'([^']+)'/);
    if (!match) return '';
    return String(match[1] || match[2] || '').trim();
};

const extractUuid = (text) => {
    const match = String(text || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match ? match[0] : '';
};

const parseChartType = (text) => {
    const t = lowerText(text);
    if (containsAny(t, ['line chart', 'linechart', 'biểu đồ đường', 'chart line'])) return 'line';
    if (containsAny(t, ['pie chart', 'biểu đồ tròn'])) return 'pie';
    if (containsAny(t, ['donut', 'doughnut'])) return 'donut';
    if (containsAny(t, ['area chart', 'biểu đồ miền'])) return 'area';
    if (containsAny(t, ['scatter', 'phân tán'])) return 'scatter';
    if (containsAny(t, ['horizontal bar', 'bar ngang'])) return 'horizontalBar';
    if (containsAny(t, ['stacked bar', 'bar chồng'])) return 'stackedBar';
    return 'bar';
};

const parseTabTarget = (text) => {
    const t = lowerText(text);
    if (containsAny(t, ['connections', 'kết nối'])) return 'connections';
    if (containsAny(t, ['tables', 'data assets', 'bảng'])) return 'tables';
    if (containsAny(t, ['reports', 'ask ai', 'phân tích'])) return 'reports';
    if (containsAny(t, ['data modeling', 'data-modeling', 'semantic', 'modeling'])) return 'data-modeling';
    if (containsAny(t, ['dashboard', 'bi'])) return 'bi';
    if (containsAny(t, ['users', 'user', 'người dùng', 'tài khoản', 'tai khoan', 'account'])) return 'users';
    if (containsAny(t, ['logs', 'audit'])) return 'logs';
    if (containsAny(t, ['ai setting', 'ai config'])) return 'ai-config';
    return '';
};

const parseFormulaSpec = (text) => {
    const raw = normalizeText(text);
    const equalIndex = raw.indexOf('=');
    if (equalIndex <= 0) return null;

    const left = raw.slice(0, equalIndex).trim();
    const right = raw.slice(equalIndex + 1).trim();
    if (!left || !right) return null;

    const nameMatch = left.match(/([a-zA-Z_][\w]*)\s*$/);
    if (!nameMatch) return null;

    const name = String(nameMatch[1] || '').trim();
    const formula = right;
    if (!name || !formula) return null;
    return { name, formula };
};

const parseEmail = (text) => {
    const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0] : '';
};

const parseProjectId = (text) => {
    const match = String(text || '').match(/\b[a-z][a-z0-9-]{4,}[a-z0-9]\b/);
    return match ? match[0] : '';
};

const sanitizeUserTargetToken = (rawValue) => {
    const value = String(rawValue || '')
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/^@+/, '')
        .replace(/[.,!?;:]+$/g, '');
    if (value.length < 2) return '';

    const normalized = value.toLowerCase();
    const blocked = new Set([
        'user',
        'users',
        'account',
        'acc',
        'tai',
        'khoan',
        'tài',
        'khoản',
        'status',
        'active',
        'activate',
        'inactive',
        'deactivate',
        'disable',
        'enable',
        'toggle',
        'cho',
        'toi',
        'tôi',
        'tao',
        'phat',
        'giup',
        'giúp',
        'dum',
        'dùm',
        'nhe',
        'nhé',
        'nha',
        'nhá',
    ]);
    if (blocked.has(normalized)) return '';
    return value;
};

const parseUserTarget = (text) => {
    const userId = extractUuid(text);
    if (userId) return { userId, email: '', userName: '' };

    const email = parseEmail(text);
    if (email) return { userId: '', email, userName: '' };

    const raw = String(text || '');
    const mention = raw.match(/@([a-zA-Z0-9._-]{2,})/);
    if (mention) {
        const userName = sanitizeUserTargetToken(mention[1]);
        if (userName) return { userId: '', email: '', userName };
    }

    const quoted = extractFirstQuotedText(raw);
    if (quoted) {
        const userName = sanitizeUserTargetToken(quoted);
        if (userName) return { userId: '', email: '', userName };
    }

    const userTokenMatch = raw.match(/(?:users?|account|acount|accout|acc|tài khoản|tai khoan)\b\s*(?:là|la|tên|ten|name|:)?\s*([a-zA-Z0-9._-]{2,})/i);
    if (userTokenMatch) {
        const userName = sanitizeUserTargetToken(userTokenMatch[1]);
        if (userName) return { userId: '', email: '', userName };
    }

    const statusTokenMatch = raw.match(/(?:active|activate|inactive|deactivate|disable|enable|khóa|khoa|mở khóa|mo khoa|kích hoạt|kich hoat|vô hiệu hóa|vo hieu hoa)\s+(?:lại\s+|lai\s+)?(?:users?|account|acount|accout|acc|tài khoản|tai khoan)\b\s*([a-zA-Z0-9._-]{2,})/i);
    if (statusTokenMatch) {
        const userName = sanitizeUserTargetToken(statusTokenMatch[1]);
        if (userName) return { userId: '', email: '', userName };
    }

    const plainText = normalizeText(raw);
    const plainLower = plainText.toLowerCase();
    const hasActionKeyword = containsAny(plainLower, [
        'active',
        'activate',
        'inactive',
        'deactivate',
        'disable',
        'enable',
        'user',
        'account',
        'tài khoản',
        'tai khoan',
        'khóa',
        'khoa',
        'mở khóa',
        'mo khoa',
        'delete',
        'remove',
        'xóa',
        'xoa',
        'update',
        'cập nhật',
        'cap nhat',
    ]);
    if (!hasActionKeyword && plainText) {
        const wholeTextCandidate = sanitizeUserTargetToken(plainText);
        if (wholeTextCandidate) return { userId: '', email: '', userName: wholeTextCandidate };
    }

    return { userId: '', email: '', userName: '' };
};

const isUserStatusToggleIntent = (text) => {
    const t = lowerText(text);
    const hasKnownToken = containsAny(t, [
        'disable user',
        'enable user',
        'toggle user status',
        'khóa user',
        'khoa user',
        'mở khóa user',
        'mo khoa user',
        'khóa tài khoản',
        'khoa tai khoan',
        'mở khóa tài khoản',
        'mo khoa tai khoan',
        'active user',
        'activate user',
        'inactive user',
        'deactivate user',
        'deactive user',
        'active account',
        'activate account',
        'inactive account',
        'deactivate account',
        'deactive account',
        'active lại account',
        'active lai account',
        'inactive lại account',
        'inactive lai account',
        'kích hoạt tài khoản',
        'kich hoat tai khoan',
        'vô hiệu hóa tài khoản',
        'vo hieu hoa tai khoan',
    ]);
    if (hasKnownToken) return true;

    const statusPattern = /\b(active|activate|enable|inactive|disable|deactivate|deactive|kh[oó]a|khoa|m[oơ]\s*kh[oó]a|mo\s*khoa|k[ií]ch\s*ho[aạ]t|vo\s*hieu\s*hoa|v[oô]\s*hi[eệ]u\s*h[oó]a)\b/i;
    const accountPattern = /\b(user|users|account|acount|accout|acc|t[aà]i\s*kho[aả]n)\b/i;
    return statusPattern.test(String(text || '')) && accountPattern.test(String(text || ''));
};

const inferDesiredUserStatus = (text) => {
    const t = lowerText(text);
    const wantsDisabled = containsAny(t, [
        'disable',
        'inactive',
        'deactivate',
        'deactive',
        'khóa',
        'khoa',
        'vô hiệu',
        'vo hieu',
        'tắt user',
        'tat user',
        'tắt tài khoản',
        'tat tai khoan',
    ]);
    if (wantsDisabled) return 'Disabled';

    const wantsActive = containsAny(t, [
        'enable',
        'active',
        'activate',
        'mở khóa',
        'mo khoa',
        'kích hoạt',
        'kich hoat',
        'bật user',
        'bat user',
        'mở lại',
        'mo lai',
    ]);
    if (wantsActive) return 'Active';

    return undefined;
};

const isCreateRelationshipIntent = (text) => {
    const t = lowerText(text);
    if (containsAny(t, ['create relationship', 'tạo relationship', 'tao relationship'])) return true;
    if (containsAny(t, ['connect modeling', 'nối modeling', 'noi modeling', 'connect model', 'nối model', 'noi model'])) return true;
    if (containsAny(t, ['nối bảng', 'noi bang', 'link table', 'map table', 'join table']) && containsAny(t, ['model', 'modeling', 'semantic', 'relationship'])) return true;
    return false;
};

const isAutoDetectRelationshipIntent = (text) => {
    const t = lowerText(text);
    return containsAny(t, [
        'auto detect relationship',
        'auto detect relationships',
        'tự động dò relationship',
        'tu dong do relationship',
        'tự động nối bảng',
        'tu dong noi bang',
        'auto relationship',
    ]);
};

const isDeleteRelationshipIntent = (text) => {
    const t = lowerText(text);
    return containsAny(t, [
        'delete relationship',
        'xóa relationship',
        'xoá relationship',
        'xoa relationship',
        'remove relationship',
        'gỡ relationship',
        'go relationship',
    ]);
};

const isSystemOperationIntent = (text) => {
    const t = lowerText(text);
    if (!t) return false;

    if (isUserStatusToggleIntent(t)) return true;
    if (isCreateRelationshipIntent(t) || isAutoDetectRelationshipIntent(t) || isDeleteRelationshipIntent(t)) return true;

    return containsAny(t, [
        'dashboard',
        'widget',
        'calculated field',
        'calculation field',
        'phép tính',
        'phep tinh',
        'công thức',
        'cong thuc',
        'table',
        'bảng',
        'bang',
        'connection',
        'kết nối',
        'ket noi',
        'user',
        'users',
        'tài khoản',
        'tai khoan',
        'account',
        'acount',
        'accout',
        'acc ',
        'modeling',
        'model',
        'relationship',
        'active ',
        'inactive',
        'enable',
        'disable',
        'deactivate',
        'delete',
        'remove',
        'xóa',
        'xoa',
        'create',
        'tạo',
        'tao',
        'update',
        'cập nhật',
        'cap nhat',
    ]);
};

const normalizeTabName = (tab) => {
    const token = normalizeToken(tab);
    if (!token) return '';
    if (token === 'data_modeling' || token === 'semantic') return 'data-modeling';
    return token;
};

const resolveTabFromActionType = (actionType) => {
    const token = normalizeToken(actionType);
    if (!token) return '';
    if (token.startsWith('bi.')) return 'bi';
    if (token.startsWith('connections.')) return 'connections';
    if (token.startsWith('tables.')) return 'tables';
    if (token.startsWith('users.')) return 'users';
    if (token.startsWith('data_modeling.')) return 'data-modeling';
    if (token.startsWith('reports.')) return 'reports';
    return '';
};

const ensureNavigationForPlannedActions = (actions, activeTab = '') => {
    const list = Array.isArray(actions) ? actions.filter((action) => action && typeof action === 'object') : [];
    if (list.length === 0) return [];

    const currentTab = normalizeTabName(activeTab);
    const existingNavTabs = new Set();
    list.forEach((action) => {
        if (normalizeToken(action.actionType) !== 'nav.go_to_tab') return;
        const args = action.args && typeof action.args === 'object' ? action.args : {};
        const tab = normalizeTabName(args.tab || args.target || args.route);
        if (tab) existingNavTabs.add(tab);
    });

    const firstOperationalAction = list.find((action) => normalizeToken(action.actionType) !== 'nav.go_to_tab');
    if (!firstOperationalAction) return list;

    const targetTab = resolveTabFromActionType(firstOperationalAction.actionType);
    if (!targetTab) return list;
    if (existingNavTabs.has(targetTab)) return list;
    if (currentTab && currentTab === targetTab) return list;

    return [
        {
            actionType: 'nav.go_to_tab',
            args: {
                tab: targetTab,
                flow: String(firstOperationalAction.actionType || '').replace(/\./g, '_'),
            },
        },
        ...list,
    ];
};

const parseRelationshipSpec = (text) => {
    const match = String(text || '').match(/([\w.]+)\.([\w]+)\s*(?:->|=>|to|sang)\s*([\w.]+)\.([\w]+)/i);
    if (!match) return null;

    return {
        fromTableName: String(match[1] || '').trim(),
        fromColumn: String(match[2] || '').trim(),
        toTableName: String(match[3] || '').trim(),
        toColumn: String(match[4] || '').trim(),
    };
};

const parseDashboardTarget = (text) => {
    const raw = String(text || '');
    const quoted = raw.match(/dashboard\s*["']([^"']+)["']/i);
    if (quoted) return String(quoted[1] || '').trim();

    const named = raw.match(/(?:dashboard\s+(?:tên|name|là)|vào dashboard)\s*([^\n,.!?]+)/i);
    if (named) {
        const value = String(named[1] || '').trim();
        if (value.length >= 3) return value;
    }
    return '';
};

const shouldCreateDashboard = (text) => {
    const t = lowerText(text);
    if (!t.includes('dashboard')) return false;
    if (containsAny(t, ['delete dashboard', 'xóa dashboard', 'remove dashboard'])) return false;
    if (containsAny(t, ['update dashboard', 'cập nhật dashboard', 'sửa dashboard'])) return false;

    if (containsAny(t, ['create dashboard', 'tạo dashboard', 'làm dashboard', 'build dashboard', 'dựng dashboard', 'thiết kế dashboard'])) {
        return true;
    }

    return /l[àa]m.*dashboard/.test(t) || /dashboard.*(ph[âa]n t[ií]ch|theo|analysis)/.test(t);
};

const inferDashboardTitle = (text) => {
    const quoted = extractFirstQuotedText(text);
    if (quoted) return quoted;

    const t = lowerText(text);
    if (containsAny(t, ['doanh thu', 'revenue']) && containsAny(t, ['chi phí', 'chi phi', 'cost'])) {
        if (containsAny(t, ['theo tháng', 'monthly', 'month'])) return 'Doanh thu và Chi phí theo tháng';
        return 'Doanh thu và Chi phí';
    }
    return 'New Dashboard';
};

const shouldCreateChart = (text) => {
    const t = lowerText(text);
    if (containsAny(t, ['create chart', 'tạo chart', 'làm chart', 'tạo biểu đồ'])) return true;

    const hasTimeIntent = containsAny(t, [
        'theo tháng',
        'theo ngày',
        'theo quý',
        'theo năm',
        'monthly',
        'daily',
        'quarterly',
        'yearly',
    ]);
    const hasMetricIntent = containsAny(t, [
        'doanh thu',
        'revenue',
        'chi phí',
        'chi phi',
        'cost',
        'lợi nhuận',
        'loi nhuan',
        'profit',
    ]);
    return t.includes('dashboard') && hasTimeIntent && hasMetricIntent;
};

const inferChartTitle = (text) => {
    const quoted = extractFirstQuotedText(text);
    if (quoted) return quoted;
    const t = lowerText(text);
    if (containsAny(t, ['doanh thu', 'revenue']) && containsAny(t, ['chi phí', 'chi phi', 'cost'])) {
        if (containsAny(t, ['theo tháng', 'monthly', 'month'])) return 'Doanh thu và Chi phí theo tháng';
        return 'Doanh thu và Chi phí';
    }
    return undefined;
};

const isAnalysisIntent = (text) => {
    const t = lowerText(text);
    return containsAny(t, [
        'phân tích',
        'phan tich',
        'ask ai',
        'analyze',
        'analysis',
        'insight',
        'report',
        'reports',
        'xu hướng',
        'xu huong',
        'số liệu',
        'so lieu',
        'báo cáo',
        'bao cao',
        'quyết định',
        'quyet dinh',
        'đánh giá',
        'danh gia',
    ]);
};

const shouldSkipReportsCompanion = (text) => {
    const t = lowerText(text);
    return containsAny(t, [
        'không cần report',
        'khong can report',
        'không cần báo cáo',
        'khong can bao cao',
        'không cần phân tích',
        'khong can phan tich',
        'chỉ dashboard',
        'chi dashboard',
        'dashboard only',
        'only dashboard',
        'no report',
        'no analysis',
    ]);
};

const inferReportsPromptFromBiRequest = (text) => {
    const raw = normalizeText(text);
    if (!raw) return '';

    const tailMatch = raw.match(/(?:để|de|for|to)\s*((?:phân tích|phan tich|analy[sz]e?|analysis|report|báo cáo|bao cao)[\s\S]*)/i);
    if (tailMatch) {
        const tailPrompt = normalizeText(tailMatch[1]);
        if (tailPrompt.length >= 8) return tailPrompt;
    }

    const stripped = raw
        .replace(/\b(?:tạo|tao|create|build|làm|lam|dựng|dung|thiết kế|thiet ke)\b[\s\S]{0,80}?\bdashboard\b/ig, ' ')
        .replace(/\b(?:mới|new)\b/ig, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (isAnalysisIntent(stripped) && stripped.length >= 8) {
        return stripped;
    }
    return raw;
};

const normalizeTableLabel = (table) => {
    const datasetName = normalizeText(table?.datasetName);
    const tableName = normalizeText(table?.tableName);
    if (!tableName) return '';
    return datasetName ? `${datasetName}.${tableName}` : tableName;
};

const getActiveTablesFromContext = (context) => {
    const list = Array.isArray(context?.tables) ? context.tables : [];
    return list
        .map((item) => ({
            id: normalizeText(item?.id),
            tableName: normalizeText(item?.tableName),
            datasetName: normalizeText(item?.datasetName),
            status: normalizeToken(item?.status),
        }))
        .filter((item) => item.id && item.tableName)
        .filter((item) => !item.status || item.status === 'active')
        .map((item) => ({
            ...item,
            label: normalizeTableLabel(item),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
};

const hasAllTablesToken = (text) => {
    const t = lowerText(text);
    return containsAny(t, [
        'all tables',
        'all data',
        'all datasets',
        'tất cả bảng',
        'tat ca bang',
        'tất cả dữ liệu',
        'tat ca du lieu',
        'mọi bảng',
        'moi bang',
    ]);
};

const parseTableSelectionFromText = (text, tables) => {
    const raw = normalizeText(text);
    const lower = lowerText(raw);
    if (!raw || !Array.isArray(tables) || tables.length === 0) return [];
    if (hasAllTablesToken(raw)) return tables.map((table) => table.id);

    const selected = new Set();

    tables.forEach((table) => {
        const label = normalizeToken(table.label);
        const tableName = normalizeToken(table.tableName);
        if (label && lower.includes(label)) selected.add(table.id);
        else if (tableName && lower.includes(tableName)) selected.add(table.id);
    });

    const numericOnly = /^[\d,\s]+$/.test(lower);
    const hasTableKeyword = containsAny(lower, ['bảng', 'bang', 'table']);
    if (numericOnly || hasTableKeyword) {
        const indices = raw.match(/\d{1,3}/g) || [];
        indices.forEach((value) => {
            const idx = Number(value);
            if (!Number.isFinite(idx) || idx <= 0) return;
            const table = tables[idx - 1];
            if (table?.id) selected.add(table.id);
        });
    }

    return Array.from(selected);
};

const buildTableSelectionQuestion = (tables) => {
    if (!Array.isArray(tables) || tables.length === 0) {
        return 'Hiện chưa có bảng Active. Bạn hãy bật bảng trong Data Assets trước, rồi nhắn lại.';
    }
    const maxShow = 12;
    const shown = tables.slice(0, maxShow);
    const lines = shown.map((table, index) => `${index + 1}. ${table.label}`);
    const more = tables.length > maxShow
        ? `\n... và ${tables.length - maxShow} bảng khác.`
        : '';
    return `Chọn bảng để tôi tạo report trong dashboard (trả lời bằng số thứ tự, ví dụ "1,3" hoặc tên bảng):\n${lines.join('\n')}${more}`;
};

const parseChartIndex = (text, fallbackIndex = 0) => {
    const t = lowerText(text);
    if (containsAny(t, ['đầu tiên', 'dau tien', 'first', 'đầu 1', 'chart đầu'])) return 0;

    const chartMatch = String(text || '').match(/(?:chart|biểu đồ)\s*(\d{1,2})/i);
    if (chartMatch) {
        const value = Number(chartMatch[1]);
        if (Number.isFinite(value) && value > 0) return value - 1;
    }

    const fallback = Number(fallbackIndex);
    return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
};

const makeMissingInput = (key, question, expectedType = 'string') => ({
    key,
    question,
    expectedType,
});

const deriveFollowupMissingInputs = (actions) => {
    const list = Array.isArray(actions) ? actions : [];
    for (const action of list) {
        const actionType = normalizeToken(action?.actionType);
        const args = action?.args && typeof action.args === 'object' ? action.args : {};

        if (actionType === 'bi.create_calculated_field') {
            if (!normalizeText(args.name) || !normalizeText(args.formula)) {
                return [makeMissingInput(
                    'formulaSpec',
                    'Hãy cho công thức theo dạng: ten_truong = bieu_thuc',
                    'string'
                )];
            }
        }

        if (actionType === 'data_modeling.create_relationship') {
            if (!normalizeText(args.dataModelId)) {
                return [makeMissingInput(
                    'dataModelTarget',
                    'Bạn muốn nối ở Data Model nào? (gửi dataModelId hoặc tên model)',
                    'string'
                )];
            }
            if (!normalizeText(args.fromTableName) || !normalizeText(args.fromColumn) || !normalizeText(args.toTableName) || !normalizeText(args.toColumn)) {
                return [makeMissingInput(
                    'relationshipSpec',
                    'Hãy gửi theo dạng: tableA.columnA -> tableB.columnB',
                    'string'
                )];
            }
        }

        if (actionType === 'data_modeling.auto_detect_relationships' && !normalizeText(args.dataModelId)) {
            return [makeMissingInput(
                'dataModelTarget',
                'Bạn muốn thao tác trên Data Model nào? (gửi dataModelId hoặc tên model)',
                'string'
            )];
        }

        if (actionType.startsWith('users.')) {
            const hasUserTarget = normalizeText(args.userId) || normalizeText(args.email) || normalizeText(args.userName);
            if (!hasUserTarget) {
                return [makeMissingInput(
                    'userTarget',
                    'Bạn muốn thao tác user nào? (email, userId, hoặc tên user)',
                    'string'
                )];
            }
        }
    }

    return [];
};

const parseBooleanAnswer = (raw) => {
    const value = normalizeToken(raw);
    if (!value) return null;
    const yesTokens = ['yes', 'y', 'ok', 'agree', 'true', 'co', 'có', 'dong y', 'đồng ý'];
    const noTokens = ['no', 'n', 'false', 'khong', 'không', 'huy', 'cancel', 'khong dong y', 'không đồng ý'];
    if (yesTokens.some((token) => value === token || value.includes(token))) return true;
    if (noTokens.some((token) => value === token || value.includes(token))) return false;
    return null;
};

const castMissingInputValue = (raw, expectedType) => {
    const type = normalizeToken(expectedType);
    const text = normalizeText(raw);
    if (!text) return '';
    if (type === 'boolean') {
        const bool = parseBooleanAnswer(text);
        return bool === null ? text : bool;
    }
    if (type === 'number') {
        const num = Number(text);
        return Number.isFinite(num) ? num : text;
    }
    return text;
};

const resolvePendingActionsFromContext = ({ text, context }) => {
    const safeContext = context && typeof context === 'object' ? context : {};
    const pendingActions = Array.isArray(safeContext.pendingActionPlan) ? safeContext.pendingActionPlan : [];
    const pendingMissingInput = safeContext.pendingMissingInput && typeof safeContext.pendingMissingInput === 'object'
        ? safeContext.pendingMissingInput
        : null;

    if (!pendingMissingInput || pendingActions.length === 0) return null;

    const missingKey = normalizeText(pendingMissingInput.key);
    const expectedType = normalizeText(pendingMissingInput.expectedType || 'string') || 'string';
    const providedValue = castMissingInputValue(text, expectedType);
    if (!missingKey || providedValue === '') return null;

    if (missingKey === 'createDashboardForChart' || missingKey === 'createDashboardForCalculatedField') {
        const approved = providedValue === true;
        if (!approved) {
            const question = missingKey === 'createDashboardForChart'
                ? 'Bạn muốn tạo chart vào dashboard nào?'
                : 'Bạn muốn thêm phép tính vào dashboard nào?';
            return finalizePlan({
                assistantText: question,
                actions: pendingActions,
                missingInputs: [makeMissingInput('dashboardTarget', question, 'string')],
                modelProvider: null,
                modelId: null,
                activeTab: safeContext.activeTab,
            });
        }

        const patchedActions = pendingActions.map((action) => {
            if (action?.actionType !== 'bi.create_chart' && action?.actionType !== 'bi.create_calculated_field') return action;
            const args = action.args && typeof action.args === 'object' ? { ...action.args } : {};
            delete args.dashboardId;
            delete args.dashboardTitle;
            return { ...action, args };
        });

        const createTitle = missingKey === 'createDashboardForChart'
            ? 'New Dashboard'
            : 'New Dashboard';

        return finalizePlan({
            assistantText: missingKey === 'createDashboardForChart'
                ? 'Đã nhận. Tôi sẽ tạo dashboard mới rồi thêm chart.'
                : 'Đã nhận. Tôi sẽ tạo dashboard mới rồi thêm phép tính.',
            actions: [
                { actionType: 'bi.create_dashboard', args: { title: createTitle } },
                ...patchedActions,
            ],
            missingInputs: deriveFollowupMissingInputs([
                { actionType: 'bi.create_dashboard', args: { title: createTitle } },
                ...patchedActions,
            ]),
            modelProvider: null,
            modelId: null,
            activeTab: safeContext.activeTab,
        });
    }

    const patchedActions = pendingActions.map((action) => {
        const next = action && typeof action === 'object' ? { ...action } : {};
        const args = next.args && typeof next.args === 'object' ? { ...next.args } : {};

        if (missingKey === 'dashboardTarget' && next.actionType === 'bi.create_chart') {
            args.dashboardTitle = String(providedValue);
        } else if (missingKey === 'formulaSpec' && next.actionType === 'bi.create_calculated_field') {
            const spec = parseFormulaSpec(String(providedValue));
            if (spec) {
                args.name = spec.name;
                args.formula = spec.formula;
            }
        } else if (missingKey === 'relationshipSpec' && next.actionType === 'data_modeling.create_relationship') {
            const spec = parseRelationshipSpec(String(providedValue));
            if (spec) {
                args.fromTableName = spec.fromTableName;
                args.fromColumn = spec.fromColumn;
                args.toTableName = spec.toTableName;
                args.toColumn = spec.toColumn;
            }
        } else if (missingKey === 'userTarget' && String(next.actionType || '').startsWith('users.')) {
            const target = parseUserTarget(String(providedValue));
            if (target.userId) args.userId = target.userId;
            if (target.email) args.email = target.email;
            if (target.userName) args.userName = target.userName;
        } else if (missingKey === 'userTarget') {
            next.args = args;
            return next;
        } else if (missingKey === 'dataModelTarget' && String(next.actionType || '').startsWith('data_modeling.')) {
            args.dataModelId = String(providedValue);
        } else {
            args[missingKey] = providedValue;
        }

        next.args = args;
        return next;
    });

    const followupMissingInputs = deriveFollowupMissingInputs(patchedActions);
    return finalizePlan({
        assistantText: 'Đã nhận đủ thông tin. Tôi bắt đầu thực thi ngay.',
        actions: patchedActions,
        missingInputs: followupMissingInputs,
        modelProvider: null,
        modelId: null,
        activeTab: safeContext.activeTab,
    });
};

const normalizeMissingInputs = (inputs) => {
    if (!Array.isArray(inputs)) return [];
    const unique = new Map();
    inputs.forEach((input) => {
        if (!input || typeof input !== 'object') return;
        const key = normalizeText(input.key || `input_${unique.size + 1}`);
        if (!key || unique.has(key)) return;

        const expectedType = normalizeText(input.expectedType || 'string') || 'string';
        let question = normalizeText(input.question || 'Vui lòng cung cấp thêm thông tin.');
        if (!question) {
            question = 'Vui lòng cung cấp thêm thông tin.';
        }
        unique.set(key, {
            key,
            expectedType,
            question,
        });
    });
    return Array.from(unique.values());
};

const finalizePlan = ({
    assistantText,
    actions,
    missingInputs,
    modelProvider = null,
    modelId = null,
    activeTab = '',
}) => {
    const actionsWithNavigation = ensureNavigationForPlannedActions(actions, activeTab);
    const normalizedActions = normalizePlannedActions(Array.isArray(actionsWithNavigation) ? actionsWithNavigation : []);
    const normalizedMissing = normalizeMissingInputs(missingInputs).slice(0, 1);
    const pendingConfirmations = collectPendingConfirmations(normalizedActions);

    if (normalizedMissing.length > 0) {
        return {
            assistantText: normalizedMissing[0].question,
            actions: normalizedActions,
            missingInputs: normalizedMissing,
            pendingConfirmations,
            modelProvider,
            modelId,
        };
    }

    if (normalizedActions.length === 0) {
        return {
            assistantText: normalizeText(assistantText) || FALLBACK_ACTION_GUIDANCE,
            actions: [],
            missingInputs: [],
            pendingConfirmations: [],
            modelProvider,
            modelId,
        };
    }

    if (normalizeText(assistantText)) {
        return {
            assistantText: normalizeText(assistantText),
            actions: normalizedActions,
            missingInputs: [],
            pendingConfirmations,
            modelProvider,
            modelId,
        };
    }

    const actionNames = normalizedActions.map((item) => item.actionType).join(', ');
    const message = pendingConfirmations.length > 0
        ? `Tôi đã lập kế hoạch hành động: ${actionNames}. Có ${pendingConfirmations.length} bước cần xác nhận trước khi chạy.`
        : `Tôi đã lập kế hoạch hành động: ${actionNames}. Tôi sẽ chạy các bước an toàn ngay bây giờ.`;

    return {
        assistantText: message,
        actions: normalizedActions,
        missingInputs: [],
        pendingConfirmations,
        modelProvider,
        modelId,
    };
};

const buildRuleBasedPlan = ({ text, context }) => {
    const rawText = normalizeText(text);
    const lower = lowerText(text);
    const safeContext = context && typeof context === 'object' ? context : {};
    const activeTab = String(safeContext.activeTab || '').toLowerCase();
    const activeDataModelId = normalizeText(safeContext.activeDataModelId || safeContext.dataModelId);
    const reportsContext = safeContext.reportsContext && typeof safeContext.reportsContext === 'object'
        ? safeContext.reportsContext
        : {};

    const missingInputs = [];
    const plannedActions = [];
    let createdDashboardTitle = '';
    const activeTableOptions = getActiveTablesFromContext(safeContext);

    const pushAction = (actionType, args = {}) => {
        plannedActions.push({ actionType, args });
    };

    const hasAction = (actionType) => plannedActions.some((action) => action.actionType === actionType);

    if (!rawText) {
        return finalizePlan({
            assistantText: 'Vui lòng mô tả yêu cầu bạn muốn tôi thực hiện.',
            actions: [],
            missingInputs: [makeMissingInput('text', 'Bạn muốn tôi thực hiện việc gì?', 'string')],
            activeTab,
        });
    }

    const resumedPlan = resolvePendingActionsFromContext({ text: rawText, context: safeContext });
    if (resumedPlan) {
        return resumedPlan;
    }

    if (containsAny(lower, ['undo', 'hoàn tác', 'quay lại thao tác trước'])) {
        pushAction('bi.undo', {});
    }

    if (containsAny(lower, ['go to', 'open tab', 'mở tab', 'chuyển sang'])) {
        const tab = parseTabTarget(rawText);
        if (tab) pushAction('nav.go_to_tab', { tab });
    }

    if (containsAny(lower, ['import excel', 'upload excel', 'nhập excel', 'tải excel'])) {
        pushAction('nav.go_to_tab', { tab: 'connections', flow: 'excel_import' });
        missingInputs.push(makeMissingInput(
            'excelFile',
            'Tôi đã mở Connections. Bạn tải file Excel để tôi tiếp tục import.',
            'file'
        ));
    }

    if (containsAny(lower, ['google oauth', 'ủy quyền google', 'kết nối google sheets', 'import google sheet'])) {
        pushAction('nav.go_to_tab', { tab: 'connections', flow: 'google_sheets_oauth' });
        missingInputs.push(makeMissingInput(
            'oauth',
            'Tôi đã mở luồng kết nối. Bạn hoàn tất OAuth Google để tôi tiếp tục.',
            'oauth'
        ));
    }

    const dashboardReportIntent = shouldCreateDashboard(rawText) && isAnalysisIntent(rawText);
    if (dashboardReportIntent) {
        const title = inferDashboardTitle(rawText);
        createdDashboardTitle = title;
        const selectedTableIds = parseTableSelectionFromText(rawText, activeTableOptions);
        const requireSelection = !hasAllTablesToken(rawText) && selectedTableIds.length === 0;
        if (requireSelection) {
            missingInputs.push(makeMissingInput(
                'tableTarget',
                buildTableSelectionQuestion(activeTableOptions),
                'string'
            ));
        }
        pushAction('bi.create_dashboard_report', {
            title,
            prompt: inferReportsPromptFromBiRequest(rawText),
            tableIds: selectedTableIds,
            useAllTables: hasAllTablesToken(rawText),
            tableOptions: activeTableOptions.map((table) => ({
                id: table.id,
                label: table.label,
            })),
        });
    } else if (shouldCreateDashboard(rawText)) {
        const title = inferDashboardTitle(rawText);
        createdDashboardTitle = title;
        pushAction('bi.create_dashboard', { title });
    }

    if (containsAny(lower, ['create folder', 'tạo folder', 'tạo thư mục'])) {
        const name = extractFirstQuotedText(rawText) || 'New Folder';
        pushAction('bi.create_folder', { name });
    }

    if (!dashboardReportIntent && shouldCreateChart(rawText)) {
        const chartType = parseChartType(rawText);
        const activeDashboardId = String(safeContext.activeDashboardId || '').trim();
        const dashboardCount = Array.isArray(safeContext.dashboards) ? safeContext.dashboards.length : 0;
        let dashboardTitle = parseDashboardTarget(rawText) || String(safeContext.dashboardTarget || '').trim() || undefined;
        const chartTitle = inferChartTitle(rawText);

        if (!dashboardTitle && hasAction('bi.create_dashboard') && createdDashboardTitle) {
            dashboardTitle = createdDashboardTitle;
        }

        if (activeTab !== 'bi' || !activeDashboardId) {
            if (dashboardCount === 0 && !hasAction('bi.create_dashboard')) {
                missingInputs.push(makeMissingInput(
                    'createDashboardForChart',
                    'Hiện chưa có dashboard nào. Bạn muốn tôi tạo dashboard mới để thêm chart không?',
                    'boolean'
                ));
            } else if (!dashboardTitle && !hasAction('bi.create_dashboard')) {
                missingInputs.push(makeMissingInput(
                    'dashboardTarget',
                    'Bạn muốn tạo chart vào dashboard nào?',
                    'string'
                ));
            }
        }

        pushAction('bi.create_chart', {
            chartType,
            dashboardId: activeDashboardId || undefined,
            dashboardTitle,
            title: chartTitle,
        });
    }

    if (containsAny(lower, ['create widget', 'tạo widget'])) {
        const dashboardId = String(safeContext.activeDashboardId || '').trim();
        if (!dashboardId) {
            missingInputs.push(makeMissingInput(
                'dashboardTarget',
                'Bạn muốn tạo widget trên dashboard nào?',
                'string'
            ));
        }
        pushAction('bi.create_widget', {
            dashboardId: dashboardId || undefined,
            widgetType: containsAny(lower, ['table']) ? 'table'
                : containsAny(lower, ['card', 'kpi']) ? 'card'
                    : containsAny(lower, ['pivot']) ? 'pivot'
                        : containsAny(lower, ['slicer', 'filter']) ? 'slicer'
                            : 'chart',
            chartType: parseChartType(rawText),
            title: extractFirstQuotedText(rawText) || undefined,
        });
    }

    if (containsAny(lower, ['update widget', 'sửa widget', 'cập nhật widget'])) {
        const widgetId = extractUuid(rawText) || String(safeContext.editingWidgetId || '').trim();
        if (!widgetId) {
            missingInputs.push(makeMissingInput('widgetId', 'Bạn muốn cập nhật widget nào? (gửi widgetId)', 'string'));
        }
        pushAction('bi.update_widget', {
            widgetId: widgetId || undefined,
            dashboardId: String(safeContext.activeDashboardId || '').trim() || undefined,
            title: extractFirstQuotedText(rawText) || undefined,
            chartType: parseChartType(rawText),
        });
    }

    if (containsAny(lower, [
        'calculated field',
        'calculation field',
        'calculated',
        'field tính toán',
        'truong tinh toan',
        'phép tính',
        'phep tinh',
        'công thức',
        'cong thuc',
        'measure formula',
    ])) {
        const formulaSpec = parseFormulaSpec(rawText);
        const activeTab = String(safeContext.activeTab || '').toLowerCase();
        const activeDashboardId = String(safeContext.activeDashboardId || '').trim();
        const dashboardCount = Array.isArray(safeContext.dashboards) ? safeContext.dashboards.length : 0;
        const dashboardTitle = parseDashboardTarget(rawText) || String(safeContext.dashboardTarget || '').trim() || undefined;

        if (!activeDashboardId) {
            if (dashboardCount === 0) {
                missingInputs.push(makeMissingInput(
                    'createDashboardForCalculatedField',
                    'Hiện chưa có dashboard. Bạn muốn tôi tạo dashboard mới để thêm phép tính không?',
                    'boolean'
                ));
            } else if (activeTab !== 'bi' && !dashboardTitle) {
                missingInputs.push(makeMissingInput(
                    'dashboardTarget',
                    'Bạn muốn thêm phép tính vào dashboard nào?',
                    'string'
                ));
            }
        }

        if (!formulaSpec) {
            missingInputs.push(makeMissingInput(
                'formulaSpec',
                'Hãy cho công thức theo dạng: ten_truong = bieu_thuc',
                'string'
            ));
        }
        pushAction('bi.create_calculated_field', {
            dashboardId: activeDashboardId || undefined,
            dashboardTitle,
            name: formulaSpec?.name,
            formula: formulaSpec?.formula,
        });
    }

    if (containsAny(lower, ['delete widget', 'xóa widget'])) {
        const widgetId = extractUuid(rawText) || String(safeContext.editingWidgetId || '').trim();
        if (!widgetId) {
            missingInputs.push(makeMissingInput('widgetId', 'Bạn muốn xóa widget nào? (gửi widgetId)', 'string'));
        }
        pushAction('bi.delete_widget', { widgetId, dashboardId: safeContext.activeDashboardId });
    }

    if (containsAny(lower, ['delete dashboard', 'xóa dashboard'])) {
        const dashboardId = extractUuid(rawText) || String(safeContext.activeDashboardId || '').trim();
        const dashboardTitle = extractFirstQuotedText(rawText) || undefined;
        if (!dashboardId && !dashboardTitle) {
            missingInputs.push(makeMissingInput('dashboardTarget', 'Bạn muốn xóa dashboard nào?', 'string'));
        }
        pushAction('bi.delete_dashboard', { dashboardId, dashboardTitle });
    }

    if (containsAny(lower, ['create bigquery connection', 'tạo kết nối bigquery'])) {
        const projectId = parseProjectId(rawText);
        const name = extractFirstQuotedText(rawText) || 'BigQuery Connection';
        if (!projectId) {
            missingInputs.push(makeMissingInput('projectId', 'Vui lòng cung cấp projectId cho BigQuery.', 'string'));
        }
        pushAction('connections.create_bigquery', { name, projectId });
    }

    if (containsAny(lower, ['create postgres connection', 'tạo kết nối postgres', 'tạo kết nối postgresql'])) {
        const name = extractFirstQuotedText(rawText) || 'PostgreSQL Connection';
        const args = {
            name,
            host: safeContext.postgresHost,
            port: safeContext.postgresPort,
            databaseName: safeContext.postgresDatabaseName,
            username: safeContext.postgresUsername,
            password: safeContext.postgresPassword,
            ssl: safeContext.postgresSsl,
        };

        ['host', 'databaseName', 'username', 'password'].forEach((key) => {
            if (!args[key]) {
                missingInputs.push(makeMissingInput(key, `Vui lòng cung cấp ${key} cho kết nối PostgreSQL.`, key === 'password' ? 'password' : 'string'));
            }
        });

        pushAction('connections.create_postgres', args);
    }

    if (containsAny(lower, ['delete connection', 'xóa connection', 'xóa kết nối'])) {
        const connectionId = extractUuid(rawText);
        const connectionName = extractFirstQuotedText(rawText) || undefined;
        if (!connectionId && !connectionName) {
            missingInputs.push(makeMissingInput('connectionTarget', 'Bạn muốn xóa kết nối nào?', 'string'));
        }
        pushAction('connections.delete_connection', { connectionId, connectionName });
    }

    if (containsAny(lower, ['toggle table', 'bật tắt table', 'đổi trạng thái table', 'disable table', 'enable table'])) {
        const tableId = extractUuid(rawText);
        const tableName = extractFirstQuotedText(rawText) || undefined;
        if (!tableId && !tableName) {
            missingInputs.push(makeMissingInput('tableTarget', 'Bạn muốn đổi trạng thái table nào?', 'string'));
        }
        pushAction('tables.toggle_status', { tableId, tableName });
    }

    if (containsAny(lower, ['delete table', 'xóa table'])) {
        const tableId = extractUuid(rawText);
        const tableName = extractFirstQuotedText(rawText) || undefined;
        if (!tableId && !tableName) {
            missingInputs.push(makeMissingInput('tableTarget', 'Bạn muốn xóa table nào?', 'string'));
        }
        pushAction('tables.delete', { tableId, tableName });
    }

    if (isAutoDetectRelationshipIntent(rawText)) {
        if (!activeDataModelId) {
            missingInputs.push(makeMissingInput(
                'dataModelTarget',
                'Bạn muốn thao tác trên Data Model nào? (gửi dataModelId hoặc tên model)',
                'string'
            ));
        }
        pushAction('data_modeling.auto_detect_relationships', {
            dataModelId: activeDataModelId || undefined,
        });
    }

    if (isCreateRelationshipIntent(rawText)) {
        const spec = parseRelationshipSpec(rawText);
        if (!activeDataModelId) {
            missingInputs.push(makeMissingInput(
                'dataModelTarget',
                'Bạn muốn nối ở Data Model nào? (gửi dataModelId hoặc tên model)',
                'string'
            ));
        }
        if (!spec) {
            missingInputs.push(makeMissingInput(
                'relationshipSpec',
                'Hãy gửi theo dạng: tableA.columnA -> tableB.columnB',
                'string'
            ));
        }
        pushAction('data_modeling.create_relationship', {
            dataModelId: activeDataModelId || undefined,
            fromTableName: spec?.fromTableName,
            fromColumn: spec?.fromColumn,
            toTableName: spec?.toTableName,
            toColumn: spec?.toColumn,
        });
    }

    if (isDeleteRelationshipIntent(rawText)) {
        const relationshipId = extractUuid(rawText);
        if (!relationshipId) {
            missingInputs.push(makeMissingInput('relationshipId', 'Bạn muốn xóa relationship nào? (gửi relationshipId)', 'string'));
        }
        pushAction('data_modeling.delete_relationship', { relationshipId });
    }

    if (containsAny(lower, ['invite user', 'mời user', 'mời người dùng'])) {
        const email = parseEmail(rawText);
        const name = extractFirstQuotedText(rawText) || undefined;
        const role = containsAny(lower, [' admin ', ' role admin'])
            ? 'Admin'
            : containsAny(lower, [' editor ', ' role editor'])
                ? 'Editor'
                : 'Viewer';
        if (!email) {
            missingInputs.push(makeMissingInput('email', 'Vui lòng cung cấp email người dùng cần mời.', 'string'));
        }
        if (!name) {
            missingInputs.push(makeMissingInput('name', 'Vui lòng cung cấp tên người dùng cần mời.', 'string'));
        }
        pushAction('users.invite', { email, name, role });
    }

    if (containsAny(lower, [
        'update user',
        'cập nhật user',
        'cap nhat user',
        'sửa user',
        'sua user',
        'update account',
        'cập nhật tài khoản',
        'cap nhat tai khoan',
    ])) {
        const target = parseUserTarget(rawText);
        const email = target.email;
        const userId = target.userId;
        const userName = target.userName;
        const role = containsAny(lower, [' admin '])
            ? 'Admin'
            : containsAny(lower, [' editor '])
                ? 'Editor'
                : containsAny(lower, [' viewer '])
                    ? 'Viewer'
                    : undefined;

        if (!email && !userId && !userName) {
            missingInputs.push(makeMissingInput('userTarget', 'Bạn muốn cập nhật user nào? (email, userId, hoặc tên user)', 'string'));
        }

        pushAction('users.update', {
            email,
            userId,
            userName,
            role,
        });
    }

    if (isUserStatusToggleIntent(rawText)) {
        const target = parseUserTarget(rawText);
        const desiredStatus = inferDesiredUserStatus(rawText);
        if (!target.email && !target.userId && !target.userName) {
            missingInputs.push(makeMissingInput('userTarget', 'Bạn muốn active/inactive tài khoản nào? (email, userId, hoặc tên user)', 'string'));
        }
        pushAction('users.toggle_status', {
            email: target.email,
            userId: target.userId,
            userName: target.userName,
            desiredStatus,
        });
    }

    if (containsAny(lower, ['delete user', 'xóa user', 'xoá user', 'xoa user', 'delete account', 'xóa account', 'xoa account', 'xóa tài khoản', 'xoa tai khoan'])) {
        const target = parseUserTarget(rawText);
        if (!target.email && !target.userId && !target.userName) {
            missingInputs.push(makeMissingInput('userTarget', 'Bạn muốn xóa user nào? (email, userId, hoặc tên user)', 'string'));
        }
        pushAction('users.delete', {
            email: target.email,
            userId: target.userId,
            userName: target.userName,
        });
    }

    const wantsReportsScope = activeTab === 'reports' || containsAny(lower, ['reports', 'report', 'trong reports']);

    if (
        wantsReportsScope
        && containsAny(lower, ['new report session', 'new analysis session', 'tạo session report', 'tạo session mới', 'session mới', 'new session'])
    ) {
        const title = extractFirstQuotedText(rawText) || 'New Analysis';
        pushAction('reports.new_session', { title });
    }

    const hasBiBuildAction = plannedActions.some((action) => (
        action.actionType === 'bi.create_dashboard'
        || action.actionType === 'bi.create_chart'
        || action.actionType === 'bi.create_widget'
    ));

    if (
        hasBiBuildAction
        && isAnalysisIntent(rawText)
        && !hasAction('reports.ask')
        && !hasAction('bi.create_dashboard_report')
        && !shouldSkipReportsCompanion(rawText)
    ) {
        pushAction('reports.ask', {
            text: inferReportsPromptFromBiRequest(rawText),
        });
    }

    const hasReportsAskIntent = wantsReportsScope
        && (/(\bhỏi\b|\bask\b|reports\.ask)/i.test(rawText));

    if (hasReportsAskIntent && !hasAction('reports.ask')) {
        const quotedPrompt = extractFirstQuotedText(rawText);
        if (quotedPrompt) {
            pushAction('reports.ask', { text: quotedPrompt });
        } else {
            pushAction('reports.ask', { text: rawText });
        }
    }

    if (plannedActions.length === 0 && isAnalysisIntent(rawText)) {
        if (activeTab !== 'reports') {
            pushAction('nav.go_to_tab', { tab: 'reports', flow: 'reports_ask' });
        }
        pushAction('reports.ask', {
            text: rawText,
        });
    }

    if (containsAny(lower, ['rerun chart sql', 'rerun sql chart', 'rerun chart', 'chạy lại chart sql', 'chạy lại sql chart', 'run lại sql'])) {
        const messageId = extractUuid(rawText) || String(reportsContext.latestChartMessageId || '').trim();
        const chartIndex = parseChartIndex(rawText, safeContext.chartIndex || reportsContext.defaultChartIndex || 0);
        pushAction('reports.rerun_chart_sql', {
            messageId: messageId || 'latest',
            chartIndex,
            newSQL: String(safeContext.newSQL || '').trim() || undefined,
        });
        if (!messageId && !String(reportsContext.latestChartMessageId || '').trim()) {
            missingInputs.push(makeMissingInput('messageId', 'Bạn muốn chạy lại chart ở câu trả lời nào?', 'string'));
        }
    }

    if (
        activeTab === 'reports'
        && plannedActions.length === 0
        && !isSystemOperationIntent(rawText)
    ) {
        pushAction('reports.ask', { text: rawText });
    }

    return finalizePlan({
        assistantText: '',
        actions: plannedActions,
        missingInputs,
        modelProvider: null,
        modelId: null,
        activeTab,
    });
};

const cleanJson = (text) => {
    const value = String(text || '').trim();
    const blockMatch = value.match(/```json\s*([\s\S]*?)```/i);
    if (blockMatch) return blockMatch[1].trim();
    return value;
};

const getAiCredential = async ({ workspaceId, userId }) => {
    const rows = await query(
        `SELECT provider, api_key_encrypted, model_id
         FROM ai_settings
         WHERE workspace_id = $1
           AND user_id = $2
           AND COALESCE(api_key_encrypted, '') <> ''`,
        [workspaceId, userId]
    );

    const entries = rows.rows || [];
    const pick = (provider) => entries.find((item) => normalizeToken(item.provider) === provider);

    return pick('openai') || pick('anthropic') || pick('gemini') || null;
};

const callOpenAiPlanner = async ({ apiKey, modelId, prompt }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: modelId || 'gpt-5.1',
                temperature: 0.1,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content: 'You are an action planner. Return JSON only with: assistantText, missingInputs, actions. Actions must use known actionType only.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
            }),
            signal: controller.signal,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error?.message || `OpenAI error ${response.status}`);
        }

        const content = payload?.choices?.[0]?.message?.content || '{}';
        return JSON.parse(cleanJson(content));
    } finally {
        clearTimeout(timeout);
    }
};

const callAnthropicPlanner = async ({ apiKey, modelId, prompt }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: modelId || 'claude-sonnet-4-20250514',
                temperature: 0.1,
                max_tokens: 900,
                system: 'You are an action planner. Return JSON only with: assistantText, missingInputs, actions. Use known actionType only.',
                messages: [{ role: 'user', content: prompt }],
            }),
            signal: controller.signal,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error?.message || `Anthropic error ${response.status}`);
        }

        const content = payload?.content?.[0]?.text || '{}';
        return JSON.parse(cleanJson(content));
    } finally {
        clearTimeout(timeout);
    }
};

const callGeminiPlanner = async ({ apiKey, modelId, prompt }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const targetModel = modelId || 'gemini-2.5-flash';
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                },
            }),
            signal: controller.signal,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error?.message || `Gemini error ${response.status}`);
        }

        const content = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        return JSON.parse(cleanJson(content));
    } finally {
        clearTimeout(timeout);
    }
};

const tryAiPlanner = async ({ text, context, user }) => {
    const credential = await getAiCredential({
        workspaceId: user.workspace_id,
        userId: user.id,
    });

    if (!credential) return null;

    const prompt = JSON.stringify({
        instruction: 'Plan executable actions for this user request.',
        allowedActionTypes: ACTION_TYPES,
        requestText: text,
        context: context || {},
        outputShape: {
            assistantText: 'string',
            missingInputs: [{ key: 'string', question: 'string', expectedType: 'string' }],
            actions: [{ actionType: 'string', args: {} }],
        },
    });

    const provider = normalizeToken(credential.provider);
    const apiKey = String(credential.api_key_encrypted || '').trim();
    if (!apiKey) return null;

    let data = null;
    if (provider === 'openai') {
        data = await callOpenAiPlanner({ apiKey, modelId: credential.model_id, prompt });
    } else if (provider === 'anthropic') {
        data = await callAnthropicPlanner({ apiKey, modelId: credential.model_id, prompt });
    } else if (provider === 'gemini') {
        data = await callGeminiPlanner({ apiKey, modelId: credential.model_id, prompt });
    }

    if (!data || typeof data !== 'object') return null;

    return finalizePlan({
        assistantText: String(data.assistantText || '').trim() || 'Đã lên kế hoạch hành động theo yêu cầu.',
        actions: Array.isArray(data.actions) ? data.actions : [],
        missingInputs: Array.isArray(data.missingInputs) ? data.missingInputs : [],
        modelProvider: credential.provider,
        modelId: credential.model_id || null,
        activeTab: context?.activeTab,
    });
};

const planAssistantActions = async ({ text, context, user }) => {
    const ruleResult = buildRuleBasedPlan({ text, context });
    const hasRuleActions = Array.isArray(ruleResult.actions) && ruleResult.actions.length > 0;
    const hasRuleMissingInputs = Array.isArray(ruleResult.missingInputs) && ruleResult.missingInputs.length > 0;

    // Rule planner is deterministic for executable commands; use it first.
    if (hasRuleActions || hasRuleMissingInputs) {
        return ruleResult;
    }

    try {
        const aiResult = await tryAiPlanner({ text, context, user });
        const hasAiActions = aiResult && Array.isArray(aiResult.actions) && aiResult.actions.length > 0;
        const hasAiMissingInputs = aiResult && Array.isArray(aiResult.missingInputs) && aiResult.missingInputs.length > 0;
        if (hasAiActions || hasAiMissingInputs) return aiResult;
    } catch (err) {
        console.warn('[assistant-orchestrator] AI planner failed, fallback to rules:', err.message);
    }

    return ruleResult;
};

module.exports = {
    planAssistantActions,
};
