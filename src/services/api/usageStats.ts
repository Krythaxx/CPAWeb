import axios from 'axios';
import { apiClient } from './client';
import type {
  UsageStatsResponse,
  UsageStatsSummary,
  DashboardTimeRange,
  UsageStatsGroupRow,
  DataCoverageInfo,
  HeatmapBucket,
  HeatmapResponse,
  ProviderRow,
  ProvidersResponse,
  AccountRow,
  AccountsResponse,
  PriceEntry,
  TrendBucket,
} from '@/types/usageStats';
import type { AuthFileItem, AuthFilesResponse } from '@/types/authFile';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
  sumRecentRequests,
  mergeRecentRequestBucketGroups,
  RECENT_REQUEST_BUCKET_DURATION_MINUTES,
  type ApiKeyUsageResponse,
  type RecentRequestBucket,
} from '@/utils/recentRequests';

const USAGE_SERVICE_TIMEOUT_MS = 3 * 1000;

const SUCCESS_KEYS = ['success', 'succeeded', 'successful', 'ok', 'successCount'];
const FAILURE_KEYS = ['failed', 'failure', 'failures', 'error', 'errors', 'failureCount'];
const RECENT_REQUEST_KEYS = ['recent_requests', 'recentRequests'];
const REQUEST_TOTAL_KEYS = ['requests', 'request_count', 'requestCount', 'total', 'count', 'value'];
const AUTH_INDEX_KEYS = ['auth_index', 'authIndex', 'auth-index'];
const SINGLE_MODEL_KEYS = ['model', 'modelId', 'model_id', 'modelName', 'model_name'];
const MODEL_NAME_KEYS = ['model', 'modelId', 'model_id', 'modelName', 'model_name', 'name', 'id'];
const MODEL_USAGE_KEYS = [
  'models',
  'model_usage',
  'modelUsage',
  'models_usage',
  'modelsUsage',
  'model_usages',
  'modelUsages',
  'by_model',
  'byModel',
  'model_stats',
  'modelStats',
  'model_statistics',
  'modelStatistics',
];
const USAGE_OBJECT_KEYS = [
  'usage',
  'tokens',
  'tokenUsage',
  'token_usage',
  'usageInfo',
  'usage_info',
  'responseUsage',
  'response_usage',
];
const NESTED_USAGE_SOURCE_KEYS = [
  'request',
  'requestBody',
  'request_body',
  'body',
  'payload',
  'params',
  'response',
  'responseBody',
  'response_body',
  'result',
  'data',
];
const INPUT_TOKEN_KEYS = [
  'inputTokens',
  'input_tokens',
  'inputTokenCount',
  'input_token_count',
  'promptTokens',
  'prompt_tokens',
  'promptTokenCount',
  'prompt_token_count',
];
const OUTPUT_TOKEN_KEYS = [
  'outputTokens',
  'output_tokens',
  'outputTokenCount',
  'output_token_count',
  'completionTokens',
  'completion_tokens',
  'completionTokenCount',
  'completion_token_count',
];
const REASONING_TOKEN_KEYS = [
  'reasoningTokens',
  'reasoning_tokens',
  'thinkingTokens',
  'thinking_tokens',
];
const CACHED_TOKEN_KEYS = [
  'cachedTokens',
  'cached_tokens',
  'cacheTokens',
  'cache_tokens',
  'cacheReadTokens',
  'cache_read_tokens',
  'cacheReadInputTokens',
  'cache_read_input_tokens',
  'cacheCreationTokens',
  'cache_creation_tokens',
  'cacheCreationInputTokens',
  'cache_creation_input_tokens',
];
const CACHE_READ_TOKEN_KEYS = [
  'cacheReadTokens',
  'cache_read_tokens',
  'cacheReadInputTokens',
  'cache_read_input_tokens',
];
const CACHE_CREATION_TOKEN_KEYS = [
  'cacheCreationTokens',
  'cache_creation_tokens',
  'cacheCreationInputTokens',
  'cache_creation_input_tokens',
];
const TOTAL_TOKEN_KEYS = [
  'totalTokens',
  'total_tokens',
  'totalTokenCount',
  'total_token_count',
  'tokens',
];
const TOTAL_REQUEST_KEYS = ['totalRequests', 'total_requests', 'requestCount', 'request_count', 'requests'];
const SUCCESS_COUNT_KEYS = ['successCount', 'success_count', ...SUCCESS_KEYS];
const FAILURE_COUNT_KEYS = ['failureCount', 'failure_count', ...FAILURE_KEYS];
const SUCCESS_RATE_KEYS = ['successRate', 'success_rate'];
const CACHE_TOKEN_KEYS = ['cacheTokens', 'cache_tokens', ...CACHED_TOKEN_KEYS];
const PERIOD_START_KEYS = ['periodStartMs', 'period_start_ms', 'periodStart', 'period_start'];
const PERIOD_END_KEYS = ['periodEndMs', 'period_end_ms', 'periodEnd', 'period_end'];
const COVERED_MINUTES_KEYS = ['coveredMinutes', 'covered_minutes'];
const CHILD_MODEL_KEYS = ['childModels', 'child_models'];
const API_KEY_IDENTITY_KEYS = [
  'apiKeyIdentity',
  'api_key_identity',
  'clientApiKeyIdentity',
  'client_api_key_identity',
];
const API_KEY_HASH_KEYS = [
  'api_key_hash',
  'apiKeyHash',
  'client_api_key_hash',
  'clientApiKeyHash',
];
const GROUP_KEY_KEYS = ['key', 'id'];
const GROUP_LABEL_KEYS = ['label', 'name'];
const GROUP_PROVIDER_KEYS = ['provider', 'providerKey', 'provider_key'];
const MODEL_USAGE_IGNORED_KEYS = new Set([
  'total',
  'count',
  'requests',
  'value',
  'request_count',
  'requestCount',
  'success',
  'succeeded',
  'successful',
  'ok',
  'successCount',
  'failed',
  'failure',
  'failures',
  'error',
  'errors',
  'failureCount',
  'recent_requests',
  'recentRequests',
  'models',
]);

export interface MemoryStatsPayload {
  apiKeyUsage?: ApiKeyUsageResponse;
  authFiles?: AuthFileItem[];
}

export interface NormalizedAuthFileRow {
  key: string;
  label: string;
  provider: string;
  authIndex: string | undefined;
  requests: number;
  successCount: number;
  failureCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  childModels: UsageStatsGroupRow[];
}

export interface NormalizedApiKeyRow {
  key: string;
  identity: string;
  label: string;
  requests: number;
  successCount: number;
  failureCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  childModels: UsageStatsGroupRow[];
}

