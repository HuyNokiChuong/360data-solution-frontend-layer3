// ============================================
// BI Dashboard Studio - Type Definitions
// ============================================

// --------------------------------------------
// Data Source Types
// --------------------------------------------

export type DataSourceType = 'csv' | 'json' | 'api' | 'bigquery' | 'excel' | 'manual' | 'semantic_model';

export interface DataSource {
    id: string;
    name: string;
    type: DataSourceType;
    data: any[];
    schema: Field[];
    createdAt: string;
    connectionId?: string; // For BigQuery tables
    tableName?: string;
    datasetName?: string;
    syncedTableId?: string; // For Excel tables stored in backend
    dataModelId?: string;
    semanticFieldMap?: Record<string, { tableId: string; column: string }>;
    semanticTableIds?: string[];
    semanticEngine?: 'bigquery' | 'postgres';
    isLoaded?: boolean;
    totalRows?: number;
    isLoadingPartial?: boolean;
    lastRefresh?: string;
    syncStatus?: 'ready' | 'syncing' | 'error' | 'stale' | 'queued';
    lastSyncAt?: string;
    syncError?: string | null;
}

export interface SystemLog {
    id: string;
    timestamp: string;
    type: 'info' | 'error' | 'success';
    message: string;
    target?: string;
}

export interface Field {
    name: string;
    type: 'string' | 'number' | 'date' | 'boolean';
    aggregation?: AggregationType;
    format?: string; // e.g., "currency", "percentage", "date:YYYY-MM-DD"
    isCalculated?: boolean;
}

export type AggregationType = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'countDistinct' | 'none';

// --------------------------------------------
// Widget Types
// --------------------------------------------

export type WidgetType = 'chart' | 'table' | 'card' | 'slicer' | 'gauge' | 'date-range' | 'search' | 'pivot';

export type ChartType =
    | 'bar'
    | 'line'
    | 'pie'
    | 'scatter'
    | 'combo'
    | 'donut'
    | 'horizontalBar'
    | 'stackedBar'
    | 'area';

export interface BIWidget {
    id: string;
    type: WidgetType;
    title: string;

    // Layout properties (for react-grid-layout)
    x: number;
    y: number;
    w: number; // width in grid units
    h: number; // height in grid units

    // Data configuration
    dataSourceId?: string;
    dataSourceName?: string; // Backup for recovery if ID is lost
    dataSourcePipelineName?: string;
    chartType?: ChartType;
    dataset?: string; // Legacy support

    // Field bindings
    xAxis?: string;
    yAxis?: string[];
    values?: string[];
    category?: string;
    legend?: string;
    dimensions?: string[]; // Legacy support
    measures?: string[]; // Legacy support
    aggregation?: AggregationType; // Aggregation type for Y-axis values
    yAxisConfigs?: PivotValue[]; // Multi-measure configuration
    lineAxisConfigs?: PivotValue[]; // Line measures for combo charts
    stacked?: boolean; // For bar charts

    // Styling
    colors?: string[];
    fontSize?: number;
    fontFamily?: string;
    showLegend?: boolean;
    legendPosition?: 'top' | 'bottom' | 'left' | 'right';
    legendFontSize?: number;
    showGrid?: boolean;
    showLabels?: boolean;
    labelMode?: 'value' | 'percent' | 'category' | 'categoricalValue' | 'categoricalPercent';
    borderRadius?: number;
    showShadow?: boolean;

    // Filters
    filters?: Filter[];

    // Interactions
    enableCrossFilter?: boolean;
    drillDownHierarchy?: string[];
    legendHierarchy?: string[];

    // Card-specific
    metric?: string;
    comparisonValue?: string;
    trend?: 'up' | 'down' | 'neutral';

    // Slicer-specific
    slicerField?: string;
    slicerMode?: 'list' | 'dropdown' | 'buttons';
    multiSelect?: boolean;
    showSelectAll?: boolean;

    // Table-specific
    columns?: TableColumn[];
    pageSize?: number;

    // Calculated fields
    calculatedFields?: CalculatedField[];

    // Grouping
    groupId?: string;

