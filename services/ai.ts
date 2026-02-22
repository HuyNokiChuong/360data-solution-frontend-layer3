import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { DashboardConfig } from "../types";
import { WarehouseService } from "./warehouse";
import { BIDashboard } from "../components/bi/types";
import { stripBigQueryProjectPrefixFromSql } from "../utils/sql";

// Mapping Type for compatibility with user snippet
const Type = {
  OBJECT: SchemaType.OBJECT,
  STRING: SchemaType.STRING,
  ARRAY: SchemaType.ARRAY,
  INTEGER: SchemaType.INTEGER,
};

function cleanJsonResponse(text: string): string {
  if (!text) return "{}";
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.substring(start, end + 1);
  }
  return cleaned;
}

type NormalizedReportChartType = 'bar' | 'line' | 'pie' | 'area';

const TIME_SERIES_AXIS_HINTS = ['date', 'day', 'week', 'month', 'quarter', 'year', 'time', 'created', 'updated'];
const TIME_SERIES_SQL_REGEX = /\b(date|datetime|timestamp|date_trunc|format_date|format_datetime|extract\s*\(\s*year|order\s+by\s+[^;]*?(date|day|week|month|year))\b/i;
const TIME_SERIES_TITLE_REGEX = /(theo ngày|theo tuần|theo tháng|hàng ngày|hàng tuần|hàng tháng|7 ngày|14 ngày|30 ngày|60 ngày|90 ngày|daily|weekly|monthly|time[-\s]?series)/i;
const DATE_VALUE_REGEX = /^(\d{4}-\d{1,2}-\d{1,2}|\d{4}\/\d{1,2}\/\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{1,2}|\d{4}Q[1-4])(?:\s.*)?$/i;
const SPEND_METRIC_HINTS = ['chi_phi', 'cost', 'spend', 'budget', 'expense', 'ads_cost', 'ad_spend', 'marketing_cost', 'cp_'];
const VALUE_METRIC_HINTS = ['doanh_thu', 'doanh_so', 'revenue', 'sales', 'gmv', 'profit', 'margin', 'return', 'new_sales'];

const normalizeMetricKey = (rawKey: string): string => (
  String(rawKey || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
);

const hasMetricHint = (key: string, hints: string[]): boolean => {
  const normalized = normalizeMetricKey(key);
  return hints.some((hint) => normalized.includes(hint));
};

const isSpendMetricKey = (key: string): boolean => hasMetricHint(key, SPEND_METRIC_HINTS);
const isValueMetricKey = (key: string): boolean => hasMetricHint(key, VALUE_METRIC_HINTS);

const ensureSpendValueMetricPair = (baseKeys: string[], availableNumericKeys: string[], maxKeys = 4): string[] => {
  if (!Array.isArray(baseKeys) || baseKeys.length === 0) return [];

  const limited = baseKeys.slice(0, maxKeys);
  const spendKey = baseKeys.find((key) => isSpendMetricKey(key));
  if (!spendKey) return limited;

  const hasValueInLimited = limited.some((key) => key !== spendKey && isValueMetricKey(key));
  if (hasValueInLimited) return limited;

  const valueCandidate = availableNumericKeys.find((key) => (
    key !== spendKey
    && !limited.includes(key)
    && isValueMetricKey(key)
  ));
  if (!valueCandidate) return limited;

  if (limited.length < maxKeys) return [...limited, valueCandidate];
  return [...limited.slice(0, maxKeys - 1), valueCandidate];
};

const hasTemporalHint = (value: string): boolean => {
  const normalized = String(value || '').toLowerCase();
  return TIME_SERIES_AXIS_HINTS.some((hint) => normalized.includes(hint));
};

const isDateLikeValue = (value: any): boolean => {
  if (value instanceof Date) return true;
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  if (DATE_VALUE_REGEX.test(raw)) return true;
  if (/^\d{4}-\d{2}-\d{2}t/i.test(raw)) return true;
  if (/^[a-z]{3,9}\s+\d{4}$/i.test(raw)) return true;
  return false;
};

const isLikelyTimeSeriesChart = (chart: any): boolean => {
  const xAxisKey = String(chart?.xAxisKey || '').trim().toLowerCase();
  const title = String(chart?.title || '').trim();
  const sql = String(chart?.sql || '').trim();

  if (hasTemporalHint(xAxisKey)) return true;
  if (TIME_SERIES_TITLE_REGEX.test(title)) return true;
  if (TIME_SERIES_SQL_REGEX.test(sql)) return true;

  if (Array.isArray(chart?.mockLabels) && chart.mockLabels.length > 0) {
    const sampleLabels = chart.mockLabels.slice(0, 8);
    if (sampleLabels.some((label: any) => isDateLikeValue(label))) return true;
  }

  return false;
};

const normalizeReportChartType = (
  rawType: any,
  isTimeSeries: boolean
): NormalizedReportChartType => {
  const normalized = String(rawType || '').trim().toLowerCase();

  if (normalized === 'line') return 'line';
  if (normalized === 'area') return isTimeSeries ? 'area' : 'bar';
  if (normalized === 'bar' || normalized === 'horizontalbar' || normalized === 'stackedbar') return 'bar';
  if (normalized === 'combo' || normalized === 'scatter') return isTimeSeries ? 'line' : 'bar';

  if (normalized === 'pie' || normalized === 'donut' || normalized === 'doughnut' || normalized === 'radial') {
    return isTimeSeries ? 'line' : 'pie';
  }

  return isTimeSeries ? 'line' : 'bar';
};

const toInsightText = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .join('; ');
  }
  return String(value).replace(/\s+/g, ' ').trim();
};

const isDuplicateInsightText = (left: string, right: string): boolean => {
  const l = String(left || '').toLowerCase().trim();
  const r = String(right || '').toLowerCase().trim();
  if (!l || !r) return false;
  return l === r || l.includes(r) || r.includes(l);
};

const normalizeReportChartInsight = (rawInsight: any, language: ReportLanguage = 'vi'): any => {
  if (!rawInsight || typeof rawInsight !== 'object') return rawInsight;
  const fallback = getReportFallbackText(language);

  const insight = { ...rawInsight };
  const analysis = toInsightText(insight.analysis ?? insight.currentStatus ?? insight.current_state ?? insight.overview);
  const trend = toInsightText(insight.trend ?? insight.trendAnalysis ?? insight.direction);
  const cause = toInsightText(
    insight.cause
    ?? insight.rootCause
    ?? insight.root_cause
    ?? insight.reason
    ?? insight.reasons
    ?? insight.driverAnalysis
    ?? insight.drivers
    ?? insight.keyDrivers
  );
  const action = toInsightText(
    insight.action
    ?? insight.actions
    ?? insight.nextStep
    ?? insight.nextSteps
    ?? insight.recommendation
    ?? insight.recommendations
  );

  const mergedAnalysis = (() => {
    if (!analysis && !trend) return '';
    if (!analysis) return trend;
    if (!trend || isDuplicateInsightText(analysis, trend)) return analysis;
    return `${analysis} ${trend}`.trim();
  })();

  return {
    ...insight,
    analysis: mergedAnalysis || analysis || trend || fallback.noInsightConclusion,
    trend: trend || analysis || '',
    cause: cause || '',
    action: action || fallback.defaultAction,
  };
};

const sanitizeReportCharts = (charts: any[], language: ReportLanguage = 'vi'): any[] => {
  if (!Array.isArray(charts)) return [];

  return charts.map((chart) => {
    const safeChart = chart && typeof chart === 'object' ? { ...chart } : {};
    const isTimeSeries = isLikelyTimeSeriesChart(safeChart);
    const normalizedType = normalizeReportChartType(safeChart.type, isTimeSeries);
    return {
      ...safeChart,
      type: normalizedType,
      sql: stripBigQueryProjectPrefixFromSql(String(safeChart.sql || '')),
      insight: normalizeReportChartInsight(safeChart.insight, language),
    };
  });
};

const toFiniteNumber = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/[\s,]+/g, '')
    .replace(/%$/, '');
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const isChartQueryErrorRow = (row: any): boolean => (
  !!row
  && typeof row === 'object'
  && !Array.isArray(row)
  && typeof row._error === 'string'
  && String(row._error).trim().length > 0
);

const extractChartQueryError = (chartData: any): string => {
  if (isChartQueryErrorRow(chartData)) return String(chartData._error || '').trim();
  if (!Array.isArray(chartData)) return '';
  const errorRow = chartData.find((row) => isChartQueryErrorRow(row));
  return errorRow ? String(errorRow._error || '').trim() : '';
};

const stripChartErrorRows = (chartData: any): any[] => {
  if (!Array.isArray(chartData)) return [];
  return chartData.filter((row) => !isChartQueryErrorRow(row));
};

const coerceChartNumericRows = (rows: any[], dataKeys: any[]): any[] => {
  if (!Array.isArray(rows)) return [];
  const keys = Array.isArray(dataKeys)
    ? dataKeys.map((key) => String(key || '').trim()).filter(Boolean)
    : [];

  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const next = { ...row };
    keys.forEach((key) => {
      const parsed = toFiniteNumber(next[key]);
      if (parsed !== null) next[key] = parsed;
    });
    return next;
  });
};

const resolveChartDataKeys = (rows: any[], preferredKeys: any[]): string[] => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const normalizedPreferred = Array.isArray(preferredKeys)
    ? preferredKeys.map((key) => String(key || '').trim()).filter(Boolean)
    : [];
  const hasNumericValue = (row: any, key: string): boolean => (
    toFiniteNumber(row?.[key]) !== null
  );

  const preferredNumeric = normalizedPreferred.filter((key) => (
    rows.some((row) => row && typeof row === 'object' && !Array.isArray(row) && hasNumericValue(row, key))
  ));

  const discoveredNumeric = Array.from(new Set(
    rows.flatMap((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
      return Object.keys(row).filter((key) => key !== '_error' && hasNumericValue(row, key));
    })
  ));

  const baseKeys = preferredNumeric.length > 0 ? preferredNumeric : discoveredNumeric;
  if (baseKeys.length > 0) {
    return ensureSpendValueMetricPair(baseKeys, discoveredNumeric, 4);
  }
  return [];
};

