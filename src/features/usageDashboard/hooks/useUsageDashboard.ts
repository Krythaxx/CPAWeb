import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useConfigStore } from '@/stores';
import {
  usageStatsApi,
  augmentMemoryStatsWithRequestLogs,
  collectMemoryStatsBuckets,
  normalizeMemoryStats,
  deriveCoveredMinutes,
  deriveCoveredMinutesFromBuckets,
  computeApiKeyHash,
  maskApiKeyForDisplay,
  tokenCountTotal,
  type PrecomputedApiKeyHashMap,
  type MemoryRequestLogDetail,
} from '@/services/api/usageStats';
import { normalizeApiBase } from '@/utils/connection';
import type {
  UsageStatsDataSource,
  UsageStatsResponse,
  DashboardTimeRange,
  HeatmapBucket,
  ApiKeyDisplayRow,
  AuthFileDisplayRow,
  ProviderDisplayRow,
  SourceDisplayRow,
  TrendBucket,
} from '@/types/usageStats';
import {
  normalizeRecentRequestBuckets,
  mergeRecentRequestBucketGroups,
  RECENT_REQUEST_BLOCK_DURATION_MS,
  type RecentRequestBucket,
} from '@/utils/recentRequests';

const STORAGE_KEY_SERVICE_URL = 'cli-proxy-usage-service-url';
const STORAGE_KEY_MEMORY_USAGE_DETAILS = 'cli-proxy-memory-usage-details';
const MAX_MEMORY_USAGE_DETAILS = 500;
const MEMORY_USAGE_DETAILS_TTL_MS = 60 * 60 * 1000;

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const n = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(n)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(n)) return false;
  }
  return undefined;
}

function deriveDefaultServiceUrl(apiBase: string): string {
  try {
    const base = normalizeApiBase(apiBase);
    const url = new URL(base);
    const currentPort = parseInt(url.port, 10);
    if (Number.isFinite(currentPort) && currentPort > 0) {
      url.port = '18317';
    }
    return url.origin;
  } catch {
    return `http://localhost:18317`;
  }
}

function loadServiceUrl(apiBase: string): string {
  const stored = localStorage.getItem(STORAGE_KEY_SERVICE_URL);
  if (stored) return stored;
  return deriveDefaultServiceUrl(apiBase);
}

function saveServiceUrl(url: string) {
  localStorage.setItem(STORAGE_KEY_SERVICE_URL, url);
}

function clearServiceUrl() {
  localStorage.removeItem(STORAGE_KEY_SERVICE_URL);
}

function hasUsableTokens(detail: MemoryRequestLogDetail): boolean {
  return (
    detail.tokens.totalTokens +
      detail.tokens.inputTokens +
      detail.tokens.outputTokens +
      detail.tokens.reasoningTokens +
      detail.tokens.cachedTokens >
    0
  );
}

function isMemoryRequestLogDetail(value: unknown): value is MemoryRequestLogDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const tokens = record.tokens;
  return Boolean(tokens && typeof tokens === 'object' && !Array.isArray(tokens));
}

function loadCachedMemoryUsageDetails(): MemoryRequestLogDetail[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_MEMORY_USAGE_DETAILS);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as { savedAt?: unknown; details?: unknown };
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (Date.now() - savedAt > MEMORY_USAGE_DETAILS_TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY_MEMORY_USAGE_DETAILS);
      return [];
    }

    return Array.isArray(parsed.details)
      ? parsed.details.filter(isMemoryRequestLogDetail).filter(hasUsableTokens).slice(-MAX_MEMORY_USAGE_DETAILS)
      : [];
  } catch {
    return [];
  }
}

function saveCachedMemoryUsageDetails(details: MemoryRequestLogDetail[]) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY_MEMORY_USAGE_DETAILS,
      JSON.stringify({
        savedAt: Date.now(),
        details: details.slice(-MAX_MEMORY_USAGE_DETAILS),
      })
    );
  } catch {
    // Ignore storage failures; the live queue still feeds the current render.
  }
}

function clearCachedMemoryUsageDetails() {
  try {
    sessionStorage.removeItem(STORAGE_KEY_MEMORY_USAGE_DETAILS);
  } catch {
    // Ignore storage failures.
  }
}

