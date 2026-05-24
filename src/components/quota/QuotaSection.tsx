/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useNotificationStore, useQuotaStore, useThemeStore } from '@/stores';
import { usageStatsApi, type AuthFileQuotaEntry } from '@/services/api/usageStats';
import { authFilesApi } from '@/services/api';
import { normalizeApiBase } from '@/utils/connection';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { useGridColumns } from './useGridColumns';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type ViewMode = 'paged' | 'all';

const MAX_ITEMS_PER_PAGE = 25;
const MAX_SHOW_ALL_THRESHOLD = 30;
const STORAGE_KEY_SERVICE_URL = 'cli-proxy-usage-service-url';
const USAGE_SERVICE_PORT = '18317';

function deriveDefaultServiceUrl(apiBase: string): string {
  try {
    const base = normalizeApiBase(apiBase);
    const url = new URL(base);
    if (url.protocol !== 'https:') {
      url.port = USAGE_SERVICE_PORT;
    }
    return url.origin;
  } catch {
    return `http://localhost:${USAGE_SERVICE_PORT}`;
  }
}

function loadServiceUrl(apiBase: string): string {
  const stored = localStorage.getItem(STORAGE_KEY_SERVICE_URL);
  if (stored) return stored;
  return deriveDefaultServiceUrl(apiBase);
}