// Helper to get API keys from local storage or env
const getApiKey = (provider: string) => {
  let key = "";
  if (provider === 'OpenAI') key = localStorage.getItem('openai_api_key') || process.env.OPENAI_API_KEY || '';
  else if (provider === 'Anthropic') key = localStorage.getItem('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
  else if (provider === 'Google') key = localStorage.getItem('gemini_api_key') || process.env.GEMINI_API_KEY || process.env.API_KEY || "";

  return key.trim();
};

type AIProvider = 'Google' | 'OpenAI' | 'Anthropic';
export type ReportLanguage = 'en' | 'vi';
export type ChartAnalysisOutputLanguage = 'vi' | 'en' | 'ja' | 'ko' | 'zh-CN' | 'th';

const normalizeReportLanguage = (language?: string): ReportLanguage => (
  String(language || '').toLowerCase() === 'en' ? 'en' : 'vi'
);

const chartAnalysisLanguageMeta: Record<ChartAnalysisOutputLanguage, {
  targetLabel: string;
  highlightTitle: string;
  summaryTitle: string;
}> = {
  vi: {
    targetLabel: 'Vietnamese',
    highlightTitle: '## 🔴 Điểm cần highlight từ dữ liệu thực',
    summaryTitle: '## 📋 Bảng Summary cuối cùng',
  },
  en: {
    targetLabel: 'English',
    highlightTitle: '## 🔴 Key Data Highlights',
    summaryTitle: '## 📋 Final Summary Table',
  },
  ja: {
    targetLabel: 'Japanese',
    highlightTitle: '## 🔴 重要なデータハイライト',
    summaryTitle: '## 📋 最終サマリーテーブル',
  },
  ko: {
    targetLabel: 'Korean',
    highlightTitle: '## 🔴 주요 데이터 하이라이트',
    summaryTitle: '## 📋 최종 요약 표',
  },
  'zh-CN': {
    targetLabel: 'Simplified Chinese',
    highlightTitle: '## 🔴 关键数据亮点',
    summaryTitle: '## 📋 最终汇总表',
  },
  th: {
    targetLabel: 'Thai',
    highlightTitle: '## 🔴 ไฮไลต์ข้อมูลสำคัญ',
    summaryTitle: '## 📋 ตารางสรุปสุดท้าย',
  },
};

const normalizeChartAnalysisOutputLanguage = (
  language?: string,
  fallback: ReportLanguage = 'vi'
): ChartAnalysisOutputLanguage => {
  const raw = String(language || '').trim().toLowerCase();
  if (raw === 'vi' || raw.startsWith('vi-')) return 'vi';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  if (raw === 'ja' || raw.startsWith('ja-') || raw === 'jp' || raw === 'japanese') return 'ja';
  if (raw === 'ko' || raw.startsWith('ko-') || raw === 'kr' || raw === 'korean') return 'ko';
  if (raw === 'th' || raw.startsWith('th-') || raw === 'thai') return 'th';
  if (
    raw === 'zh'
    || raw === 'zh-cn'
    || raw === 'zh_hans'
    || raw === 'zh-hans'
    || raw === 'zh-sg'
    || raw === 'cn'
    || raw === 'chinese'
  ) {
    return 'zh-CN';
  }
  return fallback === 'en' ? 'en' : 'vi';
};

const getReportFallbackText = (language: ReportLanguage) => {
  if (language === 'en') {
    return {
      noInsightConclusion: 'Insufficient data to conclude current status.',
      defaultAction: 'Continue collecting data and define prioritized actions by business impact.',
      strategicInsightTitle: 'Strategic Insight',
      strategicPointTitle: 'Strategic Point',
      strategicRecommendationDefault: 'Review detailed data and decide actions aligned with current business conditions.',
      strategicRecommendationEmpty: 'Analyze deeper data slices to define concrete actions.',
      dashboardTitle: 'Advanced Analytics Report',
      dashboardSummary: 'Analytical overview.',
      sqlTraceUnavailable: '-- SQL trace unavailable',
      googleApiKeyMissing: 'Google API Key is missing. Please update the key in AI Settings.',
      noAiResponse: 'No response from AI.',
      leakedSummary: '⚠️ SECURITY ALERT: Your Gemini API key was flagged as leaked and blocked. Create a new key in Google AI Studio and update it in AI Settings.',
      rateLimitSummary: '⚠️ RATE LIMIT: Your AI account reached request limits. Wait 30-60 seconds and try again, or upgrade your plan.',
      leakedError: '⚠️ SECURITY ALERT: Your Gemini API key was flagged as leaked and blocked. Create a new key at https://aistudio.google.com/ and update AI Settings. Do not expose keys publicly.',
      rateLimitError: '⚠️ RATE LIMIT: Your AI account reached request limits. Please wait a few seconds and retry.',
      openAiApiMissing: 'OpenAI API Key is missing. Please update the key in AI Settings.',
      anthropicApiMissing: 'Anthropic API Key is missing. Please update the key in AI Settings.',
      noApiKeyFound: 'No AI API key found. Please add one in AI Settings.',
      reportJsonGeneratorSystem: 'You are a JSON generator. Return valid JSON only.',
    };
  }

  return {
    noInsightConclusion: 'Chưa đủ dữ liệu để kết luận hiện trạng.',
    defaultAction: 'Tiếp tục thu thập thêm dữ liệu và xác định hành động ưu tiên theo mức ảnh hưởng.',
    strategicInsightTitle: 'Strategic Insight',
    strategicPointTitle: 'Strategic Point',
    strategicRecommendationDefault: 'Xem xét dữ liệu chi tiết và đưa ra quyết định phù hợp với tình hình thực tế.',
    strategicRecommendationEmpty: 'Phân tích thêm dữ liệu chi tiết để đưa ra hành động cụ thể.',
    dashboardTitle: 'Báo cáo phân tích chuyên sâu',
    dashboardSummary: 'Tổng quan phân tích.',
    sqlTraceUnavailable: '-- SQL Trace unavailable',
    googleApiKeyMissing: 'Google API Key is missing. Hãy cập nhật Key trong tab AI Setting.',
    noAiResponse: 'Không nhận được phản hồi từ AI.',
    leakedSummary: '⚠️ LỖI BẢO MẬT: API Key Gemini của bạn đã bị Google xác định là bị lộ (leaked) và đã bị khóa. Hãy tạo Key mới tại Google AI Studio và cập nhật trong tab AI Setting.',
    rateLimitSummary: '⚠️ HỆ THỐNG ĐANG QUÁ TẢI (Rate Limit): Tài khoản AI (Gemini Free) của bạn đã hết lượt gọi trong phút này. Hãy chờ 30-60 giây rồi thử lại, hoặc nâng cấp lên gói trả phí (Pay-as-you-go).',
    leakedError: '⚠️ LỖI BẢO MẬT: API Key Gemini của bạn đã bị Google xác định là bị lộ (leaked) và đã bị khóa. Hãy tạo Key mới tại Google AI Studio (https://aistudio.google.com/) và cập nhật trong tab AI Setting. Lưu ý tuyệt đối không để lộ Key này trên GitHub hoặc các nơi công cộng.',
    rateLimitError: '⚠️ HỆ THỐNG ĐANG QUÁ TẢI (Rate Limit): Tài khoản AI (Gemini Free) của bạn đã hết lượt gọi trong phút này. Hãy chờ vài giây rồi nhấn thử lại nhé.',
    openAiApiMissing: 'OpenAI API Key is missing. Hãy cập nhật Key trong tab AI Setting.',
    anthropicApiMissing: 'Anthropic API Key is missing. Hãy cập nhật Key trong tab AI Setting.',
    noApiKeyFound: 'No AI API key found. Vui lòng thêm API Key trong AI Settings.',
    reportJsonGeneratorSystem: 'You are a JSON generator.',
  };
};

const inferProviderFromModelId = (modelId: string): AIProvider => {
  if (!modelId) return 'Google';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1')) return 'OpenAI';
  if (modelId.startsWith('claude')) return 'Anthropic';
  return 'Google';
};

const hasApiKeyForProvider = (provider: AIProvider): boolean => !!getApiKey(provider);

const pickBestFormulaModel = (preferredModelId?: string, preferredProvider?: AIProvider): { provider: AIProvider; modelId: string } => {
  if (preferredModelId) {
    const inferredProvider = inferProviderFromModelId(preferredModelId);
    if (hasApiKeyForProvider(inferredProvider)) {
      return { provider: inferredProvider, modelId: preferredModelId };
    }
  }

  if (preferredProvider && hasApiKeyForProvider(preferredProvider)) {
    if (preferredProvider === 'OpenAI') return { provider: 'OpenAI', modelId: 'gpt-5.1' };
    if (preferredProvider === 'Anthropic') return { provider: 'Anthropic', modelId: 'claude-sonnet-4-20250514' };
    return { provider: 'Google', modelId: 'gemini-2.5-pro' };
  }

  if (hasApiKeyForProvider('OpenAI')) return { provider: 'OpenAI', modelId: 'gpt-5.1' };
  if (hasApiKeyForProvider('Anthropic')) return { provider: 'Anthropic', modelId: 'claude-sonnet-4-20250514' };
  if (hasApiKeyForProvider('Google')) return { provider: 'Google', modelId: 'gemini-2.5-pro' };

  throw new Error('No AI API key found. Vui lòng thêm API Key trong AI Settings.');
};

export interface FormulaGenerationField {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | string;
}

export interface GenerateCalculatedFieldFormulaInput {
  prompt: string;
  availableFields: FormulaGenerationField[];
  modelId?: string;
  provider?: AIProvider;
  currentFieldName?: string;
  signal?: AbortSignal;
}

export interface GenerateCalculatedFieldFormulaResult {
  suggestedName: string;
  formula: string;
  explanation: string;
  provider: AIProvider;
  modelId: string;
}

export interface FormulaRecommendationVariable {
  key: string;
  label: string;
  suggestedField: string;
  acceptedTypes?: Array<'string' | 'number' | 'date' | 'boolean' | string>;
}

export interface FormulaRecommendation {
  id: string;
  title: string;
  description: string;
  suggestedName: string;
  formulaTemplate: string;
  variables: FormulaRecommendationVariable[];
}

export interface GenerateCalculatedFieldRecommendationsInput {
  availableFields: FormulaGenerationField[];
  sampleRows?: Record<string, any>[];
  modelId?: string;
  provider?: AIProvider;
  contextHint?: string;
  signal?: AbortSignal;
}

async function callOpenAI(modelId: string, systemPrompt: string, userPrompt: string, temperature: number = 0.7, signal?: AbortSignal) {
  const apiKey = getApiKey('OpenAI');
  if (!apiKey) throw new Error("OpenAI API Key is missing. Hãy cập nhật Key trong tab AI Setting.");

  const normalizeOpenAIError = (err: any): string => {
    const rawMessage = err?.message || '';
    const errCode = err?.code || '';
    const errType = err?.type || '';
    const lower = `${rawMessage} ${errCode} ${errType}`.toLowerCase();

    if (
      lower.includes('insufficient_quota') ||
      lower.includes('exceeded your current quota') ||
      lower.includes('billing_hard_limit_reached')
    ) {
      return "OpenAI API key hợp lệ nhưng tài khoản API đã hết quota/credit. ChatGPT Plus/Pro không bao gồm API credit. Vào platform.openai.com > Billing để nạp credit hoặc đổi sang model/provider khác.";
    }

    if (
      lower.includes('model_not_found') ||
      lower.includes('does not exist') ||
      lower.includes('do not have access')
    ) {
      return `Tài khoản OpenAI chưa có quyền dùng model "${modelId}". Hãy chọn model khác (ví dụ gpt-5-mini) hoặc kiểm tra quyền truy cập model trong OpenAI dashboard.`;
    }

    if (
      lower.includes('invalid_api_key') ||
      lower.includes('incorrect api key') ||
      lower.includes('unauthorized')
    ) {
      return "OpenAI API key không hợp lệ hoặc đã bị thu hồi. Hãy tạo key mới tại platform.openai.com/api-keys.";
    }

    return rawMessage || "Không thể gọi OpenAI API. Vui lòng kiểm tra API key và billing.";
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: temperature,
        response_format: { type: "json_object" }
      }),
      signal
    });

    const data = await response.json();
    if (!response.ok || data?.error) {
      throw new Error(normalizeOpenAIError(data?.error || { message: `HTTP ${response.status}` }));
    }

    return data.choices[0].message.content;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new Error(normalizeOpenAIError(e));
  }
}

async function callAnthropic(modelId: string, systemPrompt: string, userPrompt: string, temperature: number = 0.7, signal?: AbortSignal) {
  const apiKey = getApiKey('Anthropic');
  if (!apiKey) throw new Error("Anthropic API Key is missing. Hãy cập nhật Key trong tab AI Setting.");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: modelId,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt }
      ],
      max_tokens: 4096,
      temperature: temperature
    }),
    signal
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

// Helper: Smart Data Summarization for AI
function summarizeChartData(data: any[], dataKeys: string[], xAxis: string): string {
  if (!data || data.length === 0) return "No data available.";

  const toNumber = (value: any): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const getAxisLabel = (row: any, idx: number): string => {
    const raw = row?.[xAxis];
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return `Row ${idx + 1}`;
    }
    return String(raw);
  };

  const pearsonCorrelation = (pairs: Array<[number, number]>): number | null => {
    if (!pairs || pairs.length < 3) return null;
    const n = pairs.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    let sumYY = 0;

    pairs.forEach(([x, y]) => {
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
      sumYY += y * y;
    });

    const numerator = (n * sumXY) - (sumX * sumY);
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    if (!Number.isFinite(denominator) || denominator === 0) return null;
    const corr = numerator / denominator;
    if (!Number.isFinite(corr)) return null;
    return corr;
  };

  const corrStrengthLabel = (corr: number): string => {
    const abs = Math.abs(corr);
    if (abs >= 0.8) return 'rất mạnh';
    if (abs >= 0.6) return 'mạnh';
    if (abs >= 0.4) return 'trung bình';
    if (abs >= 0.2) return 'yếu';
    return 'rất yếu';
  };

  const count = data.length;
  const axisLabels = data.map((row, idx) => getAxisLabel(row, idx));

  // Calculate basic stats for each dataKey
  const stats = dataKeys.map((key) => {
    const values = data
      .map((d) => toNumber(d?.[key]))
      .filter((v): v is number => v !== null);

    if (values.length === 0) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const first = values[0];
    const last = values[values.length - 1];
    const trend = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;

    return { key, min, max, avg, sum, first, last, trend };
  }).filter(Boolean);

  const pairwiseCorrelations: Array<{ left: string; right: string; corr: number; sample: number }> = [];
  for (let i = 0; i < dataKeys.length; i++) {
    for (let j = i + 1; j < dataKeys.length; j++) {
      const leftKey = dataKeys[i];
      const rightKey = dataKeys[j];
      const pairs: Array<[number, number]> = [];

      data.forEach((row) => {
        const left = toNumber(row?.[leftKey]);
        const right = toNumber(row?.[rightKey]);
        if (left === null || right === null) return;
        pairs.push([left, right]);
      });

      const corr = pearsonCorrelation(pairs);
      if (corr === null) continue;
      pairwiseCorrelations.push({ left: leftKey, right: rightKey, corr, sample: pairs.length });
    }
  }
  pairwiseCorrelations.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

  const primaryKey = dataKeys[0] || '';
  let peakInfo = '';
  let troughInfo = '';
  let transitionInfo = '';
  if (primaryKey) {
    const primaryPoints = data
      .map((row, idx) => ({
        x: axisLabels[idx],
        value: toNumber(row?.[primaryKey]),
        idx
      }))
      .filter((p): p is { x: string; value: number; idx: number } => p.value !== null);

    if (primaryPoints.length > 0) {
      const peak = primaryPoints.reduce((best, cur) => cur.value > best.value ? cur : best, primaryPoints[0]);
      const trough = primaryPoints.reduce((best, cur) => cur.value < best.value ? cur : best, primaryPoints[0]);
      peakInfo = `${primaryKey} đạt đỉnh tại "${peak.x}" = ${peak.value.toFixed(2)}`;
      troughInfo = `${primaryKey} chạm đáy tại "${trough.x}" = ${trough.value.toFixed(2)}`;
    }

    const transitions = [];
    for (let i = 1; i < primaryPoints.length; i++) {
      const prev = primaryPoints[i - 1];
      const cur = primaryPoints[i];
      const delta = cur.value - prev.value;
      const pct = prev.value !== 0 ? (delta / Math.abs(prev.value)) * 100 : 0;
      transitions.push({
        from: prev.x,
        to: cur.x,
        delta,
        pct
      });
    }

    if (transitions.length > 0) {
      const largestIncrease = transitions.reduce((best, cur) => cur.delta > best.delta ? cur : best, transitions[0]);
      const largestDecrease = transitions.reduce((best, cur) => cur.delta < best.delta ? cur : best, transitions[0]);
      transitionInfo = `Bước nhảy lớn nhất: +${largestIncrease.delta.toFixed(2)} (${largestIncrease.pct >= 0 ? '+' : ''}${largestIncrease.pct.toFixed(1)}%) từ "${largestIncrease.from}" -> "${largestIncrease.to}". | Sụt giảm lớn nhất: ${largestDecrease.delta.toFixed(2)} (${largestDecrease.pct >= 0 ? '+' : ''}${largestDecrease.pct.toFixed(1)}%) từ "${largestDecrease.from}" -> "${largestDecrease.to}".`;
    }
  }

  let summary = `Total Rows: ${count}\n`;
  summary += `X-Axis Field: ${xAxis || 'N/A'}\n`;

  if (stats.length > 0) {
    summary += "Key Statistics:\n";
    stats.forEach(s => {
      if (!s) return;
      summary += `- ${s.key}: Range=[${s.min.toFixed(2)} - ${s.max.toFixed(2)}], Avg=${s.avg.toFixed(2)}, Trend=${s.trend > 0 ? '+' : ''}${s.trend.toFixed(1)}%\n`;
    });
  }

  if (pairwiseCorrelations.length > 0) {
    summary += "Strongest Pairwise Correlations:\n";
    pairwiseCorrelations.slice(0, 5).forEach((pair) => {
      const dir = pair.corr >= 0 ? 'cùng chiều' : 'ngược chiều';
      summary += `- ${pair.left} ↔ ${pair.right}: corr=${pair.corr.toFixed(2)} (${corrStrengthLabel(pair.corr)}, ${dir}, n=${pair.sample})\n`;
    });
  }

  if (peakInfo || troughInfo || transitionInfo) {
    summary += "Critical Signal Points:\n";
    if (peakInfo) summary += `- ${peakInfo}\n`;
    if (troughInfo) summary += `- ${troughInfo}\n`;
    if (transitionInfo) summary += `- ${transitionInfo}\n`;
  }

  // Smart Sampling: First 3, Last 3, and evenly spaced in between
  // Limit total tokens by keeping sample size reasonable (e.g., ~20 points)
  let indices = new Set<number>();
  indices.add(0);
  if (count > 0) indices.add(count - 1);
  if (count > 1) indices.add(1);
  if (count > 2) indices.add(count - 2);

  const targetSamples = 20;
  const step = Math.max(1, Math.floor(count / targetSamples));
  for (let i = 0; i < count; i += step) indices.add(i);

  const sortedIndices = Array.from(indices).sort((a, b) => a - b).filter(i => i >= 0 && i < count);
  const sampledData = sortedIndices.map(i => data[i]);

  summary += `Sampled Data Points (Representative subset of ${sortedIndices.length} rows):\n${JSON.stringify(sampledData)}`;

  return summary;
}

