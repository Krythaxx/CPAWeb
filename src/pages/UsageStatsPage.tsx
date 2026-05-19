import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
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

const RANGES: UsageStatsTimeRange[] = ['today', '7d', '30d', 'all'];

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

  const renderSummaryCards = () => {
    const s = stats.data?.summary;
    if (!s && !stats.loading) return null;

    const cards = [
      {
        label: t('usage_stats.summary_total_requests'),
        value: s ? formatNumber(s.totalRequests) : '-',
        highlight: false,
      },
      {
        label: t('usage_stats.summary_success_rate'),
        value: s ? formatPercent(s.successRate) : '-',
        highlight: true,
        rateClass: true,
      },
      {
        label: t('usage_stats.summary_total_tokens'),
        value: s && showTokenColumns ? formatNumber(s.totalTokens) : null,
        unavailable: isMemory,
      },
      {
        label: t('usage_stats.summary_input_tokens'),
        value: s && showTokenColumns ? formatNumber(s.inputTokens) : null,
        unavailable: isMemory,
      },
      {
        label: t('usage_stats.summary_output_tokens'),
        value: s && showTokenColumns ? formatNumber(s.outputTokens) : null,
        unavailable: isMemory,
      },
      {
        label: t('usage_stats.summary_cached_tokens'),
        value: s && showTokenColumns ? formatNumber(s.cachedTokens) : null,
        unavailable: isMemory,
      },
    ];

    return (
      <div className={styles.summaryGrid}>
        {cards.map((card) => (
          <div key={card.label} className={styles.summaryCard}>
            <span className={styles.summaryLabel}>{card.label}</span>
            {card.unavailable ? (
              <span className={styles.summaryValueUnavailable}>
                {t('usage_stats.token_unavailable')}
              </span>
            ) : (
              <span
                className={`${styles.summaryValue}${
                  card.rateClass ? ` ${styles.summaryValueRate}` : ''
                }`}
              >
                {card.value ?? '-'}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderGroupTable = (
    title: string,
    rows: UsageStatsGroupRow[],
  ) => {
    if (!rows || rows.length === 0) return null;

    return (
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        <div className={styles.tableWrapper}>
          <table className={styles.statsTable}>
            <thead>
              <tr>
                <th>{t('usage_stats.col_model')}</th>
                <th>{t('usage_stats.col_requests')}</th>
                <th>{t('usage_stats.col_success')}</th>
                <th>{t('usage_stats.col_failure')}</th>
                <th>{t('usage_stats.col_success_rate')}</th>
                {showTokenColumns && (
                  <>
                    <th>{t('usage_stats.col_input_tokens')}</th>
                    <th>{t('usage_stats.col_output_tokens')}</th>
                    <th>{t('usage_stats.col_cached_tokens')}</th>
                    <th>{t('usage_stats.col_total_tokens')}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{formatNumber(row.requests)}</td>
                  <td>{formatNumber(row.successCount)}</td>
                  <td>{formatNumber(row.failureCount)}</td>
                  <td>{formatPercent(row.successRate)}</td>
                  {showTokenColumns && (
                    <>
                      <td>
                        {isMemory ? (
                          <span className={styles.cellUnavailable}>-</span>
                        ) : (
                          formatNumber(row.inputTokens)
                        )}
                      </td>
                      <td>
                        {isMemory ? (
                          <span className={styles.cellUnavailable}>-</span>
                        ) : (
                          formatNumber(row.outputTokens)
                        )}
                      </td>
                      <td>
                        {isMemory ? (
                          <span className={styles.cellUnavailable}>-</span>
                        ) : (
                          formatNumber(row.cachedTokens)
                        )}
                      </td>
                      <td>
                        {isMemory ? (
                          <span className={styles.cellUnavailable}>-</span>
                        ) : (
                          formatNumber(row.totalTokens)
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <div className={styles.pageHeader}>
        <div className={styles.pageTitleRow}>
          <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        <p className={styles.description}>{t('usage_stats.description')}</p>
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
          {renderSummaryCards()}
          {renderServiceInfo()}
          {renderGroupTable(
            t('usage_stats.section_by_model'),
            stats.data.byModel,
          )}
          {renderGroupTable(
            t('usage_stats.section_by_provider'),
            stats.data.byProvider,
          )}
          {renderGroupTable(
            t('usage_stats.section_by_account'),
            stats.data.byAccount,
          )}
        </>
      )}

      {!stats.loading && !stats.error && !stats.data && stats.dataSource === 'postgres' && (
        <div className={styles.emptyBox}>{t('usage_stats.empty_postgres')}</div>
      )}
    </div>
  );
}
