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
  if (provider === 'OpenAI') return localStorage.getItem('openai_api_key') || process.env.OPENAI_API_KEY || '';
  if (provider === 'Anthropic') return localStorage.getItem('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
  if (provider === 'Google') return localStorage.getItem('gemini_api_key') || process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  return "";
};

async function callOpenAI(modelId: string, systemPrompt: string, userPrompt: string, temperature: number = 0.7) {
  const apiKey = getApiKey('OpenAI');
  if (!apiKey) throw new Error("OpenAI API Key is missing. Hãy cập nhật Key trong tab AI Setting.");

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
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function callAnthropic(modelId: string, systemPrompt: string, userPrompt: string, temperature: number = 0.7) {
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
    })
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
  chartData: any[][]
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
      1. Dashboard Summary: Viết lại 1-2 câu cực ngắn (dưới 40 chữ), phản ánh đúng tình hình dựa trên số liệu thật.
      2. Strategic Insights: Tạo ra 3 nhận định chiến lược. MỖI INSIGHT BẮT BUỘC PHẢI CÓ:
         - title: Tiêu đề ngắn gọn (4-8 từ)
         - analysis: Phân tích ngắn gọn (20-40 từ)
         - recommendation: HÀNH ĐỘNG CỤ THỂ (BẮT BUỘC - KHÔNG ĐƯỢC ĐỂ TRỐNG hoặc "N/A")
           * Phải là câu mệnh lệnh: "Tăng ngân sách...", "Cắt giảm chi phí...", "Tập trung vào..."
           * Phải có số liệu cụ thể nếu có thể: "Tăng 20%", "Giảm 30%", "Chuyển 50% ngân sách sang..."
         - priority: "High", "Medium", hoặc "Low"
      3. Chart Insights (BẮT BUỘC):
         - PHẢI tạo ra CHÍNH XÁC ${charts.length} phân tích, tương ứng với ${charts.length} biểu đồ đã liệt kê ở trên.
         - THỨ TỰ: Phải trả về mảng chart_insights theo đúng thứ tự của các biểu đồ trong danh sách trên.
         - NGUYÊN TẮC CONTEXT (CHỐNG RÂU ÔNG NỌ CẮM CẰM BÀ):
           * Phân tích của biểu đồ nào CHỈ ĐƯỢC dùng số liệu của biểu đồ đó.
           * TUYỆT ĐỐI không nhắc đến dữ liệu của biểu đồ A trong phần phân tích của biểu đồ B.
           * Ví dụ: Nếu biểu đồ nói về Nhân viên, KHÔNG được phân tích về Facebook hay Chi phí quảng cáo trong đó.
         - analysis: Tìm điểm bất thường, tăng trưởng/sụt giảm. Chỉ dựa trên dữ liệu thật được cung cấp.
         - trend: Giải thích ngắn gọn động lực chính.
         - action: Đề xuất hành động thực tế (BẮT BUỘC CỤ THỂ).
      
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
      responseText = await callOpenAI(modelId, "You are a JSON generator.", prompt);
    } else if (provider === 'Anthropic') {
      responseText = await callAnthropic(modelId, "You are a JSON generator. Output valid JSON only.", prompt);
    } else {
      if (!apiKey) throw new Error("Google API Key is missing. Hãy cập nhật Key trong tab AI Setting.");
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelId });
      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        }
      });
      responseText = response.response.text();
    }

    const result = JSON.parse(cleanJsonResponse(responseText || "{}"));
    return {
      summary: result.dashboard_summary,
      insights: result.strategic_insights || [],
      chartInsights: result.chart_insights || []
    };
  } catch (e) {
    console.warn("Failed to regenerate insights", e);
    return { summary: "", insights: [], chartInsights: [] };
  }
}