function getMemoryUsageDetailKey(detail: MemoryRequestLogDetail): string {
  if (detail.id) {
    return `id:${detail.id}`;
  }

  return [
    detail.timestamp ?? '',
    detail.provider ?? '',
    detail.model ?? '',
    detail.success ? '1' : '0',
    detail.tokens.inputTokens,
    detail.tokens.outputTokens,
    detail.tokens.reasoningTokens,
    detail.tokens.cachedTokens,
    detail.tokens.totalTokens,
  ].join('|');
}

function mergeMemoryUsageDetails(
  existing: MemoryRequestLogDetail[],
  incoming: MemoryRequestLogDetail[]
): MemoryRequestLogDetail[] {
  if (incoming.length === 0) {
    return existing.slice(-MAX_MEMORY_USAGE_DETAILS);
  }

  const merged = new Map<string, MemoryRequestLogDetail>();
  [...existing, ...incoming]
    .filter(hasUsableTokens)
    .forEach((detail) => {
      merged.set(getMemoryUsageDetailKey(detail), detail);
    });
  return Array.from(merged.values()).slice(-MAX_MEMORY_USAGE_DETAILS);
}

function selectMemoryUsageDetailsForStats(
  details: MemoryRequestLogDetail[],
  totalRequests: number
): MemoryRequestLogDetail[] {
  if (totalRequests <= 0) {
    return [];
  }
  return details.slice(-Math.min(totalRequests, MAX_MEMORY_USAGE_DETAILS));
}

function needsMemoryDetailAugmentation(data: UsageStatsResponse): boolean {
  return (
    data.summary.totalRequests > 0 &&
    (data.summary.totalTokens === 0 || data.byModel.length === 0)
  );
}

async function buildApiKeyHashMap(configuredApiKeys: string[] | undefined): Promise<PrecomputedApiKeyHashMap> {
  const rawToMasked = new Map<string, string>();
  const hashToMasked = new Map<string, string>();

  if (!configuredApiKeys || !Array.isArray(configuredApiKeys)) {
    return { rawToMasked, hashToMasked };
  }

  const keys = configuredApiKeys.filter((k): k is string => typeof k === 'string' && !!k.trim());
  await Promise.all(
    keys.map(async (k) => {
      const trimmed = k.trim();
      const masked = maskApiKeyForDisplay(trimmed);
      rawToMasked.set(trimmed, masked);
      try {
        const hash = await computeApiKeyHash(trimmed);
        hashToMasked.set(hash, masked);
      } catch {
        // ignore hash computation failures
      }
    })
  );

  return { rawToMasked, hashToMasked };
}

function buildHeatmapBuckets(buckets: RecentRequestBucket[]): HeatmapBucket[] {
  const normalized = normalizeRecentRequestBuckets(buckets);
  const now = Date.now();
  const duration = RECENT_REQUEST_BLOCK_DURATION_MS;
  return normalized.map((b, i) => {
    const parsed = b.time ? new Date(b.time).getTime() : NaN;
    const ts = Number.isFinite(parsed) ? parsed : now - (normalized.length - i) * duration;
    return {
      timeStart: ts,
      timeEnd: ts + duration,
      success: b.success,
      failed: b.failed,
      successRate: b.success + b.failed > 0 ? b.success / (b.success + b.failed) : 0,
    };
  });
}

function buildCanonicalBucketsFromRaw(raw: unknown): RecentRequestBucket[] {
  const payload = raw as { apiKeyUsage?: Record<string, Record<string, unknown>>; authFiles?: unknown[] };

  const apiKeyGroups: RecentRequestBucket[][] = [];
  if (payload?.apiKeyUsage && typeof payload.apiKeyUsage === 'object') {
    Object.values(payload.apiKeyUsage).forEach((providerEntries) => {
      if (!providerEntries || typeof providerEntries !== 'object') return;
      Object.values(providerEntries).forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const record = entry as Record<string, unknown>;
        const recentKeys = ['recent_requests', 'recentRequests'];
        for (const rk of recentKeys) {
          if (Array.isArray(record[rk])) {
            apiKeyGroups.push(normalizeRecentRequestBuckets(record[rk]));
            return;
          }
        }
      });
    });
  }

  if (apiKeyGroups.length > 0) {
    return mergeRecentRequestBucketGroups(apiKeyGroups);
  }

  const authFileGroups: RecentRequestBucket[][] = [];
  if (Array.isArray(payload?.authFiles)) {
    payload.authFiles.forEach((file) => {
      if (!file || typeof file !== 'object') return;
      const record = file as Record<string, unknown>;
      const recentKeys = ['recent_requests', 'recentRequests'];
      for (const rk of recentKeys) {
        if (Array.isArray(record[rk])) {
          authFileGroups.push(normalizeRecentRequestBuckets(record[rk]));
          return;
        }
      }
    });
  }

  if (authFileGroups.length > 0) {
    return mergeRecentRequestBucketGroups(authFileGroups);
  }

  return [];
}

