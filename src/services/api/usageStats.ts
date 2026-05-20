import axios from 'axios';
import { apiClient } from './client';
import type {
  UsageStatsResponse,
  DashboardTimeRange,
  UsageStatsGroupRow,
} from '@/types/usageStats';
import type { AuthFileItem, AuthFilesResponse } from '@/types/authFile';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
  sumRecentRequests,
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
  'model_usage',
  'modelUsage',
  'models_usage',
  'modelsUsage',
  'by_model',
  'byModel',
  'model_stats',
  'modelStats',
  'model_statistics',
  'modelStatistics',
];
const INPUT_TOKEN_KEYS = ['inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens'];
const OUTPUT_TOKEN_KEYS = ['outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens'];
const REASONING_TOKEN_KEYS = ['reasoningTokens', 'reasoning_tokens'];
const CACHED_TOKEN_KEYS = ['cachedTokens', 'cached_tokens', 'cacheTokens', 'cache_tokens'];
const TOTAL_TOKEN_KEYS = ['totalTokens', 'total_tokens', 'tokens'];
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

function resolveServiceUrl(serviceUrl: string): string {
  let base = serviceUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
}

export const usageStatsApi = {
  async fetchPersistentStats(
    serviceUrl: string,
    managementKey: string,
    range: DashboardTimeRange,
  ): Promise<UsageStatsResponse> {
    const base = resolveServiceUrl(serviceUrl);
    const response = await axios.get<UsageStatsResponse>(
      `${base}/v0/management/usage/stats`,
      {
        params: { range },
        headers: {
          Authorization: `Bearer ${managementKey}`,
        },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
    return response.data;
  },

  async probeService(serviceUrl: string): Promise<boolean> {
    try {
      const base = resolveServiceUrl(serviceUrl);
      await axios.get(`${base}/usage-service/info`, {
        timeout: 3000,
      });
      return true;
    } catch {
      return false;
    }
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

    return {
      apiKeyUsage: apiKeyUsageResult.status === 'fulfilled' ? apiKeyUsageResult.value : {},
      authFiles:
        authFilesResult.status === 'fulfilled' && Array.isArray(authFilesResult.value?.files)
          ? authFilesResult.value.files
          : [],
    };
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readKnownField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
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
  authIndex?: number;
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
    cacheTokens: 0,
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

function addTokenCounts(row: UsageStatsGroupRow, value: unknown) {
  if (!isRecord(value)) {
    return;
  }

  const inputTokens = normalizeUsageTotal(readKnownField(value, INPUT_TOKEN_KEYS));
  const outputTokens = normalizeUsageTotal(readKnownField(value, OUTPUT_TOKEN_KEYS));
  const reasoningTokens = normalizeUsageTotal(readKnownField(value, REASONING_TOKEN_KEYS));
  const cachedTokens = normalizeUsageTotal(readKnownField(value, CACHED_TOKEN_KEYS));
  const totalTokens = normalizeUsageTotal(readKnownField(value, TOTAL_TOKEN_KEYS));

  row.inputTokens += inputTokens;
  row.outputTokens += outputTokens;
  row.reasoningTokens += reasoningTokens;
  row.cachedTokens += cachedTokens;
  row.cacheTokens += cachedTokens;
  row.totalTokens += totalTokens || inputTokens + outputTokens + reasoningTokens;
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

function addModelRow(
  target: Map<string, UsageStatsGroupRow>,
  provider: string,
  model: string,
  success: number,
  failure: number,
  source?: unknown
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
    target.set(rowKey, row);
  }
  addCounts(row, success, failure);
  addTokenCounts(row, source);
}

function addModelRowsFromContainer(
  target: Map<string, UsageStatsGroupRow>,
  provider: string,
  value: unknown
) {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!isRecord(item)) return;
      const modelName = readStringField(item, MODEL_NAME_KEYS);
      const { success, failure } = readUsageCounts(item);
      addModelRow(target, provider, modelName, success, failure, item);
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
      addModelRow(target, provider, model, success, failure, stats);
      return;
    }

    const count = normalizeUsageTotal(stats);
    addModelRow(target, provider, model, count, 0);
  });
}

