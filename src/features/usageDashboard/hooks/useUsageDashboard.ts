import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useConfigStore } from '@/stores';
import { usageStatsApi, normalizeMemoryStats } from '@/services/api/usageStats';
import { normalizeApiBase } from '@/utils/connection';
import type {
  UsageStatsDataSource,
  UsageStatsResponse,
  DashboardTimeRange,
  HeatmapBucket,
} from '@/types/usageStats';
import {
  normalizeRecentRequestBuckets,
  type RecentRequestBucket,
} from '@/utils/recentRequests';

const STORAGE_KEY_SERVICE_URL = 'cli-proxy-usage-service-url';

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
  const [range, setRange] = useState<DashboardTimeRange>('7d');
  const [serviceUrl, setServiceUrlState] = useState(() => loadServiceUrl(apiBase));
  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [heatmapBuckets, setHeatmapBuckets] = useState<HeatmapBucket[]>([]);

  const abortRef = useRef<AbortController | null>(null);

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
      setDataSource('postgres');
      setData({ ...persistentData, source: 'postgres' });
      setLastRefreshTime(new Date().toLocaleTimeString());
      setLoading(false);
      return;
    } catch {
      if (ac.signal.aborted) return;
    }

    try {
      const rawMemory = await usageStatsApi.fetchMemoryStats();
      if (ac.signal.aborted) return;

      console.log('[UsageDashboard] rawMemory:', JSON.stringify(rawMemory));
      const normalized = normalizeMemoryStats(rawMemory);
      console.log('[UsageDashboard] normalized:', JSON.stringify(normalized));

      if (
        usageStatisticsEnabled === false &&
        normalized.summary.totalRequests === 0 &&
        normalized.byProvider.length === 0 &&
        normalized.byAccount.length === 0
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
      const allBuckets: RecentRequestBucket[] = [];
      if (raw && typeof raw === 'object') {
        for (const providerEntries of Object.values(raw)) {
          if (!providerEntries || typeof providerEntries !== 'object') continue;
          for (const entry of Object.values(providerEntries)) {
            const rec = entry as Record<string, unknown>;
            const buckets = rec?.recent_requests ?? rec?.recentRequests;
            if (Array.isArray(buckets)) {
              allBuckets.push(...normalizeRecentRequestBuckets(buckets));
            }
          }
        }
      }
      setHeatmapBuckets(buildHeatmapBuckets(allBuckets));
    } catch {
      setHeatmapBuckets([]);
    }
  }, [managementKey]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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
  };
}
