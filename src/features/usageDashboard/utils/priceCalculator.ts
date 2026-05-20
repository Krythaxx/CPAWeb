import type { PriceEntry } from '@/types/usageStats';

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  priceEntry: PriceEntry | undefined,
): number | null {
  if (!priceEntry) return null;
  if (priceEntry.inputPricePerM === 0 && priceEntry.outputPricePerM === 0) return null;
  return (inputTokens * priceEntry.inputPricePerM + outputTokens * priceEntry.outputPricePerM) / 1_000_000;
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
