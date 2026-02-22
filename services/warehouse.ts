
import { runQuery } from './bigquery';

export class WarehouseService {
    /**
     * Executes SQL queries for a list of charts against the Data Warehouse (BigQuery).
     * @param globalSql Global SQL provided by AI (optional context)
     * @param tableNames List of available table names
     * @param prompt User prompt context
     * @param charts List of chart definitions containing SQL
     * @param options Execution options (token, projectId, signal)
     * @returns Array of result arrays, matching the order of charts
     */
    static async executeQuery(
        globalSql: string,
        tableNames: string[],
        prompt: string,
        charts: any[],
        options?: {
            token?: string;
            projectId?: string;
            limit?: number;
            signal?: AbortSignal;
            semanticEngine?: 'bigquery' | 'postgres';
            executeSql?: (sql: string) => Promise<any[]>;
        }
    ): Promise<any[][]> {
        if (options?.executeSql) {
            const promises = charts.map(async (chart, index) => {
                if (!chart.sql) return [];
                try {
                    return await options.executeSql!(chart.sql);
                } catch (error: any) {
                    console.warn(`[WarehouseService] Chart ${index} ("${chart.title}") query failed:`, error.message);
                    return [{ _error: error.message || "Query execution failed" }];
                }
            });
            return await Promise.all(promises);
        }

        if (!options?.token || !options?.projectId) {
            // If no credentials, we cannot query BigQuery.
            // Return empty arrays so the caller falls back to mock data or empty state.
            return new Array(charts.length).fill([]);
        }

        const promises = charts.map(async (chart, index) => {
            if (!chart.sql) {
                return [];
            }

            try {
                // Execute the specific SQL for this chart
                // runQuery handles network calls and response parsing
                const data = await runQuery(options.token!, options.projectId!, chart.sql, options.signal);
                return data;
            } catch (error: any) {
                console.warn(`[WarehouseService] Chart ${index} ("${chart.title}") query failed:`, error.message);

                // Return a special error object to let the UI know why it failed
                // The caller (ai.ts) checks for `_error` property.
                return [{ _error: error.message || "Query execution failed" }];
            }
        });

        // Run all queries in parallel
        return await Promise.all(promises);
    }

    /**
     * Generates mock data for visualization when real data is unavailable.
     * @param prompt User prompt context (unused for now but good for future semantic mocking)
     * @param dataKeys Keys to generate random values for
     * @returns Array of mock data objects
     */
    static generateFallbackData(prompt: string, dataKeys: string[] = []): any[] {
        const mockData: any[] = [];
        const periods = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Determine if we need time-series or categorical mock data
        // For simplicity, we default to a monthly trend
        const isTimeSeries = true;

        if (isTimeSeries) {
            const currentYear = new Date().getFullYear();
            periods.forEach((month, index) => {
                const row: any = {
                    name: month,
                    date: `${currentYear}-${String(index + 1).padStart(2, '0')}-01`,
                    // Common axis keys
                    month: month,
                    year: currentYear,
                };

                // Fill keys with random data
                dataKeys.forEach(key => {
                    // Avoid overwriting axis keys if they are in dataKeys
                    if (!['name', 'date', 'month', 'year'].includes(key)) {
                        row[key] = Math.floor(Math.random() * 5000) + 1000;
                    }
                });

                mockData.push(row);
            });
        }

        return mockData;
    }
}