    // Quick Measures
    quickMeasures?: QuickMeasure[];

    // Axis Formatting
    valueFormat?: string; // e.g. "standard", "currency", "compact", "percentage"
    labelFormat?: string; // Specific format for labels if different from global

    // Pivot-specific
    pivotRows?: string[];
    pivotCols?: string[];
    pivotValues?: PivotValue[];
    hideZeros?: boolean;
    columnWidths?: Record<string, number>;

    // Global Filter Placement
    isGlobalFilter?: boolean;

    // Sorting
    sortBy?: 'value_desc' | 'value_asc' | 'category_desc' | 'category_asc' | 'none';

    // Rename aliases
    legendAliases?: Record<string, string>;

    // AI Insight & Highlights
    insight?: {
        analysis: string;
        trend: string;
        action: string;
        highlight?: {
            index: number;
            value: any;
            label: string;
            type: 'peak' | 'drop' | 'anomaly' | 'target' | 'insight';
        }[];
    };
}

export interface PivotValue {
    field: string;
    aggregation: AggregationType;
    alias?: string; // Custom label for display
    format?: string;
    yAxisId?: 'left' | 'right';
    conditionalFormatting?: ConditionalFormat[];
}

export interface QuickMeasure {
    id: string;
    label: string;
    field: string;
    calculation: QuickCalculation;
    window?: number; // For moving average
}

export interface TableColumn {
    field: string;
    header: string;
    width?: number;
    sortable?: boolean;
    format?: string;
    conditionalFormatting?: ConditionalFormat[];
}

export interface ConditionalFormat {
    condition: 'greater' | 'less' | 'equal' | 'between' | 'contains';
    value: any;
    value2?: any; // For 'between'
    compareMode?: 'literal' | 'field' | 'formula';
    compareField?: string;
    compareAggregation?: AggregationType;
    compareScope?: 'cell' | 'rowTotal' | 'columnTotal' | 'grandTotal';
    compareFormula?: string;
    backgroundColor?: string;
    textColor?: string;
    icon?: string;
}

// --------------------------------------------
// Filter Types
// --------------------------------------------

export interface Filter {
    id: string;
    field: string;
    operator: FilterOperator;
    value: any;
    value2?: any; // For 'between'
    enabled?: boolean;
}

export type FilterOperator =
    | 'equals'
    | 'notEquals'
    | 'contains'
    | 'notContains'
    | 'startsWith'
    | 'endsWith'
    | 'greaterThan'
    | 'lessThan'
    | 'greaterOrEqual'
    | 'lessOrEqual'
    | 'between'
    | 'in'
    | 'notIn'
    | 'isNull'
    | 'isNotNull';

export interface GlobalFilter {
    id: string;
    name: string;
    field: string;
    operator: FilterOperator;
    value: any;
    appliedToWidgets: string[]; // Widget IDs
}

// --------------------------------------------
// Calculation Types
// --------------------------------------------

export interface CalculatedField {
    id: string;
    name: string;
    formula: string;
    type: 'number' | 'string' | 'date' | 'boolean';
    description?: string;
}

export interface Measure {
    id: string;
    name: string;
    field: string;
    aggregation: AggregationType;
    format?: string;
    calculation?: QuickCalculation;
}

export type QuickCalculation =
    | 'percentOfTotal'
    | 'runningTotal'
    | 'yearOverYear'
    | 'movingAverage'
    | 'difference'
    | 'percentChange';

// --------------------------------------------
// Dashboard Types
// --------------------------------------------

export interface DashboardPage {
    id: string;
    title: string;
    widgets: BIWidget[];
    dataSourceId?: string;
    dataSourceName?: string;
}

export interface BIDashboard {
    id: string;
    title: string;
    description?: string;
    folderId?: string;
    dataSourceId?: string;
    dataSourceName?: string;
    enableCrossFilter?: boolean;
    widgets: BIWidget[]; // Still present for backward compatibility
    pages: DashboardPage[];
    activePageId: string;
    dataSources?: DataSource[];
    globalFilters?: GlobalFilter[];
    calculatedFields?: CalculatedField[];
    quickMeasures?: QuickMeasure[];
    layout?: LayoutConfig;
    theme?: DashboardTheme;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    sharedWith?: SharePermission[];
}