const buildDeterministicAnalysisAppendix = (
  data: any[],
  xAxis: string,
  dataKeys: string[],
  language: ReportLanguage = 'vi'
): string => {
  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(dataKeys) || dataKeys.length === 0) {
    return '';
  }

  const reportLanguage = normalizeReportLanguage(language);
  const numberFormatters = new Map<number, Intl.NumberFormat>();
  const getNumberFormatter = (digits: number) => {
    if (!numberFormatters.has(digits)) {
      numberFormatters.set(digits, new Intl.NumberFormat('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: true,
      }));
    }
    return numberFormatters.get(digits)!;
  };
  const formatNumber = (value: number, digits = 2) => getNumberFormatter(digits).format(value);
  const formatSignedNumber = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${formatNumber(value, digits)}`;
  const formatPercent = (value: number, digits = 1) => `${formatSignedNumber(value, digits)}%`;

  const i18n = reportLanguage === 'en'
    ? {
      rowLabel: (idx: number) => `Row ${idx + 1}`,
      corrVeryStrongPos: 'Very strong (positive)',
      corrVeryStrongNeg: 'Very strong (negative)',
      corrStrongPos: 'Strong (positive)',
      corrStrongNeg: 'Strong (negative)',
      corrMediumPos: 'Moderate (positive)',
      corrMediumNeg: 'Moderate (negative)',
      corrWeakPos: 'Weak (positive)',
      corrWeakNeg: 'Weak (negative)',
      corrVeryWeak: 'Very weak',
      highlightOverall: (metric: string, delta: string, pct: string) => `- 🔥 ${metric} changed overall by ${delta} (${pct}) from start to end of the period.`,
      highlightPeakTrough: (peakX: string, peakY: string, troughX: string, troughY: string) => `- 🔥 Peak at "${peakX}" = ${peakY}; trough at "${troughX}" = ${troughY}.`,
      highlightIncrease: (from: string, to: string, delta: string, pct: string) => `- 🔥 Largest increase: "${from}" -> "${to}" (${delta}, ${pct}).`,
      highlightDecrease: (from: string, to: string, delta: string, pct: string) => `- 🔥 Largest decrease: "${from}" -> "${to}" (${delta}, ${pct}).`,
      highlightDriver: (metric: string, driver: string, corr: string, label: string) => `- 🔥 Strongest direct driver of ${metric}: ${driver} (corr=${corr} - ${label}).`,
      targetMetric: 'Target metric',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      insufficientData: 'Insufficient data',
      sectionTitle: '## 🔴 Key Data Highlights',
      tableTitle: '## 📋 Final Summary Table',
      tableHeader: '| Metric | Start | End | Delta | % Change | Direct Impact | Monitoring Priority |',
      tableDivider: '| --- | ---: | ---: | ---: | ---: | --- | --- |',
    }
    : {
      rowLabel: (idx: number) => `Row ${idx + 1}`,
      corrVeryStrongPos: 'Rất mạnh (cùng chiều)',
      corrVeryStrongNeg: 'Rất mạnh (ngược chiều)',
      corrStrongPos: 'Mạnh (cùng chiều)',
      corrStrongNeg: 'Mạnh (ngược chiều)',
      corrMediumPos: 'Trung bình (cùng chiều)',
      corrMediumNeg: 'Trung bình (ngược chiều)',
      corrWeakPos: 'Yếu (cùng chiều)',
      corrWeakNeg: 'Yếu (ngược chiều)',
      corrVeryWeak: 'Rất yếu',
      highlightOverall: (metric: string, delta: string, pct: string) => `- 🔥 ${metric} thay đổi tổng thể ${delta} (${pct}) từ đầu kỳ đến cuối kỳ.`,
      highlightPeakTrough: (peakX: string, peakY: string, troughX: string, troughY: string) => `- 🔥 Đỉnh cao nhất tại "${peakX}" = ${peakY}; đáy thấp nhất tại "${troughX}" = ${troughY}.`,
      highlightIncrease: (from: string, to: string, delta: string, pct: string) => `- 🔥 Pha tăng mạnh nhất: "${from}" -> "${to}" (${delta}, ${pct}).`,
      highlightDecrease: (from: string, to: string, delta: string, pct: string) => `- 🔥 Pha giảm mạnh nhất: "${from}" -> "${to}" (${delta}, ${pct}).`,
      highlightDriver: (metric: string, driver: string, corr: string, label: string) => `- 🔥 Biến ảnh hưởng trực tiếp mạnh nhất đến ${metric}: ${driver} (corr=${corr} - ${label}).`,
      targetMetric: 'Biến mục tiêu',
      high: 'Cao',
      medium: 'Trung bình',
      low: 'Thấp',
      insufficientData: 'Thiếu dữ liệu',
      sectionTitle: '## 🔴 Điểm cần highlight từ dữ liệu thực',
      tableTitle: '## 📋 Bảng Summary cuối cùng',
      tableHeader: '| Biến số | Đầu kỳ | Cuối kỳ | Delta | % thay đổi | Mức ảnh hưởng trực tiếp | Ưu tiên theo dõi |',
      tableDivider: '| --- | ---: | ---: | ---: | ---: | --- | --- |',
    };

  const toNumber = (value: any): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const getAxisLabel = (row: any, idx: number): string => {
    const raw = row?.[xAxis];
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return i18n.rowLabel(idx);
    }
    return String(raw);
  };

  const pearsonCorrelation = (pairs: Array<[number, number]>): number | null => {
    if (!pairs || pairs.length < 3) return null;
    const n = pairs.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    let sumYY = 0;
    pairs.forEach(([x, y]) => {
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
      sumYY += y * y;
    });
    const numerator = (n * sumXY) - (sumX * sumY);
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    if (!Number.isFinite(denominator) || denominator === 0) return null;
    const corr = numerator / denominator;
    if (!Number.isFinite(corr)) return null;
    return corr;
  };

  const correlationLabel = (corr: number): string => {
    const abs = Math.abs(corr);
    if (abs >= 0.8) return corr > 0 ? i18n.corrVeryStrongPos : i18n.corrVeryStrongNeg;
    if (abs >= 0.6) return corr > 0 ? i18n.corrStrongPos : i18n.corrStrongNeg;
    if (abs >= 0.4) return corr > 0 ? i18n.corrMediumPos : i18n.corrMediumNeg;
    if (abs >= 0.2) return corr > 0 ? i18n.corrWeakPos : i18n.corrWeakNeg;
    return i18n.corrVeryWeak;
  };

  const primaryKey = dataKeys[0];
  const axisLabels = data.map((row, idx) => getAxisLabel(row, idx));
  const primarySeries = data
    .map((row, idx) => ({
      x: axisLabels[idx],
      y: toNumber(row?.[primaryKey])
    }))
    .filter((p): p is { x: string; y: number } => p.y !== null);

  if (primarySeries.length === 0) return '';

  const peak = primarySeries.reduce((best, cur) => cur.y > best.y ? cur : best, primarySeries[0]);
  const trough = primarySeries.reduce((best, cur) => cur.y < best.y ? cur : best, primarySeries[0]);
  const first = primarySeries[0].y;
  const last = primarySeries[primarySeries.length - 1].y;
  const overallPct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
  const overallDelta = last - first;

  const transitions = [];
  for (let i = 1; i < primarySeries.length; i++) {
    const prev = primarySeries[i - 1];
    const cur = primarySeries[i];
    const delta = cur.y - prev.y;
    const pct = prev.y !== 0 ? (delta / Math.abs(prev.y)) * 100 : 0;
    transitions.push({ from: prev.x, to: cur.x, delta, pct });
  }
  const largestIncrease = transitions.length > 0
    ? transitions.reduce((best, cur) => cur.delta > best.delta ? cur : best, transitions[0])
    : null;
  const largestDecrease = transitions.length > 0
    ? transitions.reduce((best, cur) => cur.delta < best.delta ? cur : best, transitions[0])
    : null;

  const driverRows = dataKeys.slice(1).map((key) => {
    const pairs: Array<[number, number]> = [];
    data.forEach((row) => {
      const base = toNumber(row?.[primaryKey]);
      const driver = toNumber(row?.[key]);
      if (base === null || driver === null) return;
      pairs.push([base, driver]);
    });
    const corr = pearsonCorrelation(pairs);
    if (corr === null) return null;
    return { key, corr };
  }).filter(Boolean) as Array<{ key: string; corr: number }>;

  driverRows.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

  const highlightLines = [
    i18n.highlightOverall(
      primaryKey,
      formatSignedNumber(overallDelta, 2),
      formatPercent(overallPct, 1)
    ),
    i18n.highlightPeakTrough(
      peak.x,
      formatNumber(peak.y, 2),
      trough.x,
      formatNumber(trough.y, 2)
    )
  ];

  if (largestIncrease) {
    highlightLines.push(
      i18n.highlightIncrease(
        largestIncrease.from,
        largestIncrease.to,
        formatSignedNumber(largestIncrease.delta, 2),
        formatPercent(largestIncrease.pct, 1)
      )
    );
  }
  if (largestDecrease) {
    highlightLines.push(
      i18n.highlightDecrease(
        largestDecrease.from,
        largestDecrease.to,
        formatSignedNumber(largestDecrease.delta, 2),
        formatPercent(largestDecrease.pct, 1)
      )
    );
  }
  if (driverRows.length > 0) {
    const strongest = driverRows[0];
    highlightLines.push(
      i18n.highlightDriver(
        primaryKey,
        strongest.key,
        strongest.corr.toFixed(2),
        correlationLabel(strongest.corr)
      )
    );
  }

  const summaryRows = dataKeys.map((key) => {
    const series = data
      .map((row) => toNumber(row?.[key]))
      .filter((v): v is number => v !== null);
    if (series.length === 0) return null;
    const start = series[0];
    const end = series[series.length - 1];
    const delta = end - start;
    const pct = start !== 0 ? (delta / Math.abs(start)) * 100 : 0;

    if (key === primaryKey) {
      return {
        metric: key,
        start,
        end,
        delta,
        pct,
        impact: i18n.targetMetric,
        priority: i18n.high
      };
    }

    const pairs: Array<[number, number]> = [];
    data.forEach((row) => {
      const base = toNumber(row?.[primaryKey]);
      const driver = toNumber(row?.[key]);
      if (base === null || driver === null) return;
      pairs.push([base, driver]);
    });
    const corr = pearsonCorrelation(pairs);
    const impact = corr === null ? i18n.insufficientData : `corr=${corr.toFixed(2)} (${correlationLabel(corr)})`;
    const priority = corr === null
      ? i18n.low
      : (Math.abs(corr) >= 0.6 ? i18n.high : (Math.abs(corr) >= 0.35 ? i18n.medium : i18n.low));

    return {
      metric: key,
      start,
      end,
      delta,
      pct,
      impact,
      priority
    };
  }).filter(Boolean) as Array<{
    metric: string;
    start: number;
    end: number;
    delta: number;
    pct: number;
    impact: string;
    priority: string;
  }>;

  const summaryTableLines = [
    i18n.tableTitle,
    i18n.tableHeader,
    i18n.tableDivider,
    ...summaryRows.map((row) => (
      `| ${row.metric} | ${formatNumber(row.start, 2)} | ${formatNumber(row.end, 2)} | ${formatSignedNumber(row.delta, 2)} | ${formatPercent(row.pct, 1)} | ${row.impact} | ${row.priority} |`
    ))
  ];

  const appendixParts = [
    i18n.sectionTitle,
    ...highlightLines,
    '',
    ...summaryTableLines
  ];

  return appendixParts.join('\n').trim();
};

async function regenerateInsightsWithRealData(
  modelId: string,
  originalPrompt: string,
  kpis: any[],
  charts: any[],
  chartData: any[][],
  language: ReportLanguage = 'vi',
  signal?: AbortSignal
): Promise<{ summary: string, insights: any[], chartInsights: any[] }> {
  try {
    const reportLanguage = normalizeReportLanguage(language);
    const fallback = getReportFallbackText(reportLanguage);
    const targetLanguageLabel = reportLanguage === 'en' ? 'English' : 'Vietnamese';

    // Basic detection of provider based on model ID prefix
    let provider = 'Google';
    if (modelId.startsWith('gpt') || modelId.startsWith('o1')) provider = 'OpenAI';
    else if (modelId.startsWith('claude')) provider = 'Anthropic';

    const apiKey = getApiKey(provider);

    // Summarize data for the AI (limit size to avoid token overflow)
    // Summarize data for the AI (Use smart summary instead of simple slice)
    const dataSummary = charts.map((c, i) => {
      const data = chartData[i] || [];
      const keys = c.dataKeys || [];
      const xAxis = c.xAxisKey || 'date';
      return `[CHART DATA FOR: "${c.title}"]\n${summarizeChartData(data, keys, xAxis)}`;
    }).join('\n\n');

    const kpiSummary = JSON.stringify(kpis);

    const prompt = `
      You are a senior strategic data advisor.
      The user requested: "${originalPrompt}".

      TARGET OUTPUT LANGUAGE (CRITICAL): ${targetLanguageLabel}.
      Return every human-readable field strictly in ${targetLanguageLabel}. Do not mix languages.

      REAL DATA INPUT:
      KPIs: ${kpiSummary}
      Charts and data:
      ${dataSummary}

      ANALYSIS REQUIREMENTS:
      1. dashboard_summary: concise but strategic summary (max 60 words).
      2. strategic_insights: create at least 3-4 insights with:
         - title
         - analysis (40-70 words, causal and business impact)
         - recommendation (mandatory, concrete actions)
         - priority ("Critical" | "High" | "Medium" | "Low")
      3. chart_insights:
         - Return EXACTLY ${charts.length} entries in the same chart order.
         - Each chart insight must only use that chart's own data context.
         - Include:
           * analysis: current status with explicit peak/trough/current value and full-period change.
           * trend: long-term trend vs short-term volatility.
           * cause: 2-4 direct drivers with quantified impact (delta or %).
           * action: 3 prioritized concrete actions.
           * If chart includes spend/cost metric, quantify generated value and efficiency ratio (value per spend/ROAS) when value metric exists.

      OUTPUT JSON FORMAT:
      {
        "dashboard_summary": "string",
        "strategic_insights": [
          {
            "title": "string",
            "analysis": "string",
            "recommendation": "string",
            "priority": "High" | "Medium" | "Low"
          }
        ],
        "chart_insights": [
           {
             "chart_title": "string",
             "analysis": "string",
             "trend": "string",
             "cause": "string",
             "action": "string",
             "highlight": [
               {
                 "index": number,
                 "value": any,
                 "label": "string",
                 "type": "peak" | "drop" | "anomaly" | "insight"
               }
             ]
            }
         ]
      }

      HIGHLIGHT RULE:
      - Provide at least 4-5 highlights per chart when data density allows.
    `;

    let responseText = "{}";

    if (provider === 'OpenAI') {
      responseText = await callOpenAI(modelId, "You are a JSON generator.", prompt, 0.7, signal);
    } else if (provider === 'Anthropic') {
      responseText = await callAnthropic(modelId, "You are a JSON generator. Output valid JSON only.", prompt, 0.7, signal);
    } else {
      if (!apiKey) throw new Error(fallback.googleApiKeyMissing);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelId });

      // Retry logic for 429 errors
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          const response = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
            }
          }, { signal });
          responseText = response.response.text();
          break; // Success
        } catch (e: any) {
          attempts++;
          const is429 = e.message?.includes('429') || e.message?.toLowerCase().includes('resource exhausted');
          if (is429 && attempts < maxAttempts) {
            console.warn(`Gemini 429 detected, retrying (attempt ${attempts})...`);
            await new Promise(resolve => setTimeout(resolve, attempts * 2000)); // Exponential backoff
            continue;
          }
          throw e;
        }
      }
    }

    const result = JSON.parse(cleanJsonResponse(responseText || "{}"));
    return {
      summary: result.dashboard_summary,
      insights: result.strategic_insights || [],
      chartInsights: Array.isArray(result.chart_insights)
        ? result.chart_insights.map((insight: any) => normalizeReportChartInsight(insight, reportLanguage))
        : []
    };
  } catch (e: any) {
    const fallback = getReportFallbackText(normalizeReportLanguage(language));
    console.warn("Failed to regenerate insights", e);
    const errorMsg = e.message || String(e);
    if (errorMsg.toLowerCase().includes('leaked')) {
      return {
        summary: fallback.leakedSummary,
        insights: [],
        chartInsights: []
      };
    }
    if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('resource exhausted')) {
      return {
        summary: fallback.rateLimitSummary,
        insights: [],
        chartInsights: []
      };
    }
    return { summary: "", insights: [], chartInsights: [] };
  }
}

export async function generateReportInsight(
  model: any,
  prompt: string,
  schemaInfo: string,
  tableNames: string[],
  options?: {
    token?: string;
    projectId?: string;
    signal?: AbortSignal;
    semanticEngine?: 'bigquery' | 'postgres';
    executeSql?: (sql: string) => Promise<any[]>;
    semanticContext?: string;
    language?: ReportLanguage;
  }
): Promise<{ dashboard: DashboardConfig, sql: string, executionTime: number }> {
  const reportLanguage = normalizeReportLanguage(options?.language);
  const fallback = getReportFallbackText(reportLanguage);
  const activeModel = model || { id: 'gemini-2.5-flash', provider: 'Google' };
  const provider = activeModel.provider || 'Google';
  const apiKey = getApiKey(provider);
  const startTime = Date.now();

  const semanticGuidance = options?.semanticContext
    ? reportLanguage === 'en'
      ? `\n\nSEMANTIC MODEL CONTEXT (MANDATORY):\n${options.semanticContext}\n- If relationships are defined, JOIN strictly on those paths.\n- Do not invent extra JOIN paths outside semantic model.\n- If no valid relationship path exists, return SQL on the single best-fit table and mention a warning in summary.\n`
      : `\n\nSEMANTIC MODEL CONTEXT (BẮT BUỘC TUÂN THỦ):\n${options.semanticContext}\n- Nếu có quan hệ đã định nghĩa thì chỉ JOIN theo các quan hệ đó.\n- Không tự đoán JOIN ngoài semantic model.\n- Nếu không có đường relationship hợp lệ, trả về SQL trên 1 bảng phù hợp nhất và nêu cảnh báo trong summary.\n`
    : '';

  const systemInstruction = reportLanguage === 'en'
    ? `
    You are "360data Precision BI Architect", a senior analytics strategist.
    BigQuery schema available: ${schemaInfo}.
    ${semanticGuidance}

    CORE REQUIREMENTS:
    1. Never invent tables, columns, or values.
    2. Produce a comprehensive report with 10-12 charts and 4-6 critical KPIs.
    3. Include diverse chart purposes: descriptive, diagnostic (correlation/ratio/variance), and predictive indicators.
    4. Time-series charts must use only: bar, horizontalBar, stackedBar, line, combo. Never pie/donut/radial/area for time-series.
    5. Composition charts should use bar/stackedBar (not pie/donut/radial) for readability.
    6. SQL safety:
       - Use dataset-qualified table names: dataset.table.
       - Never include project prefix (for example: do not use project.dataset.table).
       - Prefer robust SQL that avoids empty joins when uncertain.
       - Use SAFE_DIVIDE for every ratio division.
       - Do not add default LIMIT unless user explicitly asks for top/bottom.
    7. Insights quality:
       - Strategic insights must include cause-effect and business impact.
       - Chart insight must include: analysis, trend, cause, action.
       - Action must be concrete and prioritized.
    8. Keep summary concise (under 50 words) and high-signal.
    9. Spend-to-value rule (mandatory):
       - If a chart contains spend/cost/budget metric, SQL must include at least one value metric (revenue/sales/gmv/new_sales/profit) at the same grain.
       - dataKeys must include both spend metric and value metric (or explicit ROAS via SAFE_DIVIDE).
       - If no value metric exists in schema, state this limitation explicitly in dashboard summary.

    OUTPUT LANGUAGE RULE (CRITICAL):
    - Return all human-readable fields strictly in English.
    - Never mix Vietnamese in title/summary/insights/kpi labels/chart insights/suggestions.

    JSON OUTPUT RULE:
    - Follow response schema exactly.
    - Ensure every chart has executable SQL and meaningful dataKeys/xAxisKey.

    ${(provider !== 'Google') ? `
    Output strict JSON following this structure:
    {
      "sql": "string (SQL query for KPIs)",
      "title": "string",
      "summary": "string",
      "kpis": [
        { "label": "string", "value": "string", "trend": "string", "status": "string", "comparisonContext": "string" }
      ],
      "charts": [
        {
          "type": "bar|line|scatter|combo|horizontalBar|stackedBar|area",
          "title": "string",
          "xAxisKey": "string",
          "dataKeys": ["string"],
          "insight": { "analysis": "string", "trend": "string", "cause": "string", "action": "string", "highlight": [ { "index": number, "value": "string", "label": "string", "type": "peak|drop|anomaly|target|insight" } ] },
          "sql": "string",
          "mockLabels": ["string"]
        }
      ],
      "insights": [
        { "title": "string", "analysis": "string", "recommendation": "string", "priority": "string" }
      ],
      "suggestions": ["string"]
    }
    ` : ''}
  `
    : `
    Bạn là '360data Precision BI Architect' - Chuyên gia tư vấn chiến lược dữ liệu cấp cao.
    Dữ liệu tại BigQuery có các bảng và cột sau: ${schemaInfo}.
    ${semanticGuidance}
    
    YÊU CẦU QUAN TRỌNG VỀ DỮ LIỆU & QUY MÔ:
    1. TUYỆT ĐỐI KHÔNG CHẾ DỮ LIỆU: Chỉ được dùng các bảng và cột thực tế đã liệt kê ở trên.
    2. BÁO CÁO TOÀN DIỆN & SÂU SẮC (10-12 CHARTS): 
       - BẮT BUỘC tạo ít nhất 10-12 biểu đồ đa dạng.
       - PHẢI bao gồm ít nhất 2-3 biểu đồ phân tích TƯƠNG QUAN hoặc TỶ LỆ.
       - Mỗi biểu đồ phải mang lại INSIGHT khác biệt, không trùng lặp.
    
    3. PHÂN LOẠI BIỂU ĐỒ THEO MỤC ĐÍCH PHÂN TÍCH:
    
       **A. DESCRIPTIVE ANALYTICS (Mô tả hiện trạng)**:
       - Time-Series: 'line', 'combo' cho xu hướng theo thời gian
       - Composition: 'bar' (ngang/dọc) hoặc 'stackedBar'. TUYỆT ĐỐI KHÔNG DÙNG PIE/DONUT/RADIAL.
       - Comparison: 'bar' cho so sánh đơn giản
       - Composition & Correlation: 'clustered column chart' cho nó so sánh 2 metrics cùng lúc có time series

       **B. DIAGNOSTIC ANALYTICS (Tìm nguyên nhân) - QUAN TRỌNG**:
       - **Correlation Analysis** (Tương quan):
         * Dùng 'combo' chart để so sánh 2 metrics cùng lúc
         * VD: "Mối quan hệ giữa Chi phí quảng cáo vs Doanh thu"
         * SQL: SELECT date, ad_spend, revenue FROM ... ORDER BY date
       
       - **Ratio/Percentage Analysis** (Phân tích tỷ lệ):
         * Tính toán các chỉ số: ROI, Conversion Rate, Cost per Acquisition, Margin %
         * Dùng 'line' hoặc 'combo' để thể hiện tỷ lệ thay đổi theo thời gian
         * VD: "Tỷ lệ chuyển đổi theo kênh marketing"
         * SQL: SELECT channel, (conversions / clicks * 100) as conversion_rate FROM ...
       
       - **Variance Analysis** (Phân tích chênh lệch):
         * So sánh Actual vs Target/Budget/Previous Period
         * Dùng 'combo' (bar cho actual, line cho target)
         * VD: "Doanh thu thực tế vs Mục tiêu theo tháng"
         * SQL: SELECT month, actual_revenue, target_revenue FROM ...
       
       - **Efficiency Metrics** (Hiệu suất):
         * Cost per Unit, Revenue per Employee, Time to Complete
         * Dùng 'bar' hoặc 'line' tùy context
         * VD: "Chi phí trung bình mỗi đơn hàng theo tháng"
       
       **C. PREDICTIVE INDICATORS (Chỉ báo dự đoán)**:
       - Growth Rate: Tốc độ tăng trưởng MoM, YoY
       - Trend Lines: Xu hướng dài hạn
       - Leading Indicators: Chỉ số dẫn đầu (VD: Traffic → Revenue)
    
    4. QUY TẮC CHỌN BIỂU ĐỒ (LINH HOẠT & THÔNG MINH):
       **Nguyên tắc chung**: Chọn loại chart phù hợp nhất với BẢN CHẤT dữ liệu, không cứng nhắc.
       **QUY TẮC CÂN BẰNG (LAYOUT BALANCE)**: 
       * Số lượng chart phải là CHẴN (10, 12, 14) hoặc chia hết cho 3 để không tạo ra khoảng trống (empty slots) trên giao diện lưới.
       * Tuyệt đối không để lẻ chart (9, 11, 13) trừ khi chart cuối cùng là chart rất quan trọng (full width).
       
       - **TIME-SERIES (Chuỗi thời gian) - LINH HOẠT NHƯNG CÓ NGUYÊN TẮC**: 
         * **ĐƯỢC PHÉP**: 'bar', 'horizontalBar', 'stackedBar', 'line', 'combo'.
         * **TUYỆT ĐỐI CẤM**: 'pie', 'donut', 'radial', 'area'. BỊ CẤM HOÀN TOÀN.
         
         * **KHI NÀO DÙNG GÌ**:
           - **Bar (Clustered Column)**: Tốt cho so sánh rõ ràng từng thời điểm, nhấn mạnh giá trị riêng lẻ
             * Phù hợp: 7-30 data points
             * VD: "Doanh thu 30 ngày gần nhất", "So sánh doanh số theo tháng"
           
           - **Line**: Tốt cho thể hiện xu hướng liên tục, dễ thấy pattern
             * Phù hợp: 15+ data points, cần thấy trend
             * VD: "Xu hướng tăng trưởng 90 ngày", "Biến động giá theo ngày"
           
           - **Stacked Bar**: Tốt cho thể hiện volume/magnitude theo thời gian
             * Phù hợp: Khi cần nhấn mạnh tổng lượng tích lũy
             * VD: "Tổng chi phí tích lũy theo tháng"
         
         * **CÁCH NHẬN BIẾT TIME-SERIES**:
           - SQL có: DATE, DATETIME, TIMESTAMP, date_trunc, FORMAT_DATE
           - SQL có: ORDER BY date, ORDER BY created_at, ORDER BY month
           - Tên cột: date, created_at, updated_at, month, year, day, week
           - Title chứa: "theo ngày", "theo tháng", "30 ngày", "7 ngày", "hàng ngày", "hàng tháng"
         
         * **VÍ DỤ VI PHẠM (CẤM TUYỆT ĐỐI)**:
           ❌ "Chi phí quảng cáo 30 ngày gần nhất" + donut → SAI
           ❌ "Doanh thu theo ngày" + donut → SAI
           ❌ SELECT date, revenue FROM ... + donut → SAI
         
         * **VÍ DỤ ĐÚNG (CẢ 3 ĐỀU OK)**:
           ✅ "Chi phí quảng cáo 30 ngày gần nhất" + bar (so sánh từng ngày)
           ✅ "Chi phí quảng cáo 30 ngày gần nhất" + line (thấy xu hướng)
           ✅ "Chi phí quảng cáo 30 ngày gần nhất" + stackedBar (thấy volume)
       
       - **COMPOSITION (Tỷ trọng/Phần trăm) - CHỈ CHO DỮ LIỆU TĨNH**:
         * **BẮT BUỘC DÙNG** 'bar' (hoặc 'stackedBar'):
           - Dữ liệu KHÔNG có yếu tố thời gian
           - Có 2-5 categories CỐ ĐỊNH: Dùng 'bar' để dễ so sánh độ dài.
           - TUYỆT ĐỐI KHÔNG DÙNG DONUT/PIE/RADIAL vì khó so sánh trực quan.
         * Nếu có 6-8 categories: Dùng 'bar' (horizontal nếu label dài).
         * Nếu trên 8 categories: Chỉ dùng LIMIT khi người dùng yêu cầu xem "Top" hoặc "Bottom" criteria. TUYỆT ĐỐI KHÔNG tự ý dùng LIMIT 12.
         * **VÍ DỤ ĐÚNG**:
           ✅ "Phân bố chi phí theo 3 kênh (Facebook, Google, TikTok)" + bar
           ✅ "Tỷ lệ sản phẩm bán ra (5 loại)" + bar
       
       - **COMPARISON (So sánh)**:
         * Dưới 6 items KHÔNG CÓ THỜI GIAN: Dùng 'bar'.
         * Trên 6 items: Chỉ dùng SQL LIMIT khi người dùng yêu cầu tập trung vào top performers hoặc xem "Top" criteria.
          * Nếu có yếu tố thời gian: Dùng 'bar', 'line'.
       
       - **CORRELATION (Tương quan 2 đại lượng)**:
         * Dùng 'combo' chart (line + bar) để thể hiện mối quan hệ.
         * Hoặc 'line' với 2 dataKeys nếu cùng đơn vị.
       
       - **DISTRIBUTION (Phân bố)**:
          * Dùng 'line' nếu có nhiều data points.
         * Dùng 'bar' nếu ít hơn 10 bins.
       
       **Ví dụ thực tế**:
       - "Top 5 sản phẩm bán chạy" → 'bar' (khuyến nghị)
       - "Phân bố chi phí theo kênh (3 kênh)" → 'bar' (thay vì donut)
       - "Doanh thu 30 ngày qua" → 'line' hoặc 'stackedBar' (BẮT BUỘC)
       - "Chi phí quảng cáo vs Doanh thu theo ngày" → 'combo' (TƯƠNG QUAN)
       - "Tỷ lệ ROI theo campaign" → 'bar' hoặc 'line'
       - "Actual vs Target Revenue" → 'combo' (VARIANCE)
    
    5. KPI DASHBOARD: Phải sinh ra ít nhất 4-6 chỉ số KPI 'Sống còn'.
    6. NGẮN GỌN & CHUYÊN NGHIỆP: Mọi nhận định phải có số liệu SQL chứng minh. Tổng kết (Summary) phải CỰC KỲ NGẮN GỌN (dưới 50 từ), tập trung vào thông điệp quan trọng nhất.

    YÊU CẦU VỀ GIÁ TRỊ QUYẾT ĐỊNH (DECISIVE & DEEP INSIGHTS):
    - Bạn không phải là máy đọc số. Bạn là CEO/Advisor/Data Scientist. 
    - Insights PHẢI CÓ CHIỀU SÂU: Kết nối các dấu chấm giữa các bảng dữ liệu khác nhau. 
    - Hãy dùng ngôn ngữ chuyên gia: "Phát hiện sự lệch pha giữa...", "Tỷ lệ tăng trưởng đang bị kìm hãm bởi...", "Cơ hội tối ưu hóa nằm ở việc tái cấu trúc...".
    - Mọi Strategic Insights phải chỉ ra được MỐI LIÊN HỆ nhân quả (Cause-Effect) và tác động kinh doanh (Business Impact).
    - Chart Insights BẮT BUỘC theo logic 3 lớp:
      1) analysis: "Hiện trạng và xu hướng hiện tại" (phải có số liệu cụ thể: đỉnh/đáy/biến động %).
      2) cause: "Nguyên nhân trực tiếp" (bắt buộc nêu biến số ảnh hưởng trực tiếp và mức tác động định lượng, ví dụ "chi_phi_ads giảm 42% kéo doanh_thu_ads giảm 38%").
      3) action: "Cần thực hiện việc gì" (3 bước rõ ràng, có thứ tự ưu tiên).
    - QUY TẮC CHI PHÍ -> GIÁ TRỊ MANG LẠI (BẮT BUỘC):
      1) Nếu chart có metric chi phí/cost/spend/budget thì SQL phải có thêm ít nhất 1 metric giá trị mang lại (doanh_thu/sales/gmv/new_sales/profit) cùng độ chi tiết.
      2) dataKeys phải chứa cả metric chi phí và metric giá trị (hoặc ROAS tính bằng SAFE_DIVIDE).
      3) Nếu schema không có metric giá trị phù hợp, phải nêu rõ giới hạn này trong summary.

    QUY TẮC SQL & KPI MAPPING:
    1. SQL TỔNG QUAN (root 'sql'): 
       - KHÔNG ĐƯỢC JOIN các bảng lớn với nhau nếu không chắc chắn có dữ liệu khớp (để tránh trả về 0 dòng).
       - NÊN dùng cấu trúc subquery cho từng KPI rồi ghép lại để mỗi KPI độc lập:
         \`SELECT (SELECT SUM(a) FROM t1) as kpi1, (SELECT COUNT(b) FROM t2) as kpi2...\`
       - Alias trùng label (lowercase, underscore).
       - CHỈ DÙNG định danh dạng \`dataset_id.table_id\` (hoặc \`dataset.schema.table\` nếu table có schema con).
       - KHÔNG đưa project-id vào SQL hiển thị.
       - Xử lý Date: Nếu không có yêu cầu ngày cụ thể, hãy lấy dữ liệu mới nhất có sẵn trong bảng thay vì dùng strict CURRENT_DATE() để tránh bảng trống.
       - TOÁN TỬ CHIA: TUYỆT ĐỐI không dùng toán tử '/' để chia. BẮT BUỘC dùng hàm \`SAFE_DIVIDE(numerator, denominator)\` cho tất cả các phép tính tỷ lệ (ROI, Conversion Rate, v.v.) để tránh lỗi 'Division by zero'.
    
    2. SQL TIME-SERIES - CHỌN GRANULARITY THÔNG MINH:
       **Nguyên tắc**: Phân tích TIME GRANULARITY dựa trên câu hỏi của người dùng.
       
       **A. DAILY (Theo ngày)**:
       - Keywords: "hàng ngày", "theo ngày", "7 ngày", "30 ngày", "tuần này", "tháng này"
       - SQL: \`SELECT DATE(created_at) as date, SUM(...) FROM ... GROUP BY 1 ORDER BY 1 ASC\`
       - ORDER BY: date ASC (để hiển thị từ trái qua phải là CWS -> MỚI)
       - LIMIT: KHÔNG DÙNG (Hiển thị tất cả dữ liệu có sẵn). TUYỆT ĐỐI KHÔNG tự ý dùng LIMIT 12.
       - VD: "Doanh thu 30 ngày gần nhất"
       
       **B. WEEKLY (Theo tuần)**:
       - Keywords: "theo tuần", "hàng tuần", "12 tuần", "quý này theo tuần"
       - SQL: \`DATE_TRUNC(created_at, WEEK) as week\` (Dùng pattern Subquery như bước A để lấy mới nhất nhưng hiển thị ASC)
       - ORDER BY: week ASC
       - LIMIT: KHÔNG DÙNG.
       - VD: "Chi phí quảng cáo 12 tuần qua"
       
       **C. MONTHLY (Theo tháng)**:
       - Keywords: "theo tháng", "hàng tháng", "6 tháng", "năm nay", "12 tháng"
       - SQL: \`DATE_TRUNC(created_at, MONTH) as month\`
       - ORDER BY: month ASC
       - LIMIT: KHÔNG DÙNG.
       - VD: "Doanh thu 12 tháng gần nhất"
       
       **D. QUARTERLY (Theo quý)**:
       - Keywords: "theo quý", "hàng quý", "4 quý", "2 năm qua theo quý"
       - SQL: \`...quarter...\`
       - ORDER BY: quarter ASC
       - LIMIT: KHÔNG DÙNG.
       - VD: "Phân tích doanh thu theo quý"
       
       **E. HALF-YEARLY (Theo nửa năm)**:
       - Keywords: "theo nửa năm", "6 tháng đầu năm", "nửa cuối năm", "H1", "H2"
       - SQL: \`...half_year...\`
       - ORDER BY: half_year ASC
       - LIMIT: KHÔNG DÙNG.
       - VD: "So sánh H1 vs H2"
       
       **F. YEARLY (Theo năm)**:
       - Keywords: "theo năm", "hàng năm", "3 năm", "5 năm qua"
       - SQL: \`EXTRACT(YEAR FROM created_at) as year\`
       - ORDER BY: year ASC
       - LIMIT: KHÔNG DÙNG.
       - VD: "Tăng trưởng doanh thu 5 năm qua"
       
       **LƯU Ý QUAN TRỌNG**:
       - KHÔNG DÙNG LIMIT nếu không có yêu cầu "Top/Bottom" từ người dùng.
       - TUYỆT ĐỐI KHÔNG bao giờ kèm theo 'LIMIT 12' mặc định.
       - Đảm bảo xAxisKey khớp with alias trong SQL (date, week, month, quarter, half_year, year)
    
    3. SQL Biểu đồ: Chỉ dùng \`dataset.table\` (không project-id). Phải đảm bảo SQL chạy được và trả về dữ liệu đa dạng.
    
    ĐỊNH DẠNG JSON: Tuân thủ responseSchema. Đảm bảo title và summary mang tính chuyên nghiệp.
    
    QUY TẮC NGÔN NGỮ: Trả về kết quả hoàn toàn bằng TIẾNG VIỆT chuyên nghiệp.

    ${(provider !== 'Google') ? `
    Output strict JSON following this structure:
    {
        "sql": "string (SQL query for KPIs)",
        "title": "string",
        "summary": "string",
        "kpis": [
            { "label": "string", "value": "string", "trend": "string", "status": "string", "comparisonContext": "string" }
        ],
        "charts": [
            {
                "type": "bar|line|scatter|combo|horizontalBar|stackedBar|area",
                "title": "string",
                "xAxisKey": "string",
                "dataKeys": ["string"],
                "insight": { "analysis": "string", "trend": "string", "cause": "string", "action": "string", "highlight": [ { "index": number, "value": "string", "label": "string", "type": "peak|drop|anomaly|target|insight" } ] },
                "sql": "string",
                "mockLabels": ["string"]
            }
        ],
        "insights": [
             { "title": "string", "analysis": "string", "recommendation": "string", "priority": "string" }
        ],
        "suggestions": ["string"]
    }
    ` : ''}
  `;

  try {
    let responseText = "{}";

    if (provider === 'OpenAI') {
      responseText = await callOpenAI(activeModel.id, systemInstruction, prompt, 0.7, options?.signal);
    } else if (provider === 'Anthropic') {
      responseText = await callAnthropic(activeModel.id, systemInstruction, prompt, 0.7, options?.signal);
    } else {
      if (!apiKey) throw new Error(fallback.googleApiKeyMissing);
      const genAI = new GoogleGenerativeAI(apiKey);
      const aiModel = genAI.getGenerativeModel({
        model: activeModel.id,
        systemInstruction: systemInstruction
      });

      // Retry logic for 429 errors
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          const response = await aiModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1,
              responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                  sql: {
                    type: SchemaType.STRING,
                    description: reportLanguage === 'en'
                      ? "SQL to fetch overview KPIs. Prefer subqueries to avoid row loss."
                      : "SQL dùng để lấy các chỉ số KPI tổng quan. Sử dụng Subqueries để tránh mất dòng dữ liệu."
                  },
                  title: { type: SchemaType.STRING },
                  summary: { type: SchemaType.STRING },
                  kpis: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        label: { type: SchemaType.STRING },
                        value: { type: SchemaType.STRING },
                        trend: { type: SchemaType.STRING },
                        status: { type: SchemaType.STRING },
                        comparisonContext: { type: SchemaType.STRING }
                      },
                      required: ["label", "value", "trend", "status", "comparisonContext"]
                    }
                  },
                  charts: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        type: {
                          type: SchemaType.STRING,
                          enum: ["bar", "line", "scatter", "combo", "horizontalBar", "stackedBar", "area"],
                          description: "Allowed: bar, line, scatter, combo, horizontalBar, stackedBar, area"
                        },
                        title: { type: SchemaType.STRING },
                        xAxisKey: { type: SchemaType.STRING },
                        dataKeys: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                        insight: {
                          type: SchemaType.OBJECT,
                          properties: {
                            analysis: { type: SchemaType.STRING },
                            trend: { type: SchemaType.STRING },
                            cause: { type: SchemaType.STRING },
                            action: { type: SchemaType.STRING },
                            highlight: {
                              type: SchemaType.ARRAY,
                              items: {
                                type: SchemaType.OBJECT,
                                properties: {
                                  index: { type: SchemaType.INTEGER },
                                  value: { type: SchemaType.STRING },
                                  label: { type: SchemaType.STRING },
                                  type: { type: SchemaType.STRING }
                                }
                              }
                            }
                          },
                          required: ["analysis", "trend", "cause", "action"]
                        },
                        sql: { type: SchemaType.STRING },
                        mockLabels: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
                      },
                      required: ["type", "title", "dataKeys", "insight", "xAxisKey", "sql", "mockLabels"]
                    }
                  },
                  insights: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        title: { type: SchemaType.STRING },
                        analysis: { type: SchemaType.STRING },
                        recommendation: { type: SchemaType.STRING },
                        priority: { type: SchemaType.STRING }
                      },
                      required: ["title", "analysis", "recommendation"]
                    }
                  },
                  suggestions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
                },
                required: ["sql", "title", "summary", "charts", "kpis", "insights", "suggestions"]
              } as any
            }
          }, { signal: options?.signal });
          if (!response || !response.response) {
            throw new Error(fallback.noAiResponse);
          }
          responseText = response.response.text();
          break; // Success
        } catch (e: any) {
          attempts++;
          const is429 = e.message?.includes('429') || e.message?.toLowerCase().includes('resource exhausted');
          if (is429 && attempts < maxAttempts) {
            console.warn(`Gemini 429 detected in report generation, retrying (attempt ${attempts})...`);
            await new Promise(resolve => setTimeout(resolve, attempts * 2000));
            continue;
          }
          throw e;
        }
      }
    }

    const cleanedText = cleanJsonResponse(responseText);
    const result = JSON.parse(cleanedText);
    result.sql = stripBigQueryProjectPrefixFromSql(String(result.sql || ''));
    result.charts = sanitizeReportCharts(result.charts || [], reportLanguage);

    // 1. Execute Chart Queries
    const chartRawData = await WarehouseService.executeQuery(result.sql || "", tableNames, prompt, result.charts, options);

    // 2. Execute Dashboard-level SQL for KPIs if possible
    let kpiValues = result.kpis || [];
    if (options?.executeSql && result.sql) {
      try {
        const kpiData = await options.executeSql(result.sql);
        if (kpiData && kpiData.length > 0) {
          const firstRow = kpiData[0];
          const normalizeStr = (str: string) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s/g, '_');

          kpiValues = (result.kpis || []).map((k: any) => {
            const normalizedLabel = normalizeStr(k.label);
            const matchingKey = Object.keys(firstRow).find(key => {
              const normalizedKey = normalizeStr(key);
              const cleanKey = normalizedKey.replace(/_/g, '');
              const cleanLabel = normalizedLabel.replace(/_/g, '');
              return normalizedKey === normalizedLabel || cleanKey === cleanLabel ||
                (normalizedKey.length > 2 && normalizedLabel.includes(normalizedKey)) ||
                (normalizedLabel.length > 2 && normalizedKey.includes(normalizedLabel));
            });
            return { ...k, value: matchingKey ? firstRow[matchingKey] : null };
          });

          const columns = Object.values(firstRow);
          kpiValues = kpiValues.map((k: any, idx: number) => {
            if (k.value !== null && k.value !== undefined) return k;
            if (columns[idx] !== undefined) return { ...k, value: columns[idx] };
            return { ...k, value: "0" };
          });
        } else {
          kpiValues = (result.kpis || []).map((k: any) => ({ ...k, value: "0" }));
        }
      } catch (e: any) {
        console.warn("Failed to fetch dashboard KPIs (scoped SQL executor)", e);
        const errorMsg = e.message || "Query Error";
        kpiValues = (result.kpis || []).map((k: any) => ({ ...k, value: errorMsg }));
      }
    } else if (options?.token && options?.projectId && result.sql) {
      try {
        const { runQuery } = await import('./bigquery');
        const kpiData = await runQuery(options.token, options.projectId, result.sql, options.signal);
        if (kpiData && kpiData.length > 0) {
          const firstRow = kpiData[0];
          const normalizeStr = (str: string) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s/g, '_');

          // Strategy 1: Smart Name Matching
          kpiValues = (result.kpis || []).map((k: any) => {
            const normalizedLabel = normalizeStr(k.label);
            const matchingKey = Object.keys(firstRow).find(key => {
              const normalizedKey = normalizeStr(key);
              if (normalizedKey === normalizedLabel) return true;

              // Fuzzy match strategies
              const cleanKey = normalizedKey.replace(/_/g, '');
              const cleanLabel = normalizedLabel.replace(/_/g, '');
              return cleanKey === cleanLabel ||
                (normalizedKey.length > 2 && normalizedLabel.includes(normalizedKey)) ||
                (normalizedLabel.length > 2 && normalizedKey.includes(normalizedLabel));
            });

            return {
              ...k,
              value: matchingKey ? firstRow[matchingKey] : null // Mark as null to retry
            };
          });

          // Strategy 2: Fallback to Positional Mapping for nulls
          const columns = Object.values(firstRow);
          kpiValues = kpiValues.map((k: any, idx: number) => {
            // If we found a value via name match, keep it
            if (k.value !== null && k.value !== undefined) return k;

            // Fallback to positional if available (using index in array)
            if (columns[idx] !== undefined) {
              return { ...k, value: columns[idx] };
            }

            return { ...k, value: options?.token ? "0" : k.value };
          });

        } else if (options?.token) {
          kpiValues = (result.kpis || []).map((k: any) => ({ ...k, value: "0" }));
        }
      } catch (e: any) {
        console.warn("Failed to fetch dashboard KPIs", e);
        if (options?.token) {
          // If BigQuery returns a specific error message, show it instead of generic "Error"
          const errorMsg = e.message || "Query Error";
          kpiValues = (result.kpis || []).map((k: any) => ({ ...k, value: errorMsg }));
        }
      }
    }

    // 3. REGENERATE INSIGHTS WITH REAL DATA
    let finalSummary = result.summary;
    let finalStrategicInsights = result.insights;
    let finalChartInsights = (result.charts || []).map((c: any) => normalizeReportChartInsight(c.insight, reportLanguage));

    const canRegenerateWithRealData = !!options?.executeSql
      || (!!options?.token && !!options?.projectId);

    if (canRegenerateWithRealData) {
      const validChartIndices = chartRawData
        .map((rawData, i) => {
          const sanitizedRows = stripChartErrorRows(rawData);
          return sanitizedRows.length > 0 ? i : -1;
        })
        .filter((i) => i !== -1);
      if (validChartIndices.length > 0) {
        const validCharts = validChartIndices.map(i => result.charts[i]);
        const validData = validChartIndices.map((i) => (
          coerceChartNumericRows(stripChartErrorRows(chartRawData[i]), result.charts?.[i]?.dataKeys || [])
        ));

        const realInsights = await regenerateInsightsWithRealData(
          activeModel.id,
          prompt,
          kpiValues,
          validCharts,
          validData,
          reportLanguage,
          options?.signal
        );

        if (realInsights.summary) finalSummary = realInsights.summary;
        if (realInsights.insights && realInsights.insights.length > 0) {
          finalStrategicInsights = realInsights.insights.map((ins: any) => {
            // If AI returns a string instead of object, create a proper structure
            if (typeof ins === 'string') {
              return {
                title: fallback.strategicInsightTitle,
                analysis: ins,
                recommendation: fallback.strategicRecommendationDefault,
                priority: "Medium"
              };
            }
            // Ensure recommendation is never empty or N/A
            if (!ins.recommendation || ins.recommendation === 'N/A' || ins.recommendation.trim() === '') {
              ins.recommendation = fallback.strategicRecommendationEmpty;
            }
            return ins;
          });
        }

        let insightCounter = 0;
        chartRawData.forEach((_, idx) => {
          if (validChartIndices.includes(idx)) {
            const chart = result.charts[idx];
            // Match insight by title if possible, otherwise use positional mapping
            const aiInsight = realInsights.chartInsights.find((ins: any) => ins.chart_title === chart.title)
              || realInsights.chartInsights[insightCounter];

            if (aiInsight) {
              finalChartInsights[idx] = normalizeReportChartInsight(aiInsight, reportLanguage);
            }
            insightCounter++;
          }
        });
      }
    }

    const finalDashboard: DashboardConfig = {
      title: result.title || fallback.dashboardTitle,
      summary: finalSummary || fallback.dashboardSummary,
      charts: (result.charts || []).map((c: any, idx: number) => {
        const rawChartData = chartRawData[idx];
        const chartErrorMessage = extractChartQueryError(rawChartData);
        const sanitizedChartData = coerceChartNumericRows(
          stripChartErrorRows(rawChartData),
          c?.dataKeys || []
        );
        const fallbackDataKeys = Array.isArray(c?.dataKeys) && c.dataKeys.length > 0
          ? c.dataKeys
          : ['value'];
        const fallbackChartData = WarehouseService.generateFallbackData(prompt, fallbackDataKeys);
        const chartData = sanitizedChartData.length > 0 ? sanitizedChartData : fallbackChartData;
        const resolvedDataKeys = resolveChartDataKeys(chartData, fallbackDataKeys);
        const finalDataKeys = resolvedDataKeys.length > 0 ? resolvedDataKeys : ['value'];
        const normalizedInsight = normalizeReportChartInsight(finalChartInsights[idx] || c.insight, reportLanguage);
        const fallbackInsightText = reportLanguage === 'en'
          ? 'Source SQL for this chart returned no usable rows, so fallback trend data is shown to keep analysis continuity.'
          : 'SQL nguồn của biểu đồ này không trả về dữ liệu hợp lệ, hệ thống đang hiển thị dữ liệu xu hướng thay thế để giữ mạch phân tích.';

        return {
          ...c,
          sql: stripBigQueryProjectPrefixFromSql(String(c.sql || '')),
          dataKeys: finalDataKeys,
          insight: chartErrorMessage
            ? (
              typeof normalizedInsight === 'object' && normalizedInsight
                ? { ...normalizedInsight, analysis: fallbackInsightText }
                : fallbackInsightText
            )
            : normalizedInsight,
          data: chartData,
        };
      }),
      insights: (finalStrategicInsights || []).map((i: any) => typeof i === 'string'
        ? { title: fallback.strategicPointTitle, analysis: i, recommendation: fallback.strategicRecommendationDefault }
        : i),
      kpis: kpiValues,
      suggestions: result.suggestions || []
    };

    return {
      dashboard: finalDashboard,
      sql: result.sql || fallback.sqlTraceUnavailable,
      executionTime: Date.now() - startTime
    };

  } catch (e: any) {
    const errorMsg = e.message || String(e);
    if (errorMsg.toLowerCase().includes('leaked')) {
      throw new Error(fallback.leakedError);
    }
    if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('resource exhausted')) {
      throw new Error(fallback.rateLimitError);
    }
    throw e;
  }
}

