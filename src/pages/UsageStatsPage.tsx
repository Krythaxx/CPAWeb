import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useUsageStats } from './hooks/useUsageStats';
import type { UsageStatsTimeRange, UsageStatsGroupRow } from '@/types/usageStats';
import styles from './UsageStatsPage.module.scss';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatTimestamp(ms: number | null | undefined): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

const RANGES: UsageStatsTimeRange[] = ['today', '7d', '30d', 'all'];

type SortKey = 'label' | 'requests' | 'tokens' | 'successRate';
type SortDir = 'asc' | 'desc';

function useSortState(defaultKey: SortKey = 'requests', defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState<SortKey>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'label' ? 'asc' : 'desc');
    }
  };

  return { sortKey, sortDir, handleSort };
}

function sortRows(rows: UsageStatsGroupRow[], sortKey: SortKey, sortDir: SortDir): UsageStatsGroupRow[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sortKey) {
      case 'label':
        return dir * a.label.localeCompare(b.label);
      case 'requests':
        return dir * (a.requests - b.requests);
      case 'tokens':
        return dir * (a.totalTokens - b.totalTokens);
      case 'successRate':
        return dir * (a.successRate - b.successRate);
      default:
        return 0;
    }
  });
}

function successRateClassName(rate: number): string {
  if (rate >= 0.95) return styles.statSuccess;
  if (rate >= 0.8) return styles.statNeutral;
  return styles.statFailure;
}