export interface LayoutConfig {
    breakpoints?: { lg: number; md: number; sm: number; xs: number };
    cols?: { lg: number; md: number; sm: number; xs: number };
    rowHeight?: number;
    margin?: [number, number];
    containerPadding?: [number, number];
}

export interface DashboardTheme {
    primaryColor?: string;
    backgroundColor?: string;
    textColor?: string;
    gridColor?: string;
    fontFamily?: string;
}

export interface SharePermission {
    userId: string;
    permission: 'view' | 'edit' | 'admin';
    sharedAt: string;
    allowedPageIds?: string[];
    rls?: DashboardRLSConfig;
}

export type RLSRuleOperator =
    | 'eq'
    | 'in'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'between'
    | 'contains'
    | 'startsWith'
    | 'endsWith'
    | 'isNull'
    | 'isNotNull';

export interface RLSCondition {
    id: string;
    field: string;
    operator: RLSRuleOperator;
    value?: string;
    values?: string[];
    value2?: string;
}

export interface RLSRule {
    id: string;
    combinator: 'AND' | 'OR';
    conditions: RLSCondition[];
}

export interface DashboardRLSConfig {
    allowedPageIds: string[];
    rules: RLSRule[];
}

export interface ShareSavePayload {
    roles: Record<string, SharePermission['permission'] | 'none'>;
    dashboardRLS: Record<string, DashboardRLSConfig>;
    confirmedDashboardIds?: string[];
}

// --------------------------------------------
// Folder Types
// --------------------------------------------

export interface BIFolder {
    id: string;
    name: string;
    parentId?: string;
    createdAt: string;
    icon?: string;
    color?: string;
    sharedWith?: SharePermission[];
    createdBy?: string;
}

// --------------------------------------------
// State Types
// --------------------------------------------

export interface BIState {
    folders: BIFolder[];
    dashboards: BIDashboard[];
    activeDashboardId: string | null;
    editingWidgetId: string | null;
    dataSources: DataSource[];
    selectedDataSourceId: string | null;
}

// --------------------------------------------
// Interaction Types
// --------------------------------------------

export interface CrossFilterState {
    sourceWidgetId: string;
    filters: Filter[];
    affectedWidgetIds: string[];
}

export interface DrillDownState {
    widgetId: string;
    hierarchy: string[];
    currentLevel: number;
    breadcrumbs: { level: number; value: string }[];
    mode?: 'drill' | 'expand'; // Power BI style: drill (replace) vs expand (additive)
}

// --------------------------------------------
// Export Types
// --------------------------------------------

export interface ExportOptions {
    format: 'pdf' | 'png' | 'json' | 'excel';
    includeData?: boolean;
    pageSize?: 'A4' | 'Letter' | 'A3';
    orientation?: 'portrait' | 'landscape';
    quality?: number; // For PNG
}

// --------------------------------------------
// UI State Types
// --------------------------------------------

export interface PanelState {
    leftSidebarOpen: boolean;
    rightSidebarOpen: boolean;
    activeLeftTab: 'data' | 'fields' | 'visualizations' | 'filters';
    previewMode: 'desktop' | 'tablet' | 'mobile';
    zoom: number;
}

export interface DragItem {
    type: 'field' | 'visualization' | 'widget';
    data: Field | ChartType | BIWidget;
}

// --------------------------------------------
// Chart Data Types
// --------------------------------------------

export interface ChartDataPoint {
    [key: string]: any;
    _highlight?: boolean;
    _filtered?: boolean;
}

export interface SeriesConfig {
    dataKey: string;
    name: string;
    color: string;
    type?: 'bar' | 'line';
    yAxisId?: 'left' | 'right';
}

// --------------------------------------------
// Utility Types
// --------------------------------------------

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export interface DataStats {
    field: string;
    count: number;
    uniqueCount: number;
    nullCount: number;
    min?: number;
    max?: number;
    avg?: number;
    median?: number;
}