export async function analyzeDashboardContent(
  userMessage: string,
  dashboard: BIDashboard,
  history: { role: 'user' | 'assistant', content: string }[] = [],
  options?: { token?: string, projectId?: string }
): Promise<string> {
  // Infer model for analysis or use default
  const geminiKey = getApiKey('Google');
  const openaiKey = getApiKey('OpenAI');
  const anthropicKey = getApiKey('Anthropic');

  let provider = 'Google';
  let modelId = 'gemini-2.5-flash';
  let apiKey = geminiKey;

  // Prefer what's available
  if (geminiKey) {
    provider = 'Google';
    modelId = 'gemini-2.5-flash';
    apiKey = geminiKey;
  } else if (openaiKey) {
    provider = 'OpenAI';
    modelId = 'gpt-5.1';
    apiKey = openaiKey;
  } else if (anthropicKey) {
    provider = 'Anthropic';
    modelId = 'claude-sonnet-4-20250514';
    apiKey = anthropicKey;
  }

  if (!apiKey) return "API Key is missing. Hãy cập nhật Key trong tab AI Setting.";

  const activePage = dashboard.pages.find(p => p.id === dashboard.activePageId);
  const widgets = activePage ? activePage.widgets : (dashboard.widgets || []);

  const widgetContext = widgets.map(w => {
    let context = `- Widget: ${w.title} (Type: ${w.type}${w.chartType ? '/' + w.chartType : ''})\n`;
    if (w.xAxis) context += `  Axis: X=${w.xAxis}, Y=${w.yAxis?.join(', ')}\n`;
    return context;
  }).join('\n');

  const systemInstruction = `
    Bạn là "360data AI Advisor" - Chuyên gia phân tích dữ liệu chuyên nghiệp.
    Nhiệm vụ của bạn là hỗ trợ người dùng giải mã các số liệu TRÊN DASHBOARD.
    2. NÊU TÊN BIỂU ĐỒ: Chỉ rõ Insight đến từ biểu đồ nào.
    3. CHIỀU SÂU: Không chỉ nói 'doanh thu tăng', hãy cố gắng giải thích 'tại sao' dựa trên các chart khác (tương quan giữa traffic và conversion chẳng hạn).
    4. HÀNH ĐỘNG: Luôn kết thúc bằng một vài khuyến nghị thực tế.
    5. NGÔN NGỮ: Trả về bằng ngôn ngữ người dùng hỏi (Việt/Anh).
    6. SQL SAFETY: Nếu người dùng yêu cầu viết hoặc sửa SQL, TUYỆT ĐỐI không dùng toán tử '/' để chia. BẮT BUỘC dùng \`SAFE_DIVIDE(numerator, denominator)\`.
  `;

  try {
    const fullUserMessage = userMessage + (widgetContext ? `\n\n[DASHBOARD DATA CONTEXT]:\n${widgetContext}` : '');

    if (provider === 'OpenAI') {
      return await callOpenAI(modelId, systemInstruction, fullUserMessage);
    } else if (provider === 'Anthropic') {
      return await callAnthropic(modelId, systemInstruction, fullUserMessage);
    } else {
      const genAI = new GoogleGenerativeAI(apiKey);
      const aiModel = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemInstruction
      });

      // Retry logic for 429 errors
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          const response = await aiModel.generateContent({
            contents: [
              ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
              { role: 'user', parts: [{ text: fullUserMessage }] }
            ],
            generationConfig: {
              temperature: 0.2,
            }
          });

          return response.response.text() || "Xin lỗi, tôi không thể phân tích vào lúc này.";
        } catch (e: any) {
          attempts++;
          const is429 = e.message?.includes('429') || e.message?.toLowerCase().includes('resource exhausted');
          if (is429 && attempts < maxAttempts) {
            console.warn(`Gemini 429 detected in analysis, retrying (attempt ${attempts})...`);
            await new Promise(resolve => setTimeout(resolve, attempts * 2000));
            continue;
          }
          throw e;
        }
      }
      return "Xin lỗi, hệ thống đang bận, vui lòng thử lại sau.";
    }
  } catch (e: any) {
    const errorMsg = e.message || String(e);
    if (errorMsg.toLowerCase().includes('leaked')) {
      return "⚠️ THÔNG BÁO QUAN TRỌNG: API Key Gemini của bạn đã bị Google xác định là bị lộ (leaked) và đã bị khóa để bảo mật. \n\nCÁCH KHẮC PHỤC:\n1. Truy cập https://aistudio.google.com/\n2. Tạo một API Key MỚI.\n3. Cập nhật Key mới này vào tab 'AI Settings' trong ứng dụng.\n\nLưu ý: Tuyệt đối không chia sẻ hoặc để lộ Key này trên các kho lưu trữ công khai như GitHub.";
    }
    if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('resource exhausted')) {
      return "⚠️ HỆ THỐNG ĐANG QUÁ TẢI (Rate Limit): Tài khoản AI (Gemini Free) của bạn đã hết lượt gọi trong phút này. Hãy chờ vài giây rồi gửi lại tin nhắn nhé.";
    }
    return `Đã có lỗi xảy ra khi gọi AI Advisor: ${errorMsg || "Vui lòng kiểm tra API Key hoặc kết nối trong tab AI Setting."}`;
  }
}

