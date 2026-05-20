export type UsageStatsTimeRange = 'today' | '7d' | '30d' | 'all';

export type DashboardTimeRange = '12h' | '24h' | 'today' | 'yesterday' | '7d' | 'all';

export interface UsageStatsSummary {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheTokens: number;
  totalTokens: number;
  requestTrend?: TrendBucket[];
  tokenTrend?: TrendBucket[];
  inputOutputTrend?: TrendBucket[];
  cacheTrend?: TrendBucket[];
}

export interface UsageStatsGroupRow {
  key: string;
  label: string;
  requests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
  authIndex?: number;
  apiKeyHash?: string;
}

export interface UsageStatsServiceInfo {
  status: string;
  lastConsumedAt: number | null;
  lastInsertedAt: number | null;
  events: number;
  deadLetters: number;
}

export interface UsageStatsResponse {
  source: 'postgres' | 'memory';
  range: UsageStatsTimeRange | DashboardTimeRange;
  summary: UsageStatsSummary;
  byModel: UsageStatsGroupRow[];
  byProvider: UsageStatsGroupRow[];
  byAccount: UsageStatsGroupRow[];
  service?: UsageStatsServiceInfo;
}

export interface UsageStatsMemoryEntry {
  success: number;
  failed: number;
}

export type UsageStatsMemoryResponse = Record<
  string,
  Record<string, UsageStatsMemoryEntry>
>;

export type UsageStatsDataSource = 'postgres' | 'memory' | 'unavailable' | 'error';

export interface UsageStatsState {
  loading: boolean;
  dataSource: UsageStatsDataSource;
  data: UsageStatsResponse | null;
  error: string | null;
  range: DashboardTimeRange;
  serviceUrl: string;
}

export interface TrendBucket {
  timestamp: number;
  value: number;
}

export interface HeatmapBucket {
  timeStart: number;
  timeEnd: number;
  success: number;
  failed: number;
  successRate: number;
}

export interface PriceEntry {
  model: string;
  inputPricePerM: number;
  outputPricePerM: number;
}