interface QuotaPaginationState<T> {
  pageSize: number;
  totalPages: number;
  currentPage: number;
  pageItems: T[];
  setPageSize: (size: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  loading: boolean;
  loadingScope: 'page' | 'all' | null;
  setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void;
}

const useQuotaPagination = <T,>(items: T[], defaultPageSize = 6): QuotaPaginationState<T> => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [loading, setLoadingState] = useState(false);
  const [loadingScope, setLoadingScope] = useState<'page' | 'all' | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(() => Math.min(page, totalPages), [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const setLoading = useCallback((isLoading: boolean, scope?: 'page' | 'all' | null) => {
    setLoadingState(isLoading);
    setLoadingScope(isLoading ? (scope ?? null) : null);
  }, []);

  return {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading,
    loadingScope,
    setLoading
  };
};

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
}

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  files,
  loading,
  disabled
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  /* Removed useRef */
  const [columns, gridRef] = useGridColumns(380); // Min card width 380px matches SCSS
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);

  const filteredFiles = useMemo(() => files.filter((file) => config.filterFn(file)), [
    files,
    config
  ]);
  const showAllAllowed = filteredFiles.length <= MAX_SHOW_ALL_THRESHOLD;
  const effectiveViewMode: ViewMode = viewMode === 'all' && !showAllAllowed ? 'paged' : viewMode;

  const {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading: sectionLoading,
    setLoading
  } = useQuotaPagination(filteredFiles);

  useEffect(() => {
    if (showAllAllowed) return;
    if (viewMode !== 'all') return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setViewMode('paged');
      setShowTooManyWarning(true);
    });

    return () => {
      cancelled = true;
    };
  }, [showAllAllowed, viewMode]);

  // Update page size based on view mode and columns
  useEffect(() => {
    if (effectiveViewMode === 'all') {
      setPageSize(Math.max(1, filteredFiles.length));
    } else {
      // Paged mode: 3 rows * columns, capped to avoid oversized pages.
      setPageSize(Math.min(columns * 3, MAX_ITEMS_PER_PAGE));
    }
  }, [effectiveViewMode, columns, filteredFiles.length, setPageSize]);

  const { quota, loadQuota } = useQuotaLoader(config);

  const pendingQuotaRefreshRef = useRef(false);
  const prevFilesLoadingRef = useRef(loading);
  const batchSyncDoneRef = useRef(false);

  const serviceUrl = apiBase ? loadServiceUrl(apiBase) : '';
  const canSync = Boolean(serviceUrl && managementKey);

  const syncQuotasToBackend = useCallback(
    (entries: AuthFileQuotaEntry[]) => {
      if (!canSync || entries.length === 0) return;
      void usageStatsApi.saveAuthFileQuotas(serviceUrl, managementKey!, entries).catch((err) => {
        console.warn('[QuotaSection] failed to sync quotas to backend:', err);
      });
    },
    [canSync, serviceUrl, managementKey]
  );

  const handleRefresh = useCallback(() => {
    pendingQuotaRefreshRef.current = true;
    void triggerHeaderRefresh();
  }, []);

  useEffect(() => {
    const wasLoading = prevFilesLoadingRef.current;
    prevFilesLoadingRef.current = loading;

    if (!pendingQuotaRefreshRef.current) return;
    if (loading) return;
    if (!wasLoading) return;

    pendingQuotaRefreshRef.current = false;
    const scope = effectiveViewMode === 'all' ? 'all' : 'page';
    const targets = effectiveViewMode === 'all' ? filteredFiles : pageItems;
    if (targets.length === 0) return;
    batchSyncDoneRef.current = false;
    loadQuota(targets, scope, setLoading);
  }, [loading, effectiveViewMode, filteredFiles, pageItems, loadQuota, setLoading]);

  useEffect(() => {
    if (loading) return;
    if (filteredFiles.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      filteredFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [filteredFiles, loading, setQuota]);

  useEffect(() => {
    if (batchSyncDoneRef.current) return;
    if (sectionLoading) return;
    if (!config.extractQuotaSnapshot) return;
    const targets = effectiveViewMode === 'all' ? filteredFiles : pageItems;
    if (targets.length === 0) return;

    const entries: AuthFileQuotaEntry[] = [];
    for (const file of targets) {
      const state = quota[file.name];
      if (!state || (state as QuotaStatusState).status !== 'success') continue;
      const snapshot = config.extractQuotaSnapshot(state);
      if (!snapshot) continue;
      entries.push({
        authFileName: file.name,
        remainingPercent: snapshot.remainingPercent,
        resetTime: snapshot.resetTime,
        provider: config.type,
      });
    }
    if (entries.length > 0) {
      syncQuotasToBackend(entries);
    }
    batchSyncDoneRef.current = true;
  }, [sectionLoading, effectiveViewMode, filteredFiles, pageItems, quota, config, syncQuotasToBackend]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;

      setQuota((prev) => ({
        ...prev,
        [file.name]: config.buildLoadingState()
      }));

      try {
        const data = await config.fetchQuota(file, t);
        const successState = config.buildSuccessState(data);
        setQuota((prev) => ({
          ...prev,
          [file.name]: successState
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');

        if (config.extractQuotaSnapshot) {
          const snapshot = config.extractQuotaSnapshot(successState);
          if (snapshot) {
            syncQuotasToBackend([{
              authFileName: file.name,
              remainingPercent: snapshot.remainingPercent,
              resetTime: snapshot.resetTime,
              provider: config.type,
            }]);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, status)
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      }
    },
    [config, disabled, quota, setQuota, showNotification, t, syncQuotasToBackend]
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {filteredFiles.length > 0 && (
        <span className={styles.countBadge}>
          {filteredFiles.length}
        </span>
      )}
    </div>
  );

  const isRefreshing = sectionLoading || loading;
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});

  const handleToggleStatus = useCallback(
    async (file: AuthFileItem, enabled: boolean) => {
      if (disabled) return;
      setStatusUpdating((prev) => ({ ...prev, [file.name]: true }));
      try {
        await authFilesApi.setStatus(file.name, !enabled);
      } catch {
        showNotification(
          t('auth_files.status_update_failed', { defaultValue: 'Failed to update status' }),
          'error'
        );
      } finally {
        setStatusUpdating((prev) => ({ ...prev, [file.name]: false }));
      }
    },
    [disabled, showNotification, t]
  );

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.viewModeToggle}>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'paged' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('paged')}
            >
              {t('auth_files.view_mode_paged')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'all' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => {
                if (filteredFiles.length > MAX_SHOW_ALL_THRESHOLD) {
                  setShowTooManyWarning(true);
                } else {
                  setViewMode('all');
                }
              }}
            >
              {t('auth_files.view_mode_all')}
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className={styles.refreshAllButton}
            onClick={handleRefresh}
            disabled={disabled || isRefreshing}
            loading={isRefreshing}
            title={t('quota_management.refresh_all_credentials')}
            aria-label={t('quota_management.refresh_all_credentials')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
            {t('quota_management.refresh_all_credentials')}
          </Button>
        </div>
      }
    >
      {filteredFiles.length === 0 ? (
        <EmptyState
          title={t(`${config.i18nPrefix}.empty_title`)}
          description={t(`${config.i18nPrefix}.empty_desc`)}
        />
      ) : (
        <>
          <div ref={gridRef} className={config.gridClassName}>
            {pageItems.map((item) => (
              <QuotaCard
                key={item.name}
                item={item}
                quota={quota[item.name]}
                resolvedTheme={resolvedTheme}
                i18nPrefix={config.i18nPrefix}
                cardIdleMessageKey={config.cardIdleMessageKey}
                cardClassName={config.cardClassName}
                defaultType={config.type}
                canRefresh={!disabled && !item.disabled}
                onRefresh={() => void refreshQuotaForFile(item)}
                renderQuotaItems={config.renderQuotaItems}
                statusUpdating={statusUpdating[item.name] === true}
                onToggleStatus={(enabled) => void handleToggleStatus(item, enabled)}
              />
            ))}
          </div>
          {filteredFiles.length > pageSize && effectiveViewMode === 'paged' && (
            <div className={styles.pagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToPrev}
                disabled={currentPage <= 1}
              >
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: filteredFiles.length
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToNext}
                disabled={currentPage >= totalPages}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
        </>
      )}
      {showTooManyWarning && (
        <div className={styles.warningOverlay} onClick={() => setShowTooManyWarning(false)}>
          <div className={styles.warningModal} onClick={(e) => e.stopPropagation()}>
            <p>{t('auth_files.too_many_files_warning')}</p>
            <Button variant="primary" size="sm" onClick={() => setShowTooManyWarning(false)}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