export async function generateReportInsight(
  model: any,
  prompt: string,
  schemaInfo: string,
  tableNames: string[],
  options?: { token?: string, projectId?: string }
): Promise<{ dashboard: DashboardConfig, sql: string, executionTime: number }> {
  const activeModel = model || { id: 'gemini-2.0-flash', provider: 'Google' };
  const provider = activeModel.provider || 'Google';
  const apiKey = getApiKey(provider);
  const startTime = Date.now();

  const systemInstruction = `
    Bạn là '360data Precision BI Architect' - Chuyên gia tư vấn chiến lược dữ liệu cấp cao.
    Dữ liệu tại BigQuery có các bảng và cột sau: ${schemaInfo}.
    
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
         * Nếu trên 8 categories: BẮT BUỘC dùng SQL LIMIT 5-10 + 'bar' chart.
         * **VÍ DỤ ĐÚNG**:
           ✅ "Phân bố chi phí theo 3 kênh (Facebook, Google, TikTok)" + bar
           ✅ "Tỷ lệ sản phẩm bán ra (5 loại)" + bar
       
       - **COMPARISON (So sánh)**:
         * Dưới 6 items KHÔNG CÓ THỜI GIAN: Dùng 'bar'.
         * Trên 6 items: Dùng 'bar' + SQL LIMIT để tập trung vào top performers.
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

    YÊU CẦU VỀ GIÁ TRỊ QUYẾT ĐỊNH (DECISIVE INSIGHTS):
    - Bạn không phải là máy đọc số. Bạn là CEO/Advisor. 
    - Insights không được dùng từ: "có xu hướng", "dao động khoảng".
    - Hãy dùng từ mạnh: "Phát hiện lỗ hổng", "Lãng phí ngân sách ở...", "Cần cắt giảm ngay...", "Cơ hội tăng trưởng 20% nằm ở...".
    - Mọi Strategic Insights phải trả lời được câu hỏi: "Nếu không làm gì, doanh nghiệp sẽ mất gì?".
    - Chart Insights: Phần 'action' phải là một mệnh lệnh hành động (Actionable Order). 
    - KHÔNG ĐƯỢC NHẦM LẪN DỮ LIỆU: Phân tích của Chart nào phải dựa trên Title và SQL của Chart đó. Không được râu ông nọ cắm cằm bà.

    QUY TẮC SQL & KPI MAPPING:
    1. SQL TỔNG QUAN (root 'sql'): 
       - KHÔNG ĐƯỢC JOIN các bảng lớn với nhau nếu không chắc chắn có dữ liệu khớp (để tránh trả về 0 dòng).
       - NÊN dùng cấu trúc subquery cho từng KPI rồi ghép lại để mỗi KPI độc lập:
         \`SELECT (SELECT SUM(a) FROM t1) as kpi1, (SELECT COUNT(b) FROM t2) as kpi2...\`
       - Alias trùng label (lowercase, underscore).
       - BẮT BUỘC PHẢI DÙNG ĐƯỜNG DẪN ĐẦY ĐỦ (Full Path): \`project-id.dataset_id.table_id\`.
       - Xử lý Date: Nếu không có yêu cầu ngày cụ thể, hãy lấy dữ liệu mới nhất có sẵn trong bảng thay vì dùng strict CURRENT_DATE() để tránh bảng trống.
    
    2. SQL TIME-SERIES - CHỌN GRANULARITY THÔNG MINH:
       **Nguyên tắc**: Phân tích TIME GRANULARITY dựa trên câu hỏi của người dùng.
       
       **A. DAILY (Theo ngày)**:
       - Keywords: "hàng ngày", "theo ngày", "7 ngày", "30 ngày", "tuần này", "tháng này"
       - SQL: \`SELECT * FROM (SELECT DATE(created_at) as date, SUM(...) FROM ... GROUP BY 1 ORDER BY 1 DESC LIMIT 30) ORDER BY 1 ASC\`
       - ORDER BY: date ASC (để hiển thị từ trái qua phải là CWS -> MỚI)
       - LIMIT: 7-30 rows (tùy yêu cầu)
       - VD: "Doanh thu 30 ngày gần nhất"
       
       **B. WEEKLY (Theo tuần)**:
       - Keywords: "theo tuần", "hàng tuần", "12 tuần", "quý này theo tuần"
       - SQL: \`DATE_TRUNC(created_at, WEEK) as week\` (Dùng pattern Subquery như bước A để lấy mới nhất nhưng hiển thị ASC)
       - ORDER BY: week ASC
       - LIMIT: 12-26 rows
       - VD: "Chi phí quảng cáo 12 tuần qua"
       
       **C. MONTHLY (Theo tháng)**:
       - Keywords: "theo tháng", "hàng tháng", "6 tháng", "năm nay", "12 tháng"
       - SQL: \`DATE_TRUNC(created_at, MONTH) as month\`
       - ORDER BY: month ASC
       - LIMIT: 6-12 rows
       - VD: "Doanh thu 12 tháng gần nhất"
       
       **D. QUARTERLY (Theo quý)**:
       - Keywords: "theo quý", "hàng quý", "4 quý", "2 năm qua theo quý"
       - SQL: \`...quarter...\`
       - ORDER BY: quarter ASC
       - LIMIT: 4-8 rows
       - VD: "Phân tích doanh thu theo quý"
       
       **E. HALF-YEARLY (Theo nửa năm)**:
       - Keywords: "theo nửa năm", "6 tháng đầu năm", "nửa cuối năm", "H1", "H2"
       - SQL: \`...half_year...\`
       - ORDER BY: half_year ASC
       - LIMIT: 4-6 rows
       - VD: "So sánh H1 vs H2"
       
       **F. YEARLY (Theo năm)**:
       - Keywords: "theo năm", "hàng năm", "3 năm", "5 năm qua"
       - SQL: \`EXTRACT(YEAR FROM created_at) as year\`
       - ORDER BY: year ASC
       - LIMIT: 3-5 rows
       - VD: "Tăng trưởng doanh thu 5 năm qua"
       
       **LƯU Ý QUAN TRỌNG**:
       - Luôn dùng ORDER BY [time_column] DESC để có dữ liệu mới nhất
       - Dùng LIMIT phù hợp để tránh quá nhiều data points
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
                "type": "bar|line|scatter|combo|horizontalBar|stackedBar",
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
      responseText = await callOpenAI(activeModel.id, systemInstruction, prompt);
    } else if (provider === 'Anthropic') {
      responseText = await callAnthropic(activeModel.id, systemInstruction, prompt);
    } else {
      if (!apiKey) throw new Error("Google API Key is missing. Hãy cập nhật Key trong tab AI Setting.");
      const genAI = new GoogleGenerativeAI(apiKey);
      const aiModel = genAI.getGenerativeModel({
        model: activeModel.id,
        systemInstruction: systemInstruction
      });

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
                      enum: ["bar", "line", "scatter", "combo", "horizontalBar", "stackedBar"],
                      description: "Allowed: bar, line, scatter, combo, horizontalBar, stackedBar"
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
      });
      if (!response || !response.response) {
        throw new Error("Không nhận được phản hồi từ AI.");
      }
      responseText = response.response.text();
    }

    const cleanedText = cleanJsonResponse(responseText);
    const result = JSON.parse(cleanedText);

    // 1. Execute Chart Queries
    const chartRawData = await WarehouseService.executeQuery(result.sql || "", tableNames, prompt, result.charts, options);

    // 2. Execute Dashboard-level SQL for KPIs if possible
    let kpiValues = result.kpis || [];
    if (options?.token && options?.projectId && result.sql) {
      try {
        const { runQuery } = await import('./bigquery');
        const kpiData = await runQuery(options.token, options.projectId, result.sql);
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

    if (options?.token && options?.projectId) {
      const validChartIndices = chartRawData.map((d, i) => d && d.length > 0 ? i : -1).filter(i => i !== -1);
      if (validChartIndices.length > 0) {
        const validCharts = validChartIndices.map(i => result.charts[i]);
        const validData = validChartIndices.map(i => chartRawData[i]);

        const realInsights = await regenerateInsightsWithRealData(
          activeModel.id,
          prompt,
          kpiValues,
          validCharts,
          validData
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
    console.error("AI Service Error:", e);
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
  let modelId = 'gemini-2.0-flash';
  let apiKey = geminiKey;

  // Prefer what's available
  if (geminiKey) {
    provider = 'Google';
    modelId = 'gemini-2.0-flash';
    apiKey = geminiKey;
  } else if (openaiKey) {
    provider = 'OpenAI';
    modelId = 'gpt-4o';
    apiKey = openaiKey;
  } else if (anthropicKey) {
    provider = 'Anthropic';
    modelId = 'claude-3-5-sonnet-20240620';
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
    
    NGUYÊN TẮC PHÂN TÍCH (BẮT BUỘC):
    1. CHỈ PHÂN TÍCH DỰA TRÊN DỮ LIỆU THỰC: Mọi nhận định, con số và xu hướng phải bắt nguồn trực tiếp từ danh sách Widget và Data Sample. TUYỆT ĐỐI không bịa số.
    2. NÊU TÊN BIỂU ĐỒ: Chỉ rõ Insight đến từ biểu đồ nào.
    3. CHIỀU SÂU: Không chỉ nói 'doanh thu tăng', hãy cố gắng giải thích 'tại sao' dựa trên các chart khác (tương quan giữa traffic và conversion chẳng hạn).
    4. HÀNH ĐỘNG: Luôn kết thúc bằng một vài khuyến nghị thực tế.
    5. NGÔN NGỮ: Trả về bằng ngôn ngữ người dùng hỏi (Việt/Anh).
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
    }
  } catch (e: any) {
    console.error("AI Analysis Error:", e);
    return `Đã có lỗi xảy ra khi gọi AI Advisor: ${e.message || "Vui lòng kiểm tra API Key hoặc kết nối trong tab AI Setting."}`;
  }
}
