import type { BIWidget, ChartType, DataSource } from '../bi/types';
import { useDashboardStore } from '../bi/store/dashboardStore';
import { useDataStore } from '../bi/store/dataStore';
import {
  autoDetectRelationships,
  createRelationship,
  deleteRelationship,
  getDefaultDataModel,
  getModelTables,
} from '../../services/dataModeling';
import { detectSchema } from '../bi/engine/dataProcessing';
import { getReportsAssistantBridge } from '../reports/reportsAssistantBridge';
import type { AssistantAction, AssistantClientBindings, AssistantUndoEntry } from './types';

const asString = (value: any) => String(value || '').trim();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForReportsBridge = async (timeoutMs = 4000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const bridge = getReportsAssistantBridge();
    if (bridge) return bridge;
    await wait(120);
  }
  return null;
};

const slugToTitle = (token: string) => {
  const normalized = asString(token);
  if (!normalized) return '';
  return normalized
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const resolveTabPath = (tab: string) => {
  const normalized = asString(tab).toLowerCase();
  if (normalized === 'data-modeling' || normalized === 'data_modeling' || normalized === 'semantic') return 'data-modeling';
  if (normalized === 'ai-settings' || normalized === 'ai_setting') return 'ai-config';
  if (normalized === 'bi') return 'bi';
  if (normalized === 'reports') return 'reports';
  if (normalized === 'connections') return 'connections';
  if (normalized === 'tables') return 'tables';
  if (normalized === 'users') return 'users';
  if (normalized === 'logs') return 'logs';
  return normalized || 'connections';
};

const emitAssistantFlow = (
  bindings: AssistantClientBindings,
  tab: string,
  flow: string | null,
  args: Record<string, any> = {}
) => {
  const resolvedTab = resolveTabPath(tab);
  bindings.setActiveTab(resolvedTab);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('assistant:open-flow', {
      detail: { tab: resolvedTab, flow, args },
    }));
  }
};

const focusUserOnActionScreen = (action: AssistantAction, bindings: AssistantClientBindings) => {
  const args = action.args && typeof action.args === 'object' ? action.args : {};
  const type = asString(action.actionType).toLowerCase();

  if (type === 'nav.go_to_tab') {
    emitAssistantFlow(bindings, asString(args.tab || args.target || args.route), asString(args.flow) || null, args);
    return;
  }

  if (type.startsWith('bi.')) {
    const flow = type === 'bi.create_calculated_field'
      ? 'bi_calculated_field'
      : type === 'bi.create_chart'
        ? 'bi_create_chart'
        : type === 'bi.create_widget'
          ? 'bi_create_widget'
          : type === 'bi.update_widget'
            ? 'bi_update_widget'
      : type === 'bi.delete_widget'
              ? 'bi_delete_widget'
              : type === 'bi.create_dashboard'
                || type === 'bi.create_dashboard_report'
                ? 'bi_create_dashboard'
                : type === 'bi.delete_dashboard'
                  ? 'bi_delete_dashboard'
                  : type === 'bi.create_folder'
                    ? 'bi_create_folder'
                    : 'bi_action';
    emitAssistantFlow(bindings, 'bi', flow, args);
    return;
  }

  if (type.startsWith('reports.')) {
    const flow = type === 'reports.ask'
      ? 'reports_ask'
      : type === 'reports.new_session'
        ? 'reports_new_session'
        : type === 'reports.rerun_chart_sql'
          ? 'reports_rerun_chart_sql'
          : 'reports_action';
    emitAssistantFlow(bindings, 'reports', flow, args);
    return;
  }

  if (type.startsWith('connections.')) {
    emitAssistantFlow(bindings, 'connections', type.replace(/\./g, '_'), args);
    return;
  }

  if (type.startsWith('tables.')) {
    emitAssistantFlow(bindings, 'tables', type.replace(/\./g, '_'), args);
    return;
  }

  if (type.startsWith('users.')) {
    emitAssistantFlow(bindings, 'users', type.replace(/\./g, '_'), args);
    return;
  }

  if (type.startsWith('data_modeling.')) {
    emitAssistantFlow(bindings, 'data-modeling', type.replace(/\./g, '_'), args);
  }
};

const pickChartType = (value: string): ChartType => {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'line') return 'line';
  if (normalized === 'pie') return 'pie';
  if (normalized === 'donut' || normalized === 'doughnut') return 'donut';
  if (normalized === 'combo') return 'combo';
  if (normalized === 'area') return 'area';
  if (normalized === 'scatter') return 'scatter';
  if (normalized === 'horizontalbar' || normalized === 'horizontal_bar') return 'horizontalBar';
  if (normalized === 'stackedbar' || normalized === 'stacked_bar') return 'stackedBar';
  return 'bar';
};

type ReportTableOption = {
  id: string;
  label: string;
  tableName?: string;
  datasetName?: string;
};

