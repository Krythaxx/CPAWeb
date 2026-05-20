import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageDashboard } from '@/features/usageDashboard/hooks/useUsageDashboard';
import { useAutoRefresh } from '@/features/usageDashboard/hooks/useAutoRefresh';
import { usePriceTable } from '@/features/usageDashboard/hooks/usePriceTable';
import { UsageToolbar } from '@/features/usageDashboard/components/UsageToolbar';
import { ApiKeyHeatmap } from '@/features/usageDashboard/components/ApiKeyHeatmap';
import { MetricCard } from '@/features/usageDashboard/components/MetricCard';
import { ApiKeyTable } from '@/features/usageDashboard/components/ApiKeyTable';
import { ModelTable } from '@/features/usageDashboard/components/ModelTable';
import { PriceManagerModal } from '@/features/usageDashboard/components/PriceManagerModal';
import { calculateCost, formatCost } from '@/features/usageDashboard/utils/priceCalculator';
import styles from './UsageStatsPage.module.scss';

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function UsageStatsPage() {
  const { t } = useTranslation();
  const dashboard = useUsageDashboard();
  const { table: priceTable, updateEntry, removeEntry, clearAll } = usePriceTable();
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);
  const [priceModalOpen, setPriceModalOpen] = useState(false);

  const autoRefresh = useAutoRefresh(() => {
    dashboard.refresh();
    dashboard.refreshHeatmap();
  }, autoRefreshInterval);

  useEffect(() => {
    if (autoRefreshInterval > 0) {
      autoRefresh.start();
    } else {
      autoRefresh.stop();
    }
    return () => autoRefresh.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshInterval]);

  useEffect(() => {
    dashboard.refresh();
    dashboard.refreshHeatmap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard.range, dashboard.serviceUrl]);

  const handleRefresh = useCallback(() => {
    dashboard.refresh();
    dashboard.refreshHeatmap();
    autoRefresh.reset();
  }, [dashboard, autoRefresh]);

  const s = dashboard.data?.summary;
  const isMemory = dashboard.dataSource === 'memory';
  const showTokenColumns = !isMemory;

  const cacheRate = s && s.inputTokens + s.outputTokens > 0
    ? s.cachedTokens / (s.inputTokens + s.outputTokens)
    : 0;

  return (
    <div className={styles.container}>
      <UsageToolbar
        range={dashboard.range}
        onRangeChange={dashboard.setRange}
        lastRefreshTime={dashboard.lastRefreshTime}
        autoRefreshInterval={autoRefreshInterval}
        onAutoRefreshChange={setAutoRefreshInterval}
        onRefresh={handleRefresh}
        loading={dashboard.loading}
        onOpenPriceManager={() => setPriceModalOpen(true)}
      />

      {dashboard.loading && !dashboard.data && (
        <div className={styles.loadingBox}>{t('usage_stats.loading')}</div>
      )}

      {dashboard.error && !dashboard.loading && !dashboard.data && (
        <div className={styles.errorBox}>{dashboard.error}</div>
      )}

      {dashboard.data && (
        <>
          <ApiKeyHeatmap
            totalRequests={s?.totalRequests ?? 0}
            successRate={s?.successRate ?? 0}
            successCount={s?.successCount ?? 0}
            failureCount={s?.failureCount ?? 0}
            buckets={dashboard.heatmapBuckets}
          />

          <div className={styles.metricsGrid}>
            <MetricCard
              title={t('usage_dashboard.total_token')}
              value={s ? formatNumber(s.totalTokens) : '-'}
              subtitle={showTokenColumns && s && s.totalTokens > 0 ? formatCost(calculateCost(s.inputTokens, s.outputTokens, undefined)) : undefined}
              trend={s?.tokenTrend}
              trendColor="#3b82f6"
            />
            <MetricCard
              title={t('usage_dashboard.input_output')}
              value={s ? `${formatNumber(s.inputTokens)} / ${formatNumber(s.outputTokens)}` : '-'}
              subtitle={
                s && showTokenColumns
                  ? `${t('usage_dashboard.cached')}: ${formatNumber(s.cachedTokens)} · ${t('usage_dashboard.cache_hit')}: ${(cacheRate * 100).toFixed(1)}%`
                  : isMemory && s
                    ? t('usage_stats.token_unavailable')
                    : undefined
              }
              trend={s?.inputOutputTrend}
              trendColor="#3b82f6"
              secondaryTrend={s?.cacheTrend}
              secondaryColor="#10b981"
            />
            <MetricCard
              title={t('usage_stats.summary_total_requests')}
              value={s ? formatNumber(s.totalRequests) : '-'}
              subtitle={
                s
                  ? `${t('usage_stats.col_success')}: ${formatNumber(s.successCount)} · ${t('usage_stats.col_failure')}: ${formatNumber(s.failureCount)} · ${t('usage_stats.col_success_rate')}: ${formatPercent(s.successRate)}`
                  : undefined
              }
              trend={s?.requestTrend}
              trendColor="#f97316"
            />
            <MetricCard
              title={t('usage_stats.summary_success_rate')}
              value={s ? formatPercent(s.successRate) : '-'}
              subtitle={
                s
                  ? s.successRate >= 0.95 ? t('usage_stats.rate_good') : s.successRate >= 0.8 ? t('usage_stats.rate_fair') : t('usage_stats.rate_poor')
                  : undefined
              }
              trendColor="#8b5cf6"
            />
          </div>

          <div className={styles.tablesGrid}>
            <ApiKeyTable
              rows={dashboard.data.byProvider.filter((r) => r.requests > 0)}
              modelRows={dashboard.data.byModel}
              priceTable={priceTable}
            />
            <ModelTable
              rows={dashboard.data.byModel.filter((r) => r.requests > 0)}
              priceTable={priceTable}
            />
          </div>
        </>
      )}

      <PriceManagerModal
        open={priceModalOpen}
        onClose={() => setPriceModalOpen(false)}
        modelRows={dashboard.data?.byModel ?? []}
        priceTable={priceTable}
        onUpdateEntry={updateEntry}
        onRemoveEntry={removeEntry}
        onClearAll={clearAll}
      />
    </div>
  );
}
