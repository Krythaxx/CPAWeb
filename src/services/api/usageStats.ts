import axios from 'axios';
import { apiClient } from './client';
import type {
  UsageStatsResponse,
  UsageStatsSummary,
  DashboardTimeRange,
  UsageStatsGroupRow,
  DataCoverageInfo,
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
  authIndex: number | undefined;
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
  totalTokens: number;
}

export interface MemoryRequestLogDetail {
  id?: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  success: boolean;
  tokens: TokenCounts;
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
    const pattern = new RegExp(
      `(?:["']${escaped}["']|\\b${escaped}\\b)\\s*[:=]\\s*["']([^"'\\n\\r]+)["']`,
      'i'
    );
    const match = text.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
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
    totalTokens,
  };
}

function parseMemoryRequestLogDetail(
  text: string,
  candidate: RequestLogCandidate
): MemoryRequestLogDetail | null {
  const tokens = readTokenCountsFromLog(text);
  const model = readTextValueFromLog(text, SINGLE_MODEL_KEYS);
  const provider = normalizeProviderKey(readTextValueFromLog(text, PROVIDER_LOG_KEYS), '');
  const statusCode = extractStatusCode(text);
  const success = statusCode == null ? candidate.success : statusCode < 400;

  if (!model && tokenCountTotal(tokens) <= 0) {
    return null;
  }

  return {
    id: candidate.id,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
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

function emptyTokenCounts(): TokenCounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
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

function readUsageQueueTextField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
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
    readUsageQueueTextField(record, SINGLE_MODEL_KEYS) ||
    readUsageQueueTextField(record, ['alias']);
  const provider = normalizeProviderKey(readUsageQueueTextField(record, PROVIDER_LOG_KEYS), '');

  if (!model && tokenCountTotal(tokens) <= 0) {
    return null;
  }

  const id = readUsageQueueTextField(record, ['request_id', 'requestId', 'id']);
  const timestamp = readUsageQueueTextField(record, ['timestamp', 'time', 'created_at', 'createdAt']);

  return {
    ...(id ? { id } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    success: readUsageQueueSuccess(record),
    tokens,
  };
}

function applyTokenCounts(row: UsageStatsGroupRow, tokens: TokenCounts) {
  row.inputTokens += tokens.inputTokens;
  row.outputTokens += tokens.outputTokens;
  row.reasoningTokens += tokens.reasoningTokens;
  row.cachedTokens += tokens.cachedTokens;
  row.cacheTokens += tokens.cachedTokens;
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
  if (r === 'all' || r === '7d') {
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
      authIndex: authIndexKey && Number.isFinite(Number(authIndexKey)) ? Number(authIndexKey) : undefined,
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
      cacheTokens: row.cachedTokens,
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
      cacheTokens: row.cachedTokens,
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
      cacheTokens: summaryTokens.cachedTokens,
      totalTokens: tokenCountTotal(summaryTokens),
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
    byModel,
    byProvider,
    byAccount,
  };
}

const API_KEY_HASH_KEYS = [
  'api_key_hash',
  'apiKeyHash',
  'client_api_key_hash',
  'clientApiKeyHash',
];
const PERIOD_START_KEYS = ['periodStartMs', 'period_start_ms', 'periodStart'];
const PERIOD_END_KEYS = ['periodEndMs', 'period_end_ms', 'periodEnd'];
const COVERED_MINUTES_KEYS = ['coveredMinutes', 'covered_minutes'];
const LEGACY_ARRAY_KEYS = ['details', 'events', 'records', 'items'];

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
  return LEGACY_ARRAY_KEYS.some(
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
    data.byProvider.map((row) => [row.key, { ...row }] as const)
  );
  const modelMap = new Map(
    data.byModel.map((row) => [row.key, { ...row }] as const)
  );

  const authFileAccounts = data.byAccount.filter(
    (a) => a.key.startsWith('auth-file/') && a.requests > 0
  );
  const apiKeyAccounts = data.byAccount.filter(
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

  const byAccount = data.byAccount.map((a) => {
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
    data.byProvider.filter((row) => row.requests > 0).length === 1
      ? data.byProvider.find((row) => row.requests > 0)?.key
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
      cacheTokens: shouldFillTokens ? summaryTokens.cachedTokens : data.summary.cacheTokens,
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
