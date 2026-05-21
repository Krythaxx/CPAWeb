import type { PriceEntry } from '@/types/usageStats';

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  priceEntry: PriceEntry | undefined,
  cachedTokens?: number,
): number | null {
  if (!priceEntry) return null;
  if (priceEntry.inputPricePerM === 0 && priceEntry.outputPricePerM === 0 && (priceEntry.cacheHitPricePerM ?? 0) === 0) return null;
  const cacheHit = priceEntry.cacheHitPricePerM ?? 0;
  const cacheTokens = cachedTokens ?? 0;
  const nonCacheInput = Math.max(inputTokens - cacheTokens, 0);
  return (nonCacheInput * priceEntry.inputPricePerM + cacheTokens * cacheHit + outputTokens * priceEntry.outputPricePerM) / 1_000_000;
}

export function findPriceEntry(
  priceTable: PriceEntry[],
  model: string,
): PriceEntry | undefined {
  return priceTable.find((p) => p.model === model);
}

export function formatCost(cost: number | null): string {
  if (cost === null) return '-';
  if (cost < 0.01) return `< $0.01`;
  return `≈ $${cost.toFixed(2)}`;
}
