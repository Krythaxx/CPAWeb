import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { HeatmapBucket } from '@/types/usageStats';
import styles from './ApiKeyHeatmap.module.scss';

interface ApiKeyHeatmapProps {
  totalRequests: number;
  successRate: number;
  successCount: number;
  failureCount: number;
  buckets: HeatmapBucket[];
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function dotColor(successRate: number, total: number): string {
  if (total === 0) return '#d1d5db';
  if (successRate >= 0.9) return '#10b981';
  if (successRate >= 0.5) return '#f59e0b';
  return '#ef4444';
}

function formatTimeRange(start: number, end: number): string {
  const s = new Date(start);
  const e = new Date(end);
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${fmt(s)} - ${fmt(e)}`;
}

export function ApiKeyHeatmap({
  totalRequests,
  successRate,
  successCount,
  failureCount,
  buckets,
}: ApiKeyHeatmapProps) {
  const { t } = useTranslation();
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    bucket: HeatmapBucket;
  } | null>(null);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, bucket: HeatmapBucket) => {
      const rect = (e.currentTarget as HTMLElement).closest(`.${styles.grid}`)
        ?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        bucket,
      });
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const successWidth = totalRequests > 0 ? (successCount / totalRequests) * 100 : 100;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <span className={styles.cardTitle}>{t('usage_dashboard.api_key_overview')}</span>
          <span className={styles.cardMeta}>
            {t('usage_dashboard.total_requests')}: {formatNumber(totalRequests)}
            {' · '}
            {t('usage_stats.col_success_rate')}: {formatPercent(successRate)}
          </span>
        </div>
        <div className={styles.ratioBar}>
          <div className={styles.ratioSuccess} style={{ width: `${successWidth}%` }} />
          <div className={styles.ratioFailure} style={{ width: `${100 - successWidth}%` }} />
        </div>
        <div className={styles.ratioLabels}>
          <span className={styles.labelSuccess}>
            {t('usage_stats.col_success')}: {formatNumber(successCount)}
          </span>
          <span className={styles.labelFailure}>
            {t('usage_stats.col_failure')}: {formatNumber(failureCount)}
          </span>
        </div>
      </div>
      <div className={styles.grid}>
        {buckets.map((bucket, i) => {
          const total = bucket.success + bucket.failed;
          return (
            <div
              key={i}
              className={styles.dot}
              style={{ backgroundColor: dotColor(bucket.successRate, total) }}
              onMouseEnter={(e) => handleMouseEnter(e, bucket)}
              onMouseLeave={handleMouseLeave}
            />
          );
        })}
        {buckets.length === 0 && (
          <div className={styles.emptyHint}>{t('usage_dashboard.no_requests')}</div>
        )}
      </div>
      {tooltip && (
        <div
          className={styles.tooltip}
          style={{ left: tooltip.x, top: tooltip.y - 60 }}
        >
          <div className={styles.tooltipTime}>
            {formatTimeRange(tooltip.bucket.timeStart, tooltip.bucket.timeEnd)}
          </div>
          <div>
            {t('usage_stats.col_success')}: {tooltip.bucket.success}
          </div>
          <div>
            {t('usage_stats.col_failure')}: {tooltip.bucket.failed}
          </div>
          <div>
            {t('usage_stats.col_success_rate')}:{' '}
            {formatPercent(tooltip.bucket.successRate)}
          </div>
        </div>
      )}
    </div>
  );
}