export async function generateCalculatedFieldFormula(
  input: GenerateCalculatedFieldFormulaInput
): Promise<GenerateCalculatedFieldFormulaResult> {
  const normalizedPrompt = (input.prompt || '').trim();
  if (!normalizedPrompt) {
    throw new Error('Prompt is required. Hãy mô tả công thức bạn cần tạo.');
  }

  const availableFields = Array.isArray(input.availableFields) ? input.availableFields : [];
  if (availableFields.length === 0) {
    throw new Error('No fields available for formula generation.');
  }

  const modelSelection = pickBestFormulaModel(input.modelId, input.provider);
  const fieldCatalog = availableFields
    .map((f) => `- ${f.name} (${f.type})`)
    .join('\n');

  const systemInstruction = `
You are a BI formula copilot.
Return valid JSON only.
You write formulas for this exact expression engine:
- Field reference syntax: [FieldName]
- Supported functions only: IF, AND, OR, NOT, ABS, ROUND, CEILING, FLOOR, MAX, MIN, UPPER, LOWER, CONCAT, LEN
- Operators: + - * / % > < >= <= == != && || !

Rules:
1. Output one single expression in "formula", no markdown, no code fences.
2. Use only fields from the provided list.
3. Do not output SQL, SELECT, GROUP BY, window functions, or table aliases.
4. Keep it concise and executable.
5. If request is ambiguous, choose the safest assumption and mention it in "explanation".
6. Suggest a readable snake_case field name in "suggestedName".
`;

  const userPrompt = `
User request:
${normalizedPrompt}

Current field name (optional):
${input.currentFieldName || '(empty)'}

Available fields:
${fieldCatalog}

Return strictly this JSON shape:
{
  "suggestedName": "string",
  "formula": "string",
  "explanation": "string"
}
`;

  try {
    let responseText = '{}';

    if (modelSelection.provider === 'OpenAI') {
      responseText = await callOpenAI(modelSelection.modelId, systemInstruction, userPrompt, 0.2, input.signal);
    } else if (modelSelection.provider === 'Anthropic') {
      responseText = await callAnthropic(modelSelection.modelId, systemInstruction, userPrompt, 0.2, input.signal);
    } else {
      const apiKey = getApiKey('Google');
      if (!apiKey) throw new Error('Google API Key is missing. Hãy cập nhật Key trong tab AI Setting.');

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelSelection.modelId,
        systemInstruction
      });

      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              suggestedName: { type: SchemaType.STRING },
              formula: { type: SchemaType.STRING },
              explanation: { type: SchemaType.STRING }
            },
            required: ['formula']
          } as any
        }
      }, { signal: input.signal });

      responseText = response.response.text();
    }

    const parsed = JSON.parse(cleanJsonResponse(responseText || '{}'));
    const formula = String(parsed.formula || parsed.expression || '').trim();
    if (!formula) {
      throw new Error('AI did not return a valid formula.');
    }

    const rawName = String(parsed.suggestedName || parsed.fieldName || parsed.name || input.currentFieldName || 'calculated_field')
      .trim();
    const suggestedName = rawName
      .replace(/[^\w\s]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'calculated_field';

    const explanation = String(parsed.explanation || parsed.reasoning || parsed.note || '').trim();

    return {
      suggestedName,
      formula,
      explanation,
      provider: modelSelection.provider,
      modelId: modelSelection.modelId
    };
  } catch (e: any) {
    const errorMsg = e?.message || String(e);
    if (errorMsg.toLowerCase().includes('leaked')) {
      throw new Error('API Key đã bị lộ và bị khóa. Vui lòng tạo key mới trong AI Settings.');
    }
    if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('resource exhausted')) {
      throw new Error('AI đang quá tải (rate limit). Vui lòng thử lại sau vài giây.');
    }
    throw new Error(`Không thể generate công thức: ${errorMsg}`);
  }
}

