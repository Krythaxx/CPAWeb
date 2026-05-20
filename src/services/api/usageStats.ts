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
  'cacheReadInputTokens',
  'cache_read_input_tokens',
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

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export interface MemoryRequestLogDetail {
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

    return {
      apiKeyUsage: apiKeyUsageResult.status === 'fulfilled' ? apiKeyUsageResult.value : {},
      authFiles:
        authFilesResult.status === 'fulfilled' && Array.isArray(authFilesResult.value?.files)
          ? authFilesResult.value.files
          : [],
    };
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
  return (
    tokens.totalTokens ||
    tokens.inputTokens + tokens.outputTokens + tokens.reasoningTokens
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
  const inputTokens = normalizeUsageTotal(readKnownField(record, INPUT_TOKEN_KEYS));
  const outputTokens = normalizeUsageTotal(readKnownField(record, OUTPUT_TOKEN_KEYS));
  const reasoningTokens = normalizeUsageTotal(readKnownField(record, REASONING_TOKEN_KEYS));
  const cachedTokens = normalizeUsageTotal(readKnownField(record, CACHED_TOKEN_KEYS));
  const totalTokens = normalizeUsageTotal(readKnownField(record, TOTAL_TOKEN_KEYS));

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

  const modelName = readModelName(record);
  if (modelName && models.size === 0 && !hasModelUsageContainer(record)) {
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

  const addProviderUsage = (
    providerKey: string,
    success: number,
    failure: number,
    source: unknown
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

  for (const [rawProviderKey, keyEntries] of Object.entries(payload.apiKeyUsage || {})) {
    const providerKey = normalizeProviderKey(rawProviderKey);
    if (!keyEntries || typeof keyEntries !== 'object') continue;

    for (const [authKey, entry] of Object.entries(keyEntries)) {
      const rec = entry as Record<string, unknown> | null | undefined;
      if (!rec || typeof rec !== 'object') continue;
      const { success, failure } = readUsageCounts(rec);
      addProviderUsage(providerKey, success, failure, rec);
      addModelRowsFromRecord(byModelMap, providerKey, rec);

      const accountRow = createEmptyGroupRow({
        key: `api-key/${providerKey}/${authKey}`,
        label: authKey || providerKey,
        provider: providerKey,
        apiKeyHash: authKey,
      });
      addCounts(accountRow, success, failure);
      addTokenCounts(accountRow, rec);
      byAccount.push(accountRow);
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

    addProviderUsage(providerKey, success, failure, record);
    addModelRowsFromRecord(byModelMap, providerKey, record);

    const accountRow = createEmptyGroupRow({
      key: `auth-file/${providerKey}/${accountKey}`,
      label: name || accountKey,
      provider: providerKey,
      authIndex:
        authIndexKey && Number.isFinite(Number(authIndexKey))
          ? Number(authIndexKey)
          : undefined,
    });
    addCounts(accountRow, success, failure);
    addTokenCounts(accountRow, record);
    byAccount.push(accountRow);
  });

  const byProvider = Array.from(byProviderMap.values());
  const byModel = Array.from(byModelMap.values());
  totalSuccess = byProvider.reduce((total, row) => total + row.successCount, 0);
  totalFailure = byProvider.reduce((total, row) => total + row.failureCount, 0);
  const summaryTokens = byProvider.reduce<TokenCounts>(
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

  const total = totalSuccess + totalFailure;
  return {
    source: 'memory',
    range: 'all',
    summary: {
      totalRequests: total,
      successCount: totalSuccess,
      failureCount: totalFailure,
      successRate: total > 0 ? totalSuccess / total : 0,
      inputTokens: summaryTokens.inputTokens,
      outputTokens: summaryTokens.outputTokens,
      reasoningTokens: summaryTokens.reasoningTokens,
      cachedTokens: summaryTokens.cachedTokens,
      cacheTokens: summaryTokens.cachedTokens,
      totalTokens: tokenCountTotal(summaryTokens),
    },
    byModel,
    byProvider,
    byAccount,
  };
}

export function augmentMemoryStatsWithRequestLogs(
  data: UsageStatsResponse,
  details: MemoryRequestLogDetail[]
): UsageStatsResponse {
  if (details.length === 0) {
    return data;
  }

  const shouldFillProviderTokens = data.summary.totalTokens === 0;
  const shouldAddModelRequests = data.byModel.length === 0;
  const providerMap = new Map(
    data.byProvider.map((row) => [row.key, { ...row }] as const)
  );
  const modelMap = new Map(
    data.byModel.map((row) => [row.key, { ...row }] as const)
  );
  const providerFallback =
    data.byProvider.filter((row) => row.requests > 0).length === 1
      ? data.byProvider.find((row) => row.requests > 0)?.key
      : undefined;

  details.forEach((detail) => {
    const providerKey = normalizeProviderKey(detail.provider, providerFallback || 'unknown');
    const providerRow = providerMap.get(providerKey);
    if (providerRow && shouldFillProviderTokens) {
      applyTokenCounts(providerRow, detail.tokens);
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

    if (shouldAddModelRequests) {
      addCounts(modelRow, detail.success ? 1 : 0, detail.success ? 0 : 1);
    }
    applyTokenCounts(modelRow, detail.tokens);
  });

  const byProvider = Array.from(providerMap.values());
  const summaryTokens = byProvider.reduce<TokenCounts>(
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

  return {
    ...data,
    summary: {
      ...data.summary,
      inputTokens: shouldFillProviderTokens ? summaryTokens.inputTokens : data.summary.inputTokens,
      outputTokens: shouldFillProviderTokens ? summaryTokens.outputTokens : data.summary.outputTokens,
      reasoningTokens: shouldFillProviderTokens
        ? summaryTokens.reasoningTokens
        : data.summary.reasoningTokens,
      cachedTokens: shouldFillProviderTokens ? summaryTokens.cachedTokens : data.summary.cachedTokens,
      cacheTokens: shouldFillProviderTokens ? summaryTokens.cachedTokens : data.summary.cacheTokens,
      totalTokens: shouldFillProviderTokens ? tokenCountTotal(summaryTokens) : data.summary.totalTokens,
    },
    byProvider,
    byModel: Array.from(modelMap.values()),
  };
}