const normalizeTableOption = (value: any): ReportTableOption | null => {
  const id = asString(value?.id);
  if (!id) return null;

  const datasetName = asString(value?.datasetName);
  const tableName = asString(value?.tableName);
  const label = asString(value?.label) || (datasetName ? `${datasetName}.${tableName}` : tableName);

  return {
    id,
    label: label || id,
    tableName,
    datasetName,
  };
};

const hasAllTablesToken = (raw: string) => {
  const text = asString(raw).toLowerCase();
  if (!text) return false;
  return [
    'all tables',
    'all data',
    'all datasets',
    'tất cả bảng',
    'tat ca bang',
    'tất cả dữ liệu',
    'tat ca du lieu',
    'mọi bảng',
    'moi bang',
  ].some((token) => text.includes(token));
};

const parseTableSelectionFromText = (raw: string, options: ReportTableOption[]) => {
  const text = asString(raw);
  const lower = text.toLowerCase();
  if (!text || options.length === 0) return [];

  if (hasAllTablesToken(text)) return options.map((option) => option.id);

  const selected = new Set<string>();
  options.forEach((option) => {
    const label = asString(option.label).toLowerCase();
    const tableName = asString(option.tableName).toLowerCase();
    const fullName = [asString(option.datasetName), asString(option.tableName)].filter(Boolean).join('.').toLowerCase();
    if ((label && lower.includes(label)) || (tableName && lower.includes(tableName)) || (fullName && lower.includes(fullName))) {
      selected.add(option.id);
    }
  });

  const numericOnly = /^[\d,\s]+$/.test(lower);
  const hasTableKeyword = ['bảng', 'bang', 'table'].some((token) => lower.includes(token));
  if (numericOnly || hasTableKeyword) {
    const indices = text.match(/\d{1,3}/g) || [];
    indices.forEach((value) => {
      const idx = Number(value);
      if (!Number.isFinite(idx) || idx <= 0) return;
      const option = options[idx - 1];
      if (option?.id) selected.add(option.id);
    });
  }

  return Array.from(selected);
};

const resolveReportTableSelection = (args: Record<string, any>, bindings: AssistantClientBindings) => {
  const optionsFromArgs = (Array.isArray(args.tableOptions) ? args.tableOptions : [])
    .map(normalizeTableOption)
    .filter(Boolean) as ReportTableOption[];

  const optionsFromBindings = (bindings.tables || [])
    .filter((table) => asString(table.status).toLowerCase() === 'active')
    .map((table) => normalizeTableOption({
      id: table.id,
      tableName: table.tableName,
      datasetName: table.datasetName,
      label: `${table.datasetName}.${table.tableName}`,
    }))
    .filter(Boolean) as ReportTableOption[];

  const tableOptions = optionsFromArgs.length > 0 ? optionsFromArgs : optionsFromBindings;
  const selected = new Set<string>();

  if (args.useAllTables === true) {
    tableOptions.forEach((option) => selected.add(option.id));
  }

  const explicitIds = Array.isArray(args.tableIds) ? args.tableIds : [];
  explicitIds.forEach((value) => {
    const raw = asString(value);
    if (!raw) return;
    const byId = tableOptions.find((option) => option.id === raw);
    if (byId) {
      selected.add(byId.id);
      return;
    }
    const byLabel = tableOptions.find((option) => asString(option.label).toLowerCase() === raw.toLowerCase());
    if (byLabel) selected.add(byLabel.id);
  });

  const selectedFromText = parseTableSelectionFromText(asString(args.tableTarget), tableOptions);
  selectedFromText.forEach((id) => selected.add(id));

  if (selected.size === 0 && tableOptions.length === 1) {
    selected.add(tableOptions[0].id);
  }

  return {
    selectedTableIds: Array.from(selected),
    tableOptions,
  };
};

const sanitizeRowValue = (value: any): any => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
};

const normalizeRows = (rows: any[]) => {
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { value: sanitizeRowValue(item) };
    }

    const next: Record<string, any> = {};
    Object.keys(item).forEach((key) => {
      next[key] = sanitizeRowValue(item[key]);
    });
    return next;
  });
};

const createManualDataSource = (name: string, rows: any[]) => {
  const dataStore = useDataStore.getState();
  const beforeIds = new Set((dataStore.dataSources || []).map((source) => source.id));

  const normalizedRows = normalizeRows(rows);
  const headers = normalizedRows.reduce<string[]>((acc, row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!acc.includes(key)) acc.push(key);
    });
    return acc;
  }, []);

  const schema = headers.length > 0
    ? detectSchema(normalizedRows, headers)
    : [];

  useDataStore.getState().addDataSource({
    name: asString(name) || 'AI Report Data',
    type: 'ai_generated',
    data: normalizedRows,
    schema,
    isLoaded: true,
    totalRows: normalizedRows.length,
    syncStatus: 'ready',
    lastRefresh: new Date().toISOString(),
    assistantGenerated: true,
    hiddenFromDataTables: true,
  } as any);

  const latestState = useDataStore.getState();
  const created = latestState.dataSources.find((source) => !beforeIds.has(source.id));
  if (created) return created;
  if (latestState.selectedDataSourceId) {
    return latestState.dataSources.find((source) => source.id === latestState.selectedDataSourceId) || null;
  }
  return null;
};

