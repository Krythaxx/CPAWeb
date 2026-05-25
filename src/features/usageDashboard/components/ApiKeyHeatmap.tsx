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

interface DisplayBucket extends HeatmapBucket {
  isIdle: boolean;
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
    let resizeFrame: number | null = null;

    const measure = () => {
      const width = Number.isFinite(el.clientWidth) ? el.clientWidth : 0;
      const cols = Math.floor(width / (DOT_SIZE + GAP));
      setColCount(Math.max(cols, 20));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = requestAnimationFrame(measure);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }
    };
  }, []);

  const displayBuckets = useMemo<DisplayBucket[]>(() => {
    const duration = RECENT_REQUEST_BLOCK_DURATION_MS;
    const timelineEnd =
      buckets.length > 0
        ? buckets[buckets.length - 1].timeEnd + Math.max(0, colCount - buckets.length) * duration
        : HEATMAP_IDLE_REFERENCE_TIME;
    const idleBucket = (i: number): DisplayBucket => ({
      timeStart: timelineEnd - (colCount - i) * duration,
      timeEnd: timelineEnd - (colCount - i - 1) * duration,
      success: 0,
      failed: 0,
      successRate: 0,
      isIdle: true,
    });

    if (buckets.length === 0) {
      return Array.from({ length: colCount }, (_, i) => idleBucket(i));
    }

    if (buckets.length < colCount) {
      const realBuckets = buckets.map<DisplayBucket>((b) => ({ ...b, isIdle: false }));
      const padding = Array.from({ length: colCount - buckets.length }, (_, i) =>
        idleBucket(buckets.length + i),
      );
      return [...realBuckets, ...padding];
    }

    return buckets.slice(-colCount).map<DisplayBucket>((b) => ({ ...b, isIdle: false }));
  }, [buckets, colCount]);

  const handleMouseEnter = useCallback(
    (_e: React.MouseEvent, bucket: HeatmapBucket, isIdle: boolean, index: number) => {
      const cardRect = cardRef.current?.getBoundingClientRect();
      const gridEl = gridRef.current;
      if (!cardRect || !gridEl) return;

      const gridRect = gridEl.getBoundingClientRect();
      const gridLeftInCard = gridRect.left - cardRect.left;
      const gridTopInCard = gridRect.top - cardRect.top;
      const gridHeight = gridRect.height;

      const col = index % colCount;
      const dotCenterX = col * (DOT_SIZE + GAP) + DOT_SIZE / 2;

      const tooltipOffset = 8;
      const tooltipWidth = tooltipRef.current?.offsetWidth ?? 180;
      const tooltipHeight = tooltipRef.current?.offsetHeight ?? 80;

      let x = gridLeftInCard + dotCenterX - tooltipWidth / 2;
      let y = gridTopInCard - tooltipHeight - tooltipOffset;

      if (x < 0) x = 0;
      if (x + tooltipWidth > cardRect.width) x = cardRect.width - tooltipWidth;

      if (y < 0) {
        y = gridTopInCard + gridHeight + tooltipOffset;
      }

      setTooltip({ x, y, bucket, isIdle });
    },
    [colCount],
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
          return (
            <div
              key={i}
              className={styles.dot}
              style={{ backgroundColor: dotColor(bucket.successRate, total) }}
              onMouseEnter={(e) => handleMouseEnter(e, bucket, bucket.isIdle, i)}
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