function addModelRowsFromRecord(
  target: Map<string, UsageStatsGroupRow>,
  provider: string,
  record: Record<string, unknown>
) {
  const successes = new Map<string, number>();
  const failures = new Map<string, number>();
  collectModelCounts(readKnownField(record, SUCCESS_KEYS), successes);
  collectModelCounts(readKnownField(record, FAILURE_KEYS), failures);

  const models = new Set([...successes.keys(), ...failures.keys()]);
  models.forEach((model) => {
    addModelRow(target, provider, model, successes.get(model) ?? 0, failures.get(model) ?? 0);
  });

  MODEL_USAGE_KEYS.forEach((key) => addModelRowsFromContainer(target, provider, record[key]));

  const modelName = readStringField(record, SINGLE_MODEL_KEYS);
  if (modelName) {
    const { success, failure } = readUsageCounts(record);
    addModelRow(target, provider, modelName, success, failure, record);
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

export function collectMemoryStatsBuckets(
  raw: MemoryStatsPayload | ApiKeyUsageResponse
): RecentRequestBucket[] {
  const payload = unwrapMemoryStatsPayload(raw);
  const buckets: RecentRequestBucket[] = [];

  Object.values(payload.apiKeyUsage || {}).forEach((providerEntries) => {
    if (!isRecord(providerEntries)) return;
    Object.values(providerEntries).forEach((entry) => {
      if (!isRecord(entry)) return;
      buckets.push(...readRecentRequestBuckets(entry));
    });
  });

  selectAuthFilesWithStats(payload.authFiles || []).forEach((file) => {
    buckets.push(...readRecentRequestBuckets(file as Record<string, unknown>));
  });

  return buckets;
}

export function normalizeMemoryStats(
  raw: MemoryStatsPayload | ApiKeyUsageResponse,
): UsageStatsResponse {
  let totalSuccess = 0;
  let totalFailure = 0;
  const byAccount: UsageStatsResponse['byAccount'] = [];
  const byProviderMap = new Map<string, UsageStatsGroupRow>();
  const byModelMap = new Map<string, UsageStatsGroupRow>();
  const payload = unwrapMemoryStatsPayload(raw);

  const addProviderCounts = (providerKey: string, success: number, failure: number) => {
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
  };

  for (const [rawProviderKey, keyEntries] of Object.entries(payload.apiKeyUsage || {})) {
    const providerKey = normalizeProviderKey(rawProviderKey);
    if (!keyEntries || typeof keyEntries !== 'object') continue;

    for (const [authKey, entry] of Object.entries(keyEntries)) {
      const rec = entry as Record<string, unknown> | null | undefined;
      if (!rec || typeof rec !== 'object') continue;
      const { success, failure } = readUsageCounts(rec);
      addProviderCounts(providerKey, success, failure);
      addModelRowsFromRecord(byModelMap, providerKey, rec);

      byAccount.push({
        key: `api-key/${providerKey}/${authKey}`,
        label: authKey || providerKey,
        requests: success + failure,
        successCount: success,
        failureCount: failure,
        successRate: success + failure > 0 ? success / (success + failure) : 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        provider: providerKey,
        authIndex: undefined,
        apiKeyHash: authKey,
      });
    }
  }

  selectAuthFilesWithStats(payload.authFiles || []).forEach((file, index) => {
    const record = file as Record<string, unknown>;
    const providerKey = normalizeProviderKey(file.provider ?? file.type, 'auth-files');
    const { success, failure } = readUsageCounts(record);
    const rawAuthIndex = readKnownField(record, AUTH_INDEX_KEYS);
    const authIndexKey = normalizeRecentRequestAuthIndex(rawAuthIndex);
    const name = String(file.name ?? '').trim();
    const accountKey = authIndexKey || name || `${providerKey}-${index + 1}`;

    addProviderCounts(providerKey, success, failure);
    addModelRowsFromRecord(byModelMap, providerKey, record);

    byAccount.push({
      key: `auth-file/${providerKey}/${accountKey}`,
      label: name || accountKey,
      requests: success + failure,
      successCount: success,
      failureCount: failure,
      successRate: success + failure > 0 ? success / (success + failure) : 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
      provider: providerKey,
      authIndex:
        authIndexKey && Number.isFinite(Number(authIndexKey))
          ? Number(authIndexKey)
          : undefined,
    });
  });

  const byProvider = Array.from(byProviderMap.values());
  const byModel = Array.from(byModelMap.values());
  totalSuccess = byProvider.reduce((total, row) => total + row.successCount, 0);
  totalFailure = byProvider.reduce((total, row) => total + row.failureCount, 0);

  const total = totalSuccess + totalFailure;
  return {
    source: 'memory',
    range: 'all',
    summary: {
      totalRequests: total,
      successCount: totalSuccess,
      failureCount: totalFailure,
      successRate: total > 0 ? totalSuccess / total : 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
    },
    byModel,
    byProvider,
    byAccount,
  };
}
