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
} from '@/types/usageStats';
import {
  normalizeRecentRequestBuckets,
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
      const masked = `${trimmed.slice(0, 5)}***${trimmed.slice(-4)}`;
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
  const duration = 30 * 60 * 1000;
  return normalized.map((b, i) => {
    const ts = b.time ? new Date(b.time).getTime() : now - (normalized.length - i) * duration;
    return {
      timeStart: ts,
      timeEnd: ts + duration,
      success: b.success,
      failed: b.failed,
      successRate: b.success + b.failed > 0 ? b.success / (b.success + b.failed) : 0,
    };
  });
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
      setHeatmapBuckets(buildHeatmapBuckets(collectMemoryStatsBuckets(raw)));
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
    if (!data) return '-';
    const covered = deriveCoveredMinutes(data);
    if (covered !== null && covered > 0) {
      return (data.summary.totalRequests / covered).toFixed(1);
    }
    return '-';
  }, [data]);

  const tpmValue = useMemo<string>(() => {
    if (!data) return '-';
    const covered = deriveCoveredMinutes(data);
    if (covered !== null && covered > 0 && data.summary.totalTokens > 0) {
      return (data.summary.totalTokens / covered).toFixed(1);
    }
    return '-';
  }, [data]);

  const rpmFromBuckets = useMemo<string>(() => {
    if (heatmapBuckets.length === 0) return '-';
    const totalReqs = heatmapBuckets.reduce((t, b) => t + b.success + b.failed, 0);
    if (totalReqs === 0) return '-';
    const covered = deriveCoveredMinutesFromBuckets(
      heatmapBuckets.map((b) => ({
        time: new Date(b.timeStart).toISOString(),
        success: b.success,
        failed: b.failed,
      })),
    );
    if (!covered || covered <= 0) return '-';
    return (totalReqs / covered).toFixed(1);
  }, [heatmapBuckets]);

  const tpmFromBuckets = useMemo<string>(() => {
    if (heatmapBuckets.length === 0 || !data || data.summary.totalTokens <= 0) return '-';
    const covered = deriveCoveredMinutesFromBuckets(
      heatmapBuckets.map((b) => ({
        time: new Date(b.timeStart).toISOString(),
        success: b.success,
        failed: b.failed,
      })),
    );
    if (!covered || covered <= 0) return '-';
    return (data.summary.totalTokens / covered).toFixed(1);
  }, [heatmapBuckets, data]);

  const displayRpm = data && rpmValue !== '-' ? rpmValue : rpmFromBuckets;
  const displayTpm = data && tpmValue !== '-' ? tpmValue : tpmFromBuckets;

  const apiKeyRows = useMemo<ApiKeyDisplayRow[]>(() => {
    if (!data) return [];
    const accountRows = data.byAccount ?? [];
    return accountRows
      .filter((account) => account.key.startsWith('api-key/') && account.requests > 0)
      .map((account) => {
        const childModels = data.byModel.filter(
          (m) => m.provider && account.apiKeyHash,
        );
        const hasModelAttribution = childModels.length > 0;
        return {
          key: account.key,
          label: account.label,
          requests: account.requests,
          successCount: account.successCount,
          failureCount: account.failureCount,
          totalTokens: account.totalTokens,
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
        const childModels = data.byModel.filter(
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
    return data.byProvider
      .filter((r) => r.requests > 0)
      .map((row) => {
        const childModels = data.byModel.filter(
          (m) => m.provider === row.label || m.key.startsWith(row.key),
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
  };
}
