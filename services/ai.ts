
import { GoogleGenAI, Type } from "@google/genai";
import { DashboardConfig } from "../types";
import { WarehouseService } from "./warehouse";

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

export async function generateReportInsight(
  model: any, 
  prompt: string, 
  schemaInfo: string, 
  tableNames: string[]
): Promise<{ dashboard: DashboardConfig, sql: string, executionTime: number }> {
  const activeModelId = model?.id || 'gemini-3-flash-preview';
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const startTime = Date.now();

  const systemInstruction = `
    Bạn là '360data Precision BI Architect'. 
    Dữ liệu nằm trong BigQuery với các bảng: ${schemaInfo}.
    
    NHIỆM VỤ: Tạo 6 biểu đồ phân tích sâu.
    
    QUY TẮC DỮ LIỆU ĐỘNG:
    1. Với mỗi biểu đồ, hãy dự đoán các GIÁ TRỊ THỰC TẾ (labels) sẽ xuất hiện ở trục X (xAxisKey).
       Ví dụ: Nếu phân tích theo 'category', hãy liệt kê 5-6 tên category thực tế phù hợp với ngữ cảnh bảng đó vào mảng 'mockLabels'.
    2. Nếu là thời gian, 'mockLabels' có thể là ['T01/24', 'T02/24'...] hoặc ['2023', '2024'].
    3. Insight PHẢI nhắc đúng tên các giá trị trong 'mockLabels' này.
    
    ĐỊNH DẠNG JSON: Tuân thủ responseSchema.
  `;

  try {
    const response = await ai.models.generateContent({
      model: activeModelId,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.1,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sql: { type: Type.STRING },
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            kpis: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  value: { type: Type.STRING },
                  trend: { type: Type.STRING }
                },
                required: ["label", "value", "trend"]
              }
            },
            charts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  title: { type: Type.STRING },
                  xAxisKey: { type: Type.STRING },
                  dataKeys: { type: Type.ARRAY, items: { type: Type.STRING } },
                  insight: { type: Type.STRING },
                  sql: { type: Type.STRING },
                  mockLabels: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Danh sách 5-7 giá trị thực tế cho trục X dựa trên Schema" }
                },
                required: ["type", "title", "dataKeys", "insight", "xAxisKey", "sql", "mockLabels"]
              }
            },
            insights: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestions: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["sql", "title", "summary", "charts", "kpis", "insights", "suggestions"]
        }
      }
    });

    if (!response || !response.text) {
      throw new Error("Không nhận được phản hồi từ AI.");
    }

    const cleanedText = cleanJsonResponse(response.text);
    const result = JSON.parse(cleanedText);
    
    const rawData = await WarehouseService.executeQuery(result.sql || "", tableNames, prompt, result.charts);

    const finalDashboard: DashboardConfig = {
      title: result.title || "Báo cáo phân tích chuyên sâu",
      summary: result.summary || "Tổng quan phân tích.",
      charts: (result.charts || []).map((c: any, idx: number) => ({
        ...c,
        data: rawData[idx] || WarehouseService.generateFallbackData(prompt, c.dataKeys)
      })),
      insights: result.insights || [],
      kpis: result.kpis || [],
      suggestions: result.suggestions || []
    };

    return { dashboard: finalDashboard, sql: result.sql || "-- SQL Trace unavailable", executionTime: Date.now() - startTime };
  } catch (e: any) {
    console.error("AI Service Error:", e);
    throw e;
  }
}
