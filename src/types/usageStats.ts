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
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  rpm: number;
  tpm: number;
  periodStartMs?: number;
  periodEndMs?: number;
  coveredMinutes?: number;
  requestTrend?: TrendBucket[];
  tokenTrend?: TrendBucket[];
  inputTrend?: TrendBucket[];
  outputTrend?: TrendBucket[];
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
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
  authIndex?: string;
  apiKeyHash?: string;
  apiKeyIdentity?: string;
  childModels?: UsageStatsGroupRow[];
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
  byApiKey: UsageStatsGroupRow[];
  byModel: UsageStatsGroupRow[];
  byProvider?: UsageStatsGroupRow[];
  byAccount?: UsageStatsGroupRow[];
  heatmap?: HeatmapBucket[];
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

export interface HeatmapResponse {
  range: string;
  buckets: HeatmapBucket[];
}

export interface ProviderRow {
  key: string;
  label: string;
  model?: string;
  provider?: string;
  authIndex?: string;
  requests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  childModels?: UsageStatsGroupRow[];
}

export interface ProvidersResponse {
  range: string;
  providers: ProviderRow[];
}

export interface AccountRow {
  key: string;
  source: string;
  provider: string;
  type: string;
  name: string;
  label: string;
  authIndex?: string;
  status: string;
  statusMessage: string;
  disabled: boolean;
  unavailable: boolean;
  runtimeOnly: boolean;
  success: number;
  failed: number;
  recentRequests: unknown[];
}

export interface AccountsResponse {
  snapshotTime: number;
  accounts: AccountRow[];
}

export interface ApiKeyDetailEntry {
  key: string;
  childModels: UsageStatsGroupRow[];
}

export interface ApiKeyDetailsResponse {
  range: string;
  details: ApiKeyDetailEntry[];
}

export interface PriceEntry {
  model: string;
  inputPricePerM: number;
  cacheHitPricePerM: number;
  outputPricePerM: number;
}

export interface ApiKeyDisplayRow {
  key: string;
  label: string;
  requests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  modelCount: number;
  cost: number | null;
  hasModelAttribution: boolean;
  childModels: UsageStatsGroupRow[];
}

export interface ProviderDisplayRow {
  key: string;
  label: string;
  requests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  modelCount: number;
  cost: number | null;
  childModels: UsageStatsGroupRow[];
}

export interface AuthFileDisplayRow {
  key: string;
  label: string;
  provider: string;
  requests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  modelCount: number;
  cost: number | null;
  childModels: UsageStatsGroupRow[];
}

export interface SourceDisplayRow {
  key: string;
  label: string;
  sourceType: 'auth-file' | 'provider';
  provider: string;
  requests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  modelCount: number;
  cost: number | null;
  childModels: UsageStatsGroupRow[];
}

export interface DataCoverageInfo {
  partial: boolean;
  coveredMinutes: number;
  requestedMinutes: number;
}