export function UsageStatsPage() {
  const { t } = useTranslation();
  const stats = useUsageStats();

  useEffect(() => {
    stats.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.range, stats.serviceUrl]);

  const isMemory = stats.dataSource === 'memory';
  const isUnavailable = stats.dataSource === 'unavailable';
  const isError = stats.dataSource === 'error';
  const showTokenColumns = !isMemory && !isUnavailable && !isError;
  const isMemoryEmpty =
    isMemory &&
    stats.data?.summary.totalRequests === 0 &&
    stats.data.byProvider.length === 0 &&
    stats.data.byAccount.length === 0;
  const showZeroTokenValues = showTokenColumns || isMemoryEmpty;

  const modelSort = useSortState('requests');
  const credentialSort = useSortState('requests');

  const sortedModelRows = useMemo(() => {
    if (!stats.data?.byModel) return [];
    return sortRows(stats.data.byModel, modelSort.sortKey, modelSort.sortDir);
  }, [stats.data?.byModel, modelSort.sortKey, modelSort.sortDir]);

  const sortedCredentialRows = useMemo(() => {
    if (!stats.data?.byAccount) return [];
    return sortRows(stats.data.byAccount, credentialSort.sortKey, credentialSort.sortDir);
  }, [stats.data?.byAccount, credentialSort.sortKey, credentialSort.sortDir]);

  const columnCount = showTokenColumns ? 9 : 5;

  const renderSourceBadge = () => {
    if (stats.loading) return null;
    if (isMemory) {
      return (
        <span className={`${styles.sourceBadge} ${styles.sourceBadgeMemory}`}>
          {t('usage_stats.source_memory')}
        </span>
      );
    }
    if (isUnavailable) {
      return (
        <span className={`${styles.sourceBadge} ${styles.sourceBadgeUnavailable}`}>
          {t('usage_stats.source_unavailable')}
        </span>
      );
    }
    if (isError) {
      return (
        <span className={`${styles.sourceBadge} ${styles.sourceBadgeError}`}>
          Error
        </span>
      );
    }
    return (
      <span className={`${styles.sourceBadge} ${styles.sourceBadgePostgres}`}>
        {t('usage_stats.source_postgres')}
      </span>
    );
  };

  const renderStatCards = () => {
    const s = stats.data?.summary;
    if (!s && !stats.loading) return null;

    const cards: {
      key: string;
      label: string;
      accent: string;
      value: string | null;
      meta?: React.ReactNode;
      unavailable?: boolean;
    }[] = [
      {
        key: 'requests',
        label: t('usage_stats.summary_total_requests'),
        accent: '#8b8680',
        value: s ? formatNumber(s.totalRequests) : '-',
        meta: s ? (
          <>
            <span className={styles.statMetaItem}>
              <span className={styles.statMetaDot} style={{ backgroundColor: '#10b981' }} />
              {t('usage_stats.col_success')}: {formatNumber(s.successCount)}
            </span>
            <span className={styles.statMetaItem}>
              <span className={styles.statMetaDot} style={{ backgroundColor: '#c65746' }} />
              {t('usage_stats.col_failure')}: {formatNumber(s.failureCount)}
            </span>
          </>
        ) : undefined,
      },
      {
        key: 'rate',
        label: t('usage_stats.summary_success_rate'),
        accent: '#22c55e',
        value: s ? formatPercent(s.successRate) : '-',
        meta: s ? (
          <span className={`${successRateClassName(s.successRate)}`}>
            {s.successRate >= 0.95 ? t('usage_stats.rate_good') : s.successRate >= 0.8 ? t('usage_stats.rate_fair') : t('usage_stats.rate_poor')}
          </span>
        ) : undefined,
      },
      {
        key: 'tokens',
        label: t('usage_stats.summary_total_tokens'),
        accent: '#8b5cf6',
        value: s && showZeroTokenValues ? formatNumber(s.totalTokens) : null,
        unavailable: isMemory && !isMemoryEmpty,
        meta: s && showTokenColumns ? (
          <>
            <span className={styles.statMetaItem}>
              {t('usage_stats.summary_input_tokens')}: {formatNumber(s.inputTokens)}
            </span>
            <span className={styles.statMetaItem}>
              {t('usage_stats.summary_output_tokens')}: {formatNumber(s.outputTokens)}
            </span>
          </>
        ) : undefined,
      },
      {
        key: 'input',
        label: t('usage_stats.summary_input_tokens'),
        accent: '#3b82f6',
        value: s && showZeroTokenValues ? formatNumber(s.inputTokens) : null,
        unavailable: isMemory && !isMemoryEmpty,
      },
      {
        key: 'output',
        label: t('usage_stats.summary_output_tokens'),
        accent: '#f97316',
        value: s && showZeroTokenValues ? formatNumber(s.outputTokens) : null,
        unavailable: isMemory && !isMemoryEmpty,
      },
      {
        key: 'cached',
        label: t('usage_stats.summary_cached_tokens'),
        accent: '#f59e0b',
        value: s && showZeroTokenValues ? formatNumber(s.cachedTokens) : null,
        unavailable: isMemory && !isMemoryEmpty,
      },
    ];

    return (
      <div className={styles.statsGrid}>
        {cards.map((card) => (
          <div
            key={card.key}
            className={styles.statCard}
            style={
              {
                '--accent': card.accent,
                '--accent-soft': `${card.accent}2e`,
                '--accent-border': `${card.accent}59`,
              } as CSSProperties
            }
          >
            <div className={styles.statCardHeader}>
              <span className={styles.statLabel}>{card.label}</span>
            </div>
            {card.unavailable ? (
              <span className={styles.summaryValueUnavailable}>
                {t('usage_stats.token_unavailable')}
              </span>
            ) : (
              <div className={styles.statValue}>{card.value ?? '-'}</div>
            )}
            {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}
          </div>
        ))}
      </div>
    );
  };

  const renderSortableTable = (
    rows: UsageStatsGroupRow[],
    sort: { sortKey: SortKey; sortDir: SortDir; handleSort: (k: SortKey) => void },
    opts?: { isModelSection?: boolean; firstColKey?: string },
  ) => {
    const isEmpty = !rows || rows.length === 0;
    const arrow = (key: SortKey) =>
      sort.sortKey === key ? (sort.sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
    const ariaSort = (key: SortKey): 'none' | 'ascending' | 'descending' =>
      sort.sortKey === key ? (sort.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
    const firstCol = opts?.firstColKey ?? 'usage_stats.col_model';

    return (
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.sortableHeader} aria-sort={ariaSort('label')}>
                <button type="button" className={styles.sortHeaderButton} onClick={() => sort.handleSort('label')}>
                  {t(firstCol)}{arrow('label')}
                </button>
              </th>
              <th className={styles.sortableHeader} aria-sort={ariaSort('requests')}>
                <button type="button" className={styles.sortHeaderButton} onClick={() => sort.handleSort('requests')}>
                  {t('usage_stats.col_requests')}{arrow('requests')}
                </button>
              </th>
              <th>{t('usage_stats.col_success')}</th>
              <th>{t('usage_stats.col_failure')}</th>
              <th className={styles.sortableHeader} aria-sort={ariaSort('successRate')}>
                <button type="button" className={styles.sortHeaderButton} onClick={() => sort.handleSort('successRate')}>
                  {t('usage_stats.col_success_rate')}{arrow('successRate')}
                </button>
              </th>
              {showTokenColumns && (
                <>
                  <th className={styles.sortableHeader} aria-sort={ariaSort('tokens')}>
                    <button type="button" className={styles.sortHeaderButton} onClick={() => sort.handleSort('tokens')}>
                      {t('usage_stats.col_total_tokens')}{arrow('tokens')}
                    </button>
                  </th>
                  <th>{t('usage_stats.col_input_tokens')}</th>
                  <th>{t('usage_stats.col_output_tokens')}</th>
                  <th>{t('usage_stats.col_cached_tokens')}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {isEmpty ? (
              <tr className={styles.emptyRow}>
                <td colSpan={columnCount}>{t('usage_stats.empty_table')}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  <td className={styles.modelCell}>
                    {row.apiKeyHash ? maskKey(row.label) : row.label}
                  </td>
                  <td>
                    <span className={styles.requestCountCell}>
                      <span>{formatNumber(row.requests)}</span>
                      <span className={styles.requestBreakdown}>
                        (<span className={styles.statSuccess}>{formatNumber(row.successCount)}</span>{' '}
                        <span className={styles.statFailure}>{formatNumber(row.failureCount)}</span>)
                      </span>
                    </span>
                  </td>
                  <td>{formatNumber(row.successCount)}</td>
                  <td>{formatNumber(row.failureCount)}</td>
                  <td>
                    <span className={successRateClassName(row.successRate)}>
                      {formatPercent(row.successRate)}
                    </span>
                  </td>
                  {showTokenColumns && (
                    <>
                      <td>{formatNumber(row.totalTokens)}</td>
                      <td>{formatNumber(row.inputTokens)}</td>
                      <td>{formatNumber(row.outputTokens)}</td>
                      <td>{formatNumber(row.cachedTokens)}</td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderServiceInfo = () => {
    const svc = stats.data?.service;
    if (!svc || isMemory) return null;

    return (
      <div className={styles.serviceInfo}>
        <div className={styles.serviceInfoItem}>
          <span>{t('usage_stats.service_status')}:</span>
          <span>{svc.status === 'running' ? t('usage_stats.service_running') : t('usage_stats.service_stopped')}</span>
        </div>
        <div className={styles.serviceInfoItem}>
          <span>{t('usage_stats.service_events')}:</span>
          <span>{svc.events}</span>
        </div>
        {svc.deadLetters > 0 && (
          <div className={styles.serviceInfoItem}>
            <span>{t('usage_stats.service_dead_letters')}:</span>
            <span>{svc.deadLetters}</span>
          </div>
        )}
        <div className={styles.serviceInfoItem}>
          <span>{t('usage_stats.service_last_consumed')}:</span>
          <span>{formatTimestamp(svc.lastConsumedAt)}</span>
        </div>
        <div className={styles.serviceInfoItem}>
          <span>{t('usage_stats.service_last_inserted')}:</span>
          <span>{formatTimestamp(svc.lastInsertedAt)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
          <p className={styles.description}>{t('usage_stats.description')}</p>
        </div>
        <div className={styles.headerActions}>
          {renderSourceBadge()}
          <Button
            className={styles.refreshButton}
            size="sm"
            onClick={stats.refresh}
            disabled={stats.loading}
          >
            {t('usage_stats.refresh')}
          </Button>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.rangeToggle}>
          {RANGES.map((r) => (
            <Button
              key={r}
              className={`${styles.rangeButton}${
                stats.range === r ? ` ${styles.rangeButtonActive}` : ''
              }`}
              size="sm"
              onClick={() => stats.setRange(r)}
            >
              {t(`usage_stats.range_${r === 'today' ? 'today' : r}`)}
            </Button>
          ))}
        </div>
        <div className={styles.controlGroup}>
          <label>{t('usage_stats.service_url_label')}</label>
          <input
            type="text"
            className={styles.serviceUrlInput}
            value={stats.serviceUrl}
            onChange={(e) => stats.setServiceUrl(e.target.value)}
            placeholder={t('usage_stats.service_url_placeholder')}
            title={t('usage_stats.service_url_hint')}
          />
        </div>
      </div>

      {stats.loading && (
        <div className={styles.loadingBox}>{t('usage_stats.loading')}</div>
      )}

      {stats.error && !stats.loading && (
        <div className={styles.errorBox}>{stats.error}</div>
      )}

      {!stats.loading && stats.data && (
        <>
          {renderStatCards()}
          {renderServiceInfo()}

          <div className={styles.detailsGrid}>
            <Card title={t('usage_stats.section_by_model')} className={styles.detailsFixedCard}>
              {isMemory && stats.data.byModel.length === 0 ? (
                <div className={styles.modelHint}>
                  {t('usage_stats.model_unavailable_hint')}
                </div>
              ) : (
                <div className={styles.detailsScroll}>
                  {renderSortableTable(sortedModelRows, modelSort, { firstColKey: 'usage_stats.col_model' })}
                </div>
              )}
            </Card>

            <Card title={t('usage_stats.section_by_provider')} className={styles.detailsFixedCard}>
              <div className={styles.detailsScroll}>
                {renderSortableTable(sortedCredentialRows, credentialSort, { firstColKey: 'usage_stats.col_provider' })}
              </div>
            </Card>
          </div>
        </>
      )}

      {!stats.loading && stats.error && isMemoryEmpty && (
        <div className={styles.emptyBox}>{t('usage_stats.empty_memory')}</div>
      )}

      {!stats.loading && !stats.error && !stats.data && stats.dataSource === 'postgres' && (
        <div className={styles.emptyBox}>{t('usage_stats.empty_postgres')}</div>
      )}
    </div>
  );
}
