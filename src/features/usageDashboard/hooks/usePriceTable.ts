import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/stores';
import { usageStatsApi } from '@/services/api/usageStats';
import type { PriceEntry } from '@/types/usageStats';

const STORAGE_KEY = 'cpa-price-table';

function loadTable(): PriceEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PriceEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const record = entry as Partial<PriceEntry>;
      return (
        typeof record.model === 'string' &&
        typeof record.inputPricePerM === 'number' &&
        Number.isFinite(record.inputPricePerM) &&
        typeof record.cacheHitPricePerM === 'number' &&
        Number.isFinite(record.cacheHitPricePerM) &&
        typeof record.outputPricePerM === 'number' &&
        Number.isFinite(record.outputPricePerM)
      );
    });
  } catch {
    return [];
  }
}

function saveTable(table: PriceEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
}

interface UsePriceTableOptions {
  serviceUrl: string;
}

export function usePriceTable(options?: UsePriceTableOptions) {
  const managementKey = useAuthStore((state) => state.managementKey);
  const serviceUrl = options?.serviceUrl ?? '';
  const [table, setTable] = useState<PriceEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      if (serviceUrl && managementKey) {
        try {
          const prices = await usageStatsApi.fetchPrices(serviceUrl, managementKey);
          if (cancelled) return;
          setTable(prices);
          setLoading(false);
          return;
        } catch {
          // fallback to localStorage
        }
      }

      if (cancelled) return;
      setTable(loadTable());
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [managementKey, serviceUrl]);

  const persistTable = useCallback((next: PriceEntry[]) => {
    saveTable(next);
  }, []);

  const updateEntry = useCallback((model: string, input: number, cacheHit: number, output: number) => {
    setTable((prev) => {
      const idx = prev.findIndex((e) => e.model === model);
      const next = [...prev];
      const entry: PriceEntry = { model, inputPricePerM: input, cacheHitPricePerM: cacheHit, outputPricePerM: output };
      if (idx >= 0) {
        next[idx] = entry;
      } else {
        next.push(entry);
      }
      persistTable(next);
      return next;
    });
  }, [persistTable]);

  const removeEntry = useCallback((model: string) => {
    setTable((prev) => {
      const next = prev.filter((e) => e.model !== model);
      persistTable(next);
      return next;
    });
  }, [persistTable]);

  const clearAll = useCallback(() => {
    setTable([]);
    persistTable([]);
  }, [persistTable]);

  const syncToBackend = useCallback(async () => {
    if (!serviceUrl || !managementKey) return;
    await usageStatsApi.savePrices(serviceUrl, managementKey, table);
  }, [serviceUrl, managementKey, table]);

  const loadFromBackend = useCallback(async () => {
    if (!serviceUrl || !managementKey) return;
    const prices = await usageStatsApi.fetchPrices(serviceUrl, managementKey);
    if (Array.isArray(prices) && prices.length > 0) {
      setTable(prices);
      persistTable(prices);
    }
  }, [serviceUrl, managementKey, persistTable]);

  return { table, loading, updateEntry, removeEntry, clearAll, syncToBackend, loadFromBackend };
}
