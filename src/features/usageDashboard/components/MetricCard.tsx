import { useId } from 'react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import type { TrendBucket } from '@/types/usageStats';
import styles from './MetricCard.module.scss';

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  badge?: string;
  trend?: TrendBucket[];
  trendColor?: string;
  secondaryTrend?: TrendBucket[];
  secondaryColor?: string;
}

export function MetricCard({
  title,
  value,
  subtitle,
  badge,
  trend,
  trendColor = '#3b82f6',
  secondaryTrend,
  secondaryColor = '#10b981',
}: MetricCardProps) {
  const gradientId = useId().replace(/:/g, '');
  const chartData = trend?.map((t, i) => ({
    idx: i,
    value: Number.isFinite(t.value) ? t.value : null,
    secondary: Number.isFinite(secondaryTrend?.[i]?.value)
      ? secondaryTrend?.[i]?.value
      : null,
  })).filter((item) => item.value !== null || item.secondary !== null);
  const hasChartData = Boolean(
    chartData && chartData.length > 1 &&
    chartData.some((item) => (item.value ?? 0) > 0 || (item.secondary ?? 0) > 0)
  );

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {badge && <span className={styles.badge}>{badge}</span>}
      </div>
      <div className={styles.value}>{value}</div>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      <div className={styles.chartArea}>
        {hasChartData ? (
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              {secondaryTrend && (
                <Area
                  type="monotone"
                  dataKey="secondary"
                  stroke={secondaryColor}
                  strokeWidth={1.5}
                  fill="none"
                  isAnimationActive={false}
                  dot={false}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={trendColor}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.chartPlaceholder} />
        )}
      </div>
    </div>
  );
}
