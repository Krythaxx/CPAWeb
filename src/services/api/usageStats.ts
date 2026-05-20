import axios from 'axios';
import { apiClient } from './client';
import type {
  UsageStatsResponse,
  DashboardTimeRange,
} from '@/types/usageStats';
import type { ApiKeyUsageResponse } from '@/utils/recentRequests';

const USAGE_SERVICE_TIMEOUT_MS = 3 * 1000;

function resolveServiceUrl(serviceUrl: string): string {
  let base = serviceUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
}

export const usageStatsApi = {
  async fetchPersistentStats(
    serviceUrl: string,
    managementKey: string,
    range: DashboardTimeRange,
  ): Promise<UsageStatsResponse> {
    const base = resolveServiceUrl(serviceUrl);
    const response = await axios.get<UsageStatsResponse>(
      `${base}/v0/management/usage/stats`,
      {
        params: { range },
        headers: {
          Authorization: `Bearer ${managementKey}`,
        },
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      },
    );
    return response.data;
  },

  async probeService(serviceUrl: string): Promise<boolean> {
    try {
      const base = resolveServiceUrl(serviceUrl);
      await axios.get(`${base}/usage-service/info`, {
        timeout: 3000,
      });
      return true;
    } catch {
      return false;
    }
  },

  async fetchMemoryStats(): Promise<ApiKeyUsageResponse> {
    return apiClient.get<ApiKeyUsageResponse>('/api-key-usage', {
      timeout: 15 * 1000,
    });
  },
};

export function normalizeMemoryStats(
  raw: ApiKeyUsageResponse,
): UsageStatsResponse {
  let totalSuccess = 0;
  let totalFailure = 0;
  const byProvider: UsageStatsResponse['byProvider'] = [];
  const byAccount: UsageStatsResponse['byAccount'] = [];

  for (const [providerKey, keyEntries] of Object.entries(raw || {})) {
    if (!keyEntries || typeof keyEntries !== 'object') continue;

    let providerSuccess = 0;
    let providerFailure = 0;

    for (const [authKey, entry] of Object.entries(keyEntries)) {
      const s =
        typeof (entry as Record<string, unknown>)?.success === 'number'
          ? ((entry as Record<string, unknown>).success as number)
          : Number((entry as Record<string, unknown>)?.success ?? 0) || 0;
      const f =
        typeof (entry as Record<string, unknown>)?.failed === 'number'
          ? ((entry as Record<string, unknown>).failed as number)
          : Number((entry as Record<string, unknown>)?.failed ?? 0) || 0;
      providerSuccess += s;
      providerFailure += f;

      byAccount.push({
        key: `${providerKey}/${authKey}`,
        label: authKey || providerKey,
        requests: s + f,
        successCount: s,
        failureCount: f,
        successRate: s + f > 0 ? s / (s + f) : 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        provider: providerKey,
        authIndex: undefined,
        apiKeyHash: authKey,
      });
    }

    totalSuccess += providerSuccess;
    totalFailure += providerFailure;

    byProvider.push({
      key: providerKey,
      label: providerKey,
      requests: providerSuccess + providerFailure,
      successCount: providerSuccess,
      failureCount: providerFailure,
      successRate:
        providerSuccess + providerFailure > 0
          ? providerSuccess / (providerSuccess + providerFailure)
          : 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
      provider: providerKey,
    });
  }

  const total = totalSuccess + totalFailure;
  return {
    source: 'memory',
    range: 'all',
    summary: {
      totalRequests: total,
      successCount: totalSuccess,
      failureCount: totalFailure,
      successRate: total > 0 ? totalSuccess / total : 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
    },
    byModel: [],
    byProvider,
    byAccount,
  };
}
