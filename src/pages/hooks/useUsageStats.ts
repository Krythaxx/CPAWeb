import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useConfigStore } from '@/stores';
import { usageStatsApi, normalizeMemoryStats } from '@/services/api/usageStats';
import { normalizeApiBase } from '@/utils/connection';
import type {
  UsageStatsDataSource,
  UsageStatsState,
  UsageStatsTimeRange,
} from '@/types/usageStats';

const STORAGE_KEY_SERVICE_URL = 'cli-proxy-usage-service-url';

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
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

export function useUsageStats() {
  const { t } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const usageStatisticsEnabled = useConfigStore((s) =>
    normalizeBoolean(s.config?.raw?.['usage-statistics-enabled']),
  );

  const [state, setState] = useState<UsageStatsState>({
    loading: false,
    dataSource: 'postgres',
    data: null,
    error: null,
    range: '7d',
    serviceUrl: loadServiceUrl(apiBase),
  });

  const abortRef = useRef<AbortController | null>(null);

  const setRange = useCallback((range: UsageStatsTimeRange) => {
    setState((prev) => ({ ...prev, range }));
  }, []);

  const setServiceUrl = useCallback(
    (url: string) => {
      if (url.trim()) {
        saveServiceUrl(url);
      } else {
        clearServiceUrl();
        url = deriveDefaultServiceUrl(apiBase);
      }
      setState((prev) => ({ ...prev, serviceUrl: url }));
    },
    [apiBase],
  );

  const fetchData = useCallback(async () => {
    if (!managementKey) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const persistentData = await usageStatsApi.fetchPersistentStats(
        state.serviceUrl,
        managementKey,
        state.range,
      );

      if (ac.signal.aborted) return;

      const source: UsageStatsDataSource = 'postgres';
      setState((prev) => ({
        ...prev,
        loading: false,
        dataSource: source,
        data: { ...persistentData, source: 'postgres' },
        error: null,
      }));
      return;
    } catch {
      if (ac.signal.aborted) return;
    }

    try {
      const rawMemory = await usageStatsApi.fetchMemoryStats();

      if (ac.signal.aborted) return;

      const normalized = normalizeMemoryStats(rawMemory);

      if (
        usageStatisticsEnabled === false &&
        normalized.summary.totalRequests === 0 &&
        normalized.byProvider.length === 0 &&
        normalized.byAccount.length === 0
      ) {
        setState((prev) => ({
          ...prev,
          loading: false,
          dataSource: 'unavailable',
          data: null,
          error: t('usage_stats.empty_memory_disabled'),
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        loading: false,
        dataSource: 'memory',
        data: normalized,
        error: null,
      }));
    } catch (err: unknown) {
      if (ac.signal.aborted) return;

      const message =
        err instanceof Error ? err.message : t('usage_stats.error_generic');

      let finalMessage = message;
      if (
        message.toLowerCase().includes('unauthorized') ||
        message.toLowerCase().includes('401')
      ) {
        finalMessage = t('usage_stats.error_auth');
      }

      setState((prev) => ({
        ...prev,
        loading: false,
        dataSource: 'error',
        data: null,
        error: finalMessage,
      }));
    }
  }, [state.serviceUrl, state.range, managementKey, usageStatisticsEnabled, t]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    ...state,
    setRange,
    setServiceUrl,
    refresh: fetchData,
  };
}