const normalizeFieldTypeToken = (rawType: any): 'string' | 'number' | 'date' | 'boolean' => {
  const t = String(rawType || '').trim().toLowerCase();
  if (t.includes('num') || t.includes('int') || t.includes('float') || t.includes('double') || t.includes('decimal')) return 'number';
  if (t.includes('date') || t.includes('time')) return 'date';
  if (t.includes('bool')) return 'boolean';
  return 'string';
};

const normalizeVariableKey = (rawKey: any, fallbackIndex: number): string => {
  const cleaned = String(rawKey || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || `var_${fallbackIndex + 1}`;
};

const normalizeSuggestedName = (rawName: any, fallback: string): string => {
  const cleaned = String(rawName || fallback)
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_');
  return cleaned || fallback;
};

const fieldNameMapLower = (fields: FormulaGenerationField[]) => {
  const map = new Map<string, FormulaGenerationField>();
  fields.forEach((field) => {
    map.set(String(field.name || '').trim().toLowerCase(), field);
  });
  return map;
};

const findFieldByNameLoose = (fields: FormulaGenerationField[], fieldName?: string): FormulaGenerationField | null => {
  const token = String(fieldName || '').trim().toLowerCase();
  if (!token) return null;
  const byLower = fieldNameMapLower(fields).get(token);
  if (byLower) return byLower;
  const byContains = fields.find((field) => String(field.name || '').toLowerCase().includes(token));
  return byContains || null;
};

const parseAcceptedTypes = (raw: any): Array<'string' | 'number' | 'date' | 'boolean'> => {
  if (!Array.isArray(raw)) return [];
  const normalized = raw.map((item) => normalizeFieldTypeToken(item));
  return Array.from(new Set(normalized));
};

const pickSuggestedFieldForVariable = ({
  availableFields,
  variable,
}: {
  availableFields: FormulaGenerationField[];
  variable: FormulaRecommendationVariable;
}): string => {
  const acceptedTypes = parseAcceptedTypes(variable.acceptedTypes);
  const suggested = findFieldByNameLoose(availableFields, variable.suggestedField);
  if (suggested) {
    if (acceptedTypes.length === 0) return suggested.name;
    const suggestedType = normalizeFieldTypeToken(suggested.type);
    if (acceptedTypes.includes(suggestedType)) return suggested.name;
  }

  if (acceptedTypes.length > 0) {
    const matchedByType = availableFields.find((field) => acceptedTypes.includes(normalizeFieldTypeToken(field.type)));
    if (matchedByType) return matchedByType.name;
  }

  return availableFields[0]?.name || '';
};

const extractTemplateKeys = (formulaTemplate: string): string[] => {
  const keys = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null = regex.exec(formulaTemplate);
  while (match) {
    keys.add(String(match[1] || '').trim());
    match = regex.exec(formulaTemplate);
  }
  return Array.from(keys);
};

const convertBracketFormulaToTemplate = (
  rawFormula: string
): { formulaTemplate: string; variables: FormulaRecommendationVariable[] } => {
  const fieldToKey = new Map<string, { key: string; fieldName: string }>();
  let index = 0;

  const formulaTemplate = String(rawFormula || '').replace(/\[\s*([^\]]+?)\s*\]/g, (_, fieldRaw) => {
    const fieldName = String(fieldRaw || '').trim();
    const token = fieldName.toLowerCase();
    if (!fieldName) return String(_);

    if (!fieldToKey.has(token)) {
      fieldToKey.set(token, {
        key: `var_${index + 1}`,
        fieldName,
      });
      index += 1;
    }
    const info = fieldToKey.get(token)!;
    return `{{${info.key}}}`;
  });

  const variables = Array.from(fieldToKey.values()).map((item) => ({
    key: item.key,
    label: item.fieldName,
    suggestedField: item.fieldName,
    acceptedTypes: [],
  }));

  return { formulaTemplate, variables };
};

