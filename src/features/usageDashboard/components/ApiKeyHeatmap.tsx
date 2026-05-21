import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HeatmapBucket } from '@/types/usageStats';
import { RECENT_REQUEST_BLOCK_DURATION_MS } from '@/utils/recentRequests';
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
  const cardRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
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
    const duration = RECENT_REQUEST_BLOCK_DURATION_MS;
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
      const cardRect = cardRef.current?.getBoundingClientRect();
      const gridRect = gridRef.current?.getBoundingClientRect();
      if (!cardRect || !gridRect) return;

      const dotX = e.clientX - gridRect.left;
      const dotY = e.clientY - gridRect.top;
      const gridTopInCard = gridRect.top - cardRect.top;
      const tooltipOffset = 12;
      const tooltipWidth = tooltipRef.current?.offsetWidth ?? 180;
      const tooltipHeight = tooltipRef.current?.offsetHeight ?? 60;

      let x = gridRect.left - cardRect.left + dotX - tooltipWidth / 2;
      let y = gridTopInCard + dotY + DOT_SIZE + tooltipOffset;

      if (x < 0) x = 0;
      if (x + tooltipWidth > cardRect.width) x = cardRect.width - tooltipWidth;

      if (y + tooltipHeight > cardRect.height) {
        const flippedY = gridTopInCard + dotY - tooltipOffset - tooltipHeight;
        if (flippedY >= 0) {
          y = flippedY;
        } else {
          y = Math.max(0, cardRect.height - tooltipHeight);
        }
      }

      setTooltip({ x, y, bucket, isIdle });
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const successWidth = totalRequests > 0 ? (successCount / totalRequests) * 100 : 100;

  return (
    <div className={styles.card} ref={cardRef}>
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
          ref={tooltipRef}
          className={styles.tooltip}
          style={{ left: tooltip.x, top: tooltip.y }}
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
