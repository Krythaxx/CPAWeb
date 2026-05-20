import { useCallback, useState } from 'react';
import type { PriceEntry } from '@/types/usageStats';

const STORAGE_KEY = 'cpa-price-table';

function loadTable(): PriceEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PriceEntry[];
  } catch {
    return [];
  }
}

function saveTable(table: PriceEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
}

export function usePriceTable() {
  const [table, setTable] = useState<PriceEntry[]>(loadTable);

  const updateEntry = useCallback((model: string, input: number, output: number) => {
    setTable((prev) => {
      const idx = prev.findIndex((e) => e.model === model);
      const next = [...prev];
      const entry: PriceEntry = { model, inputPricePerM: input, outputPricePerM: output };
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
