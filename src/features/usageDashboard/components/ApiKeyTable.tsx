import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageStatsGroupRow, PriceEntry } from '@/types/usageStats';
import { calculateCost, findPriceEntry, formatCost } from '../utils/priceCalculator';
import styles from './ApiKeyTable.module.scss';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

type SortKey = 'label' | 'requests' | 'tokens' | 'cost';
type SortDir = 'asc' | 'desc';

interface ApiKeyTableProps {
  rows: UsageStatsGroupRow[];
  modelRows: UsageStatsGroupRow[];
  priceTable: PriceEntry[];
}

export function ApiKeyTable({ rows, modelRows, priceTable }: ApiKeyTableProps) {
  const { t } = useTranslation();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'label' ? 'asc' : 'desc');
    }
  };

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const getRowCost = (row: UsageStatsGroupRow): number | null => {
      const models = modelRows.filter((m) => m.provider === row.label);
      let total = 0;
      let hasPrice = false;
      for (const m of models) {
        const cost = calculateCost(m.inputTokens, m.outputTokens, findPriceEntry(priceTable, m.label));
        if (cost !== null) {
          total += cost;
          hasPrice = true;
        }
      }
      return hasPrice ? total : null;
    };
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'label':
          return dir * a.label.localeCompare(b.label);
        case 'requests':
          return dir * (a.requests - b.requests);
        case 'tokens':
          return dir * (a.totalTokens - b.totalTokens);
        case 'cost': {
          const ca = getRowCost(a) ?? -1;
          const cb = getRowCost(b) ?? -1;
          return dir * (ca - cb);
        }
        default:
          return 0;
      }
    });
  }, [rows, sortKey, sortDir, priceTable, modelRows]);

  const getCost = (row: UsageStatsGroupRow): number | null => {
    const models = modelRows.filter((m) => m.provider === row.label);
    let total = 0;
    let hasPrice = false;
    for (const m of models) {
      const cost = calculateCost(m.inputTokens, m.outputTokens, findPriceEntry(priceTable, m.label));
      if (cost !== null) {
        total += cost;
        hasPrice = true;
      }
    }
    return hasPrice ? total : null;
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  const toggleExpand = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  const uniqueModels = useMemo(() => {
    const modelSet = new Set<string>();
    modelRows.forEach((m) => modelSet.add(m.label));
    return modelSet.size;
  }, [modelRows]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('usage_dashboard.api_key_usage')}</span>
        <span className={styles.headerHint}>{t('usage_dashboard.click_expand_hint')}</span>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th />
              <th className={styles.sortable} onClick={() => handleSort('label')}>
                API Key{arrow('label')}
              </th>
              <th className={styles.sortable} onClick={() => handleSort('requests')}>
                {t('usage_stats.col_requests')}{arrow('requests')}
              </th>
              <th className={styles.sortable} onClick={() => handleSort('tokens')}>
                Token{arrow('tokens')}
              </th>
              <th>{t('usage_dashboard.model_count')}</th>
              <th className={styles.sortable} onClick={() => handleSort('cost')}>
                {t('usage_dashboard.cost')}{arrow('cost')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.empty}>
                  {t('usage_stats.empty_table')}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const isExpanded = expandedKey === row.key;
                const childModels = modelRows.filter(
                  (m) => m.provider === row.label || m.key.startsWith(row.key),
                );
                const cost = getCost(row);
                return (
                  <>
                    <tr key={row.key} className={isExpanded ? styles.expandedRow : ''}>
                      <td className={styles.expandCell}>
                        <button
                          className={styles.expandBtn}
                          onClick={() => toggleExpand(row.key)}
                        >
                          {isExpanded ? '\u25BC' : '\u25B6'}
                        </button>
                      </td>
                      <td className={styles.keyCell}>{maskKey(row.label)}</td>
                      <td>
                        <span className={styles.requestCell}>
                          {formatNumber(row.requests)}{' '}
                          <span className={styles.requestBreakdown}>
                            (<span className={styles.success}>{formatNumber(row.successCount)}</span>
                            /<span className={styles.failure}>{formatNumber(row.failureCount)}</span>)
                          </span>
                        </span>
                      </td>
                      <td>{formatNumber(row.totalTokens)}</td>
                      <td>{uniqueModels}</td>
                      <td>{formatCost(cost)}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.key}-detail`} className={styles.detailRow}>
                        <td colSpan={6} className={styles.detailCell}>
                          <table className={styles.innerTable}>
                            <thead>
                              <tr>
                                <th>{t('usage_stats.col_model')}</th>
                                <th>{t('usage_stats.col_requests')}</th>
                                <th>Token</th>
                                <th>{t('usage_dashboard.cost')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {childModels.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className={styles.empty}>
                                    {t('usage_dashboard.no_model_detail')}
                                  </td>
                                </tr>
                              ) : (
                                childModels.map((m) => {
                                  const mc = calculateCost(
                                    m.inputTokens,
                                    m.outputTokens,
                                    findPriceEntry(priceTable, m.label),
                                  );
                                  return (
                                    <tr key={m.key}>
                                      <td className={styles.modelName}>{m.label}</td>
                                      <td>{formatNumber(m.requests)}</td>
                                      <td>{formatNumber(m.totalTokens)}</td>
                                      <td>{formatCost(mc)}</td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