const normalizeRecommendations = (
  rawItems: any[],
  availableFields: FormulaGenerationField[]
): FormulaRecommendation[] => {
  const normalized: FormulaRecommendation[] = [];

  rawItems.forEach((item, idx) => {
    const initialTemplate = String(item?.formulaTemplate || item?.template || item?.formula || '').trim();
    if (!initialTemplate) return;

    let formulaTemplate = initialTemplate;
    let variablesRaw = Array.isArray(item?.variables) ? item.variables : [];

    const templateKeysBefore = extractTemplateKeys(formulaTemplate);
    if (templateKeysBefore.length === 0 && /\[[^\]]+\]/.test(formulaTemplate)) {
      const converted = convertBracketFormulaToTemplate(formulaTemplate);
      formulaTemplate = converted.formulaTemplate;
      if (!variablesRaw.length) variablesRaw = converted.variables;
    }

    const templateKeys = new Set(extractTemplateKeys(formulaTemplate));
    if (templateKeys.size === 0) return;

    const fallbackVariables = Array.from(templateKeys).map((key, keyIndex) => ({
      key,
      label: key.replace(/_/g, ' '),
      suggestedField: '',
      acceptedTypes: [],
      _idx: keyIndex,
    }));

    const candidateVariables = (variablesRaw.length > 0 ? variablesRaw : fallbackVariables)
      .map((variable: any, variableIndex: number) => {
        const key = normalizeVariableKey(variable?.key, variableIndex);
        if (!templateKeys.has(key)) return null;
        return {
          key,
          label: String(variable?.label || key).trim(),
          suggestedField: String(variable?.suggestedField || variable?.field || '').trim(),
          acceptedTypes: parseAcceptedTypes(variable?.acceptedTypes || variable?.types || []),
          _idx: variableIndex,
        };
      })
      .filter(Boolean) as Array<FormulaRecommendationVariable & { _idx: number }>;

    const dedupedVariables: FormulaRecommendationVariable[] = [];
    const seenVarKeys = new Set<string>();
    candidateVariables.forEach((variable) => {
      if (seenVarKeys.has(variable.key)) return;
      seenVarKeys.add(variable.key);
      dedupedVariables.push({
        key: variable.key,
        label: variable.label || variable.key,
        suggestedField: pickSuggestedFieldForVariable({
          availableFields,
          variable,
        }),
        acceptedTypes: variable.acceptedTypes,
      });
    });

    if (dedupedVariables.length === 0) return;

    const fallbackName = `calculated_field_${idx + 1}`;
    normalized.push({
      id: `ai-rec-${Date.now()}-${idx}`,
      title: String(item?.title || item?.name || `Recommendation ${idx + 1}`).trim(),
      description: String(item?.description || item?.explanation || 'Suggested formula based on your current fields.').trim(),
      suggestedName: normalizeSuggestedName(item?.suggestedName || item?.fieldName, fallbackName),
      formulaTemplate,
      variables: dedupedVariables,
    });
  });

  return normalized.slice(0, 5);
};

const buildFallbackFormulaRecommendations = (
  availableFields: FormulaGenerationField[]
): FormulaRecommendation[] => {
  const numericFields = availableFields.filter((field) => normalizeFieldTypeToken(field.type) === 'number');
  const stringFields = availableFields.filter((field) => normalizeFieldTypeToken(field.type) === 'string');

  const suggestions: FormulaRecommendation[] = [];

  if (numericFields.length >= 2) {
    suggestions.push({
      id: 'fallback-margin',
      title: 'Quick margin estimate',
      description: 'Subtract cost-like metric from revenue-like metric, then keep null-safe behavior.',
      suggestedName: 'margin_value',
      formulaTemplate: 'IF({{base_value}} != null, {{base_value}} - {{compare_value}}, 0)',
      variables: [
        { key: 'base_value', label: 'Base value', suggestedField: numericFields[0].name, acceptedTypes: ['number'] },
        { key: 'compare_value', label: 'Compare value', suggestedField: numericFields[1].name, acceptedTypes: ['number'] },
      ],
    });

    suggestions.push({
      id: 'fallback-ratio',
      title: 'Ratio with safe denominator',
      description: 'Create a percentage or ratio metric with divide-by-zero protection.',
      suggestedName: 'ratio_percent',
      formulaTemplate: 'IF({{denominator}} > 0, ROUND(({{numerator}} / {{denominator}}) * 100, 2), 0)',
      variables: [
        { key: 'numerator', label: 'Numerator', suggestedField: numericFields[0].name, acceptedTypes: ['number'] },
        { key: 'denominator', label: 'Denominator', suggestedField: numericFields[1].name, acceptedTypes: ['number'] },
      ],
    });
  }

  if (stringFields.length > 0) {
    suggestions.push({
      id: 'fallback-text-normalized',
      title: 'Standardize text value',
      description: 'Normalize text to uppercase to reduce duplicate labels caused by casing.',
      suggestedName: 'normalized_text',
      formulaTemplate: 'UPPER({{text_field}})',
      variables: [
        { key: 'text_field', label: 'Text field', suggestedField: stringFields[0].name, acceptedTypes: ['string'] },
      ],
    });
  }

  if (numericFields.length > 0) {
    suggestions.push({
      id: 'fallback-numeric-bucket',
      title: 'Positive/negative flag',
      description: 'Mark whether a metric is positive for quick filtering in charts.',
      suggestedName: 'positive_flag',
      formulaTemplate: 'IF({{metric}} > 0, 1, 0)',
      variables: [
        { key: 'metric', label: 'Metric', suggestedField: numericFields[0].name, acceptedTypes: ['number'] },
      ],
    });
  }

  if (suggestions.length === 0 && availableFields.length > 0) {
    suggestions.push({
      id: 'fallback-identity',
      title: 'Quick copy field',
      description: 'Start from one existing field and customize the formula from there.',
      suggestedName: 'new_calculated_field',
      formulaTemplate: '{{source_field}}',
      variables: [
        { key: 'source_field', label: 'Source field', suggestedField: availableFields[0].name, acceptedTypes: [] },
      ],
    });
  }

  return suggestions.slice(0, 4);
};

