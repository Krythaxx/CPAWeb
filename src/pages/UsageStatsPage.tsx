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
import { SourceTable } from '@/features/usageDashboard/components/SourceTable';
import { PriceManagerModal } from '@/features/usageDashboard/components/PriceManagerModal';
import { calculateCost, formatCost } from '@/features/usageDashboard/utils/priceCalculator';
import styles from './UsageStatsPage.module.scss';

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function UsageStatsPage() {
  const { t } = useTranslation();
  const dashboard = useUsageDashboard();
  const { table: priceTable, updateEntry, removeEntry, clearAll } = usePriceTable();
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(10);
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
    dashboard.resetPostgresDetection();
    void dashboard.refresh();
    void dashboard.refreshHeatmap();
    autoRefresh.reset();
  }, [dashboard, autoRefresh]);

  const s = dashboard.data?.summary;
  const isMemory = dashboard.dataSource === 'memory';
  const hasTokenUsage = Boolean(s && s.totalTokens > 0);
  const showTokenColumns = !isMemory || hasTokenUsage;

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
        dataCoverage={dashboard.dataCoverage}
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
              trend={dashboard.metricTrends.totalTokens}
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
              trend={dashboard.metricTrends.inputTokens}
              trendColor="#3b82f6"
              secondaryTrend={dashboard.metricTrends.outputTokens}
              secondaryColor="#10b981"
            />
            <MetricCard
              title={t('usage_dashboard.rpm')}
              value={dashboard.rpmValue}
              subtitle={t('usage_dashboard.requests_per_minute')}
              trend={dashboard.metricTrends.rpm}
              trendColor="#f97316"
            />
            <MetricCard
              title={t('usage_dashboard.tpm')}
              value={dashboard.tpmValue}
              subtitle={t('usage_dashboard.tokens_per_minute')}
              trend={dashboard.metricTrends.tpm}
              trendColor="#8b5cf6"
            />
          </div>

          <div className={styles.tablesGrid}>
            {isMemory && (
              <div className={styles.tableNote}>
                {t('usage_dashboard.lifetime_totals')}
              </div>
            )}
            <ApiKeyTable
              rows={dashboard.apiKeyRows}
              priceTable={priceTable}
            />
            <ModelTable
              rows={dashboard.data.byModel.filter((r) => r.requests > 0)}
              priceTable={priceTable}
            />
          </div>

          <SourceTable
            rows={dashboard.sourceRows}
            priceTable={priceTable}
          />
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
