
import { MOCK_DATA_MAP } from '../constants';

export class WarehouseService {
  /**
   * Thực thi truy vấn ảo.
   * Ưu tiên lấy nhãn (labels) từ AI gợi ý (mockLabels) để đảm bảo tính logic với SQL.
   */
  static async executeQuery(sql: string, tableContext: string[], userPrompt?: string, chartConfigs?: any[]): Promise<any[][]> {
    if (!chartConfigs) return [this.generateFallbackData(userPrompt)];

    const promptText = (userPrompt || "").toLowerCase();

    return chartConfigs.map((config) => {
      const { dataKeys, xAxisKey, mockLabels, title, insight } = config;
      
      // Ưu tiên 1: Sử dụng nhãn mà AI đã suy luận từ Schema
      // Ưu tiên 2: Nếu AI không có, thử tìm trong MOCK_DATA_MAP dựa trên context bảng
      // Ưu tiên 3: Mặc định fallback
      let labels: string[] = mockLabels && mockLabels.length > 0 ? mockLabels : [];

      if (labels.length === 0) {
        // Cố gắng tìm dữ liệu mẫu thực tế từ hằng số
        const targetTable = tableContext.find(t => sql.toLowerCase().includes(t.toLowerCase())) || tableContext[0];
        const sourceData = MOCK_DATA_MAP[targetTable];
        
        if (sourceData && sourceData.length > 0) {
          // Lấy unique values của cột tương ứng xAxisKey nếu có
          const possibleValues = Array.from(new Set(sourceData.map(row => row[xAxisKey] || row.label || row.category || row.product_name))).filter(Boolean);
          labels = possibleValues.slice(0, 8) as string[];
        }
      }

      // Cuối cùng nếu vẫn không có nhãn, dùng fallback an toàn
      if (labels.length === 0) {
        labels = ['Hạng mục 1', 'Hạng mục 2', 'Hạng mục 3', 'Hạng mục 4', 'Hạng mục 5'];
      }

      const combinedText = (title + " " + (insight || "") + " " + promptText).toLowerCase();
      const isVolatility = combinedText.includes('biến động');
      const isGrowth = combinedText.includes('tăng trưởng') || combinedText.includes('phát triển') || combinedText.includes('xu hướng');

      return labels.map((label, i) => {
        const row: any = {
          label: label,
          period: label,
          [xAxisKey]: label
        };

        dataKeys.forEach((key: string) => {
          let base = 5000;
          if (key.includes('churn') || key.includes('rate')) base = 0.05;
          else if (key.includes('point')) base = 150;
          else if (key.includes('stock')) base = 300;
          else if (key.includes('volume')) base = 800;
          else if (key.includes('active_users')) base = 2500;
          else if (key.includes('spend')) base = 1000;
          else if (key.includes('conversions')) base = 50;

          let multiplier = 1;
          if (isVolatility) multiplier = (i % 2 === 0) ? 1.4 : 0.6;
          else if (isGrowth) multiplier = 0.8 + (i * 0.15);
          else multiplier = 0.9 + Math.random() * 0.2;

          const val = base * multiplier + (Math.random() * base * 0.1);
          row[key] = parseFloat(val.toFixed(key.includes('rate') || key.includes('churn') ? 4 : 2));
        });

        return row;
      });
    });
  }

  static generateFallbackData(prompt?: string, dataKeys: string[] = ['revenue']) {
    return Array.from({ length: 6 }).map((_, i) => {
      const row: any = {
        label: `Item ${i + 1}`,
        period: `T0${i + 1}/24`,
      };
      dataKeys.forEach(k => row[k] = 1000 + Math.random() * 500);
      return row;
    });
  }
}
