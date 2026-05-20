import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw, IconDollarSign } from '@/components/ui/icons';
import type { DashboardTimeRange } from '@/types/usageStats';
import styles from './UsageToolbar.module.scss';

const RANGES: { key: DashboardTimeRange; label: string }[] = [
  { key: '12h', label: '12h' },
  { key: '24h', label: '24h' },
  { key: 'today', label: 'usage_dashboard.range_today' },
  { key: 'yesterday', label: 'usage_dashboard.range_yesterday' },
  { key: '7d', label: '7d' },
  { key: 'all', label: 'usage_dashboard.range_all' },
];

const REFRESH_OPTIONS = [0, 3, 5, 10, 30];

interface UsageToolbarProps {
  range: DashboardTimeRange;
  onRangeChange: (r: DashboardTimeRange) => void;
  lastRefreshTime: string | null;
  autoRefreshInterval: number;
  onAutoRefreshChange: (s: number) => void;
  onRefresh: () => void;
  loading: boolean;
  onOpenPriceManager: () => void;
}

export function UsageToolbar({
  range,
  onRangeChange,
  lastRefreshTime,
  autoRefreshInterval,
  onAutoRefreshChange,
  onRefresh,
  loading,
  onOpenPriceManager,
}: UsageToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>
        <h1 className={styles.title}>CPA Dashboard</h1>
        <div className={styles.rangeGroup}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={`${styles.rangeBtn}${range === r.key ? ` ${styles.rangeBtnActive}` : ''}`}
              onClick={() => onRangeChange(r.key)}
            >
              {r.key === 'today' || r.key === 'yesterday' || r.key === 'all'
                ? t(r.label)
                : r.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.right}>
        {lastRefreshTime && (
          <span className={styles.refreshTime}>
            {t('usage_dashboard.last_refresh')}: {lastRefreshTime}
          </span>
        )}
        <div className={styles.refreshSelect}>
          <select
            value={autoRefreshInterval}
            onChange={(e) => onAutoRefreshChange(Number(e.target.value))}
            className={styles.select}
          >
            <option value={0}>{t('usage_dashboard.auto_refresh_off')}</option>
            {REFRESH_OPTIONS.filter((v) => v > 0).map((s) => (
              <option key={s} value={s}>
                {t('usage_dashboard.auto_refresh_interval', { seconds: s })}
              </option>
            ))}
          </select>
        </div>
        <button
          className={styles.iconBtn}
          onClick={onOpenPriceManager}
          title={t('usage_dashboard.manage_prices')}
        >
          <IconDollarSign size={16} />
        </button>
        <Button size="sm" onClick={onRefresh} disabled={loading}>
          <IconRefreshCw size={14} />
          <span className={styles.btnLabel}>{t('usage_stats.refresh')}</span>
        </Button>
      </div>
    </div>
  );
}