export async function generateCalculatedFieldRecommendations(
  input: GenerateCalculatedFieldRecommendationsInput
): Promise<{
  recommendations: FormulaRecommendation[];
  provider: AIProvider;
  modelId: string;
}> {
  const availableFields = Array.isArray(input.availableFields) ? input.availableFields : [];
  if (availableFields.length === 0) {
    throw new Error('No fields available for recommendations.');
  }

  let modelSelection: { provider: AIProvider; modelId: string };
  try {
    modelSelection = pickBestFormulaModel(input.modelId, input.provider);
  } catch (_e) {
    return {
      recommendations: buildFallbackFormulaRecommendations(availableFields),
      provider: 'Google',
      modelId: 'fallback-local',
    };
  }
  const fieldCatalog = availableFields
    .map((field) => `- ${field.name} (${normalizeFieldTypeToken(field.type)})`)
    .join('\n');
  const sampleRows = (Array.isArray(input.sampleRows) ? input.sampleRows : []).slice(0, 8);
  const samplePreview = sampleRows.length > 0 ? JSON.stringify(sampleRows, null, 2) : 'No sample rows available';
  const contextHint = String(input.contextHint || '').trim();

  const systemInstruction = `
You are a BI formula recommendation assistant.
Return valid JSON only.
You write formulas for this exact expression engine:
- Field reference syntax: [FieldName]
- Supported functions only: IF, AND, OR, NOT, ABS, ROUND, CEILING, FLOOR, MAX, MIN, UPPER, LOWER, CONCAT, LEN
- Operators: + - * / % > < >= <= == != && || !

Rules:
1. Return 3 to 5 recommendations tailored to available fields.
2. Use human-friendly language in title and description.
3. Use formulaTemplate with placeholders like {{variable_key}} (NOT direct [FieldName] if possible).
4. Each variable must include: key, label, suggestedField, acceptedTypes.
5. Suggested fields must come from provided fields list.
6. Avoid meaningless relationships like name-name between unrelated metrics.
7. Keep formulas executable and concise.
`;

  const userPrompt = `
Context hint from user (optional):
${contextHint || '(none)'}

Available fields:
${fieldCatalog}

Sample rows (optional):
${samplePreview}

Return strictly:
{
  "recommendations": [
    {
      "title": "string",
      "description": "string",
      "suggestedName": "string_snake_case",
      "formulaTemplate": "string with {{variables}}",
      "variables": [
        {
          "key": "string",
          "label": "string",
          "suggestedField": "string",
          "acceptedTypes": ["number" | "string" | "date" | "boolean"]
        }
      ]
    }
  ]
}
`;

  try {
    let responseText = '{}';

    if (modelSelection.provider === 'OpenAI') {
      responseText = await callOpenAI(modelSelection.modelId, systemInstruction, userPrompt, 0.2, input.signal);
    } else if (modelSelection.provider === 'Anthropic') {
      responseText = await callAnthropic(modelSelection.modelId, systemInstruction, userPrompt, 0.2, input.signal);
    } else {
      const apiKey = getApiKey('Google');
      if (!apiKey) throw new Error('Google API Key is missing. Hãy cập nhật Key trong tab AI Setting.');

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelSelection.modelId,
        systemInstruction
      });

      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              recommendations: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    title: { type: SchemaType.STRING },
                    description: { type: SchemaType.STRING },
                    suggestedName: { type: SchemaType.STRING },
                    formulaTemplate: { type: SchemaType.STRING },
                    variables: {
                      type: SchemaType.ARRAY,
                      items: {
                        type: SchemaType.OBJECT,
                        properties: {
                          key: { type: SchemaType.STRING },
                          label: { type: SchemaType.STRING },
                          suggestedField: { type: SchemaType.STRING },
                          acceptedTypes: {
                            type: SchemaType.ARRAY,
                            items: { type: SchemaType.STRING }
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          } as any
        }
      }, { signal: input.signal });

      responseText = response.response.text();
    }

    const parsed = JSON.parse(cleanJsonResponse(responseText || '{}'));
    const rawRecommendations = Array.isArray(parsed?.recommendations)
      ? parsed.recommendations
      : (Array.isArray(parsed?.items) ? parsed.items : []);
    const recommendations = normalizeRecommendations(rawRecommendations, availableFields);

    return {
      recommendations: recommendations.length > 0
        ? recommendations
        : buildFallbackFormulaRecommendations(availableFields),
      provider: modelSelection.provider,
      modelId: modelSelection.modelId,
    };
  } catch (e: any) {
    console.warn('AI recommendation fallback activated:', e?.message || e);
    return {
      recommendations: buildFallbackFormulaRecommendations(availableFields),
      provider: modelSelection.provider,
      modelId: modelSelection.modelId,
    };
  }
}

export async function testApiKey(provider: string, key: string): Promise<{ success: boolean, message: string }> {
  if (!key) return { success: false, message: "API Key không được để trống." };

  try {
    if (provider === 'Google') {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      await model.generateContent("Hi");
      return { success: true, message: "Kết nối Google Gemini thành công!" };
    } else if (provider === 'OpenAI') {
      const preferredModel = (() => {
        const candidate = localStorage.getItem('preferred_ai_model') || 'gpt-5-mini';
        if (candidate.startsWith('gpt') || candidate.startsWith('o1')) return candidate;
        return 'gpt-5-mini';
      })();

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`
        },
        body: JSON.stringify({
          model: preferredModel,
          messages: [{ role: "user", content: "ping" }],
          max_completion_tokens: 8
        })
      });
      const data = await response.json();
      if (!response.ok || data?.error) {
        const rawMessage = data?.error?.message || `HTTP ${response.status}`;
        const lower = `${rawMessage} ${data?.error?.code || ''} ${data?.error?.type || ''}`.toLowerCase();

        if (
          lower.includes('insufficient_quota') ||
          lower.includes('exceeded your current quota') ||
          lower.includes('billing_hard_limit_reached')
        ) {
          throw new Error("OpenAI key hợp lệ nhưng tài khoản API đã hết quota/credit. ChatGPT Plus/Pro không bao gồm API credit.");
        }
        if (
          lower.includes('model_not_found') ||
          lower.includes('does not exist') ||
          lower.includes('do not have access')
        ) {
          throw new Error(`Không có quyền truy cập model "${preferredModel}". Hãy chọn model khác hoặc kiểm tra quyền trong OpenAI dashboard.`);
        }
        throw new Error(rawMessage);
      }

      return { success: true, message: `Kết nối OpenAI (${preferredModel}) thành công!` };
    } else if (provider === 'Anthropic') {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        }
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return { success: true, message: "Kết nối Anthropic thành công!" };
    }
    return { success: false, message: "Provider không hợp lệ." };
  } catch (e: any) {
    console.error(`Test ${provider} Key failed:`, e);
    let msg = e.message || String(e);
    if (msg.toLowerCase().includes('leaked')) {
      msg = "⚠️ API Key đã bị lộ (leaked) và bị Google/nhà cung cấp khóa. Hãy tạo Key mới.";
    }
    return { success: false, message: `Lỗi: ${msg}` };
  }
}

export async function analyzeChartTrend(
  title: string,
  xAxis: string,
  data: any[],
  dataKeys: string[],
  chartContext: string,
  options?: {
    provider?: string;
    modelId?: string;
    signal?: AbortSignal;
    language?: ReportLanguage;
    outputLanguage?: ChartAnalysisOutputLanguage | string;
  }
): Promise<string> {
  const activeModel = {
    id: options?.modelId || 'gemini-2.5-flash',
    provider: options?.provider || 'Google'
  };
  const uiLanguage = normalizeReportLanguage(options?.language);
  const outputLanguage = normalizeChartAnalysisOutputLanguage(options?.outputLanguage, uiLanguage);
  const outputLanguageMeta = chartAnalysisLanguageMeta[outputLanguage];
  const isEnglishUi = uiLanguage === 'en';
  const targetLanguageLabel = outputLanguageMeta.targetLabel;
  const fallback = getReportFallbackText(uiLanguage);
  const finalTitle = String(title || '').trim() || (isEnglishUi ? 'Chart' : 'Biểu đồ');
  const expectedHighlightTitle = outputLanguageMeta.highlightTitle;
  const expectedSummaryTitle = outputLanguageMeta.summaryTitle;

  if (!options?.provider && typeof localStorage !== 'undefined') {
    // Legacy fallback: if no provider specified, check if OpenAI is available
    if (localStorage.getItem('openai_api_key')) activeModel.provider = 'OpenAI';
  }

  const prompt = `
    You are a Senior Data Scientist and Strategic Advisor.
    TARGET OUTPUT LANGUAGE (CRITICAL): ${targetLanguageLabel}.
    Return all narrative text strictly in ${targetLanguageLabel}. Do not mix languages.
    
    TASK: Deeply analyze chart "${finalTitle}" and produce actionable insights.

    DATA SNAPSHOT:
    ${summarizeChartData(data, dataKeys, xAxis)}

    CHART STRUCTURE:
    - X axis: ${xAxis}
    - Y metrics: ${dataKeys.join(', ')}
    - Context: ${chartContext}

    ANALYSIS REQUIREMENTS (markdown output):
    1. Executive Summary (1-2 sentences): dominant trend + overall % change when available.
    2. Deep Dive & Causal Analysis:
       - Explain WHY, not just "A > B".
       - Describe correlation between metrics (same direction vs inverse).
       - Mention seasonality/cycles if detected.
       - Quantify direct drivers using corr/delta/% where possible.
       - If data has spend/cost metric and value metric, quantify return efficiency (value/spend or ROAS).
    3. Critical Points:
       - Identify peak, trough, inflection points, and suspicious outliers.
       - Include a dedicated section titled "${expectedHighlightTitle}" with 4-6 bullets, each bullet starts with "🔥".
    4. Strategic Recommendations:
       - Provide 3 concrete actions with priorities (High/Medium/Low).
    5. Final Summary Table (mandatory at the end):
       - End with title "${expectedSummaryTitle}".
       - Output a markdown table that includes ALL dataKeys.

    WRITING RULES:
    - Tone: professional, objective, concise.
    - No vague statements.
    - Flag data quality risk when values suddenly collapse.
    - Base conclusions on provided data only.
  `;

  const finalizeAnalysis = (rawText: string): string => {
    const aiText = String(rawText || '').trim();
    const appendixLanguage: ReportLanguage | null = outputLanguage === 'en'
      ? 'en'
      : (outputLanguage === 'vi' ? 'vi' : null);
    const appendix = appendixLanguage
      ? buildDeterministicAnalysisAppendix(data, xAxis, dataKeys, appendixLanguage)
      : '';
    if (!appendix) return aiText;
    return `${aiText}\n\n${appendix}`.trim();
  };

  try {
    if (activeModel.provider === 'OpenAI') {
      const responseText = await callOpenAI(activeModel.id || 'gpt-5.1', "You are a helpful Data Analyst.", prompt, 0.7, options?.signal);
      return finalizeAnalysis(responseText);
    } else if (activeModel.provider === 'Anthropic') {
      const responseText = await callAnthropic(activeModel.id || 'claude-sonnet-4-20250514', "You are a helpful Data Analyst.", prompt, 0.7, options?.signal);
      return finalizeAnalysis(responseText);
    } else {
      const apiKey = getApiKey('Google');
      if (!apiKey) throw new Error(fallback.googleApiKeyMissing);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: activeModel.id || 'gemini-2.5-flash' });

      // Retry logic for 429 errors
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          const result = await model.generateContent(prompt);
          return finalizeAnalysis(result.response.text());
        } catch (e: any) {
          attempts++;
          const is429 = e.message?.includes('429') || e.message?.toLowerCase().includes('resource exhausted');
          if (is429 && attempts < maxAttempts) {
            console.warn(`Gemini 429 detected in analysis, retrying (attempt ${attempts})...`);
            await new Promise(resolve => setTimeout(resolve, attempts * 2000));
            continue;
          }
          throw e;
        }
      }
      return isEnglishUi
        ? "Sorry, the system is currently busy. Please try again shortly."
        : "Xin lỗi, hệ thống đang bận, vui lòng thử lại sau.";
    }
  } catch (e: any) {
    console.error("AI Analysis failed:", e);
    const errorMsg = e.message || String(e);
    if (errorMsg.toLowerCase().includes('leaked')) {
      throw new Error(isEnglishUi
        ? "⚠️ SECURITY ERROR: Your API key was flagged as leaked and blocked. Please create a new key."
        : "⚠️ LỖI BẢO MẬT: API Key của bạn đã bị lộ (leaked) và bị khóa. Vui lòng tạo Key mới.");
    }
    if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('resource exhausted')) {
      throw new Error(isEnglishUi
        ? "⚠️ RATE LIMIT: Your AI account has reached request limits. Please wait a few seconds and retry."
        : "⚠️ HỆ THỐNG ĐANG QUÁ TẢI (Rate Limit): Tài khoản AI của bạn đã hết lượt gọi. Vui lòng chờ vài giây.");
    }
    throw new Error(isEnglishUi
      ? `Sorry, the analysis failed: ${errorMsg}. Please check your API key or network connection.`
      : `Xin lỗi, không thể phân tích: ${errorMsg}. Vui lòng kiểm tra lại API Key hoặc kết nối mạng.`);
  }
}
