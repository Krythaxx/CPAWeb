import { Fragment, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourceDisplayRow, PriceEntry } from '@/types/usageStats';
import { calculateCost, findPriceEntry, formatCost } from '../utils/priceCalculator';
import styles from './SourceTable.module.scss';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

type SortKey = 'label' | 'requests' | 'tokens' | 'models' | 'cost';
type SortDir = 'asc' | 'desc';

interface SourceTableProps {
  rows: SourceDisplayRow[];
  priceTable: PriceEntry[];
}

export function SourceTable({ rows, priceTable }: SourceTableProps) {
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

  const computeRowCost = useCallback((row: SourceDisplayRow): number | null => {
    if (!row.childModels || row.childModels.length === 0) return null;
    let total = 0;
    let hasPrice = false;
    for (const m of row.childModels) {
      const cost = calculateCost(m.inputTokens, m.outputTokens, findPriceEntry(priceTable, m.label), m.cachedTokens);
      if (cost !== null) {
        total += cost;
        hasPrice = true;
      }
    }
    return hasPrice ? total : null;
  }, [priceTable]);

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
        case 'models':
          return dir * (a.modelCount - b.modelCount);
        case 'cost': {
          const ca = computeRowCost(a) ?? -1;
          const cb = computeRowCost(b) ?? -1;
          return dir * (ca - cb);
        }
        default:
          return 0;
      }
    });
  }, [rows, sortKey, sortDir, computeRowCost]);

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  const toggleExpand = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('usage_dashboard.source_usage')}</span>
        <span className={styles.headerHint}>{t('usage_dashboard.click_expand_hint')}</span>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th />
              <th className={styles.sortable} onClick={() => handleSort('label')}>
                {t('usage_dashboard.col_source')}{arrow('label')}
              </th>
              <th className={styles.sortable} onClick={() => handleSort('requests')}>
                {t('usage_stats.col_requests')}{arrow('requests')}
              </th>
              <th className={styles.sortable} onClick={() => handleSort('tokens')}>
                Token{arrow('tokens')}
              </th>
              <th className={styles.sortable} onClick={() => handleSort('models')}>
                {t('usage_dashboard.model_count')}{arrow('models')}
              </th>
              <th>{t('usage_stats.col_provider')}</th>
              <th className={styles.sortable} onClick={() => handleSort('cost')}>
                {t('usage_dashboard.cost')}{arrow('cost')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className={styles.empty}>
                  {t('usage_stats.empty_table')}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const isExpanded = expandedKey === row.key;
                const cost = computeRowCost(row);
                return (
                  <Fragment key={row.key}>
                    <tr className={isExpanded ? styles.expandedRow : ''}>
                      <td className={styles.expandCell}>
                        <button
                          className={styles.expandBtn}
                          onClick={() => toggleExpand(row.key)}
                        >
                          {isExpanded ? '\u25BC' : '\u25B6'}
                        </button>
                      </td>
                      <td className={styles.nameCell}>{row.label}</td>
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
                      <td>{row.modelCount}</td>
                      <td className={styles.providerCell}>{row.provider || '-'}</td>
                      <td>{formatCost(cost)}</td>
                    </tr>
                    {isExpanded && (
                      <tr className={styles.detailRow}>
                        <td colSpan={7} className={styles.detailCell}>
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
                              {row.childModels.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className={styles.empty}>
                                    {t('usage_dashboard.no_model_detail')}
                                  </td>
                                </tr>
                              ) : (
                                row.childModels.map((m) => {
                                  const mc = calculateCost(
                                    m.inputTokens,
                                    m.outputTokens,
                                    findPriceEntry(priceTable, m.label),
                                    m.cachedTokens,
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
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
