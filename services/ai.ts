import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { DashboardConfig } from "../types";
import { WarehouseService } from "./warehouse";
import { BIDashboard } from "../components/bi/types";

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

// Helper to get API keys from local storage or env
const getApiKey = (provider: string) => {
  let key = "";
  if (provider === 'OpenAI') key = localStorage.getItem('openai_api_key') || process.env.OPENAI_API_KEY || '';
  else if (provider === 'Anthropic') key = localStorage.getItem('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
  else if (provider === 'Google') key = localStorage.getItem('gemini_api_key') || process.env.GEMINI_API_KEY || process.env.API_KEY || "";

  return key.trim();
};

type AIProvider = 'Google' | 'OpenAI' | 'Anthropic';

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

async function regenerateInsightsWithRealData(
  modelId: string,
  originalPrompt: string,
  kpis: any[],
  charts: any[],
  chartData: any[][],
  signal?: AbortSignal
): Promise<{ summary: string, insights: any[], chartInsights: any[] }> {
  try {
    // Basic detection of provider based on model ID prefix
    let provider = 'Google';
    if (modelId.startsWith('gpt') || modelId.startsWith('o1')) provider = 'OpenAI';
    else if (modelId.startsWith('claude')) provider = 'Anthropic';

    const apiKey = getApiKey(provider);

    // Summarize data for the AI (limit size to avoid token overflow)
    const dataSummary = charts.map((c, i) => {
      const data = chartData[i] || [];
      const slice = data.slice(0, 15); // Increased to 15 for better context
      return `[CHART DATA FOR: "${c.title}"]\n${JSON.stringify(slice)}`;
    }).join('\n\n');

    const kpiSummary = JSON.stringify(kpis);

    const prompt = `
      Bạn là chuyên gia tư vấn chiến lược cấp cao (Strategic Advisor).
      Khách hàng đã yêu cầu: "${originalPrompt}".
      
      Dữ liệu THỰC TẾ từ Data Warehouse:
      KPIs: ${kpiSummary}
      
      Danh sách Biểu đồ và Dữ liệu:
      ${dataSummary}
      
      YÊU CẦU PHÂN TÍCH (QUAN TRỌNG - TUYỆT ĐỐI TUÂN THỦ):
      1. Dashboard Summary: Tổng hợp tình hình cốt lõi cực kỳ súc tích nhưng đầy đủ chiều sâu chiến lược (dưới 60 chữ).
      2. Strategic Insights (NHẬN ĐỊNH CẤP CAO): Tạo ra ít nhất 3-4 nhận định đa chiều. Mỗi nhận định PHẢI bao gồm:
         - title: Tiêu đề thu hút, phản ánh bản chất vấn đề (Vd: "Khủng hoảng chi phí", "Cơ hội chiếm lĩnh thị trường").
         - analysis: Phân tích sâu sắc (40-70 từ). Kết nối các chỉ số KPI với nhau (Vd: "Mặc dù chi phí tăng 20%, nhưng Lợi nhuận gộp giảm 5%, cho thấy hiệu suất vận hành đang đi xuống").
         - recommendation: CHIẾN LƯỢC HÀNH ĐỘNG (BẮT BUỘC).
           * Phải là giải pháp giải quyết tận gốc vấn đề (Root Cause Analysis).
           * Có các bước thực thi 1-2-3 nếu cần.
         - priority: "Critical", "High", "Medium", hoặc "Low"
      3. Chart Insights (PHÂN TÍCH CHUYÊN SÂU):
         - PHẢI tạo ra CHÍNH XÁC ${charts.length} phân tích, tương ứng với ${charts.length} biểu đồ đã liệt kê ở trên.
         - THỨ TỰ: Phải trả về mảng chart_insights theo đúng thứ tự của các biểu đồ trong danh sách trên.
         - NGUYÊN TẮC CONTEXT (KIỂM TRA CHÉO):
           * Phân tích của biểu đồ nào CHỈ ĐƯỢC dùng số liệu của biểu đồ đó.
           * TUYỆT ĐỐI không nhắc đến dữ liệu của biểu đồ A trong phần phân tích của biểu đồ B.
         - analysis: PHÂN TÍCH CHI TIẾT. Không chỉ nêu con số, hãy giải thích ý nghĩa kinh tế/vận hành đằng sau sự thay đổi. 
           * Tìm kiếm các điểm xoay chiều (inflection points).
           * So sánh các giai đoạn (đầu kỳ vs cuối kỳ).
           * Đánh giá mức độ ổn định của dữ liệu.
         - trend: Phân tích xu hướng dài hạn (Long-term trend) vs biến động ngắn hạn (Short-term volatility).
         - action: Đề xuất hành động chiến thuật CỤ THỂ và định lượng (BÁT BUỘC).
      
      Output JSON format:
      {
        "dashboard_summary": "string",
        "strategic_insights": [
          {
            "title": "string",
            "analysis": "string",
            "recommendation": "string (BẮT BUỘC - Hành động cụ thể, không được N/A)",
            "priority": "High" | "Medium" | "Low"
          }
        ],
        "chart_insights": [
           {
             "chart_title": "string (Tên biểu đồ đang phân tích - Bắt buộc đúng)",
             "analysis": "string",
             "trend": "string",
             "action": "string (BẮT BUỘC - Hành động cụ thể)",
             "highlight": [
               {
                 "index": number (index of data point),
                 "value": any,
                 "label": "short label (e.g. Peak, Drop)",
                 "type": "peak" | "drop" | "anomaly" | "insight"
               }
             ]
            }
         ]
      }
      
      LƯU Ý VỀ HIGHLIGHT: PHẢI CÓ ÍT NHẤT 4-5 HIGHLIGHTS CHO MỖI BIỂU ĐỒ NẾU DỮ LIỆU ĐỦ.
    `;

    let responseText = "{}";

    if (provider === 'OpenAI') {
      responseText = await callOpenAI(modelId, "You are a JSON generator.", prompt, 0.7, signal);
    } else if (provider === 'Anthropic') {
      responseText = await callAnthropic(modelId, "You are a JSON generator. Output valid JSON only.", prompt, 0.7, signal);
    } else {
      if (!apiKey) throw new Error("Google API Key is missing. Hãy cập nhật Key trong tab AI Setting.");
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
      chartInsights: result.chart_insights || []
    };
  } catch (e: any) {
    console.warn("Failed to regenerate insights", e);
    const errorMsg = e.message || String(e);
    if (errorMsg.toLowerCase().includes('leaked')) {
      return {
        summary: "⚠️ LỖI BẢO MẬT: API Key Gemini của bạn đã bị Google xác định là bị lộ (leaked) và đã bị khóa. Hãy tạo Key mới tại Google AI Studio và cập nhật trong tab AI Setting.",
        insights: [],
        chartInsights: []
      };
    }
    if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('resource exhausted')) {
      return {
        summary: "⚠️ HỆ THỐNG ĐANG QUÁ TẢI (Rate Limit): Tài khoản AI (Gemini Free) của bạn đã hết lượt gọi trong phút này. Hãy chờ 30-60 giây rồi thử lại, hoặc nâng cấp lên gói trả phí (Pay-as-you-go).",
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
  }
): Promise<{ dashboard: DashboardConfig, sql: string, executionTime: number }> {
  const activeModel = model || { id: 'gemini-2.5-flash', provider: 'Google' };
  const provider = activeModel.provider || 'Google';
  const apiKey = getApiKey(provider);
  const startTime = Date.now();

  const semanticGuidance = options?.semanticContext
    ? `\n\nSEMANTIC MODEL CONTEXT (BẮT BUỘC TUÂN THỦ):\n${options.semanticContext}\n- Nếu có quan hệ đã định nghĩa thì chỉ JOIN theo các quan hệ đó.\n- Không tự đoán JOIN ngoài semantic model.\n- Nếu không có đường relationship hợp lệ, trả về SQL trên 1 bảng phù hợp nhất và nêu cảnh báo trong summary.\n`
    : '';

  const systemInstruction = `
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
    - Chart Insights: Phần 'analysis' phải cung cấp bối cảnh (Context), không chỉ liệt kê số. Phần 'action' phải là lộ trình hành động (Roadmap).

    QUY TẮC SQL & KPI MAPPING:
    1. SQL TỔNG QUAN (root 'sql'): 
       - KHÔNG ĐƯỢC JOIN các bảng lớn với nhau nếu không chắc chắn có dữ liệu khớp (để tránh trả về 0 dòng).
       - NÊN dùng cấu trúc subquery cho từng KPI rồi ghép lại để mỗi KPI độc lập:
         \`SELECT (SELECT SUM(a) FROM t1) as kpi1, (SELECT COUNT(b) FROM t2) as kpi2...\`
       - Alias trùng label (lowercase, underscore).
       - BẮT BUỘC PHẢI DÙNG ĐƯỜNG DẪN ĐẦY ĐỦ (Full Path): \`project-id.dataset_id.table_id\`.
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
    
    3. SQL Biểu đồ: Fully Qualified Name. Phải đảm bảo SQL chạy được và trả về dữ liệu đa dạng.
    
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
                "insight": { "analysis": "string", "trend": "string", "action": "string", "highlight": [ { "index": number, "value": "string", "label": "string", "type": "peak|drop|anomaly|target|insight" } ] },
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
      if (!apiKey) throw new Error("Google API Key is missing. Hãy cập nhật Key trong tab AI Setting.");
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
                  sql: { type: SchemaType.STRING, description: "SQL dùng để lấy các chỉ số KPI tổng quan. Sử dụng Subqueries để tránh mất dòng dữ liệu." },
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
                          required: ["analysis", "trend", "action"]
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
            throw new Error("Không nhận được phản hồi từ AI.");
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
    let finalChartInsights = (result.charts || []).map((c: any) => c.insight);

    const canRegenerateWithRealData = !!options?.executeSql
      || (!!options?.token && !!options?.projectId);

    if (canRegenerateWithRealData) {
      const validChartIndices = chartRawData.map((d, i) => d && d.length > 0 ? i : -1).filter(i => i !== -1);
      if (validChartIndices.length > 0) {
        const validCharts = validChartIndices.map(i => result.charts[i]);
        const validData = validChartIndices.map(i => chartRawData[i]);

        const realInsights = await regenerateInsightsWithRealData(
          activeModel.id,
          prompt,
          kpiValues,
          validCharts,
          validData,
          options?.signal
        );

        if (realInsights.summary) finalSummary = realInsights.summary;
        if (realInsights.insights && realInsights.insights.length > 0) {
          finalStrategicInsights = realInsights.insights.map((ins: any) => {
            // If AI returns a string instead of object, create a proper structure
            if (typeof ins === 'string') {
              return {
                title: "Strategic Insight",
                analysis: ins,
                recommendation: "Xem xét dữ liệu chi tiết và đưa ra quyết định phù hợp với tình hình thực tế.",
                priority: "Medium"
              };
            }
            // Ensure recommendation is never empty or N/A
            if (!ins.recommendation || ins.recommendation === 'N/A' || ins.recommendation.trim() === '') {
              ins.recommendation = "Phân tích thêm dữ liệu chi tiết để đưa ra hành động cụ thể.";
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
              finalChartInsights[idx] = aiInsight;
            }
            insightCounter++;
          }
        });
      }
    }

    const finalDashboard: DashboardConfig = {
      title: result.title || "Báo cáo phân tích chuyên sâu",
      summary: finalSummary || "Tổng quan phân tích.",
      charts: (result.charts || []).map((c: any, idx: number) => {
        const d = chartRawData[idx];
        const hasError = d && (d as any)._error;
        return {
          ...c,
          insight: hasError ? (d as any)._error : (finalChartInsights[idx] || c.insight),
          data: (d && d.length > 0)
            ? d
            : (options?.token ? [] : WarehouseService.generateFallbackData(prompt, c.dataKeys))
        };
      }),
      insights: (finalStrategicInsights || []).map((i: any) => typeof i === 'string' ? { title: "Strategic Point", analysis: i, recommendation: "Review data for actions." } : i),
      kpis: kpiValues,
      suggestions: result.suggestions || []
    };

    return { dashboard: finalDashboard, sql: result.sql || "-- SQL Trace unavailable", executionTime: Date.now() - startTime };

  } catch (e: any) {
    const errorMsg = e.message || String(e);
    if (errorMsg.toLowerCase().includes('leaked')) {
      throw new Error("⚠️ LỖI BẢO MẬT: API Key Gemini của bạn đã bị Google xác định là bị lộ (leaked) và đã bị khóa. Hãy tạo Key mới tại Google AI Studio (https://aistudio.google.com/) và cập nhật trong tab AI Setting. Lưu ý tuyệt đối không để lộ Key này trên GitHub hoặc các nơi công cộng.");
    }
    if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('resource exhausted')) {
      throw new Error("⚠️ HỆ THỐNG ĐANG QUÁ TẢI (Rate Limit): Tài khoản AI (Gemini Free) của bạn đã hết lượt gọi trong phút này. Hãy chờ vài giây rồi nhấn thử lại nhé.");
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
  options?: { provider?: string, modelId?: string, signal?: AbortSignal }
): Promise<string> {
  const activeModel = {
    id: options?.modelId || 'gemini-2.5-flash',
    provider: options?.provider || 'Google'
  };

  if (!options?.provider && typeof localStorage !== 'undefined') {
    // Legacy fallback: if no provider specified, check if OpenAI is available
    if (localStorage.getItem('openai_api_key')) activeModel.provider = 'OpenAI';
  }

  const prompt = `
    Bạn là chuyên gia phân tích dữ liệu cao cấp (Senior Data Analyst).
    Nhiệm vụ: Phân tích sâu về biểu đồ "${title}".

    Dữ liệu (Sample 20 dòng):
    ${JSON.stringify(data.slice(0, 20))}

    Trục X: ${xAxis}
    Metrics (Trục Y): ${dataKeys.join(', ')}
    Context: ${chartContext}

    YÊU CẦU PHÂN TÍCH (Output định dạng Markdown):
    1. **Tóm tắt Xu hướng (Executive Summary)**:
       - Nhận định chung về xu hướng chính (Tăng/Giảm/Đi ngang).
       - Tổng quan về độ biến động.

    2. **Phân tích Nhân quả & Các biến số ảnh hưởng (Causal Analysis)**:
       - ĐỪNG CHỈ MÔ TẢ DỮ LIỆU. Hãy giải thích TẠI SAO số liệu lại như vậy.
       - Nếu có nhiều metrics: Phân tích mối tương quan (Correlation) giữa chúng (Vd: "Khi metric A tăng thì metric B giảm...").
       - Nếu chỉ có 1 metric: Đưa ra các giả thuyết về các yếu tố bên ngoài có thể ảnh hưởng (Mùa vụ, sự kiện, xu hướng thị trường, chiến dịch marketing...).
       - Chỉ ra các "Inflection Points" (Điểm đảo chiều) và nguyên nhân tiềm năng.

    3. **Điểm Nổi Bật (Anomalies & Peaks)**:
       - Xác định các điểm đỉnh (Peak) và đáy (Trough) quan trọng nhất.
       - Phát hiện các điểm bất thường (Outlier) nếu có.

    4. **Khuyến nghị Hành động (Actionable Insight)**:
       - Dựa trên phân tích nhân quả, đề xuất 3 hành động cụ thể để cải thiện hoặc duy trì hiệu quả.
       - Phân loại ưu tiên: Cao/Trung bình/Thấp.

    LƯU Ý:
    - Ngôn ngữ: Tiếng Việt chuyên nghiệp, văn phong Business Intelligence.
    - Tập trung vào "Key Drivers" (Yếu tố dẫn dắt) thay vì chỉ liệt kê con số.
    - Nếu thấy dữ liệu bị thiếu hoặc null, hãy cảnh báo.
  `;

  try {
    if (activeModel.provider === 'OpenAI') {
      return await callOpenAI(activeModel.id || 'gpt-5.1', "You are a helpful Data Analyst.", prompt, 0.7, options?.signal);
    } else if (activeModel.provider === 'Anthropic') {
      return await callAnthropic(activeModel.id || 'claude-sonnet-4-20250514', "You are a helpful Data Analyst.", prompt, 0.7, options?.signal);
    } else {
      const apiKey = getApiKey('Google');
      if (!apiKey) throw new Error("Google API Key is missing. Hãy cập nhật Key trong tab AI Setting.");
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: activeModel.id || 'gemini-2.5-flash' });

      // Retry logic for 429 errors
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          const result = await model.generateContent(prompt);
          return result.response.text();
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
    console.error("AI Analysis failed:", e);
    const errorMsg = e.message || String(e);
    if (errorMsg.toLowerCase().includes('leaked')) {
      throw new Error("⚠️ LỖI BẢO MẬT: API Key của bạn đã bị lộ (leaked) và bị khóa. Vui lòng tạo Key mới.");
    }
    if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('resource exhausted')) {
      throw new Error("⚠️ HỆ THỐNG ĐANG QUÁ TẢI (Rate Limit): Tài khoản AI của bạn đã hết lượt gọi. Vui lòng chờ vài giây.");
    }
    throw new Error(`Xin lỗi, không thể phân tích: ${errorMsg}. Vui lòng kiểm tra lại API Key hoặc kết nối mạng.`);
  }
}
