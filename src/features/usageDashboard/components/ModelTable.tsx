import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageStatsGroupRow, PriceEntry } from '@/types/usageStats';
import { calculateCost, findPriceEntry, formatCost } from '../utils/priceCalculator';
import { ColumnConfigPopover } from './ColumnConfigPopover';
import styles from './ModelTable.module.scss';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

type SortKey = 'label' | 'requests' | 'tokens' | 'inputOutput' | 'cache' | 'cacheRate' | 'cost';
type SortDir = 'asc' | 'desc';

const DEFAULT_VISIBLE = ['label', 'requests', 'tokens', 'inputOutput', 'cache', 'cacheRate', 'cost'];
const ALL_COLUMNS = [
  { key: 'label', labelKey: 'usage_stats.col_model', hideable: false },
  { key: 'requests', labelKey: 'usage_stats.col_requests', hideable: false },
  { key: 'tokens', labelKey: 'usage_stats.col_total_tokens', hideable: false },
  { key: 'inputOutput', labelKey: 'usage_dashboard.col_input_output', hideable: true },
  { key: 'cache', labelKey: 'usage_dashboard.col_cache', hideable: true },
  { key: 'cacheRate', labelKey: 'usage_dashboard.col_cache_rate', hideable: true },
  { key: 'cost', labelKey: 'usage_dashboard.cost', hideable: true },
];

interface ModelTableProps {
  rows: UsageStatsGroupRow[];
  priceTable: PriceEntry[];
}

export function ModelTable({ rows, priceTable }: ModelTableProps) {
  const { t } = useTranslation();
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE);
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showColumnConfig, setShowColumnConfig] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'label' ? 'asc' : 'desc');
    }
  };

  const getCacheRate = (row: UsageStatsGroupRow): number => {
    const total = row.inputTokens + row.outputTokens;
    return total > 0 ? row.cachedTokens / total : 0;
  };

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'label':
          return dir * a.label.localeCompare(b.label);
        case 'requests':
          return dir * (a.requests - b.requests);
        case 'tokens':
          return dir * (a.totalTokens - b.totalTokens);
        case 'inputOutput':
          return dir * ((a.inputTokens + a.outputTokens) - (b.inputTokens + b.outputTokens));
        case 'cache':
          return dir * (a.cachedTokens - b.cachedTokens);
        case 'cacheRate':
          return dir * (getCacheRate(a) - getCacheRate(b));
        case 'cost': {
          const ca = calculateCost(a.inputTokens, a.outputTokens, findPriceEntry(priceTable, a.label), a.cachedTokens) ?? -1;
          const cb = calculateCost(b.inputTokens, b.outputTokens, findPriceEntry(priceTable, b.label), b.cachedTokens) ?? -1;
          return dir * (ca - cb);
        }
        default:
          return 0;
      }
    });
  }, [rows, sortKey, sortDir, priceTable]);

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  const isVisible = (key: string) => visibleColumns.includes(key);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('usage_dashboard.model_usage')}</span>
        <div className={styles.headerRight}>
          <button
            className={styles.colBtn}
            onClick={() => setShowColumnConfig(!showColumnConfig)}
          >
            {t('usage_dashboard.columns')}
          </button>
          {showColumnConfig && (
            <ColumnConfigPopover
              columns={ALL_COLUMNS}
              visibleColumns={visibleColumns}
              onChange={setVisibleColumns}
              onClose={() => setShowColumnConfig(false)}
            />
          )}
        </div>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {isVisible('label') && (
                <th className={styles.sortable} onClick={() => handleSort('label')}>
                  {t('usage_stats.col_model')}{arrow('label')}
                </th>
              )}
              {isVisible('requests') && (
                <th className={styles.sortable} onClick={() => handleSort('requests')}>
                  {t('usage_stats.col_requests')}{arrow('requests')}
                </th>
              )}
              {isVisible('tokens') && (
                <th className={styles.sortable} onClick={() => handleSort('tokens')}>
                  Token{arrow('tokens')}
                </th>
              )}
              {isVisible('inputOutput') && (
                <th className={styles.sortable} onClick={() => handleSort('inputOutput')}>
                  {t('usage_dashboard.col_input_output')}{arrow('inputOutput')}
                </th>
              )}
              {isVisible('cache') && (
                <th className={styles.sortable} onClick={() => handleSort('cache')}>
                  {t('usage_dashboard.col_cache')}{arrow('cache')}
                </th>
              )}
              {isVisible('cacheRate') && (
                <th className={styles.sortable} onClick={() => handleSort('cacheRate')}>
                  {t('usage_dashboard.col_cache_rate')}{arrow('cacheRate')}
                </th>
              )}
              {isVisible('cost') && (
                <th className={styles.sortable} onClick={() => handleSort('cost')}>
                  {t('usage_dashboard.cost')}{arrow('cost')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className={styles.empty}>
                  {t('usage_stats.empty_table')}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const cost = calculateCost(
                  row.inputTokens,
                  row.outputTokens,
                  findPriceEntry(priceTable, row.label),
                  row.cachedTokens,
                );
                const cacheRate = getCacheRate(row);
                return (
                  <tr key={row.key}>
                    {isVisible('label') && (
                      <td className={styles.modelCell} title={row.label}>{row.label}</td>
                    )}
                    {isVisible('requests') && <td>{formatNumber(row.requests)}</td>}
                    {isVisible('tokens') && <td>{formatNumber(row.totalTokens)}</td>}
                    {isVisible('inputOutput') && (
                      <td>
                        <span className={styles.ioCell}>
                          {formatNumber(row.inputTokens)} / {formatNumber(row.outputTokens)}
                        </span>
                      </td>
                    )}
                    {isVisible('cache') && <td>{formatNumber(row.cachedTokens)}</td>}
                    {isVisible('cacheRate') && (
                      <td>{cacheRate > 0 ? `${(cacheRate * 100).toFixed(1)}%` : '-'}</td>
                    )}
                    {isVisible('cost') && <td>{formatCost(cost)}</td>}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
