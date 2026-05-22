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
  preferBackend: boolean;
}

export function usePriceTable(options?: UsePriceTableOptions) {
  const managementKey = useAuthStore((state) => state.managementKey);
  const serviceUrl = options?.serviceUrl ?? '';
  const preferBackend = Boolean(options?.preferBackend);
  const [table, setTable] = useState<PriceEntry[]>(loadTable);
  const [backendPricesEnabled, setBackendPricesEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!preferBackend || !serviceUrl || !managementKey) {
        if (cancelled) return;
        setBackendPricesEnabled(false);
        setTable(loadTable());
        return;
      }

      try {
        const prices = await usageStatsApi.fetchPrices(serviceUrl, managementKey);
        if (cancelled) return;
        setBackendPricesEnabled(true);
        setTable(prices);
      } catch {
        if (cancelled) return;
        setBackendPricesEnabled(false);
        setTable(loadTable());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [managementKey, preferBackend, serviceUrl]);

  const persistTable = useCallback(
    (next: PriceEntry[]) => {
      if (backendPricesEnabled && serviceUrl && managementKey) {
        void usageStatsApi
          .savePrices(serviceUrl, managementKey, next)
          .catch(() => {
            setBackendPricesEnabled(false);
            saveTable(next);
          });
        return;
      }

      saveTable(next);
    },
    [backendPricesEnabled, managementKey, serviceUrl],
  );

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
    if (!backendPricesEnabled) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [backendPricesEnabled, persistTable]);

  return { table, updateEntry, removeEntry, clearAll };
}
