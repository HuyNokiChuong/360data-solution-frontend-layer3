export interface ReportsAssistantBridge {
  newSession: (title?: string) => Promise<{ sessionId: string } | void> | { sessionId: string } | void;
  ask: (
    text: string,
    options?: { sessionId?: string; useAllTables?: boolean; tableIds?: string[] }
  ) => Promise<any> | any;
  rerunChartSql: (messageId: string, chartIndex: number, newSQL?: string) => Promise<any> | any;
  getContext?: () => Record<string, any>;
}

let activeReportsBridge: ReportsAssistantBridge | null = null;

export const registerReportsAssistantBridge = (bridge: ReportsAssistantBridge | null) => {
  activeReportsBridge = bridge;
  return () => {
    if (activeReportsBridge === bridge) {
      activeReportsBridge = null;
    }
  };
};

export const getReportsAssistantBridge = (): ReportsAssistantBridge | null => {
  return activeReportsBridge;
};
