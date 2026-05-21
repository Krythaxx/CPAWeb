import { useCallback, useState } from 'react';
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

export function usePriceTable() {
  const [table, setTable] = useState<PriceEntry[]>(loadTable);

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
      saveTable(next);
      return next;
    });
  }, []);

  const removeEntry = useCallback((model: string) => {
    setTable((prev) => {
      const next = prev.filter((e) => e.model !== model);
      saveTable(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setTable([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { table, updateEntry, removeEntry, clearAll };
}