const extractNumericValue = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = asString(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;

  let normalized = cleaned;
  if (normalized.includes(',') && !normalized.includes('.')) {
    normalized = normalized.replace(/,/g, '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const addWidgetAndCapture = (dashboardId: string, widget: Omit<BIWidget, 'id'>) => {
  const beforeDashboard = useDashboardStore.getState().dashboards.find((item) => item.id === dashboardId);
  const beforePage = (beforeDashboard?.pages || []).find((page: any) => page.id === beforeDashboard?.activePageId);
  const beforeIds = new Set((beforePage?.widgets || beforeDashboard?.widgets || []).map((item: BIWidget) => item.id));

  useDashboardStore.getState().addWidget(dashboardId, widget);

  const latestDashboard = useDashboardStore.getState().dashboards.find((item) => item.id === dashboardId);
  const latestPage = (latestDashboard?.pages || []).find((page: any) => page.id === latestDashboard?.activePageId);
  const created = (latestPage?.widgets || latestDashboard?.widgets || []).find((item: BIWidget) => !beforeIds.has(item.id));
  return created?.id || null;
};

const materializeReportToDashboard = (dashboardId: string, visualData: any) => {
  const createdDataSourceIds: string[] = [];
  const createdWidgetIds: string[] = [];

  const kpis = Array.isArray(visualData?.kpis) ? visualData.kpis : [];
  kpis.slice(0, 6).forEach((kpi: any, idx: number) => {
    const label = asString(kpi?.label) || `KPI ${idx + 1}`;
    const numericValue = extractNumericValue(kpi?.value);
    if (numericValue === null) return;

    const dataSource = createManualDataSource(`AI Report KPI - ${label}`, [{ label, value: numericValue }]);
    if (!dataSource?.id) return;
    createdDataSourceIds.push(dataSource.id);

    const trendToken = asString(kpi?.trend).toLowerCase();
    const trend = trendToken.includes('up') || trendToken.includes('tăng')
      ? 'up'
      : (trendToken.includes('down') || trendToken.includes('giảm') ? 'down' : 'neutral');

    const widgetId = addWidgetAndCapture(dashboardId, {
      type: 'card',
      title: label,
      x: 0,
      y: Number.POSITIVE_INFINITY,
      w: 3,
      h: 3,
      enableCrossFilter: true,
      dataSourceId: dataSource.id,
      metric: 'value',
      yAxis: ['value'],
      trend,
    });
    if (widgetId) createdWidgetIds.push(widgetId);
  });

  const charts = Array.isArray(visualData?.charts) ? visualData.charts : [];
  charts.slice(0, 12).forEach((chart: any, idx: number) => {
    const title = asString(chart?.title) || `Chart ${idx + 1}`;
    const chartRows = normalizeRows(Array.isArray(chart?.data) ? chart.data : []);
    if (chartRows.length === 0) return;

    const dataSource = createManualDataSource(`AI Report Chart - ${title}`, chartRows);
    if (!dataSource?.id) return;
    createdDataSourceIds.push(dataSource.id);

    const schemaFields = (dataSource.schema || []).map((field) => asString(field?.name)).filter(Boolean);
    const numericFields = (dataSource.schema || [])
      .filter((field) => field.type === 'number')
      .map((field) => asString(field.name))
      .filter(Boolean);

    const xAxis = asString(chart?.xAxisKey) || schemaFields[0] || '';
    let yAxis = Array.isArray(chart?.dataKeys)
      ? chart.dataKeys.map((key: any) => asString(key)).filter((key: string) => key && key !== xAxis)
      : [];

    if (yAxis.length === 0) {
      yAxis = numericFields.filter((field) => field !== xAxis);
    }
    if (yAxis.length === 0 && schemaFields.length > 1) {
      yAxis = schemaFields.filter((field) => field !== xAxis).slice(0, 2);
    }

    const chartType = pickChartType(asString(chart?.type));
    const widget: Omit<BIWidget, 'id'> = {
      type: 'chart',
      title,
      x: 0,
      y: Number.POSITIVE_INFINITY,
      w: 6,
      h: 4,
      chartType,
      stacked: chartType === 'stackedBar',
      enableCrossFilter: true,
      showLegend: true,
      showGrid: true,
      showLabels: false,
      legendPosition: 'bottom',
      dataSourceId: dataSource.id,
      xAxis: xAxis || undefined,
      yAxis: yAxis.length > 0 ? yAxis : undefined,
    };

    if (chartType === 'pie' || chartType === 'donut') {
      const valueField = yAxis[0] || numericFields[0] || schemaFields.find((field) => field !== xAxis) || '';
      if (valueField) {
        widget.values = [valueField];
        widget.yAxis = [valueField];
      }
    }

    if (chartType === 'scatter' && yAxis.length > 0) {
      widget.yAxis = yAxis.slice(0, Math.min(2, yAxis.length));
    }

    if (chartType === 'combo' && yAxis.length > 0) {
      const barField = yAxis[0];
      const lineField = yAxis[1];
      widget.yAxis = barField ? [barField] : yAxis.slice(0, 1);
      if (barField) {
        widget.yAxisConfigs = [{ field: barField, aggregation: 'sum', yAxisId: 'left' }];
      }
      if (lineField) {
        widget.lineAxisConfigs = [{ field: lineField, aggregation: 'sum', yAxisId: 'right' }];
      }
    }

    const widgetId = addWidgetAndCapture(dashboardId, widget);
    if (widgetId) createdWidgetIds.push(widgetId);
  });

  return {
    createdDataSourceIds,
    createdWidgetIds,
    kpiWidgets: createdWidgetIds.length,
    chartWidgets: charts.length,
  };
};

const executeBiCreateDashboardReport = async (action: AssistantAction, bindings: AssistantClientBindings) => {
  const args = action.args && typeof action.args === 'object' ? action.args : {};
  const { selectedTableIds, tableOptions } = resolveReportTableSelection(args, bindings);
  if (selectedTableIds.length === 0) {
    const available = tableOptions.slice(0, 8).map((option) => option.label).join(', ');
    throw new Error(
      tableOptions.length > 0
        ? `Bạn chưa chọn bảng để phân tích. Chọn một trong các bảng: ${available}`
        : 'Không có bảng Active để tạo report. Bạn hãy bật ít nhất 1 bảng trong Data Assets.'
    );
  }

  const previousTab = bindings.activeTab;
  let bridge = getReportsAssistantBridge();
  if (!bridge && previousTab !== 'reports') {
    bindings.setActiveTab('reports');
  }
  if (!bridge) {
    bridge = await waitForReportsBridge(7000);
  }
  if (!bridge) {
    if (previousTab !== 'reports') {
      bindings.setActiveTab(previousTab || 'bi');
    }
    throw new Error('Reports engine chưa sẵn sàng. Hãy mở tab Reports một lần rồi thử lại.');
  }

  const prompt = asString(args.prompt || args.text) || 'Phân tích dữ liệu 30 ngày gần nhất';
  let asked: any = null;
  try {
    asked = await Promise.resolve(bridge.ask(prompt, {
      sessionId: asString(args.sessionId) || undefined,
      useAllTables: args.useAllTables === true,
      tableIds: selectedTableIds,
    }));
  } finally {
    if (previousTab !== 'reports') {
      bindings.setActiveTab(previousTab || 'bi');
    }
  }

  const visualData = asked?.visualData
    || asked?.result?.visualData
    || asked?.result?.dashboard
    || asked?.dashboard
    || null;

  if (!visualData) {
    throw new Error('Chưa nhận được dữ liệu report để dựng dashboard.');
  }

  const dashboardStore = useDashboardStore.getState();
  const beforeDashboardIds = new Set((dashboardStore.dashboards || []).map((item) => item.id));
  dashboardStore.createDashboard({
    title: asString(args.title) || 'AI Analysis Dashboard',
    description: asString(args.description) || undefined,
    folderId: asString(args.folderId) || undefined,
    dataSourceId: asString(args.dataSourceId) || undefined,
    dataSourceName: asString(args.dataSourceName) || undefined,
    widgets: [],
    createdBy: bindings.currentUser?.id || 'assistant',
  } as any);

  const createdDashboard = useDashboardStore.getState().dashboards.find((item) => !beforeDashboardIds.has(item.id));
  if (!createdDashboard?.id) {
    throw new Error('Không thể tạo dashboard để nhận report.');
  }

  const { createdDataSourceIds, createdWidgetIds } = materializeReportToDashboard(createdDashboard.id, visualData);
  bindings.setActiveTab('bi');
  useDashboardStore.getState().setActiveDashboard(createdDashboard.id);

  pushUndo(bindings, {
    actionType: action.actionType,
    undo: () => {
      const store = useDashboardStore.getState();
      const dashboardExists = store.dashboards.some((item) => item.id === createdDashboard.id);
      if (dashboardExists) {
        store.deleteDashboard(createdDashboard.id);
      }
      const dataStore = useDataStore.getState();
      createdDataSourceIds.forEach((id) => {
        if (dataStore.dataSources.some((source) => source.id === id)) {
          dataStore.deleteDataSource(id);
        }
      });
    },
  });

  return {
    dashboardId: createdDashboard.id,
    title: createdDashboard.title,
    tableIds: selectedTableIds,
    widgetCount: createdWidgetIds.length,
    dataSourceCount: createdDataSourceIds.length,
    sessionId: asked?.sessionId || null,
    messageId: asked?.messageId || asked?.result?.messageId || null,
  };
};

const ensureDashboard = (args: Record<string, any>, currentUserId?: string | null) => {
  const dashboardStore = useDashboardStore.getState();
  const dashboards = dashboardStore.dashboards || [];
  const requestedId = asString(args.dashboardId);
  const requestedTitle = asString(args.dashboardTitle || args.dashboardName || args.title);

  let dashboard = dashboards.find((item) => item.id === requestedId);
  if (!dashboard && requestedTitle) {
    dashboard = dashboards.find((item) => asString(item.title).toLowerCase() === requestedTitle.toLowerCase());
  }
  if (!dashboard && dashboardStore.activeDashboardId) {
    dashboard = dashboards.find((item) => item.id === dashboardStore.activeDashboardId);
  }
  if (!dashboard) {
    throw new Error('Không tìm thấy dashboard để thực thi action.');
  }

  dashboardStore.setActiveDashboard(dashboard.id);
  return dashboard;
};

const findWidgetInDashboard = (dashboard: any, widgetId: string) => {
  const pages = Array.isArray(dashboard?.pages) ? dashboard.pages : [];
  for (const page of pages) {
    const index = (page.widgets || []).findIndex((widget: BIWidget) => widget.id === widgetId);
    if (index >= 0) {
      return {
        widget: page.widgets[index],
        pageId: page.id,
        index,
      };
    }
  }
  const fallbackWidgets = Array.isArray(dashboard?.widgets) ? dashboard.widgets : [];
  const idx = fallbackWidgets.findIndex((widget: BIWidget) => widget.id === widgetId);
  if (idx >= 0) {
    return { widget: fallbackWidgets[idx], pageId: dashboard.activePageId, index: idx };
  }
  return null;
};

const resolveDataSource = (dashboard: any, args: Record<string, any>): DataSource | null => {
  const dataStore = useDataStore.getState();
  const dsId = asString(
    args.dataSourceId
    || dashboard?.dataSourceId
    || dashboard?.pages?.find((page: any) => page.id === dashboard?.activePageId)?.dataSourceId
    || dataStore.selectedDataSourceId
  );

  if (dsId) {
    return dataStore.dataSources.find((source) => source.id === dsId) || null;
  }
  return dataStore.dataSources[0] || null;
};

const suggestChartBinding = (source: DataSource | null) => {
  if (!source || !Array.isArray(source.schema) || source.schema.length === 0) {
    return { xAxis: undefined, yAxis: undefined };
  }

  const numeric = source.schema.filter((field) => field.type === 'number');
  const dimensions = source.schema.filter((field) => field.type !== 'number');
  const xAxis = asString(dimensions[0]?.name || source.schema[0]?.name);
  const yAxis = asString(numeric[0]?.name || source.schema[1]?.name || source.schema[0]?.name);

  return {
    xAxis: xAxis || undefined,
    yAxis: yAxis ? [yAxis] : undefined,
  };
};

const pushUndo = (bindings: AssistantClientBindings, entry: Omit<AssistantUndoEntry, 'id'>) => {
  bindings.pushUndo({
    id: `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...entry,
  });
};

const executeBiCreateWidget = async (action: AssistantAction, bindings: AssistantClientBindings) => {
  const dashboardStore = useDashboardStore.getState();
  const dashboard = ensureDashboard(action.args || {}, bindings.currentUser?.id);
  const chartType = pickChartType(asString(action.args?.chartType));
  const widgetType = asString(action.args?.widgetType || '').toLowerCase();
  const source = resolveDataSource(dashboard, action.args || {});
  const binding = suggestChartBinding(source);

  const activePage = (dashboard.pages || []).find((page: any) => page.id === dashboard.activePageId);
  const beforeIds = new Set((activePage?.widgets || dashboard.widgets || []).map((widget: BIWidget) => widget.id));

  let widget: Omit<BIWidget, 'id'>;
  if (widgetType === 'table') {
    widget = {
      type: 'table',
      title: asString(action.args?.title) || 'New Table',
      x: 0,
      y: Number.POSITIVE_INFINITY,
      w: 6,
      h: 4,
      enableCrossFilter: true,
      dataSourceId: source?.id,
    };
  } else if (widgetType === 'card') {
    widget = {
      type: 'card',
      title: asString(action.args?.title) || 'New KPI Card',
      x: 0,
      y: Number.POSITIVE_INFINITY,
      w: 3,
      h: 3,
      enableCrossFilter: true,
      dataSourceId: source?.id,
      metric: binding.yAxis?.[0],
    };
  } else {
    widget = {
      type: 'chart',
      title: asString(action.args?.title) || 'New Chart',
      x: 0,
      y: Number.POSITIVE_INFINITY,
      w: 6,
      h: 4,
      chartType,
      stacked: chartType === 'stackedBar',
      enableCrossFilter: true,
      showLegend: true,
      showGrid: true,
      showLabels: false,
      legendPosition: 'bottom',
      dataSourceId: source?.id,
      xAxis: binding.xAxis,
      yAxis: binding.yAxis,
    };
  }

  dashboardStore.addWidget(dashboard.id, widget);

  const latestDashboard = useDashboardStore.getState().dashboards.find((item) => item.id === dashboard.id);
  const latestPage = (latestDashboard?.pages || []).find((page: any) => page.id === latestDashboard?.activePageId);
  const created = (latestPage?.widgets || latestDashboard?.widgets || []).find((item: BIWidget) => !beforeIds.has(item.id));

  if (created?.id) {
    pushUndo(bindings, {
      actionType: action.actionType,
      undo: () => {
        useDashboardStore.getState().deleteWidget(dashboard.id, created.id);
      },
    });
  }

  return {
    dashboardId: dashboard.id,
    widgetId: created?.id || null,
    widgetType: created?.type || widget.type,
    chartType: created?.chartType || widget.chartType || null,
  };
};

const executeBiCreateCalculatedField = async (action: AssistantAction, bindings: AssistantClientBindings) => {
  const dashboardStore = useDashboardStore.getState();
  const dashboard = ensureDashboard(action.args || {}, bindings.currentUser?.id);
  const calcName = asString(action.args?.name);
  const calcFormula = asString(action.args?.formula);

  if (!calcName || !calcFormula) {
    throw new Error('Thiếu tên hoặc công thức cho calculated field.');
  }

  const currentFields = Array.isArray(dashboard.calculatedFields) ? dashboard.calculatedFields : [];
  const existing = currentFields.find((field) => asString(field.name).toLowerCase() === calcName.toLowerCase());
  const nextFields = existing
    ? currentFields.map((field) => (
      field.id === existing.id ? { ...field, formula: calcFormula, type: 'number' } : field
    ))
    : [
      ...currentFields,
      {
        id: asString(action.args?.fieldId) || `calc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: calcName,
        formula: calcFormula,
        type: 'number' as const,
      },
    ];

  dashboardStore.updateDashboard(dashboard.id, { calculatedFields: nextFields });

  pushUndo(bindings, {
    actionType: action.actionType,
    undo: () => {
      useDashboardStore.getState().updateDashboard(dashboard.id, { calculatedFields: currentFields });
    },
  });

  return {
    dashboardId: dashboard.id,
    fieldName: calcName,
    updated: !!existing,
  };
};

const executeBiUpdateWidget = async (action: AssistantAction, bindings: AssistantClientBindings) => {
  const dashboardStore = useDashboardStore.getState();
  const dashboard = ensureDashboard(action.args || {}, bindings.currentUser?.id);
  const widgetId = asString(action.args?.widgetId || dashboardStore.editingWidgetId);
  if (!widgetId) {
    throw new Error('Thiếu widgetId để cập nhật.');
  }

  const target = findWidgetInDashboard(dashboard, widgetId);
  if (!target) throw new Error('Không tìm thấy widget để cập nhật.');

  const updates = {
    ...(action.args?.updates && typeof action.args.updates === 'object' ? action.args.updates : {}),
    ...(asString(action.args?.title) ? { title: asString(action.args?.title) } : {}),
    ...(asString(action.args?.chartType) ? { chartType: pickChartType(action.args.chartType) } : {}),
  };

  const previousWidget = { ...target.widget };
  dashboardStore.updateWidget(dashboard.id, widgetId, updates);

  pushUndo(bindings, {
    actionType: action.actionType,
    undo: () => {
      useDashboardStore.getState().updateWidget(dashboard.id, widgetId, previousWidget);
    },
  });

  return {
    dashboardId: dashboard.id,
    widgetId,
    updates,
  };
};

const executeBiDeleteWidget = async (action: AssistantAction, bindings: AssistantClientBindings) => {
  const dashboardStore = useDashboardStore.getState();
  const dashboard = ensureDashboard(action.args || {}, bindings.currentUser?.id);
  const widgetId = asString(action.args?.widgetId || dashboardStore.editingWidgetId);
  if (!widgetId) throw new Error('Thiếu widgetId để xóa.');

  const target = findWidgetInDashboard(dashboard, widgetId);
  if (!target) throw new Error('Không tìm thấy widget để xóa.');

  const snapshot = { ...target.widget };
  const snapshotPageId = target.pageId;
  const snapshotIndex = target.index;

  dashboardStore.deleteWidget(dashboard.id, widgetId);

  pushUndo(bindings, {
    actionType: action.actionType,
    undo: () => {
      const currentStore = useDashboardStore.getState();
      const currentDashboard = currentStore.dashboards.find((item) => item.id === dashboard.id);
      if (!currentDashboard) return;

      const pages = Array.isArray(currentDashboard.pages) ? currentDashboard.pages : [];
      const page = pages.find((item) => item.id === snapshotPageId) || pages.find((item) => item.id === currentDashboard.activePageId);
      if (!page) return;

      if ((page.widgets || []).some((widget: BIWidget) => widget.id === snapshot.id)) return;
      const nextWidgets = [...(page.widgets || [])];
      const insertAt = Math.max(0, Math.min(snapshotIndex, nextWidgets.length));
      nextWidgets.splice(insertAt, 0, snapshot);
      const nextPages = pages.map((item) => (
        item.id === page.id ? { ...item, widgets: nextWidgets } : item
      ));

      currentStore.updateDashboard(currentDashboard.id, {
        pages: nextPages,
        widgets: page.id === currentDashboard.activePageId ? nextWidgets : currentDashboard.widgets,
      });
    },
  });

  return {
    dashboardId: dashboard.id,
    widgetId,
  };
};

const executeDataModelingCreateRelationship = async (args: Record<string, any>) => {
  const defaultModel = await getDefaultDataModel();
  const tables = await getModelTables(defaultModel.id);

  const resolveTableId = (value: string) => {
    const normalized = asString(value).toLowerCase();
    const byId = tables.find((table) => table.id === value);
    if (byId) return byId.id;
    const byTable = tables.find((table) => asString(table.tableName).toLowerCase() === normalized);
    if (byTable) return byTable.id;
    const byDatasetAndTable = tables.find((table) => (
      `${asString(table.datasetName)}.${asString(table.tableName)}`.toLowerCase() === normalized
    ));
    return byDatasetAndTable?.id || '';
  };

  const fromTableId = asString(args.fromTableId) || resolveTableId(args.fromTableName);
  const toTableId = asString(args.toTableId) || resolveTableId(args.toTableName);

  if (!fromTableId || !toTableId) {
    throw new Error('Không tìm thấy table cho relationship.');
  }

  return createRelationship({
    dataModelId: asString(args.dataModelId) || defaultModel.id,
    fromTableId,
    fromColumn: asString(args.fromColumn),
    toTableId,
    toColumn: asString(args.toColumn),
    relationshipType: (asString(args.relationshipType) as any) || 'n-1',
    crossFilterDirection: (asString(args.crossFilterDirection) as any) || 'single',
  });
};

const executeUserClientFallback = (action: AssistantAction, bindings: AssistantClientBindings) => {
  const users = bindings.users || [];
  const email = asString(action.args?.email).toLowerCase();
  const userId = asString(action.args?.userId);
  const index = users.findIndex((item) => (
    (userId && item.id === userId)
    || (email && asString(item.email).toLowerCase() === email)
  ));
  if (index < 0) throw new Error('Không tìm thấy user để thao tác.');

  if (action.actionType === 'users.toggle_status') {
    bindings.setUsers((prev) => prev.map((item, idx) => {
      if (idx !== index) return item;
      const nextStatus = item.status === 'Active' ? 'Disabled' : 'Active';
      return { ...item, status: nextStatus };
    }));
    return { userId: users[index].id, statusToggled: true };
  }

  if (action.actionType === 'users.update') {
    const updates: any = {};
    if (asString(action.args?.name)) updates.name = asString(action.args?.name);
    if (asString(action.args?.role)) updates.role = asString(action.args?.role);
    bindings.setUsers((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...updates } : item)));
    return { userId: users[index].id, updated: true };
  }

  if (action.actionType === 'users.delete') {
    const removed = users[index];
    bindings.setUsers((prev) => prev.filter((item) => item.id !== removed.id));
    return { userId: removed.id, deleted: true };
  }

  return null;
};