export function useUsageDashboard() {
  const { t } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const usageStatisticsEnabled = useConfigStore((s) =>
    normalizeBoolean(s.config?.raw?.['usage-statistics-enabled']),
  );

  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState<UsageStatsDataSource>('postgres');
  const [data, setData] = useState<UsageStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DashboardTimeRange>('today');
  const [serviceUrl, setServiceUrlState] = useState(() => loadServiceUrl(apiBase));
  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [heatmapBuckets, setHeatmapBuckets] = useState<HeatmapBucket[]>([]);
  const [mergedRecentBuckets, setMergedRecentBuckets] = useState<RecentRequestBucket[]>([]);
  const [memoryDetailsSnapshot, setMemoryDetailsSnapshot] = useState<MemoryRequestLogDetail[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const memoryUsageDetailsRef = useRef<MemoryRequestLogDetail[]>(
    loadCachedMemoryUsageDetails()
  );

  const setServiceUrl = useCallback(
    (url: string) => {
      if (url.trim()) {
        saveServiceUrl(url);
      } else {
        clearServiceUrl();
        url = deriveDefaultServiceUrl(apiBase);
      }
      setServiceUrlState(url);
    },
    [apiBase],
  );

  const fetchData = useCallback(async () => {
    if (!managementKey) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);

    try {
      const persistentData = await usageStatsApi.fetchPersistentStats(
        serviceUrl,
        managementKey,
        range,
      );
      if (ac.signal.aborted) return;
      if (
        persistentData?.summary &&
        persistentData.summary.totalRequests > 0
      ) {
        setDataSource('postgres');
        setData({ ...persistentData, source: 'postgres' });
        setLastRefreshTime(new Date().toLocaleTimeString());
        setLoading(false);
        return;
      }
    } catch {
      if (ac.signal.aborted) return;
    }

    try {
      const rawMemory = await usageStatsApi.fetchMemoryStats();
      if (ac.signal.aborted) return;

      setMergedRecentBuckets(buildCanonicalBucketsFromRaw(rawMemory));

      const configuredApiKeys = useConfigStore.getState().config?.apiKeys as string[] | undefined;
      const hashMap = await buildApiKeyHashMap(configuredApiKeys);
      if (ac.signal.aborted) return;

      let normalized = normalizeMemoryStats(rawMemory, configuredApiKeys, hashMap);
      const baseMemoryData = normalized;

      if (normalized.summary.totalRequests === 0) {
        memoryUsageDetailsRef.current = [];
        clearCachedMemoryUsageDetails();
      }

      if (needsMemoryDetailAugmentation(normalized)) {
        try {
          const queueDetails = await usageStatsApi.fetchMemoryUsageQueueDetails(
            Math.max(1, Math.min(normalized.summary.totalRequests, MAX_MEMORY_USAGE_DETAILS))
          );
          if (ac.signal.aborted) return;
          memoryUsageDetailsRef.current = mergeMemoryUsageDetails(
            memoryUsageDetailsRef.current,
            queueDetails
          );
          saveCachedMemoryUsageDetails(memoryUsageDetailsRef.current);
        } catch {
          if (ac.signal.aborted) return;
        }

        const cachedDetails = selectMemoryUsageDetailsForStats(
          memoryUsageDetailsRef.current,
          normalized.summary.totalRequests
        );
        if (cachedDetails.length > 0) {
          normalized = augmentMemoryStatsWithRequestLogs(baseMemoryData, cachedDetails);
        }
      }

      if (needsMemoryDetailAugmentation(normalized)) {
        try {
          const requestLogDetails = await usageStatsApi.fetchMemoryRequestLogDetails(
            Math.max(1, Math.min(normalized.summary.totalRequests, 50))
          );
          if (ac.signal.aborted) return;
          memoryUsageDetailsRef.current = mergeMemoryUsageDetails(
            memoryUsageDetailsRef.current,
            requestLogDetails
          );
          saveCachedMemoryUsageDetails(memoryUsageDetailsRef.current);
          const cachedDetails = selectMemoryUsageDetailsForStats(
            memoryUsageDetailsRef.current,
            normalized.summary.totalRequests
          );
          normalized =
            cachedDetails.length > 0
              ? augmentMemoryStatsWithRequestLogs(baseMemoryData, cachedDetails)
              : normalized;
        } catch {
          if (ac.signal.aborted) return;
        }
      }

      if (
        usageStatisticsEnabled === false &&
        normalized.summary.totalRequests === 0
      ) {
        setDataSource('unavailable');
        setData(null);
        setError(t('usage_stats.empty_memory_disabled'));
        setLoading(false);
        return;
      }

      setDataSource('memory');
      setData(normalized);
      setMemoryDetailsSnapshot(memoryUsageDetailsRef.current);
      setLastRefreshTime(new Date().toLocaleTimeString());
      setLoading(false);
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      const message = err instanceof Error ? err.message : t('usage_stats.error_generic');
      let finalMessage = message;
      if (message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('401')) {
        finalMessage = t('usage_stats.error_auth');
      }
      setDataSource('error');
      setData(null);
      setError(finalMessage);
      setLoading(false);
    }
  }, [serviceUrl, range, managementKey, usageStatisticsEnabled, t]);

  const fetchHeatmap = useCallback(async () => {
    if (!managementKey) return;
    try {
      const raw = await usageStatsApi.fetchMemoryStats();
      const canonicalBuckets = collectMemoryStatsBuckets(raw);
      setHeatmapBuckets(buildHeatmapBuckets(canonicalBuckets));
      setMergedRecentBuckets(buildCanonicalBucketsFromRaw(raw));
    } catch {
      setHeatmapBuckets([]);
    }
  }, [managementKey]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const rpmValue = useMemo<string>(() => {
    if (!data) {
      if (mergedRecentBuckets.length === 0) return '-';
      const totalReqs = mergedRecentBuckets.reduce((t, b) => t + b.success + b.failed, 0);
      if (totalReqs === 0) return '-';
      const covered = deriveCoveredMinutesFromBuckets(mergedRecentBuckets);
      if (!covered || covered <= 0) return '-';
      return (totalReqs / covered).toFixed(1);
    }
    const covered = deriveCoveredMinutes(data);
    if (covered !== null && covered > 0) {
      return (data.summary.totalRequests / covered).toFixed(1);
    }
    if (mergedRecentBuckets.length > 0) {
      const totalReqs = mergedRecentBuckets.reduce((t, b) => t + b.success + b.failed, 0);
      if (totalReqs > 0) {
        const bucketCovered = deriveCoveredMinutesFromBuckets(mergedRecentBuckets);
        if (bucketCovered && bucketCovered > 0) {
          return (totalReqs / bucketCovered).toFixed(1);
        }
      }
    }
    return '-';
  }, [data, mergedRecentBuckets]);

  const tpmValue = useMemo<string>(() => {
    if (!data) return '-';
    if (data.summary.totalTokens <= 0) return '-';

    if (data.source === 'postgres') {
      const covered = deriveCoveredMinutes(data);
      if (covered !== null && covered > 0) {
        return (data.summary.totalTokens / covered).toFixed(1);
      }
      return '-';
    }

    if (mergedRecentBuckets.length > 0) {
      const bucketCovered = deriveCoveredMinutesFromBuckets(mergedRecentBuckets);
      if (bucketCovered && bucketCovered > 0) {
        const details = memoryDetailsSnapshot;
        if (details.length > 0) {
          const bucketTotalReqs = mergedRecentBuckets.reduce(
            (t, b) => t + b.success + b.failed, 0
          );
          if (details.length <= bucketTotalReqs * 1.5 + 5) {
            const recentTotalTokens = details.reduce(
              (sum, d) => sum + tokenCountTotal(d.tokens), 0
            );
            if (recentTotalTokens > 0) {
              return (recentTotalTokens / bucketCovered).toFixed(1);
            }
          }
        }
      }
    }

    return '-';
  }, [data, mergedRecentBuckets, memoryDetailsSnapshot]);

  const displayRpm = rpmValue;
  const displayTpm = tpmValue;

  const apiKeyRows = useMemo<ApiKeyDisplayRow[]>(() => {
    if (!data) return [];
    const accountRows = data.byAccount ?? [];
    return accountRows
      .filter((account) => account.key.startsWith('api-key/') && account.requests > 0)
      .map((account) => {
        const childModels = account.childModels ?? [];
        const hasModelAttribution = childModels.length > 0;
        const parentTotalTokens = hasModelAttribution
          ? childModels.reduce((sum, m) => sum + m.totalTokens, 0)
          : account.totalTokens;
        return {
          key: account.key,
          label: account.label,
          requests: account.requests,
          successCount: account.successCount,
          failureCount: account.failureCount,
          totalTokens: parentTotalTokens,
          modelCount: hasModelAttribution ? new Set(childModels.map((m) => m.label)).size : -1,
          cost: null,
          hasModelAttribution,
          childModels,
        };
      })
      .sort((a, b) => b.requests - a.requests);
  }, [data]);

  const authFileRows = useMemo<AuthFileDisplayRow[]>(() => {
    if (!data) return [];
    const accountRows = data.byAccount ?? [];
    return accountRows
      .filter((account) => account.key.startsWith('auth-file/') && account.requests > 0)
      .map((account) => {
        const childModels = account.childModels ?? data.byModel.filter(
          (m) => m.provider === account.provider,
        );
        return {
          key: account.key,
          label: account.label,
          provider: account.provider ?? '',
          requests: account.requests,
          successCount: account.successCount,
          failureCount: account.failureCount,
          totalTokens: account.totalTokens,
          modelCount: new Set(childModels.map((m) => m.label)).size,
          cost: null,
          childModels,
        };
      })
      .sort((a, b) => b.requests - a.requests);
  }, [data]);

  const providerRows = useMemo<ProviderDisplayRow[]>(() => {
    if (!data) return [];
    const authFileOwnedModelKeys = new Set(
      data.byAccount
        .filter((a) => a.key.startsWith('auth-file/') && a.childModels)
        .flatMap((a) => a.childModels!.map((m) => m.key))
    );
    return data.byProvider
      .filter((r) => r.requests > 0)
      .map((row) => {
        const childModels = data.byModel.filter(
          (m) =>
            (m.provider === row.label || m.key.startsWith(row.key)) &&
            !authFileOwnedModelKeys.has(m.key),
        );
        return {
          key: row.key,
          label: row.label,
          requests: row.requests,
          successCount: row.successCount,
          failureCount: row.failureCount,
          totalTokens: row.totalTokens,
          modelCount: new Set(childModels.map((m) => m.label)).size,
          cost: null,
          childModels,
        };
      });
  }, [data]);

  const sourceRows = useMemo<SourceDisplayRow[]>(() => {
    const auths = authFileRows.map((r) => ({
      ...r,
      key: `auth:${r.key}`,
      sourceType: 'auth-file' as const,
    }));
    const provs = providerRows.map((r) => ({
      ...r,
      key: `prov:${r.key}`,
      sourceType: 'provider' as const,
      provider: '',
    }));
    return [...auths, ...provs].sort((a, b) => b.requests - a.requests);
  }, [authFileRows, providerRows]);

  const metricTrends = useMemo<{
    totalTokens?: TrendBucket[];
    inputTokens?: TrendBucket[];
    outputTokens?: TrendBucket[];
    rpm?: TrendBucket[];
    tpm?: TrendBucket[];
  }>(() => {
    if (!data) return {};

    if (data.source === 'postgres' && data.summary) {
      const s = data.summary;
      return {
        totalTokens: s.tokenTrend,
        inputTokens: s.inputOutputTrend,
        outputTokens: s.cacheTrend,
        rpm: s.requestTrend,
        tpm: s.tokenTrend,
      };
    }

    const duration = RECENT_REQUEST_BLOCK_DURATION_MS;

    if (mergedRecentBuckets.length >= 2) {
      const rpmTrend: TrendBucket[] = mergedRecentBuckets.map((b, i) => {
        const ts = b.time
          ? new Date(b.time).getTime()
          : i * duration;
        return {
          timestamp: ts,
          value: (b.success + b.failed) / (duration / 60000),
        };
      });

      const details = memoryDetailsSnapshot;
      if (details.length >= 2) {
        const bucketStartTimes = mergedRecentBuckets.map((b, i) =>
          b.time
            ? new Date(b.time).getTime()
            : i * duration
        );

        const tokenBuckets = bucketStartTimes.map((start) => {
          const end = start + duration;
          const inBucket = details.filter((d) => {
            if (!d.timestamp) return false;
            const ts = new Date(d.timestamp).getTime();
            return ts >= start && ts < end;
          });
          return {
            timestamp: start,
            inputTokens: inBucket.reduce((s, d) => s + d.tokens.inputTokens, 0),
            outputTokens: inBucket.reduce((s, d) => s + d.tokens.outputTokens, 0),
            totalTokens: inBucket.reduce((s, d) => s + tokenCountTotal(d.tokens), 0),
          };
        });

        if (tokenBuckets.some((b) => b.totalTokens > 0)) {
          const covered = deriveCoveredMinutesFromBuckets(mergedRecentBuckets);
          return {
            totalTokens: tokenBuckets.map((b) => ({ timestamp: b.timestamp, value: b.totalTokens })),
            inputTokens: tokenBuckets.map((b) => ({ timestamp: b.timestamp, value: b.inputTokens })),
            outputTokens: tokenBuckets.map((b) => ({ timestamp: b.timestamp, value: b.outputTokens })),
            rpm: rpmTrend,
            tpm: covered && covered > 0
              ? tokenBuckets.map((b) => ({ timestamp: b.timestamp, value: b.totalTokens / covered }))
              : undefined,
          };
        }
      }

      const result: { totalTokens?: TrendBucket[]; inputTokens?: TrendBucket[]; outputTokens?: TrendBucket[]; rpm?: TrendBucket[]; tpm?: TrendBucket[] } = { rpm: rpmTrend };

      if (data.summary.totalTokens > 0) {
        const lastTs = rpmTrend[rpmTrend.length - 1]?.timestamp ?? duration;
        result.totalTokens = [
          { timestamp: lastTs - duration, value: data.summary.totalTokens },
          { timestamp: lastTs, value: data.summary.totalTokens },
        ];
        if (data.summary.inputTokens > 0) {
          result.inputTokens = [
            { timestamp: lastTs - duration, value: data.summary.inputTokens },
            { timestamp: lastTs, value: data.summary.inputTokens },
          ];
        }
        if (data.summary.outputTokens > 0) {
          result.outputTokens = [
            { timestamp: lastTs - duration, value: data.summary.outputTokens },
            { timestamp: lastTs, value: data.summary.outputTokens },
          ];
        }
      }

      return result;
    }

    if (mergedRecentBuckets.length === 1) {
      const b = mergedRecentBuckets[0];
      const ts = b.time ? new Date(b.time).getTime() : 0;
      const rpm = (b.success + b.failed) / (duration / 60000);
      return {
        rpm: [
          { timestamp: ts, value: rpm },
          { timestamp: ts + duration, value: rpm },
        ],
      };
    }

    if (data.summary.totalTokens > 0) {
      const ts = duration;
      return {
        totalTokens: [
          { timestamp: 0, value: data.summary.totalTokens },
          { timestamp: ts, value: data.summary.totalTokens },
        ],
        inputTokens: data.summary.inputTokens > 0 ? [
          { timestamp: 0, value: data.summary.inputTokens },
          { timestamp: ts, value: data.summary.inputTokens },
        ] : undefined,
        outputTokens: data.summary.outputTokens > 0 ? [
          { timestamp: 0, value: data.summary.outputTokens },
          { timestamp: ts, value: data.summary.outputTokens },
        ] : undefined,
      };
    }

    return {};
  }, [data, mergedRecentBuckets, memoryDetailsSnapshot]);

  return {
    loading,
    dataSource,
    data,
    error,
    range,
    serviceUrl,
    lastRefreshTime,
    heatmapBuckets,
    setRange,
    setServiceUrl,
    refresh: fetchData,
    refreshHeatmap: fetchHeatmap,
    rpmValue: displayRpm,
    tpmValue: displayTpm,
    apiKeyRows,
    authFileRows,
    providerRows,
    sourceRows,
    metricTrends,
  };
}
