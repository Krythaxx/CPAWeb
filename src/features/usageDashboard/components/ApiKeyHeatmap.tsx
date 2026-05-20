import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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

const DOT_SIZE = 10;
const GAP = 4;
const DEFAULT_COLS = 80;
const HEATMAP_IDLE_REFERENCE_TIME = Date.now();

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
  const gridRef = useRef<HTMLDivElement>(null);
  const [colCount, setColCount] = useState(DEFAULT_COLS);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    bucket: HeatmapBucket;
    isIdle: boolean;
  } | null>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const measure = () => {
      const width = el.clientWidth;
      const cols = Math.floor(width / (DOT_SIZE + GAP));
      setColCount(Math.max(cols, 20));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const displayBuckets = useMemo(() => {
    const duration = 30 * 60 * 1000;
    const timelineEnd =
      buckets.length > 0
        ? buckets[buckets.length - 1].timeEnd + Math.max(0, colCount - buckets.length) * duration
        : HEATMAP_IDLE_REFERENCE_TIME;
    const idleBucket = (i: number): HeatmapBucket => ({
      timeStart: timelineEnd - (colCount - i) * duration,
      timeEnd: timelineEnd - (colCount - i - 1) * duration,
      success: 0,
      failed: 0,
      successRate: 0,
    });

    if (buckets.length === 0) {
      return Array.from({ length: colCount }, (_, i) => idleBucket(i));
    }

    if (buckets.length < colCount) {
      const padding = Array.from({ length: colCount - buckets.length }, (_, i) =>
        idleBucket(buckets.length + i),
      );
      return [...buckets, ...padding];
    }

    return buckets.slice(-colCount);
  }, [buckets, colCount]);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, bucket: HeatmapBucket, isIdle: boolean) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        bucket,
        isIdle,
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
      <div className={styles.grid} ref={gridRef}>
        {displayBuckets.map((bucket, i) => {
          const total = bucket.success + bucket.failed;
          const isIdle = total === 0 && i >= buckets.length;
          return (
            <div
              key={i}
              className={styles.dot}
              style={{ backgroundColor: dotColor(bucket.successRate, total) }}
              onMouseEnter={(e) => handleMouseEnter(e, bucket, isIdle)}
              onMouseLeave={handleMouseLeave}
            />
          );
        })}
      </div>
      {tooltip && (
        <div
          className={styles.tooltip}
          style={{ left: tooltip.x, top: tooltip.y - 70 }}
        >
          {tooltip.isIdle ? (
            <div>{t('usage_dashboard.no_requests')}</div>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