export const createClientActionRegistry = (bindings: AssistantClientBindings) => {
  const execute = async (action: AssistantAction): Promise<Record<string, any>> => {
    const args = action.args && typeof action.args === 'object' ? action.args : {};
    const dashboardStore = useDashboardStore.getState();
    focusUserOnActionScreen(action, bindings);

    if (action.actionType === 'bi.undo') {
      const entry = bindings.popUndo();
      if (!entry) throw new Error('Không có thao tác undo khả dụng.');
      await Promise.resolve(entry.undo());
      return { undone: true, undoneActionType: entry.actionType };
    }

    switch (action.actionType) {
      case 'nav.go_to_tab': {
        const tab = resolveTabPath(args.tab || args.target || args.route);
        return { tab };
      }

      case 'bi.create_dashboard': {
        const beforeIds = new Set((dashboardStore.dashboards || []).map((item) => item.id));
        dashboardStore.createDashboard({
          title: asString(args.title) || 'New Dashboard',
          description: asString(args.description) || undefined,
          folderId: asString(args.folderId) || undefined,
          dataSourceId: asString(args.dataSourceId) || undefined,
          dataSourceName: asString(args.dataSourceName) || undefined,
          widgets: [],
          createdBy: bindings.currentUser?.id || 'assistant',
        } as any);

        const created = useDashboardStore.getState().dashboards.find((item) => !beforeIds.has(item.id));
        if (created?.id) {
          pushUndo(bindings, {
            actionType: action.actionType,
            undo: () => useDashboardStore.getState().deleteDashboard(created.id),
          });
        }
        return { dashboardId: created?.id || null, title: created?.title || args.title || 'New Dashboard' };
      }

      case 'bi.create_dashboard_report': {
        return executeBiCreateDashboardReport(action, bindings);
      }

      case 'bi.create_folder': {
        const beforeIds = new Set((dashboardStore.folders || []).map((item) => item.id));
        dashboardStore.createFolder(
          asString(args.name) || 'New Folder',
          asString(args.parentId) || undefined,
          bindings.currentUser?.id || 'assistant'
        );
        const created = useDashboardStore.getState().folders.find((item) => !beforeIds.has(item.id));
        return { folderId: created?.id || null, name: created?.name || args.name || 'New Folder' };
      }

      case 'bi.create_chart':
      case 'bi.create_widget': {
        return executeBiCreateWidget(action, bindings);
      }

      case 'bi.create_calculated_field': {
        return executeBiCreateCalculatedField(action, bindings);
      }

      case 'bi.update_widget': {
        return executeBiUpdateWidget(action, bindings);
      }

      case 'bi.delete_widget': {
        return executeBiDeleteWidget(action, bindings);
      }

      case 'bi.delete_dashboard': {
        const dashboard = ensureDashboard(args, bindings.currentUser?.id);
        dashboardStore.deleteDashboard(dashboard.id);
        return { dashboardId: dashboard.id };
      }

      case 'connections.delete_connection': {
        const connectionId = asString(args.connectionId);
        if (!connectionId) throw new Error('Thiếu connectionId.');
        bindings.deleteConnection(connectionId);
        return { connectionId };
      }

      case 'tables.toggle_status': {
        const tableId = asString(args.tableId);
        if (!tableId) throw new Error('Thiếu tableId.');
        await Promise.resolve(bindings.toggleTableStatus(tableId));
        pushUndo(bindings, {
          actionType: action.actionType,
          undo: () => bindings.toggleTableStatus(tableId),
        });
        return { tableId, toggled: true };
      }

      case 'tables.delete': {
        const tableId = asString(args.tableId);
        if (!tableId) throw new Error('Thiếu tableId.');
        await Promise.resolve(bindings.deleteTable(tableId));
        return { tableId };
      }

      case 'data_modeling.auto_detect_relationships': {
        return {
          suggestions: await autoDetectRelationships({
            dataModelId: asString(args.dataModelId) || undefined,
            tableIds: Array.isArray(args.tableIds) ? args.tableIds : undefined,
          }),
        };
      }

      case 'data_modeling.create_relationship': {
        return {
          relationship: await executeDataModelingCreateRelationship(args),
        };
      }

      case 'data_modeling.delete_relationship': {
        const relationshipId = asString(args.relationshipId || args.id);
        if (!relationshipId) throw new Error('Thiếu relationshipId.');
        await deleteRelationship(relationshipId);
        return { relationshipId };
      }

      case 'users.update':
      case 'users.toggle_status':
      case 'users.delete': {
        return executeUserClientFallback(action, bindings) || {};
      }

      case 'reports.new_session': {
        const bridge = await waitForReportsBridge();
        if (!bridge) throw new Error('Reports assistant bridge chưa sẵn sàng.');
        const output = await Promise.resolve(bridge.newSession(asString(args.title) || 'New Analysis'));
        return { ...(output || {}), opened: true };
      }

      case 'reports.ask': {
        const bridge = await waitForReportsBridge();
        if (!bridge) throw new Error('Reports assistant bridge chưa sẵn sàng.');
        const text = asString(args.text || args.prompt);
        if (!text) throw new Error('Thiếu nội dung cho reports.ask');
        const result = await Promise.resolve(bridge.ask(text, {
          sessionId: asString(args.sessionId) || undefined,
          useAllTables: args.useAllTables === true,
          tableIds: Array.isArray(args.tableIds) ? args.tableIds : undefined,
        }));
        return { asked: true, result: result || null };
      }

      case 'reports.rerun_chart_sql': {
        const bridge = await waitForReportsBridge();
        if (!bridge) throw new Error('Reports assistant bridge chưa sẵn sàng.');
        const messageId = asString(args.messageId);
        const chartIndex = Number(args.chartIndex || 0);
        const newSQL = asString(args.newSQL || args.sql) || undefined;
        if (!messageId) {
          throw new Error('Thiếu messageId để chạy lại chart.');
        }
        const result = await Promise.resolve(bridge.rerunChartSql(messageId, chartIndex, newSQL));
        return { rerun: true, result: result || null };
      }

      default:
        throw new Error(`Client action chưa được hỗ trợ: ${action.actionType}`);
    }
  };

  return { execute };
};