export interface NormalizedMemoryResult {
  summary: {
    totalRequests: number;
    totalSuccess: number;
    totalFailure: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
  };
  apiKeyRows: NormalizedApiKeyRow[];
  authFileRows: NormalizedAuthFileRow[];
  byModel: UsageStatsGroupRow[];
  byProvider: UsageStatsGroupRow[];
  apiKeyRequestTotal: number;
  authFileRequestTotal: number;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface MemoryRequestLogDetail {
  id?: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  authIndex?: string;
  apiKey?: string;
  success: boolean;
  tokens: TokenCounts;
}

export interface ProviderConfigEntry {
  authIndex: string;
  provider: string;
  type: string;
  name: string;
  prefix: string;
  baseUrl: string;
  apiKey: string;
}

export interface ProviderConfigSnapshot {
  entries: ProviderConfigEntry[];
  authFiles: AuthFileItem[];
}

function resolveServiceUrl(serviceUrl: string): string {
  let base = serviceUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
}

export interface AuthFileQuotaEntry {
  authFileName: string;
  remainingPercent: number;
  resetTime: string;
  provider: string;
  updatedAt?: string;
}

export const usageStatsApi = {
  async fetchPersistentStats(
    serviceUrl: string,
    managementKey: string,
    range: DashboardTimeRange,
  ): Promise<UsageStatsResponse> {
    const base = resolveServiceUrl(serviceUrl);
    const response = await axios.get<unknown>(
      `${base}/v0/management/usage/stats`,
      {
        params: { range },
        headers: {
          Authorization: `Bearer ${managementKey}`,
        },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
    return normalizePersistentStatsResponse(response.data, range);
  },

  async fetchPrices(
    serviceUrl: string,
    managementKey: string,
  ): Promise<PriceEntry[]> {
    const base = resolveServiceUrl(serviceUrl);
    const response = await axios.get<PriceEntry[]>(
      `${base}/v0/management/usage/prices`,
      {
        headers: { Authorization: `Bearer ${managementKey}` },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
    return Array.isArray(response.data) ? response.data : [];
  },

  async savePrices(
    serviceUrl: string,
    managementKey: string,
    prices: PriceEntry[],
  ): Promise<void> {
    const base = resolveServiceUrl(serviceUrl);
    await axios.put(
      `${base}/v0/management/usage/prices`,
      prices,
      {
        headers: { Authorization: `Bearer ${managementKey}` },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
  },

  async probeService(serviceUrl: string): Promise<boolean> {
    try {
      const base = resolveServiceUrl(serviceUrl);
      const res = await axios.get(`${base}/v0/management/usage/healthz`, {
        timeout: 1000,
      });
      return res.data?.status === 'ok';
    } catch {
      return false;
    }
  },

  async saveAuthFileQuotas(
    serviceUrl: string,
    managementKey: string,
    entries: AuthFileQuotaEntry[],
  ): Promise<void> {
    const base = resolveServiceUrl(serviceUrl);
    await axios.put(
      `${base}/v0/management/usage/auth-file-quotas`,
      entries,
      {
        headers: { Authorization: `Bearer ${managementKey}` },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
  },

  async fetchAuthFileQuotas(
    serviceUrl: string,
    managementKey: string,
  ): Promise<AuthFileQuotaEntry[]> {
    const base = resolveServiceUrl(serviceUrl);
    const response = await axios.get<AuthFileQuotaEntry[]>(
      `${base}/v0/management/usage/auth-file-quotas`,
      {
        headers: { Authorization: `Bearer ${managementKey}` },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
    return Array.isArray(response.data) ? response.data : [];
  },

  async deleteAuthFileQuota(
    serviceUrl: string,
    managementKey: string,
    name: string,
  ): Promise<void> {
    const base = resolveServiceUrl(serviceUrl);
    await axios.delete(
      `${base}/v0/management/usage/auth-file-quotas`,
      {
        params: { name },
        headers: { Authorization: `Bearer ${managementKey}` },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
  },

  async fetchMemoryStats(): Promise<MemoryStatsPayload> {
    const [apiKeyUsageResult, authFilesResult] = await Promise.allSettled([
      apiClient.get<ApiKeyUsageResponse>('/api-key-usage', {
        timeout: 15 * 1000,
      }),
      apiClient.get<AuthFilesResponse>('/auth-files', {
        timeout: 15 * 1000,
      }),
    ]);

    if (apiKeyUsageResult.status === 'rejected' && authFilesResult.status === 'rejected') {
      throw apiKeyUsageResult.reason;
    }

    if (apiKeyUsageResult.status === 'rejected') {
      console.warn('[UsageStats] /api-key-usage request failed:', apiKeyUsageResult.reason);
    }

    return {
      apiKeyUsage: apiKeyUsageResult.status === 'fulfilled' ? apiKeyUsageResult.value : {},
      authFiles:
        authFilesResult.status === 'fulfilled' && Array.isArray(authFilesResult.value?.files)
          ? authFilesResult.value.files
          : [],
    };
  },

  async fetchMemoryUsageQueueDetails(maxRecords = 50): Promise<MemoryRequestLogDetail[]> {
    const records = await apiClient.get<unknown[]>('/usage-queue', {
      params: { count: Math.max(1, Math.min(maxRecords, 500)) },
      timeout: 15 * 1000,
    });

    if (!Array.isArray(records)) {
      return [];
    }

    return records.reduce<MemoryRequestLogDetail[]>((result, record) => {
      const detail = parseMemoryUsageQueueDetail(record);
      if (detail) {
        result.push(detail);
      }
      return result;
    }, []);
  },

  async fetchRequestHeatmap(
    serviceUrl: string,
    managementKey: string,
    range: DashboardTimeRange,
  ): Promise<HeatmapResponse> {
    const base = resolveServiceUrl(serviceUrl);
    const response = await axios.get<unknown>(
      `${base}/v0/management/usage/request-heatmap`,
      {
        params: { range },
        headers: { Authorization: `Bearer ${managementKey}` },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
    return normalizeHeatmapResponse(response.data, range);
  },

  async fetchProviders(
    serviceUrl: string,
    managementKey: string,
    range: DashboardTimeRange,
  ): Promise<ProvidersResponse> {
    const base = resolveServiceUrl(serviceUrl);
    const response = await axios.get<unknown>(
      `${base}/v0/management/usage/providers`,
      {
        params: { range },
        headers: { Authorization: `Bearer ${managementKey}` },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
    return normalizeProvidersResponse(response.data, range);
  },

  async fetchAccounts(
    serviceUrl: string,
    managementKey: string,
  ): Promise<AccountsResponse> {
    const base = resolveServiceUrl(serviceUrl);
    const response = await axios.get<unknown>(
      `${base}/v0/management/usage/accounts`,
      {
        params: { active_only: true },
        headers: { Authorization: `Bearer ${managementKey}` },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
    return normalizeAccountsResponse(response.data);
  },

  async fetchApiKeyDetails(
    serviceUrl: string,
    managementKey: string,
    range: DashboardTimeRange,
  ): Promise<Map<string, UsageStatsGroupRow[]>> {
    const base = resolveServiceUrl(serviceUrl);
    const response = await axios.get<unknown>(
      `${base}/v0/management/usage/api-key-details`,
      {
        params: { range },
        headers: { Authorization: `Bearer ${managementKey}` },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
    return normalizeApiKeyDetailsResponse(response.data);
  },

  async fetchMemoryRequestLogDetails(maxRequestLogs = 50): Promise<MemoryRequestLogDetail[]> {
    const logs = await apiClient.get<{ lines?: string[] }>('/logs', {
      timeout: 15 * 1000,
    });
    const lines = Array.isArray(logs.lines) ? logs.lines : [];
    const candidates = collectRequestLogCandidates(lines, maxRequestLogs);

    const details = await Promise.allSettled(
      candidates.map(async (candidate) => {
        try {
          const response = await apiClient.getRaw(
            `/request-log-by-id/${encodeURIComponent(candidate.id)}`,
            {
              responseType: 'text',
              timeout: 8 * 1000,
            }
          );
          return parseMemoryRequestLogDetail(
            await responseDataToText(response.data),
            candidate
          );
        } catch {
          return parseMemoryRequestLogDetail(candidate.line, candidate);
        }
      })
    );

    return details.reduce<MemoryRequestLogDetail[]>((result, item) => {
      if (item.status === 'fulfilled' && item.value) {
        result.push(item.value);
      }
      return result;
    }, []);
  },

  async fetchProviderConfigs(): Promise<ProviderConfigSnapshot> {
    const [codexResult, claudeResult, geminiResult, openaiResult, vertexResult, authFilesResult] =
      await Promise.allSettled([
        apiClient.get('/codex-api-key', { timeout: 10 * 1000 }),
        apiClient.get('/claude-api-key', { timeout: 10 * 1000 }),
        apiClient.get('/gemini-api-key', { timeout: 10 * 1000 }),
        apiClient.get('/openai-compatibility', { timeout: 10 * 1000 }),
        apiClient.get('/vertex-api-key', { timeout: 10 * 1000 }),
        apiClient.get<AuthFilesResponse>('/auth-files', { timeout: 10 * 1000 }),
      ]);

    const entries: ProviderConfigEntry[] = [];

    const extractArray = (data: unknown, key: string): unknown[] => {
      if (Array.isArray(data)) return data;
      if (!isRecord(data)) return [];
      const candidate = (data as Record<string, unknown>)[key] ?? data;
      return Array.isArray(candidate) ? candidate : [];
    };

    const readAuthIndex = (r: Record<string, unknown>): string => {
      for (const k of AUTH_INDEX_KEYS) {
        const v = r[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (typeof v === 'number') return String(v);
      }
      return '';
    };

    const addConfigEntry = (provider: string, type: string, r: Record<string, unknown>) => {
      let authIndex = readAuthIndex(r);
      if (!authIndex) {
        const apiKey = String(r['api-key'] ?? r.apiKey ?? '');
        const prefix = String(r.prefix ?? '');
        authIndex = `${provider}:${prefix || apiKey.slice(0, 8) || entries.length}`;
      }
      entries.push({
        authIndex,
        provider: provider.toLowerCase(),
        type,
        name: String(r.name ?? type),
        prefix: String(r.prefix ?? ''),
        baseUrl: String(r['base-url'] ?? r.baseUrl ?? r.base_url ?? ''),
        apiKey: String(r['api-key'] ?? r.apiKey ?? ''),
      });
    };

    if (codexResult.status === 'fulfilled') {
      for (const item of extractArray(codexResult.value, 'codex-api-key')) {
        if (isRecord(item)) addConfigEntry('codex', 'codex-apikey', item as Record<string, unknown>);
      }
    }

    if (claudeResult.status === 'fulfilled') {
      for (const item of extractArray(claudeResult.value, 'claude-api-key')) {
        if (isRecord(item)) addConfigEntry('claude', 'claude-apikey', item as Record<string, unknown>);
      }
    }

    if (geminiResult.status === 'fulfilled') {
      for (const item of extractArray(geminiResult.value, 'gemini-api-key')) {
        if (isRecord(item)) addConfigEntry('gemini', 'gemini-apikey', item as Record<string, unknown>);
      }
    }

    if (openaiResult.status === 'fulfilled') {
      for (const item of extractArray(openaiResult.value, 'openai-compatibility')) {
        if (!isRecord(item)) continue;
        const prov = item as Record<string, unknown>;
        const providerName = String(prov.name ?? 'openai-compat').toLowerCase();
        const provAuthIndex = readAuthIndex(prov) || `${providerName}:${entries.length}`;
        const provBaseUrl = String(prov['base-url'] ?? prov.baseUrl ?? prov.base_url ?? '');
        entries.push({
          authIndex: provAuthIndex,
          provider: providerName,
          type: 'openai-compatibility',
          name: String(prov.name ?? 'openai-compat'),
          prefix: String(prov.prefix ?? ''),
          baseUrl: provBaseUrl,
          apiKey: '',
        });
        const apiEntries = prov['api-key-entries'] ?? prov.apiKeyEntries;
        if (Array.isArray(apiEntries)) {
          for (const entry of apiEntries) {
            if (!isRecord(entry)) continue;
            const entryAuthIndex = readAuthIndex(entry as Record<string, unknown>);
            if (entryAuthIndex && entryAuthIndex !== provAuthIndex) {
              entries.push({
                authIndex: entryAuthIndex,
                provider: providerName,
                type: 'openai-compatibility',
                name: String(prov.name ?? 'openai-compat'),
                prefix: String(prov.prefix ?? ''),
                baseUrl: provBaseUrl,
                apiKey: String((entry as Record<string, unknown>)['api-key'] ?? ''),
              });
            }
          }
        }
      }
    }

    if (vertexResult.status === 'fulfilled') {
      for (const item of extractArray(vertexResult.value, 'vertex-api-key')) {
        if (isRecord(item)) addConfigEntry('vertex', 'vertex-apikey', item as Record<string, unknown>);
      }
    }

    const authFiles =
      authFilesResult.status === 'fulfilled' && Array.isArray(authFilesResult.value?.files)
        ? authFilesResult.value.files
        : [];

    return { entries, authFiles };
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

type RequestLogCandidate = {
  id: string;
  line: string;
  success: boolean;
};

const PROVIDER_LOG_KEYS = ['provider', 'type', 'channel', 'service', 'authType', 'auth_type'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractRequestId(line: string): string | null {
  const match = line.match(/\b([a-f0-9]{8})\b/i);
  return match ? match[1] : null;
}

function extractStatusCode(text: string): number | null {
  const patterns = [
    /\|\s*([1-5]\d{2})\s*\|/,
    /\bstatus(?:Code)?["']?\s*[:=]\s*([1-5]\d{2})\b/i,
    /\b([1-5]\d{2})\s+(?:OK|Created|Accepted|No Content|Bad Request|Unauthorized|Forbidden|Not Found|Internal Server Error)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function collectRequestLogCandidates(lines: string[], maxRequestLogs: number): RequestLogCandidate[] {
  const limit = Math.max(0, Math.min(maxRequestLogs, 80));
  const seen = new Set<string>();
  const candidates: RequestLogCandidate[] = [];

  for (let index = lines.length - 1; index >= 0 && candidates.length < limit; index -= 1) {
    const line = lines[index];
    const id = extractRequestId(line);
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    const statusCode = extractStatusCode(line);
    candidates.push({
      id,
      line,
      success: statusCode == null ? true : statusCode < 400,
    });
  }

  return candidates.reverse();
}

async function responseDataToText(data: unknown): Promise<string> {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof Blob) {
    return data.text();
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  return String(data ?? '');
}

function readTextValueFromLog(text: string, keys: string[]): string {
  for (const key of keys) {
    const escaped = escapeRegExp(key);
    const quotedPattern = new RegExp(
      `(?:["']${escaped}["']|\\b${escaped}\\b)\\s*[:=]\\s*["']([^"'\\n\\r]+)["']`,
      'i'
    );
    const quotedMatch = text.match(quotedPattern);
    if (quotedMatch?.[1]?.trim()) {
      return quotedMatch[1].trim();
    }
    const unquotedPattern = new RegExp(
      `(?:["']${escaped}["']|\\b${escaped}\\b)\\s*[:=]\\s*([^"'\\s,}\\]]+)`,
      'i'
    );
    const unquotedMatch = text.match(unquotedPattern);
    if (unquotedMatch?.[1]?.trim()) {
      return unquotedMatch[1].trim();
    }
  }

  return '';
}

function readNumberValueFromLog(text: string, keys: string[]): number {
  let value = 0;

  keys.forEach((key) => {
    const escaped = escapeRegExp(key);
    const pattern = new RegExp(
      `(?:["']${escaped}["']|\\b${escaped}\\b)\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)`,
      'gi'
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) {
        value = Math.max(value, parsed);
      }
    }
  });

  return value;
}

function readCachedTokensFromLog(text: string): number {
  const additiveKeys = [
    'cache_read_input_tokens',
    'cacheReadInputTokens',
    'cache_creation_input_tokens',
    'cacheCreationInputTokens',
  ];
  const additive = additiveKeys.reduce(
    (total, key) => total + readNumberValueFromLog(text, [key]),
    0
  );

  return Math.max(additive, readNumberValueFromLog(text, CACHED_TOKEN_KEYS));
}

function readTokenCountsFromLog(text: string): TokenCounts {
  const inputTokens = readNumberValueFromLog(text, INPUT_TOKEN_KEYS);
  const outputTokens = readNumberValueFromLog(text, OUTPUT_TOKEN_KEYS);
  const reasoningTokens = readNumberValueFromLog(text, REASONING_TOKEN_KEYS);
  const cachedTokens = readCachedTokensFromLog(text);
  const totalTokens = readNumberValueFromLog(text, TOTAL_TOKEN_KEYS);

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens,
  };
}

function parseMemoryRequestLogDetail(
  text: string,
  candidate: RequestLogCandidate
): MemoryRequestLogDetail | null {
  let provider = '';
  let model = '';
  let authIndex: string | undefined;
  let tokens: TokenCounts = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 };

  try {
    const json = JSON.parse(text);
    if (json && typeof json === 'object') {
      const rec = json as Record<string, unknown>;
      provider = normalizeProviderKey(String(readKnownField(rec, PROVIDER_LOG_KEYS) ?? ''), '');
      const rawModel = readKnownField(rec, SINGLE_MODEL_KEYS);
      model = (rawModel != null && String(rawModel) !== 'undefined') ? String(rawModel) : readTextValueFromLog(text, SINGLE_MODEL_KEYS);
      const rawAuthIndex = readKnownField(rec, AUTH_INDEX_KEYS);
      authIndex = normalizeRecentRequestAuthIndex(rawAuthIndex) ?? undefined;
      tokens = readTokenCounts(rec);
      if (tokenCountTotal(tokens) <= 0) {
        tokens = readTokenCountsFromLog(text);
      }
    }
  } catch {
    tokens = readTokenCountsFromLog(text);
    model = readTextValueFromLog(text, SINGLE_MODEL_KEYS);
    provider = normalizeProviderKey(readTextValueFromLog(text, PROVIDER_LOG_KEYS), '');
    authIndex = normalizeRecentRequestAuthIndex(readTextValueFromLog(text, AUTH_INDEX_KEYS)) ?? undefined;
  }

  const statusCode = extractStatusCode(text);
  const success = statusCode == null ? candidate.success : statusCode < 400;

  if (!model && tokenCountTotal(tokens) <= 0) {
    return null;
  }

  return {
    id: candidate.id,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(authIndex ? { authIndex } : {}),
    success,
    tokens,
  };
}

function readKnownField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function readTokenNumberField(
  record: Record<string, unknown>,
  keys: string[],
  options: { skipObjectKeys?: string[] } = {}
): number {
  const skipObjectKeys = new Set(options.skipObjectKeys ?? []);

  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }

    const value = record[key];
    if (skipObjectKeys.has(key) && isRecord(value)) {
      continue;
    }

    const total = normalizeUsageTotal(value);
    if (total > 0) {
      return total;
    }
  }

  return 0;
}

function readRecentRequestBuckets(record: Record<string, unknown>): RecentRequestBucket[] {
  return normalizeRecentRequestBuckets(readKnownField(record, RECENT_REQUEST_KEYS));
}

function readUsageCounts(record: Record<string, unknown>): { success: number; failure: number } {
  let success = normalizeUsageTotal(readKnownField(record, SUCCESS_KEYS));
  const failure = normalizeUsageTotal(readKnownField(record, FAILURE_KEYS));
  if (success + failure > 0) {
    const requestTotal = normalizeUsageTotal(readKnownField(record, REQUEST_TOTAL_KEYS));
    if (requestTotal > success + failure) {
      success += requestTotal - success - failure;
    }
    return { success, failure };
  }

  const requestTotal = normalizeUsageTotal(readKnownField(record, REQUEST_TOTAL_KEYS));
  if (requestTotal > 0) {
    return { success: requestTotal, failure: 0 };
  }

  return sumRecentRequests(readRecentRequestBuckets(record));
}

function unwrapMemoryStatsPayload(raw: MemoryStatsPayload | ApiKeyUsageResponse): MemoryStatsPayload {
  if (
    isRecord(raw) &&
    ('apiKeyUsage' in raw || 'authFiles' in raw)
  ) {
    return raw as MemoryStatsPayload;
  }

  return { apiKeyUsage: raw as ApiKeyUsageResponse, authFiles: [] };
}

function normalizeProviderKey(value: unknown, fallback = 'unknown'): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return normalized || fallback;
}

function createEmptyGroupRow(input: {
  key: string;
  label: string;
  provider?: string;
  authIndex?: string;
  apiKeyHash?: string;
  model?: string;
}): UsageStatsGroupRow {
  return {
    key: input.key,
    label: input.label,
    requests: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    provider: input.provider,
    authIndex: input.authIndex,
    apiKeyHash: input.apiKeyHash,
    model: input.model,
  };
}

function addCounts(row: UsageStatsGroupRow, success: number, failure: number) {
  row.successCount += success;
  row.failureCount += failure;
  row.requests = row.successCount + row.failureCount;
  row.successRate = row.requests > 0 ? row.successCount / row.requests : 0;
}

function emptyTokenCounts(): TokenCounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
  };
}

function tokenCountTotal(tokens: TokenCounts): number {
  const direct = tokens.totalTokens;
  if (direct > 0) {
    return direct;
  }

  const generated = tokens.inputTokens + tokens.outputTokens + tokens.reasoningTokens;
  if (generated > 0) {
    return generated;
  }

  return (
    tokens.inputTokens +
    tokens.outputTokens +
    tokens.reasoningTokens +
    tokens.cachedTokens
  );
}

function addTokenCountValues(left: TokenCounts, right: TokenCounts): TokenCounts {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function chooseRicherTokenCounts(left: TokenCounts, right: TokenCounts): TokenCounts {
  return tokenCountTotal(right) > tokenCountTotal(left) ? right : left;
}

function readDirectTokenCounts(record: Record<string, unknown>): TokenCounts {
  const inputTokens = readTokenNumberField(record, INPUT_TOKEN_KEYS);
  const outputTokens = readTokenNumberField(record, OUTPUT_TOKEN_KEYS);
  const reasoningTokens = readTokenNumberField(record, REASONING_TOKEN_KEYS);
  const cachedTokens = Math.max(
    readTokenNumberField(record, CACHED_TOKEN_KEYS),
    readTokenNumberField(record, CACHE_READ_TOKEN_KEYS) +
      readTokenNumberField(record, CACHE_CREATION_TOKEN_KEYS)
  );
  const totalTokens = readTokenNumberField(record, TOTAL_TOKEN_KEYS, {
    skipObjectKeys: ['tokens'],
  });

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens,
  };
}

function readTokenCounts(value: unknown, depth = 0): TokenCounts {
  const record = toRecord(value);
  if (!record || depth > 3) {
    return emptyTokenCounts();
  }

  let best = readDirectTokenCounts(record);

  USAGE_OBJECT_KEYS.forEach((key) => {
    best = chooseRicherTokenCounts(best, readTokenCounts(record[key], depth + 1));
  });

  NESTED_USAGE_SOURCE_KEYS.forEach((key) => {
    best = chooseRicherTokenCounts(best, readTokenCounts(record[key], depth + 1));
  });

  return best;
}

function readModelContainerTokenCounts(record: Record<string, unknown>): TokenCounts {
  return MODEL_USAGE_KEYS.reduce<TokenCounts>((total, key) => {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.reduce<TokenCounts>(
        (sum, item) => addTokenCountValues(sum, readTokenCounts(item)),
        total
      );
    }

    const modelStats = toRecord(value);
    if (!modelStats) {
      return total;
    }

    return Object.entries(modelStats).reduce<TokenCounts>((sum, [model, stats]) => {
      if (MODEL_USAGE_IGNORED_KEYS.has(model)) {
        return sum;
      }
      return addTokenCountValues(sum, readTokenCounts(stats));
    }, total);
  }, emptyTokenCounts());
}

function readAggregateTokenCounts(value: unknown): TokenCounts {
  const direct = readTokenCounts(value);
  const record = toRecord(value);
  if (!record) {
    return direct;
  }

  const fromModels = readModelContainerTokenCounts(record);
  return tokenCountTotal(direct) > 0 ? direct : fromModels;
}

function readUsageQueueSuccess(record: Record<string, unknown>): boolean {
  const failedValue = record.failed;
  if (typeof failedValue === 'boolean') {
    return !failedValue;
  }

  const fail = toRecord(record.fail);
  const statusCode = fail ? normalizeUsageTotal(fail.status_code ?? fail.statusCode) : 0;
  return statusCode <= 0 || statusCode < 400;
}

const NESTED_SOURCE_KEYS = ['request', 'requestBody', 'request_body', 'body', 'payload', 'params', 'response', 'responseBody', 'response_body', 'result', 'data'];

function readUsageQueueTextField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

function readUsageQueueTextFieldDeep(record: Record<string, unknown>, keys: string[], depth = 0): string {
  if (depth > 4) return '';
  const top = readUsageQueueTextField(record, keys);
  if (top) return top;
  for (const nestedKey of NESTED_SOURCE_KEYS) {
    const nested = record[nestedKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const result = readUsageQueueTextFieldDeep(nested as Record<string, unknown>, keys, depth + 1);
      if (result) return result;
    }
  }
  return '';
}

function parseMemoryUsageQueueDetail(value: unknown): MemoryRequestLogDetail | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const tokens = readAggregateTokenCounts(record);
  const model =
    readUsageQueueTextFieldDeep(record, SINGLE_MODEL_KEYS) ||
    readUsageQueueTextFieldDeep(record, ['alias']);
  const provider = normalizeProviderKey(readUsageQueueTextFieldDeep(record, PROVIDER_LOG_KEYS), '');
  const rawAuthIndex = readUsageQueueTextFieldDeep(record, AUTH_INDEX_KEYS);
  const authIndex = normalizeRecentRequestAuthIndex(rawAuthIndex);

  if (!model && tokenCountTotal(tokens) <= 0) {
    return null;
  }

  const id = readUsageQueueTextFieldDeep(record, ['request_id', 'requestId', 'id', 'trace_id', 'traceId']);
  const timestamp = readUsageQueueTextFieldDeep(record, ['timestamp', 'time', 'created_at', 'createdAt']);
  const apiKey = readUsageQueueTextFieldDeep(record, ['api_key', 'apiKey', 'client_api_key', 'clientApiKey', 'key']);

  return {
    ...(id ? { id } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(authIndex ? { authIndex } : {}),
    ...(apiKey ? { apiKey } : {}),
    success: readUsageQueueSuccess(record),
    tokens,
  };
}

function applyTokenCounts(row: UsageStatsGroupRow, tokens: TokenCounts) {
  row.inputTokens += tokens.inputTokens;
  row.outputTokens += tokens.outputTokens;
  row.reasoningTokens += tokens.reasoningTokens;
  row.cachedTokens += tokens.cachedTokens;
  row.cacheReadTokens = (row.cacheReadTokens ?? 0) + (tokens.cacheReadTokens ?? 0);
  row.cacheCreationTokens = (row.cacheCreationTokens ?? 0) + (tokens.cacheCreationTokens ?? 0);
  row.totalTokens += tokenCountTotal(tokens);
}

function addTokenCounts(row: UsageStatsGroupRow, value: unknown) {
  applyTokenCounts(row, readAggregateTokenCounts(value));
}

function collectModelCounts(
  value: unknown,
  bucket: Map<string, number>
) {
  if (!isRecord(value)) {
    return;
  }

  Object.entries(value).forEach(([model, countValue]) => {
    if (MODEL_USAGE_IGNORED_KEYS.has(model)) {
      return;
    }
    const count = normalizeUsageTotal(countValue);
    if (count <= 0) {
      return;
    }
    bucket.set(model, (bucket.get(model) ?? 0) + count);
  });
}

function readStringField(record: Record<string, unknown>, keys: string[]): string {
  const value = readKnownField(record, keys);
  return typeof value === 'string' ? value.trim() : '';
}

function readModelName(value: unknown, depth = 0): string {
  const record = toRecord(value);
  if (!record || depth > 3) {
    return '';
  }

  const direct = readStringField(record, SINGLE_MODEL_KEYS);
  if (direct) {
    return direct;
  }

  for (const key of NESTED_USAGE_SOURCE_KEYS) {
    const nested = readModelName(record[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  return '';
}

function readNumberField(record: Record<string, unknown>, keys: string[]): number {
  return normalizeUsageTotal(readKnownField(record, keys));
}

function normalizeTrendBuckets(value: unknown): TrendBucket[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const buckets = value.reduce<TrendBucket[]>((result, item) => {
    const record = toRecord(item);
    if (!record) return result;

    const rawTimestamp =
      readKnownField(record, ['timestamp', 'time', 'bucketTs', 'bucket_ts']) ??
      0;
    const timestamp =
      typeof rawTimestamp === 'number'
        ? rawTimestamp
        : typeof rawTimestamp === 'string'
          ? Number(rawTimestamp) || new Date(rawTimestamp).getTime()
          : 0;
    const bucketValue = readNumberField(record, ['value', 'count', 'total', 'tokens', 'requests']);

    if (Number.isFinite(timestamp) && timestamp > 0) {
      result.push({ timestamp, value: bucketValue });
    }
    return result;
  }, []);

  return buckets.length > 0 ? buckets : undefined;
}

function normalizeHeatmapBuckets(value: unknown): HeatmapBucket[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const buckets = value.reduce<HeatmapBucket[]>((result, item) => {
    const record = toRecord(item);
    if (!record) return result;

    const timeStart = readNumberField(record, ['timeStart', 'time_start', 'start', 'startMs', 'start_ms']);
    const timeEnd = readNumberField(record, ['timeEnd', 'time_end', 'end', 'endMs', 'end_ms']);
    const success = readNumberField(record, SUCCESS_COUNT_KEYS);
    const failed = readNumberField(record, FAILURE_COUNT_KEYS);
    const total = success + failed;
    const explicitRate = readNumberField(record, SUCCESS_RATE_KEYS);

    if (timeStart > 0 && timeEnd > timeStart) {
      result.push({
        timeStart,
        timeEnd,
        success,
        failed,
        successRate: total > 0 ? (explicitRate || success / total) : 0,
      });
    }
    return result;
  }, []);

  return buckets.length > 0 ? buckets : undefined;
}

function normalizePersistentGroupRows(value: unknown): UsageStatsGroupRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<UsageStatsGroupRow[]>((result, item) => {
    const row = normalizePersistentGroupRow(item);
    if (row) {
      result.push(row);
    }
    return result;
  }, []);
}

function normalizePersistentGroupRow(value: unknown): UsageStatsGroupRow | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const tokens = readAggregateTokenCounts(record);
  const model = readStringField(record, MODEL_NAME_KEYS);
  const provider = readStringField(record, GROUP_PROVIDER_KEYS);
  const label =
    readStringField(record, GROUP_LABEL_KEYS) ||
    model ||
    provider ||
    readStringField(record, GROUP_KEY_KEYS) ||
    'unknown';
  const key =
    readStringField(record, GROUP_KEY_KEYS) ||
    (provider && model ? `${provider}/${model}` : label);

  const successCount = readNumberField(record, SUCCESS_COUNT_KEYS);
  const failureCount = readNumberField(record, FAILURE_COUNT_KEYS);
  const explicitRequests = readNumberField(record, TOTAL_REQUEST_KEYS);
  const requests = explicitRequests > 0 ? explicitRequests : successCount + failureCount;
  const explicitSuccessRate = readNumberField(record, SUCCESS_RATE_KEYS);
  const childModels = normalizePersistentGroupRows(readKnownField(record, CHILD_MODEL_KEYS));
  const apiKeyHash = readStringField(record, API_KEY_HASH_KEYS);
  const apiKeyIdentity = readStringField(record, API_KEY_IDENTITY_KEYS);
  const cachedTokens = Math.max(tokens.cachedTokens, readNumberField(record, CACHE_TOKEN_KEYS));
  const cacheReadTokens = Math.max(
    readNumberField(record, ['cacheReadTokens', 'cache_read_tokens']),
    0
  );
  const cacheCreationTokens = Math.max(
    readNumberField(record, ['cacheCreationTokens', 'cache_creation_tokens']),
    0
  );
  const totalTokens = tokenCountTotal({ ...tokens, cachedTokens });

  return {
    key,
    label,
    requests,
    successCount,
    failureCount,
    successRate: requests > 0 ? (explicitSuccessRate || successCount / requests) : 0,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    reasoningTokens: tokens.reasoningTokens,
    cachedTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens,
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(apiKeyHash ? { apiKeyHash } : {}),
    ...(apiKeyIdentity ? { apiKeyIdentity } : {}),
    ...(readStringField(record, AUTH_INDEX_KEYS) ? { authIndex: readStringField(record, AUTH_INDEX_KEYS) } : {}),
    ...(childModels.length > 0 ? { childModels } : {}),
  };
}

function normalizePersistentStatsResponse(
  raw: unknown,
  fallbackRange: DashboardTimeRange,
): UsageStatsResponse {
  const record = toRecord(raw);
  if (!record) {
    throw new Error('Invalid usage stats response');
  }

  const summaryRecord = toRecord(record.summary) ?? {};
  const byApiKey = normalizePersistentGroupRows(
    readKnownField(record, ['byApiKey', 'by_api_key', 'apiKeys', 'api_keys'])
  );
  const byModel = normalizePersistentGroupRows(
    readKnownField(record, ['byModel', 'by_model', 'models', 'modelUsage', 'model_usage'])
  );
  const byProvider = normalizePersistentGroupRows(
    readKnownField(record, ['byProvider', 'by_provider', 'providers'])
  );
  const byAccount = normalizePersistentGroupRows(
    readKnownField(record, ['byAccount', 'by_account', 'accounts'])
  );
  const heatmap = normalizeHeatmapBuckets(readKnownField(record, ['heatmap', 'buckets'])) ?? [];

  const summaryTokens = readAggregateTokenCounts(summaryRecord);
  const rowTokenTotal = byApiKey.reduce((sum, row) => sum + row.totalTokens, 0);
  const totalRequests =
    readNumberField(summaryRecord, TOTAL_REQUEST_KEYS) ||
    byApiKey.reduce((sum, row) => sum + row.requests, 0);
  const successCount =
    readNumberField(summaryRecord, SUCCESS_COUNT_KEYS) ||
    byApiKey.reduce((sum, row) => sum + row.successCount, 0);
  const failureCount =
    readNumberField(summaryRecord, FAILURE_COUNT_KEYS) ||
    byApiKey.reduce((sum, row) => sum + row.failureCount, 0);
  const cachedTokens = Math.max(
    summaryTokens.cachedTokens,
    readNumberField(summaryRecord, CACHE_TOKEN_KEYS)
  );
  const cacheReadTokens = Math.max(
    readNumberField(summaryRecord, ['cacheReadTokens', 'cache_read_tokens']),
    0
  );
  const cacheCreationTokens = Math.max(
    readNumberField(summaryRecord, ['cacheCreationTokens', 'cache_creation_tokens']),
    0
  );
  const rpm = readNumberField(summaryRecord, ['rpm', 'RPM']);
  const tpm = readNumberField(summaryRecord, ['tpm', 'TPM']);
  const coveredMinutes = readNumberField(summaryRecord, COVERED_MINUTES_KEYS);

  const summary: UsageStatsSummary = {
    totalRequests,
    successCount,
    failureCount,
    successRate: totalRequests > 0 ? successCount / totalRequests : 0,
    inputTokens: summaryTokens.inputTokens,
    outputTokens: summaryTokens.outputTokens,
    reasoningTokens: summaryTokens.reasoningTokens,
    cachedTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: tokenCountTotal({ ...summaryTokens, cachedTokens }) || rowTokenTotal,
    rpm,
    tpm,
  };

  const periodStartMs = readNumberField(summaryRecord, PERIOD_START_KEYS);
  const periodEndMs = readNumberField(summaryRecord, PERIOD_END_KEYS);
  const requestTrend = normalizeTrendBuckets(readKnownField(summaryRecord, ['requestTrend', 'request_trend']));
  const tokenTrend = normalizeTrendBuckets(readKnownField(summaryRecord, ['tokenTrend', 'token_trend']));
  const inputTrend = normalizeTrendBuckets(readKnownField(summaryRecord, ['inputTrend', 'input_trend']));
  const outputTrend = normalizeTrendBuckets(readKnownField(summaryRecord, ['outputTrend', 'output_trend']));
  const inputOutputTrend = normalizeTrendBuckets(
    readKnownField(summaryRecord, ['inputOutputTrend', 'input_output_trend'])
  );
  const cacheTrend = normalizeTrendBuckets(readKnownField(summaryRecord, ['cacheTrend', 'cache_trend']));

  if (periodStartMs > 0) summary.periodStartMs = periodStartMs;
  if (periodEndMs > 0) summary.periodEndMs = periodEndMs;
  if (coveredMinutes > 0) summary.coveredMinutes = coveredMinutes;
  if (requestTrend) summary.requestTrend = requestTrend;
  if (tokenTrend) summary.tokenTrend = tokenTrend;
  if (inputTrend) summary.inputTrend = inputTrend;
  if (outputTrend) summary.outputTrend = outputTrend;
  if (inputOutputTrend) summary.inputOutputTrend = inputOutputTrend;
  if (cacheTrend) summary.cacheTrend = cacheTrend;

  return {
    source: 'postgres',
    range:
      typeof record.range === 'string'
        ? (record.range as UsageStatsResponse['range'])
        : fallbackRange,
    summary,
    byApiKey,
    byModel,
    ...(byProvider.length > 0 ? { byProvider } : {}),
    ...(byAccount.length > 0 ? { byAccount } : {}),
    ...(heatmap.length > 0 ? { heatmap } : {}),
    ...(isRecord(record.service) ? { service: record.service as unknown as UsageStatsResponse['service'] } : {}),
  };
}

function addModelRow(
  target: Map<string, UsageStatsGroupRow>,
  provider: string,
  model: string,
  success: number,
  failure: number,
  source?: unknown,
  apiKeyIdentity?: string,
) {
  const modelName = model.trim();
  if (!modelName || success + failure <= 0) {
    return;
  }

  const rowKey = `${provider}/${modelName}`;
  let row = target.get(rowKey);
  if (!row) {
    row = createEmptyGroupRow({
      key: rowKey,
      label: modelName,
      provider,
      model: modelName,
    });
    if (apiKeyIdentity) {
      row.apiKeyIdentity = apiKeyIdentity;
    }
    target.set(rowKey, row);
  }
  addCounts(row, success, failure);
  addTokenCounts(row, source);
}

function addModelRowsFromContainer(
  target: Map<string, UsageStatsGroupRow>,
  provider: string,
  value: unknown,
  apiKeyIdentity?: string,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!isRecord(item)) return;
      const modelName = readStringField(item, MODEL_NAME_KEYS);
      const { success, failure } = readUsageCounts(item);
      addModelRow(target, provider, modelName, success, failure, item, apiKeyIdentity);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  Object.entries(value).forEach(([model, stats]) => {
    if (MODEL_USAGE_IGNORED_KEYS.has(model)) {
      return;
    }

    if (isRecord(stats)) {
      const { success, failure } = readUsageCounts(stats);
      addModelRow(target, provider, model, success, failure, stats, apiKeyIdentity);
      return;
    }

    const count = normalizeUsageTotal(stats);
    addModelRow(target, provider, model, count, 0, undefined, apiKeyIdentity);
  });
}

function hasModelUsageContainer(record: Record<string, unknown>): boolean {
  return MODEL_USAGE_KEYS.some((key) => {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    const modelStats = toRecord(value);
    return Boolean(modelStats && Object.keys(modelStats).length > 0);
  });
}

function addModelRowsFromRecord(
  target: Map<string, UsageStatsGroupRow>,
  provider: string,
  record: Record<string, unknown>,
  apiKeyIdentity?: string,
) {
  const successes = new Map<string, number>();
  const failures = new Map<string, number>();
  collectModelCounts(readKnownField(record, SUCCESS_KEYS), successes);
  collectModelCounts(readKnownField(record, FAILURE_KEYS), failures);

  const models = new Set([...successes.keys(), ...failures.keys()]);
  models.forEach((model) => {
    addModelRow(target, provider, model, successes.get(model) ?? 0, failures.get(model) ?? 0, undefined, apiKeyIdentity);
  });

  MODEL_USAGE_KEYS.forEach((key) => addModelRowsFromContainer(target, provider, record[key], apiKeyIdentity));

  const modelName = readModelName(record);
  if (modelName && models.size === 0 && !hasModelUsageContainer(record)) {
    const { success, failure } = readUsageCounts(record);
    addModelRow(target, provider, modelName, success, failure, record, apiKeyIdentity);
  }
}

function getAuthFileDedupeKey(file: AuthFileItem, index: number): string {
  const record = file as Record<string, unknown>;
  const authIndex = normalizeRecentRequestAuthIndex(readKnownField(record, AUTH_INDEX_KEYS));
  if (authIndex) {
    return `auth-index:${authIndex}`;
  }

  const name = String(file.name ?? '').trim();
  return name ? `name:${name}` : `index:${index}`;
}

function countRecentRequests(record: Record<string, unknown>): number {
  const { success, failure } = sumRecentRequests(readRecentRequestBuckets(record));
  return success + failure;
}

function scoreMemoryRecord(record: Record<string, unknown>): number {
  const { success, failure } = readUsageCounts(record);
  return (success + failure) * 1000 + countRecentRequests(record);
}

function selectAuthFilesWithStats(files: AuthFileItem[]): AuthFileItem[] {
  const grouped = new Map<string, { file: AuthFileItem; score: number; index: number }>();

  files.forEach((file, index) => {
    const key = getAuthFileDedupeKey(file, index);
    const score = scoreMemoryRecord(file as Record<string, unknown>);
    const current = grouped.get(key);
    if (!current || score > current.score) {
      grouped.set(key, { file, score, index });
    }
  });

  return Array.from(grouped.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.file);
}

function resolveApiKeyIdentity(
  mapKey: string,
  entry: Record<string, unknown>,
  configuredKeyHashes: Map<string, string>
): { identity: string; label: string } {
  const trimmedMapKey = mapKey.trim();
  const extractedKey = extractApiKeyDisplayKey(trimmedMapKey);

  if (trimmedMapKey.includes('|') && extractedKey) {
    return {
      identity: trimmedMapKey,
      label: looksLikeSha256(extractedKey)
        ? shortHashLabel(extractedKey)
        : maskApiKeyForDisplay(extractedKey),
    };
  }

  for (const hashKey of API_KEY_HASH_KEYS) {
    const trustedHash = readKnownField(entry, [hashKey]);
    if (typeof trustedHash === 'string' && trustedHash.trim()) {
      const trimmed = trustedHash.trim();
      const masked = configuredKeyHashes.get(trimmed);
      return {
        identity: trimmed,
        label: masked ?? shortHashLabel(trimmed),
      };
    }
  }

  if (looksLikeSha256(trimmedMapKey)) {
    const masked = configuredKeyHashes.get(trimmedMapKey);
    return {
      identity: trimmedMapKey,
      label: masked ?? shortHashLabel(trimmedMapKey),
    };
  }

  if (configuredKeyHashes.has(trimmedMapKey)) {
    return {
      identity: trimmedMapKey,
      label: configuredKeyHashes.get(trimmedMapKey)!,
    };
  }

  for (const [hash, masked] of configuredKeyHashes) {
    if (hash === trimmedMapKey) {
      return { identity: hash, label: masked };
    }
  }

  if (trimmedMapKey) {
    return {
      identity: trimmedMapKey,
      label: maskApiKeyForDisplay(extractedKey || trimmedMapKey),
    };
  }

  return {
    identity: 'unknown',
    label: 'unknown',
  };
}

export function collectMemoryStatsBuckets(
  raw: MemoryStatsPayload | ApiKeyUsageResponse
): RecentRequestBucket[] {
  const payload = unwrapMemoryStatsPayload(raw);

  const apiKeyBuckets: RecentRequestBucket[][] = [];
  Object.values(payload.apiKeyUsage || {}).forEach((providerEntries) => {
    if (!isRecord(providerEntries)) return;
    Object.values(providerEntries).forEach((entry) => {
      if (!isRecord(entry)) return;
      const buckets = readRecentRequestBuckets(entry as Record<string, unknown>);
      if (buckets.length > 0) {
        apiKeyBuckets.push(buckets);
      }
    });
  });

  if (apiKeyBuckets.length > 0) {
    return mergeRecentRequestBucketGroups(apiKeyBuckets);
  }

  const authFileBuckets: RecentRequestBucket[][] = [];
  selectAuthFilesWithStats(payload.authFiles || []).forEach((file) => {
    const buckets = readRecentRequestBuckets(file as Record<string, unknown>);
    if (buckets.length > 0) {
      authFileBuckets.push(buckets);
    }
  });

  if (authFileBuckets.length > 0) {
    return mergeRecentRequestBucketGroups(authFileBuckets);
  }

  return [];
}

export interface PrecomputedApiKeyHashMap {
  rawToMasked: Map<string, string>;
  hashToMasked: Map<string, string>;
}

function rangeToMinutes(r: DashboardTimeRange): number | null {
  switch (r) {
    case '12h': return 12 * 60;
    case '24h': return 24 * 60;
    case 'today': {
      const now = new Date();
      return now.getHours() * 60 + now.getMinutes();
    }
    case 'yesterday': return 24 * 60;
    case '7d': return 7 * 24 * 60;
    case '30d': return 30 * 24 * 60;
    case 'all': return null;
    default: return null;
  }
}

function rangeStartTimestamp(r: DashboardTimeRange): number | null {
  const now = Date.now();
  switch (r) {
    case '12h': return now - 12 * 60 * 60 * 1000;
    case '24h': return now - 24 * 60 * 60 * 1000;
    case 'today': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case 'yesterday': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const end = d.getTime();
      return end - 24 * 60 * 60 * 1000;
    }
    case '7d': return null;
    case '30d': return null;
    case 'all': return null;
    default: return null;
  }
}

function rangeEndTimestamp(r: DashboardTimeRange): number | null {
  const now = Date.now();
  if (r === 'yesterday') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (r === 'all') return null;
  return now;
}

export function filterBucketsByRange(
  buckets: RecentRequestBucket[],
  r: DashboardTimeRange,
): { filtered: RecentRequestBucket[]; coverage: DataCoverageInfo } {
  if (r === 'all' || r === '7d' || r === '30d') {
    const covered = buckets.length * RECENT_REQUEST_BUCKET_DURATION_MINUTES;
    return {
      filtered: buckets,
      coverage: { partial: false, coveredMinutes: covered, requestedMinutes: covered },
    };
  }

  if (buckets.length === 0) {
    const requested = rangeToMinutes(r) ?? 0;
    return {
      filtered: [],
      coverage: { partial: requested > 0, coveredMinutes: 0, requestedMinutes: requested },
    };
  }

  const now = Date.now();
  const duration = RECENT_REQUEST_BUCKET_DURATION_MINUTES * 60 * 1000;
  const bucketTimestamps = buckets.map((_, i) => now - (buckets.length - 1 - i) * duration);

  const startTs = rangeStartTimestamp(r);
  const endTs = rangeEndTimestamp(r);

  if (startTs === null) {
    const covered = buckets.length * RECENT_REQUEST_BUCKET_DURATION_MINUTES;
    const requested = rangeToMinutes(r) ?? covered;
    return {
      filtered: buckets,
      coverage: { partial: covered < requested, coveredMinutes: covered, requestedMinutes: requested },
    };
  }

  const filtered: RecentRequestBucket[] = [];
  let coveredMinutes = 0;

  for (let i = 0; i < buckets.length; i++) {
    const bucketStart = bucketTimestamps[i];
    const bucketEnd = bucketStart + duration;
    const afterStart = bucketEnd > startTs;
    const beforeEnd = endTs === null || bucketStart < endTs;
    if (afterStart && beforeEnd) {
      filtered.push(buckets[i]);
      coveredMinutes += RECENT_REQUEST_BUCKET_DURATION_MINUTES;
    }
  }

  const requested = rangeToMinutes(r) ?? 0;
  return {
    filtered,
    coverage: { partial: coveredMinutes < requested, coveredMinutes, requestedMinutes: requested },
  };
}

export function normalizeMemoryStats(
  raw: MemoryStatsPayload | ApiKeyUsageResponse,
  configuredApiKeys?: string[],
  precomputedHashMap?: PrecomputedApiKeyHashMap,
  selectedRange?: DashboardTimeRange,
): UsageStatsResponse {
  const payload = unwrapMemoryStatsPayload(raw);
  const configuredKeyHashes = new Map<string, string>();
  if (precomputedHashMap) {
    precomputedHashMap.rawToMasked.forEach((masked, raw) => {
      configuredKeyHashes.set(raw, masked);
    });
    precomputedHashMap.hashToMasked.forEach((masked, hash) => {
      configuredKeyHashes.set(hash, masked);
    });
  } else if (configuredApiKeys && Array.isArray(configuredApiKeys)) {
    configuredApiKeys
      .filter((k): k is string => typeof k === 'string' && !!k.trim())
      .forEach((k) => {
        const trimmed = k.trim();
        configuredKeyHashes.set(trimmed, maskApiKey(trimmed));
      });
  }

  const byProviderMap = new Map<string, UsageStatsGroupRow>();
  const byModelMap = new Map<string, UsageStatsGroupRow>();
  const apiKeyRowMap = new Map<string, NormalizedApiKeyRow>();
  const authFileRows: NormalizedAuthFileRow[] = [];

  const addProviderUsage = (
    providerKey: string,
    success: number,
    failure: number,
    source: unknown,
  ) => {
    let row = byProviderMap.get(providerKey);
    if (!row) {
      row = createEmptyGroupRow({
        key: providerKey,
        label: providerKey,
        provider: providerKey,
      });
      byProviderMap.set(providerKey, row);
    }
    addCounts(row, success, failure);
    addTokenCounts(row, source);
  };

  let apiKeyRequestTotal = 0;
  let apiKeyTokenCounts = emptyTokenCounts();
  let authFileRequestTotal = 0;

  const rawApiKeyEntries = Object.entries(payload.apiKeyUsage || {});
  if (rawApiKeyEntries.length === 0) {
    console.warn('[UsageStats] apiKeyUsage is empty — /api-key-usage returned no data');
  }

  for (const [rawProviderKey, keyEntries] of rawApiKeyEntries) {
    const providerKey = normalizeProviderKey(rawProviderKey);
    if (!keyEntries || typeof keyEntries !== 'object') continue;

    for (const [authKey, entry] of Object.entries(keyEntries)) {
      const rec = entry as Record<string, unknown> | null | undefined;
      if (!rec || typeof rec !== 'object') continue;
      const { success, failure } = readUsageCounts(rec);
      const resolved = resolveApiKeyIdentity(authKey, rec, configuredKeyHashes);

      let apiKeyRow = apiKeyRowMap.get(resolved.identity);
      if (!apiKeyRow) {
        apiKeyRow = {
          key: resolved.identity,
          identity: resolved.identity,
          label: resolved.label,
          requests: 0,
          successCount: 0,
          failureCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          childModels: [],
        };
        apiKeyRowMap.set(resolved.identity, apiKeyRow);
      }

      apiKeyRow.successCount += success;
      apiKeyRow.failureCount += failure;
      apiKeyRow.requests = apiKeyRow.successCount + apiKeyRow.failureCount;
      apiKeyRequestTotal += success + failure;

      const tokens = readAggregateTokenCounts(rec);
      apiKeyRow.inputTokens += tokens.inputTokens;
      apiKeyRow.outputTokens += tokens.outputTokens;
      apiKeyRow.reasoningTokens += tokens.reasoningTokens;
      apiKeyRow.cachedTokens += tokens.cachedTokens;
      apiKeyRow.totalTokens += tokenCountTotal(tokens);
      apiKeyTokenCounts = addTokenCountValues(apiKeyTokenCounts, tokens);

      addProviderUsage(providerKey, success, failure, rec);
      addModelRowsFromRecord(byModelMap, providerKey, rec);

      const attributedMap = new Map<string, UsageStatsGroupRow>();
      addModelRowsFromRecord(attributedMap, providerKey, rec, resolved.identity);
      for (const modelRow of attributedMap.values()) {
        apiKeyRow.childModels.push(modelRow);
      }
    }
  }

  for (const apiKeyRow of apiKeyRowMap.values()) {
    if (apiKeyRow.childModels.length > 0) {
      const childTotal = apiKeyRow.childModels.reduce((sum, m) => sum + m.totalTokens, 0);
      const childInput = apiKeyRow.childModels.reduce((sum, m) => sum + m.inputTokens, 0);
      const childOutput = apiKeyRow.childModels.reduce((sum, m) => sum + m.outputTokens, 0);
      const childReasoning = apiKeyRow.childModels.reduce((sum, m) => sum + m.reasoningTokens, 0);
      const childCached = apiKeyRow.childModels.reduce((sum, m) => sum + m.cachedTokens, 0);
      if (childTotal > 0) {
        apiKeyRow.totalTokens = childTotal;
        apiKeyRow.inputTokens = childInput;
        apiKeyRow.outputTokens = childOutput;
        apiKeyRow.reasoningTokens = childReasoning;
        apiKeyRow.cachedTokens = childCached;
      }
    }
  }

  const authFileItems = selectAuthFilesWithStats(payload.authFiles || []);
  const authFileLabels = authFileItems.map((file, index) => {
    const record = file as Record<string, unknown>;
    const name = String(file.name ?? '').trim();
    const rawLabel = stripJsonSuffix(name || `auth-${index + 1}`);
    const rawAuthIndex = readKnownField(record, AUTH_INDEX_KEYS);
    const authIndexKey = normalizeRecentRequestAuthIndex(rawAuthIndex);
    const key = authIndexKey || name || `auth-${index}`;
    const providerKey = normalizeProviderKey(file.provider ?? file.type, '');
    return { key, rawLabel, suffix: providerKey || String(index + 1) };
  });
  const labelMap = disambiguateLabels(authFileLabels);

  authFileItems.forEach((file, index) => {
    const record = file as Record<string, unknown>;
    const providerKey = normalizeProviderKey(file.provider ?? file.type, 'auth-files');
    const { success, failure } = readUsageCounts(record);
    const rawAuthIndex = readKnownField(record, AUTH_INDEX_KEYS);
    const authIndexKey = normalizeRecentRequestAuthIndex(rawAuthIndex);
    const name = String(file.name ?? '').trim();
    const key = authIndexKey || name || `auth-${index}`;
    const label = labelMap.get(key) ?? stripJsonSuffix(name);

    const tokens = readAggregateTokenCounts(record);

    const authChildModelMap = new Map<string, UsageStatsGroupRow>();
    addModelRowsFromRecord(authChildModelMap, providerKey, record);

    const row: NormalizedAuthFileRow = {
      key,
      label,
      provider: providerKey,
      authIndex: authIndexKey || undefined,
      requests: success + failure,
      successCount: success,
      failureCount: failure,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      reasoningTokens: tokens.reasoningTokens,
      cachedTokens: tokens.cachedTokens,
      totalTokens: tokenCountTotal(tokens),
      childModels: Array.from(authChildModelMap.values()),
    };

    authFileRequestTotal += success + failure;
    authFileRows.push(row);

    addModelRowsFromRecord(byModelMap, providerKey, record);
  });

  const byProvider = Array.from(byProviderMap.values());
  const byModel = Array.from(byModelMap.values());

  const providerRequestTotal = byProvider.reduce(
    (total, row) => total + row.requests, 0,
  );
  const totalRequests = Math.max(
    apiKeyRequestTotal + authFileRequestTotal,
    providerRequestTotal + authFileRequestTotal,
  );
  const totalSuccess = byProvider.reduce((t, r) => t + r.successCount, 0)
    + authFileRows.reduce((t, r) => t + r.successCount, 0);
  const totalFailure = byProvider.reduce((t, r) => t + r.failureCount, 0)
    + authFileRows.reduce((t, r) => t + r.failureCount, 0);

  const providerTokenCounts = byProvider.reduce<TokenCounts>(
    (totalTokens, row) =>
      addTokenCountValues(totalTokens, {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        reasoningTokens: row.reasoningTokens,
        cachedTokens: row.cachedTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: row.totalTokens,
      }),
    emptyTokenCounts(),
  );
  const authFileTokenCounts = authFileRows.reduce<TokenCounts>(
    (total, row) =>
      addTokenCountValues(total, {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        reasoningTokens: row.reasoningTokens,
        cachedTokens: row.cachedTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: row.totalTokens,
      }),
    emptyTokenCounts(),
  );
  const summaryTokens = addTokenCountValues(providerTokenCounts, authFileTokenCounts);

  const byAccount = [
    ...Array.from(apiKeyRowMap.values()).map((row) => ({
      key: `api-key/${row.identity}`,
      label: row.label,
      requests: row.requests,
      successCount: row.successCount,
      failureCount: row.failureCount,
      successRate: row.requests > 0 ? row.successCount / row.requests : 0,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
      cachedTokens: row.cachedTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: row.totalTokens,
      apiKeyHash: row.identity,
      childModels: row.childModels.length > 0 ? row.childModels : undefined,
    })),
    ...authFileRows.map((row) => ({
      key: `auth-file/${row.key}`,
      label: row.label,
      requests: row.requests,
      successCount: row.successCount,
      failureCount: row.failureCount,
      successRate: row.requests > 0 ? row.successCount / row.requests : 0,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
      cachedTokens: row.cachedTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: row.totalTokens,
      provider: row.provider,
      authIndex: row.authIndex,
      childModels: row.childModels.length > 0 ? row.childModels : undefined,
    })),
  ] as UsageStatsGroupRow[];

  const effectiveRange = selectedRange ?? 'all';
  const periodStartMs = rangeStartTimestamp(effectiveRange) ?? undefined;
  const periodEndMs = rangeEndTimestamp(effectiveRange) ?? undefined;

  const summary: UsageStatsSummary = {
      totalRequests,
      successCount: totalSuccess,
      failureCount: totalFailure,
      successRate: totalRequests > 0 ? totalSuccess / totalRequests : 0,
      inputTokens: summaryTokens.inputTokens,
      outputTokens: summaryTokens.outputTokens,
      reasoningTokens: summaryTokens.reasoningTokens,
      cachedTokens: summaryTokens.cachedTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: tokenCountTotal(summaryTokens),
      rpm: 0,
      tpm: 0,
    };

  if (periodStartMs != null) {
    summary.periodStartMs = periodStartMs;
  }
  if (periodEndMs != null) {
    summary.periodEndMs = periodEndMs;
  }

  return {
    source: 'memory' as const,
    range: effectiveRange,
    summary,
    byApiKey: Array.from(apiKeyRowMap.values()).map((row) => ({
      key: `api-key/${row.identity}`,
      label: row.label,
      requests: row.requests,
      successCount: row.successCount,
      failureCount: row.failureCount,
      successRate: row.requests > 0 ? row.successCount / row.requests : 0,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
      cachedTokens: row.cachedTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: row.totalTokens,
      childModels: row.childModels.length > 0 ? row.childModels : undefined,
    })),
    byModel,
    byProvider,
    byAccount,
  };
}

const AUTH_FILE_PROVIDER_PREFIXES = ['codex-', 'claude-', 'gemini-', 'vertex-', 'openai-'];

function authFileDisplayName(filename: string): string {
  let name = filename.replace(/\.json$/i, '');
  const lower = name.toLowerCase();
  for (const prefix of AUTH_FILE_PROVIDER_PREFIXES) {
    if (lower.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  name = name.replace(/-[0-9a-f]{8}(?=@)/i, '');
  return name;
}

function baseURLDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  let parseValue = trimmed;
  if (!parseValue.includes('://')) {
    parseValue = '//' + parseValue;
  }

  let hostPort = '';
  try {
    const parsed = new URL(parseValue);
    hostPort = parsed.host;
  } catch {
    hostPort = trimmed.split('/')[0];
  }
  if (!hostPort) return trimmed;

  let host = hostPort;
  let port = '';
  const colonIdx = hostPort.lastIndexOf(':');
  if (colonIdx > 0) {
    const possiblePort = hostPort.slice(colonIdx + 1);
    if (/^\d+$/.test(possiblePort)) {
      host = hostPort.slice(0, colonIdx);
      port = ':' + possiblePort;
    }
  }

  const parts = host.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    return parts[0] + '.***.' + parts[3] + port;
  }

  return hostPort;
}

export function buildMemoryProviders(
  payload: MemoryStatsPayload,
  config: ProviderConfigSnapshot,
): ProviderRow[] {
  const { entries: configEntries, authFiles } = config;

  const authIndexMap = new Map<string, ProviderConfigEntry>();
  for (const entry of configEntries) {
    authIndexMap.set(entry.authIndex, entry);
  }

  const apiKeyPrefixMap = new Map<string, string>();
  for (const entry of configEntries) {
    if (entry.apiKey && entry.apiKey.length >= 4) {
      apiKeyPrefixMap.set(entry.apiKey, entry.authIndex);
      apiKeyPrefixMap.set(entry.apiKey.slice(0, 8), entry.authIndex);
    }
    if (entry.prefix && entry.prefix.length >= 4) {
      apiKeyPrefixMap.set(entry.prefix, entry.authIndex);
    }
  }

  const providerConfigMap = new Map<string, ProviderConfigEntry>();
  for (const entry of configEntries) {
    if (!providerConfigMap.has(entry.provider)) {
      providerConfigMap.set(entry.provider, entry);
    }
  }

  const authFileMap = new Map<string, AuthFileItem>();
  const authFileNameByProvider = new Map<string, { name: string; displayName: string }>();
  for (const file of authFiles) {
    const record = file as Record<string, unknown>;
    const rawAuthIndex = normalizeRecentRequestAuthIndex(readKnownField(record, AUTH_INDEX_KEYS));
    const name = String(file.name ?? '').trim();
    if (rawAuthIndex) {
      authFileMap.set(rawAuthIndex, file);
    }
    if (name) {
      const providerKey = normalizeProviderKey(file.provider ?? file.type, '');
      authFileNameByProvider.set(`${providerKey}:${name}`, {
        name,
        displayName: authFileDisplayName(name) || stripJsonSuffix(name),
      });
    }
  }

  const resolveLabel = (authIndex: string, providerKey: string, configEntry: ProviderConfigEntry | undefined): string => {
    if (configEntry?.prefix) {
      return configEntry.prefix;
    }
    if (configEntry?.baseUrl) {
      const display = baseURLDisplayName(configEntry.baseUrl);
      if (display) return display;
    }
    const authFileEntry = authIndex ? authFileMap.get(authIndex) : undefined;
    if (authFileEntry) {
      const name = String(authFileEntry.name ?? '').trim();
      return authFileDisplayName(name) || stripJsonSuffix(name) || (authIndex ? `auth-index/${authIndex}` : providerKey);
    }
    if (configEntry?.name && configEntry.name !== configEntry.type) {
      return configEntry.name;
    }
    const providerConfig = providerConfigMap.get(providerKey);
    if (providerConfig?.prefix) {
      return providerConfig.prefix;
    }
    if (providerConfig?.baseUrl) {
      const display = baseURLDisplayName(providerConfig.baseUrl);
      if (display) return display;
    }
    if (authIndex) {
      return `auth-index/${authIndex}`;
    }
    return providerKey;
  };

  const updateGroupLabel = (group: ReturnType<typeof getOrCreateGroup>, candidateLabel: string) => {
    if (candidateLabel && !candidateLabel.startsWith('auth-index/') && group.label.startsWith('auth-index/')) {
      group.label = candidateLabel;
    }
  };

  type ModelAccum = {
    requests: number;
    successCount: number;
    failureCount: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    totalTokens: number;
  };

  const providerGroups = new Map<string, {
    authIndex: string;
    provider: string;
    label: string;
    type: string;
    requests: number;
    successCount: number;
    failureCount: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    totalTokens: number;
    childModels: Map<string, ModelAccum>;
  }>();

  const getOrCreateGroup = (groupKey: string, authIndex: string, provider: string, label: string, type: string) => {
    let group = providerGroups.get(groupKey);
    if (!group) {
      group = {
        authIndex,
        provider,
        label,
        type,
        requests: 0,
        successCount: 0,
        failureCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        childModels: new Map(),
      };
      providerGroups.set(groupKey, group);
    }
    return group;
  };

  const addModelToGroup = (group: ReturnType<typeof getOrCreateGroup>, modelName: string, success: number, failure: number, tokens: { inputTokens: number; outputTokens: number; reasoningTokens: number; cachedTokens: number; totalTokens: number }) => {
    let m = group.childModels.get(modelName);
    if (!m) {
      m = { requests: 0, successCount: 0, failureCount: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, totalTokens: 0 };
      group.childModels.set(modelName, m);
    }
    m.requests += success + failure;
    m.successCount += success;
    m.failureCount += failure;
    m.inputTokens += tokens.inputTokens;
    m.outputTokens += tokens.outputTokens;
    m.reasoningTokens += tokens.reasoningTokens;
    m.cachedTokens += tokens.cachedTokens;
    m.totalTokens += tokens.totalTokens;
  };

  const resolveAuthIndex = (authKey: string, entry: Record<string, unknown>): string => {
    for (const k of AUTH_INDEX_KEYS) {
      const v = entry[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    if (authKey && authIndexMap.has(authKey)) {
      return authKey;
    }
    if (authKey && apiKeyPrefixMap.has(authKey)) {
      return apiKeyPrefixMap.get(authKey)!;
    }
    for (const [prefix, idx] of apiKeyPrefixMap) {
      if (authKey.startsWith(prefix) || prefix.startsWith(authKey)) {
        return idx;
      }
    }
    return '';
  };

  const rawApiKeyEntries = Object.entries(payload.apiKeyUsage || {});
  for (const [rawProviderKey, keyEntries] of rawApiKeyEntries) {
    const providerKey = normalizeProviderKey(rawProviderKey);
    if (!keyEntries || typeof keyEntries !== 'object') continue;

    for (const [authKey, entry] of Object.entries(keyEntries)) {
      const rec = entry as Record<string, unknown> | null | undefined;
      if (!rec || typeof rec !== 'object') continue;

      const { success, failure } = readUsageCounts(rec);
      const tokens = readAggregateTokenCounts(rec);
      const authIndex = resolveAuthIndex(authKey, rec);

      const groupKey = authIndex ? `auth-index/${authIndex}/${providerKey}` : `provider/${providerKey}`;
      const configEntry = authIndex ? authIndexMap.get(authIndex) : undefined;
      const label = resolveLabel(authIndex, providerKey, configEntry);

      const group = getOrCreateGroup(groupKey, authIndex, providerKey, label, configEntry?.type ?? 'api-key');

      group.requests += success + failure;
      group.successCount += success;
      group.failureCount += failure;
      group.inputTokens += tokens.inputTokens;
      group.outputTokens += tokens.outputTokens;
      group.reasoningTokens += tokens.reasoningTokens;
      group.cachedTokens += tokens.cachedTokens;
      group.totalTokens += tokenCountTotal(tokens);

      const modelRowMap = new Map<string, UsageStatsGroupRow>();
      addModelRowsFromRecord(modelRowMap, providerKey, rec);
      for (const [, modelRow] of modelRowMap) {
        addModelToGroup(group, modelRow.model || modelRow.label, modelRow.successCount, modelRow.failureCount, {
          inputTokens: modelRow.inputTokens,
          outputTokens: modelRow.outputTokens,
          reasoningTokens: modelRow.reasoningTokens,
          cachedTokens: modelRow.cachedTokens,
          totalTokens: modelRow.totalTokens,
        });
      }
      if (modelRowMap.size === 0) {
        const modelName = readModelName(rec);
        if (modelName) {
          addModelToGroup(group, modelName, success, failure, {
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
            reasoningTokens: tokens.reasoningTokens,
            cachedTokens: tokens.cachedTokens,
            totalTokens: tokenCountTotal(tokens),
          });
        }
      }
    }
  }

  const authFileItems = selectAuthFilesWithStats(authFiles);
  const authFileLabels = authFileItems.map((file, index) => {
    const record = file as Record<string, unknown>;
    const name = String(file.name ?? '').trim();
    const rawLabel = authFileDisplayName(name) || stripJsonSuffix(name || `auth-${index + 1}`);
    const rawAuthIndex = readKnownField(record, AUTH_INDEX_KEYS);
    const authIndexKey = normalizeRecentRequestAuthIndex(rawAuthIndex);
    const key = authIndexKey || name || `auth-${index}`;
    const providerKey = normalizeProviderKey(file.provider ?? file.type, '');
    return { key, rawLabel, suffix: providerKey || String(index + 1) };
  });
  const labelMap = disambiguateLabels(authFileLabels);

  for (const file of authFileItems) {
    const record = file as Record<string, unknown>;
    const providerKey = normalizeProviderKey(file.provider ?? file.type, 'auth-files');
    const { success, failure } = readUsageCounts(record);
    const tokens = readAggregateTokenCounts(record);

    const rawAuthIndex = readKnownField(record, AUTH_INDEX_KEYS);
    const authIndex = normalizeRecentRequestAuthIndex(rawAuthIndex);
    const name = String(file.name ?? '').trim();
    const key = authIndex || name;
    const label = labelMap.get(key) ?? (authFileDisplayName(name) || stripJsonSuffix(name));

    const groupKey = authIndex ? `auth-index/${authIndex}/${providerKey}` : `auth-file/${key}`;
    const group = getOrCreateGroup(groupKey, authIndex ?? '', providerKey, label, 'auth-file');
    updateGroupLabel(group, label);

    group.requests += success + failure;
    group.successCount += success;
    group.failureCount += failure;
    group.inputTokens += tokens.inputTokens;
    group.outputTokens += tokens.outputTokens;
    group.reasoningTokens += tokens.reasoningTokens;
    group.cachedTokens += tokens.cachedTokens;
    group.totalTokens += tokenCountTotal(tokens);

    const authChildModelMap = new Map<string, UsageStatsGroupRow>();
    addModelRowsFromRecord(authChildModelMap, providerKey, record);
    for (const [modelKey, modelRow] of authChildModelMap) {
      addModelToGroup(group, modelKey, modelRow.successCount, modelRow.failureCount, {
        inputTokens: modelRow.inputTokens,
        outputTokens: modelRow.outputTokens,
        reasoningTokens: modelRow.reasoningTokens,
        cachedTokens: modelRow.cachedTokens,
        totalTokens: modelRow.totalTokens,
      });
    }
  }

  const results: ProviderRow[] = [];
  for (const group of providerGroups.values()) {
    if (group.requests === 0) continue;

    const childModels: UsageStatsGroupRow[] = Array.from(group.childModels.entries())
      .map(([modelName, m]) => ({
        key: `${group.provider}/${modelName}`,
        label: modelName,
        model: modelName,
        provider: group.provider,
        requests: m.requests,
        successCount: m.successCount,
        failureCount: m.failureCount,
        successRate: m.requests > 0 ? m.successCount / m.requests : 0,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        reasoningTokens: m.reasoningTokens,
        cachedTokens: m.cachedTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: m.totalTokens,
      }))
      .sort((a, b) => b.requests - a.requests);

    results.push({
      key: group.authIndex ? `auth-index/${group.authIndex}` : group.provider,
      label: group.label,
      provider: group.provider,
      authIndex: group.authIndex || undefined,
      requests: group.requests,
      successCount: group.successCount,
      failureCount: group.failureCount,
      successRate: group.requests > 0 ? group.successCount / group.requests : 0,
      totalTokens: group.totalTokens,
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      reasoningTokens: group.reasoningTokens,
      cachedTokens: group.cachedTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      childModels: childModels.length > 0 ? childModels : undefined,
    });
  }

  return results.sort((a, b) => b.requests - a.requests);
}

export function isCanonicalResponse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const summary = value.summary;
  if (!isRecord(summary)) return false;
  const hasByModel = Array.isArray(value.byModel);
  const hasByProvider = Array.isArray(value.byProvider);
  return hasByModel && hasByProvider;
}

export function isLegacyEventPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['details', 'events', 'records', 'items'].some(
    (key) => Array.isArray(value[key]) && (value[key] as unknown[]).length > 0
  );
}

export function deriveCoveredMinutes(data: UsageStatsResponse): number | null {
  const summary = data.summary as unknown as Record<string, unknown>;
  if (isRecord(summary)) {
    const cm = readKnownField(summary, COVERED_MINUTES_KEYS);
    const cmNum = typeof cm === 'number' && Number.isFinite(cm) && cm > 0 ? cm : 0;
    if (cmNum > 0) return cmNum;

    const startMs = readKnownField(summary, PERIOD_START_KEYS);
    const endMs = readKnownField(summary, PERIOD_END_KEYS);
    if (typeof startMs === 'number' && typeof endMs === 'number' && endMs > startMs) {
      return Math.max(1, Math.round((endMs - startMs) / 60000));
    }
  }

  if (
    data.summary.periodStartMs != null &&
    data.summary.periodEndMs != null &&
    data.summary.periodEndMs > data.summary.periodStartMs
  ) {
    return Math.max(1, Math.round((data.summary.periodEndMs - data.summary.periodStartMs) / 60000));
  }

  const trendTimestamps = extractTrendTimestamps(data.summary.requestTrend ?? data.summary.tokenTrend);
  if (trendTimestamps) return Math.max(1, Math.round((trendTimestamps.end - trendTimestamps.start) / 60000));

  return null;
}

function extractTrendTimestamps(trend: { timestamp: number }[] | undefined): { start: number; end: number } | null {
  if (!trend || trend.length < 2) return null;
  const first = trend[0].timestamp;
  const last = trend[trend.length - 1].timestamp;
  if (typeof first !== 'number' || typeof last !== 'number' || last <= first) return null;
  return { start: first, end: last };
}

export function extractApiKeyDisplayKey(identity: string): string {
  const trimmed = identity.trim();
  if (trimmed.includes('|')) {
    const segment = trimmed.slice(trimmed.lastIndexOf('|') + 1).trim();
    return segment || trimmed;
  }
  return trimmed;
}

export function maskApiKeyForDisplay(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return trimmed;
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

export function maskApiKey(key: string): string {
  return maskApiKeyForDisplay(key);
}

export async function computeApiKeyHash(apiKey: string): Promise<string> {
  const trimmed = apiKey.trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(trimmed);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function looksLikeSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function shortHashLabel(value: string): string {
  return `hash: ${value.slice(0, 8)}...`;
}

function stripJsonSuffix(name: string): string {
  return name.replace(/\.json$/i, '');
}

function disambiguateLabels(
  items: { key: string; rawLabel: string; suffix?: string }[]
): Map<string, string> {
  const result = new Map<string, string>();
  const labelCounts = new Map<string, number>();
  const labelFirstKey = new Map<string, string>();

  items.forEach((item) => {
    const count = labelCounts.get(item.rawLabel) ?? 0;
    labelCounts.set(item.rawLabel, count + 1);
    if (count === 0) {
      labelFirstKey.set(item.rawLabel, item.key);
    }
  });

  items.forEach((item) => {
    const count = labelCounts.get(item.rawLabel) ?? 1;
    if (count <= 1) {
      result.set(item.key, item.rawLabel);
    } else if (item.key === labelFirstKey.get(item.rawLabel)) {
      result.set(item.key, item.rawLabel);
    } else {
      const suffix = item.suffix;
      result.set(item.key, suffix ? `${item.rawLabel} (${suffix})` : item.rawLabel);
    }
  });

  return result;
}

const TRUSTED_API_KEY_HASH_FIELD_NAMES = new Set(API_KEY_HASH_KEYS);

export function isTrustedApiKeyHashField(fieldName: string): boolean {
  return TRUSTED_API_KEY_HASH_FIELD_NAMES.has(fieldName);
}

export { API_KEY_HASH_KEYS, PERIOD_START_KEYS, PERIOD_END_KEYS, COVERED_MINUTES_KEYS };

export { tokenCountTotal };

export function augmentMemoryStatsWithRequestLogs(
  data: UsageStatsResponse,
  details: MemoryRequestLogDetail[]
): UsageStatsResponse {
  if (details.length === 0) {
    return data;
  }

  const shouldFillTokens = data.summary.totalTokens === 0;
  const shouldAddModels = data.byModel.length === 0;
  const providerMap = new Map(
    (data.byProvider ?? []).map((row) => [row.key, { ...row }] as const)
  );
  const modelMap = new Map(
    data.byModel.map((row) => [row.key, { ...row }] as const)
  );

  const authFileAccounts = (data.byAccount ?? []).filter(
    (a) => a.key.startsWith('auth-file/') && a.requests > 0
  );
  const apiKeyAccounts = (data.byAccount ?? []).filter(
    (a) => a.key.startsWith('api-key/') && a.requests > 0
  );
  const singleAuthFile =
    authFileAccounts.length === 1 && apiKeyAccounts.length === 0
      ? { ...authFileAccounts[0] }
      : null;

  const mutableApiKeyAccounts = apiKeyAccounts.map((a) => ({ ...a }));
  const singleApiKey =
    apiKeyAccounts.length === 1 && authFileAccounts.length === 0
      ? mutableApiKeyAccounts[0]
      : null;

  const byAccount = (data.byAccount ?? []).map((a) => {
    if (singleAuthFile && a.key === singleAuthFile.key) return singleAuthFile;
    const mutableApi = mutableApiKeyAccounts.find((m) => m.key === a.key);
    if (mutableApi) return mutableApi;
    return { ...a };
  });

  const apiKeyChildModelMap = new Map<string, Map<string, UsageStatsGroupRow>>();
  for (const acct of mutableApiKeyAccounts) {
    const childMap = new Map<string, UsageStatsGroupRow>();
    const children = acct.childModels ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = { ...children[i] };
      children[i] = child;
      childMap.set(child.key, child);
    }
    acct.childModels = children;
    apiKeyChildModelMap.set(acct.key, childMap);
  }

  const providerFallback =
    (data.byProvider ?? []).filter((row) => row.requests > 0).length === 1
      ? (data.byProvider ?? []).find((row) => row.requests > 0)?.key
      : undefined;

  details.forEach((detail) => {
    const rawProviderKey = normalizeProviderKey(detail.provider, providerFallback || 'unknown');
    const providerKey = providerMap.has(rawProviderKey)
      ? rawProviderKey
      : providerFallback || rawProviderKey;

    if (shouldFillTokens) {
      const providerRow = providerMap.get(providerKey);
      if (providerRow) {
        applyTokenCounts(providerRow, detail.tokens);
      }

      if (singleAuthFile) {
        applyTokenCounts(singleAuthFile, detail.tokens);
      } else if (singleApiKey) {
        applyTokenCounts(singleApiKey, detail.tokens);
      }
    }

    if (!detail.model) {
      return;
    }

    const modelKey = `${providerKey}/${detail.model}`;
    let modelRow = modelMap.get(modelKey);
    if (!modelRow) {
      modelRow = createEmptyGroupRow({
        key: modelKey,
        label: detail.model,
        provider: providerKey,
        model: detail.model,
      });
      modelMap.set(modelKey, modelRow);
    }

    if (shouldAddModels) {
      addCounts(modelRow, detail.success ? 1 : 0, detail.success ? 0 : 1);
    }
    applyTokenCounts(modelRow, detail.tokens);

    if (singleAuthFile) {
      if (!singleAuthFile.childModels) {
        singleAuthFile.childModels = [];
      }
      const existingChild = singleAuthFile.childModels.find(
        (m) => m.key === modelKey
      );
      if (existingChild) {
        applyTokenCounts(existingChild, detail.tokens);
        if (shouldAddModels) {
          addCounts(existingChild, detail.success ? 1 : 0, detail.success ? 0 : 1);
        }
      } else {
        singleAuthFile.childModels.push({ ...modelRow });
      }
    }

    if (singleApiKey) {
      if (!singleApiKey.childModels) {
        singleApiKey.childModels = [];
      }
      const existingChild = singleApiKey.childModels.find(
        (m) => m.key === modelKey
      );
      if (existingChild) {
        applyTokenCounts(existingChild, detail.tokens);
        if (shouldAddModels) {
          addCounts(existingChild, detail.success ? 1 : 0, detail.success ? 0 : 1);
        }
      } else {
        singleApiKey.childModels.push({ ...modelRow });
      }
    }

    for (const acct of mutableApiKeyAccounts) {
      const childMap = apiKeyChildModelMap.get(acct.key);
      if (!childMap) continue;
      const existingChild = childMap.get(modelKey);
      if (existingChild) {
        applyTokenCounts(existingChild, detail.tokens);
        if (shouldAddModels) {
          addCounts(existingChild, detail.success ? 1 : 0, detail.success ? 0 : 1);
        }
      }
    }
  });

  for (const acct of mutableApiKeyAccounts) {
    const children = acct.childModels ?? [];
    if (children.length === 0) continue;
    acct.totalTokens = children.reduce((sum, m) => sum + m.totalTokens, 0);
    acct.inputTokens = children.reduce((sum, m) => sum + m.inputTokens, 0);
    acct.outputTokens = children.reduce((sum, m) => sum + m.outputTokens, 0);
    acct.reasoningTokens = children.reduce((sum, m) => sum + m.reasoningTokens, 0);
    acct.cachedTokens = children.reduce((sum, m) => sum + m.cachedTokens, 0);
  }

  const byProvider = Array.from(providerMap.values());

  const providerTokenCounts = byProvider.reduce<TokenCounts>(
    (totalTokens, row) =>
      addTokenCountValues(totalTokens, {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        reasoningTokens: row.reasoningTokens,
        cachedTokens: row.cachedTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: row.totalTokens,
      }),
    emptyTokenCounts()
  );
  const authFileTokenCounts = singleAuthFile
    ? {
        inputTokens: singleAuthFile.inputTokens,
        outputTokens: singleAuthFile.outputTokens,
        reasoningTokens: singleAuthFile.reasoningTokens,
        cachedTokens: singleAuthFile.cachedTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: singleAuthFile.totalTokens,
      }
    : emptyTokenCounts();
  const summaryTokens = addTokenCountValues(providerTokenCounts, authFileTokenCounts);

  return {
    ...data,
    byAccount,
    summary: {
      ...data.summary,
      inputTokens: shouldFillTokens ? summaryTokens.inputTokens : data.summary.inputTokens,
      outputTokens: shouldFillTokens ? summaryTokens.outputTokens : data.summary.outputTokens,
      reasoningTokens: shouldFillTokens
        ? summaryTokens.reasoningTokens
        : data.summary.reasoningTokens,
      cachedTokens: shouldFillTokens ? summaryTokens.cachedTokens : data.summary.cachedTokens,
      totalTokens: shouldFillTokens ? tokenCountTotal(summaryTokens) : data.summary.totalTokens,
    },
    byProvider,
    byModel: Array.from(modelMap.values()),
  };
}

export function deriveCoveredMinutesFromBuckets(
  buckets: RecentRequestBucket[],
): number | null {
  if (!buckets || buckets.length === 0) {
    return null;
  }

  const timestamped = buckets.filter((b) => b.time);
  if (timestamped.length >= 2) {
    const times = timestamped.map((b) => new Date(b.time!).getTime()).sort((a, b) => a - b);
    const spanMs = times[times.length - 1] - times[0];
    if (spanMs > 0) {
      return Math.max(1, Math.round((spanMs / 60000) + RECENT_REQUEST_BUCKET_DURATION_MINUTES));
    }
  }

  if (timestamped.length === 1) {
    return RECENT_REQUEST_BUCKET_DURATION_MINUTES;
  }

  return buckets.length * RECENT_REQUEST_BUCKET_DURATION_MINUTES;
}

function normalizeHeatmapResponse(raw: unknown, fallbackRange: DashboardTimeRange): HeatmapResponse {
  const record = toRecord(raw);
  if (!record) {
    return { range: fallbackRange, buckets: [] };
  }
  const range = typeof record.range === 'string' ? record.range : fallbackRange;
  const buckets = normalizeHeatmapBuckets(readKnownField(record, ['buckets'])) ?? [];
  return { range, buckets };
}

function normalizeProvidersResponse(raw: unknown, fallbackRange: DashboardTimeRange): ProvidersResponse {
  const record = toRecord(raw);
  if (!record) {
    return { range: fallbackRange, providers: [] };
  }
  const range = typeof record.range === 'string' ? record.range : fallbackRange;
  const providers = (normalizePersistentGroupRows(readKnownField(record, ['providers'])) ?? []) as ProviderRow[];
  return { range, providers };
}

function normalizeAccountsResponse(raw: unknown): AccountsResponse {
  const record = toRecord(raw);
  if (!record) {
    return { snapshotTime: 0, accounts: [] };
  }
  const snapshotTime = readNumberField(record, ['snapshotTime', 'snapshot_time']);
  const rawAccounts = record.accounts;
  const accounts: AccountRow[] = [];
  if (Array.isArray(rawAccounts)) {
    for (const item of rawAccounts) {
      const r = toRecord(item);
      if (!r) continue;
      let recentRequests: unknown[] = [];
      const rrRaw = r.recentRequests ?? r.recent_requests;
      if (typeof rrRaw === 'string' && rrRaw.trim()) {
        try {
          recentRequests = JSON.parse(rrRaw);
        } catch { /* ignore */ }
      } else if (Array.isArray(rrRaw)) {
        recentRequests = rrRaw;
      }
      accounts.push({
        key: readStringField(r, GROUP_KEY_KEYS) || 'unknown',
        source: readStringField(r, ['source']) || '',
        provider: readStringField(r, GROUP_PROVIDER_KEYS) || '',
        type: readStringField(r, ['type']) || '',
        name: readStringField(r, ['name']) || '',
        label: readStringField(r, GROUP_LABEL_KEYS) || readStringField(r, ['name']) || 'unknown',
        authIndex: readStringField(r, ['authIndex', 'auth_index', 'auth-index']) || undefined,
        status: readStringField(r, ['status']) || '',
        statusMessage: readStringField(r, ['statusMessage', 'status_message']) || '',
        disabled: !!r.disabled,
        unavailable: !!r.unavailable,
        runtimeOnly: !!r.runtimeOnly || !!r.runtime_only,
        success: readNumberField(r, SUCCESS_COUNT_KEYS),
        failed: readNumberField(r, FAILURE_COUNT_KEYS),
        recentRequests,
      });
    }
  }
  return { snapshotTime, accounts };
}

const API_KEY_DETAIL_LIST_KEYS = [
  'details', 'data', 'items', 'apiKeys', 'api_keys', 'entries', 'results',
];

function normalizeApiKeyDetailsResponse(raw: unknown): Map<string, UsageStatsGroupRow[]> {
  const result = new Map<string, UsageStatsGroupRow[]>();

  let items: unknown[] | null = null;

  if (Array.isArray(raw)) {
    items = raw;
  } else {
    const record = toRecord(raw);
    if (record) {
      items = readKnownField(record, API_KEY_DETAIL_LIST_KEYS) as unknown[] | null;
      if (!Array.isArray(items)) {
        items = null;
      }
    }
  }

  if (!items) {
    return result;
  }

  for (const item of items) {
    const r = toRecord(item);
    if (!r) continue;
    const key = readStringField(r, GROUP_KEY_KEYS) || 'unknown';
    const childModels = normalizePersistentGroupRows(
      readKnownField(r, [...CHILD_MODEL_KEYS, ...MODEL_USAGE_KEYS])
    );
    result.set(key, childModels);
  }
  return result;
}
