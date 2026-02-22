
import React from 'react';
import { SyncedTable } from './types';

// Generate Time Series Sales Data (Last 180 days)
const generateSalesTrend = () => {
  const data = [];
  const now = new Date();
  for (let i = 180; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const baseValue = 500 + Math.sin(i / 10) * 200 + (180 - i) * 2; // Trend + Seasonality
    data.push({
      date: dateStr,
      revenue: Math.floor(baseValue + Math.random() * 100),
      orders: Math.floor(baseValue / 50 + Math.random() * 5),
      growth: Math.random() * 0.15,
      category: i % 3 === 0 ? 'Electronics' : i % 3 === 1 ? 'Accessories' : 'Services'
    });
  }
  return data;
};

// Generate Monthly Performance Data
const generateMonthlyKPIs = () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months.map((m, i) => ({
    month: m,
    revenue: 15000 + i * 2000 + Math.random() * 5000,
    target: 18000 + i * 1800,
    active_users: 1200 + i * 150,
    churn_rate: 0.05 - (i * 0.002)
  }));
};

export const MOCK_SALES_SMALL = [
  { order_id: 'S-01', product: 'Coffee', qty: 2, total: 10, date: '2023-12-01' },
  { order_id: 'S-02', product: 'Tea', qty: 1, total: 4, date: '2023-12-01' },
  { order_id: 'S-03', product: 'Cake', qty: 1, total: 15, date: '2023-12-02' },
  { order_id: 'S-04', product: 'Coffee', qty: 3, total: 15, date: '2023-12-02' },
  { order_id: 'S-05', product: 'Cookie', qty: 5, total: 10, date: '2023-12-03' }
];

export const MOCK_DATA_MAP: Record<string, any[]> = {
  'test_sales': MOCK_SALES_SMALL,
  'sales_ops': generateSalesTrend(),
  'monthly_performance': generateMonthlyKPIs(),
  'order_line': Array.from({ length: 50 }).map((_, i) => ({
    order_id: `ORD-100${i}`,
    product_name: ['iPhone 15', 'MacBook M3', 'AirPods Pro', 'iPad Air'][i % 4],
    category: 'Electronics',
    quantity: Math.floor(Math.random() * 3) + 1,
    price: [1000, 2000, 250, 600][i % 4],
    order_date: new Date(Date.now() - (i * 86400000)).toISOString().split('T')[0]
  })),
  'marketing_bi': Array.from({ length: 30 }).map((_, i) => ({
    date: new Date(Date.now() - (i * 86400000)).toISOString().split('T')[0],
    spend: 200 + Math.random() * 150,
    conversions: 10 + Math.random() * 20,
    roas: 3.5 + Math.random() * 2
  })),
  'warehouse_v2': Array.from({ length: 20 }).map((_, i) => ({
    sku: `SKU-${1000 + i}`,
    stock_on_hand: Math.floor(Math.random() * 500),
    reorder_point: 50,
    unit_cost: 50 + Math.random() * 100
  }))
};

export const INITIAL_TABLES: SyncedTable[] = [];

export const DISCOVERABLE_TABLES = [
  { name: 'sales_ops', dataset: 'enterprise_bi', rows: 4500000, schema: ['date', 'revenue', 'orders', 'growth', 'category'] },
  { name: 'monthly_performance', dataset: 'finance_ops', rows: 24, schema: ['month', 'revenue', 'target', 'active_users', 'churn_rate'] },
  { name: 'order_line', dataset: 'sales_ops', rows: 1250000, schema: ['order_id', 'product_name', 'category', 'quantity', 'price', 'order_date'] },
  { name: 'marketing_bi', dataset: 'advertising', rows: 85000, schema: ['date', 'spend', 'conversions', 'roas'] },
  { name: 'warehouse_v2', dataset: 'logistics', rows: 12000, schema: ['sku', 'stock_on_hand', 'reorder_point', 'unit_cost'] }
];

export const AI_MODELS = [
  { id: 'gemini-2.5-flash', provider: 'Google', name: 'Gemini 2.5 Flash', label: 'Ultra Fast', description: 'Model tốc độ cao thế hệ mới, cân bằng tốt giữa độ chính xác và chi phí.', icon: 'fa-solid fa-bolt-lightning', brandIcon: 'fa-brands fa-google text-blue-400', isFree: true },
  { id: 'gemini-2.5-pro', provider: 'Google', name: 'Gemini 2.5 Pro', label: 'Complex Analysis', description: 'Model suy luận nâng cao cho các tác vụ phân tích dữ liệu và chiến lược phức tạp.', icon: 'fa-solid fa-network-wired', brandIcon: 'fa-brands fa-google text-blue-400', isFree: false },
  { id: 'gpt-5.1', provider: 'OpenAI', name: 'GPT-5.1', label: 'Most Advanced', description: 'Model flagship mới của OpenAI cho phân tích, lập luận và tạo nội dung chất lượng cao.', icon: 'fa-solid fa-wand-magic-sparkles', brandIcon: 'fa-solid fa-brain text-emerald-500', isFree: false },
  { id: 'gpt-5-mini', provider: 'OpenAI', name: 'GPT-5 mini', label: 'Fast & Efficient', description: 'Phiên bản tối ưu chi phí của GPT-5, phù hợp cho tác vụ rõ ràng cần tốc độ.', icon: 'fa-solid fa-bolt', brandIcon: 'fa-solid fa-brain text-emerald-500', isFree: false },
  { id: 'claude-sonnet-4-20250514', provider: 'Anthropic', name: 'Claude Sonnet 4', label: 'Smartest Claude', description: 'Model cân bằng hiệu năng cao của Anthropic cho phân tích và coding thực chiến.', icon: 'fa-solid fa-microchip', brandIcon: 'fas fa-robot text-amber-500', isFree: false },
  { id: 'claude-opus-4-1-20250805', provider: 'Anthropic', name: 'Claude Opus 4.1', label: 'Deep Reasoning', description: 'Model mạnh nhất của dòng Claude, phù hợp cho bài toán suy luận đa bước phức tạp.', icon: 'fa-solid fa-scroll', brandIcon: 'fas fa-robot text-amber-500', isFree: false }
];

export const WAREHOUSE_OPTIONS = [
  { id: 'BigQuery', name: 'Google BigQuery', icon: <i className="fab fa-google text-blue-500 mr-2"></i> },
  { id: 'Snowflake', name: 'Snowflake', icon: <i className="fas fa-snowflake text-blue-400 mr-2"></i> },
  { id: 'PostgreSQL', name: 'PostgreSQL', icon: <i className="fas fa-database text-indigo-500 mr-2"></i> },
  { id: 'Excel', name: 'Excel File', icon: <i className="fas fa-file-excel text-green-600 mr-2"></i> },
  { id: 'GoogleSheets', name: 'Google Sheets', icon: <i className="fas fa-file-csv text-green-500 mr-2"></i> }
];
