import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../api/client.ts';

export interface CloudAccountItem {
  id: string;
  account_id?: string;
  login: string;
  account_name?: string;
  broker_server: string;
  mt5_server?: string;
  equity: number;
  balance: number;
  deployment_state: string;
  deployment_status?: string;
  is_active: boolean;
  auto_trade?: boolean;
  cloud_slot_expires_at?: number | null;
  risk_multiplier?: number;
  lot_multiplier?: number;
  auto_compounding?: boolean;
  prop_firm_mode?: boolean;
  max_daily_drawdown_pct?: number;
  max_daily_dd_pct?: number;
  profit_target_pct?: number;
  [key: string]: any;
}

export interface EquityPoint {
  timestamp?: string | number;
  time?: string | number;
  equity: number;
  balance?: number;
}

export function getActiveUserKey(explicitKey?: string | null): string {
  if (explicitKey) return explicitKey;
  if (typeof window !== 'undefined' && (window as any).__ZUPIRUS_USER_KEY__) {
    return String((window as any).__ZUPIRUS_USER_KEY__);
  }
  return 'anonymous';
}

export const QUERY_KEYS = {
  allAccounts: ['accounts'] as const,
  accounts: (userKey?: string | null) => ['accounts', getActiveUserKey(userKey)] as const,
  allOrders: ['orders'] as const,
  orders: (url?: string | null, sessionKey?: string | null) => ['orders', url || 'all', sessionKey || 'anon'] as const,
  allEquityHistory: ['equity-history'] as const,
  equityHistory: (days: number = 30, userKey?: string | null) => ['equity-history', getActiveUserKey(userKey), days] as const,
  telemetryTopbar: ['telemetry', 'topbar'] as const,
  userBilling: ['user-billing'] as const,
  adminBilling: ['admin-billing'] as const,
};

export function useEquityHistory(days: number = 30, userKey?: string | null) {
  const uKey = getActiveUserKey(userKey);
  return useQuery<EquityPoint[]>({
    queryKey: QUERY_KEYS.equityHistory(days, uKey),
    queryFn: async () => {
      try {
        const data = await apiGet<any>(`/api/dashboard?days=${days}`);
        if (Array.isArray(data?.series) && data.series.length > 0) {
          return data.series.map((item: any) => ({
            timestamp: item.timestamp || item.time || item.ts || item.bucket,
            equity: Number(item.equity ?? item.balance ?? 0),
            balance: Number(item.balance ?? item.equity ?? 0),
          }));
        }
      } catch {
        // fallback empty
      }
      return [];
    },
    staleTime: 15_000,
  });
}

export function useCloudAccounts(userKey?: string | null) {
  const uKey = getActiveUserKey(userKey);
  return useQuery<{ accounts: CloudAccountItem[]; total: number }>({
    queryKey: QUERY_KEYS.accounts(uKey),
    queryFn: async () => {
      return apiGet<{ accounts: CloudAccountItem[]; total: number }>('/api/v1/accounts');
    },
    staleTime: 10_000,
    refetchInterval: () => (typeof document !== 'undefined' && document.visibilityState === 'visible' ? 15000 : false),
  });
}

export interface LiveTopbarTelemetry {
  xauusd: {
    symbol: string;
    bid: number | null;
    ask: number | null;
    mid: number | null;
    spread_pips: number | null;
    live: boolean;
    data_available: boolean;
    stale: boolean;
    source: string;
  };
  usd_vnd: {
    rate: number;
    source: string;
  };
  news_shield: {
    status: string;
    distance_mins: number;
    next_event_name?: string;
    nearest_title?: string | null;
  };
  system_guard?: {
    kill_switch_active: boolean;
    active_connections: number;
    execution_engine_healthy: boolean;
    max_slippage_pips: number;
  };
  shields?: Array<{
    layer: string;
    name: string;
    detail: string;
    status: string;
    latency_ms: number;
  }>;
  redis_ping_ms?: number;
  db_ping_ms?: number;
  metaapi_latency_ms: number;
  region?: string;
  active_sources_count?: number;
  shadow_sources_count?: number;
  system_status?: string;
  server_time?: number;
}

export function useLiveTopbarTelemetry() {
  const [sseConnected, setSseConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/v1/stream/topbar', { withCredentials: true });

    es.addEventListener('topbar', (ev: MessageEvent) => {
      try {
        const payload: LiveTopbarTelemetry = JSON.parse(ev.data);
        queryClient.setQueryData(QUERY_KEYS.telemetryTopbar, payload);
        setSseConnected(true);
      } catch {
        // ignore parse error
      }
    });

    es.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [queryClient]);

  return useQuery<LiveTopbarTelemetry>({
    queryKey: QUERY_KEYS.telemetryTopbar,
    queryFn: async () => {
      return apiGet<LiveTopbarTelemetry>('/api/v1/telemetry/topbar');
    },
    staleTime: sseConnected ? 30_000 : 2500,
    refetchInterval: sseConnected ? false : 5000,
  });
}

export function useRealtimePortalStream(portal: 'user' | 'admin', enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const url = portal === 'admin' ? '/api/v1/stream/admin' : '/api/v1/stream/user';
    const es = new EventSource(url, { withCredentials: true });

    if (portal === 'user') {
      const refreshUser = () => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.allAccounts });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.allOrders });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.allEquityHistory });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userBilling });
        window.dispatchEvent(new CustomEvent('zupirus:user-refresh'));
      };
      es.addEventListener('payment_paid', refreshUser);
      es.addEventListener('order_update', refreshUser);
      es.addEventListener('account_update', refreshUser);
    } else {
      es.addEventListener('radar', (ev: MessageEvent) => {
        try {
          window.dispatchEvent(new CustomEvent('zupirus:admin-radar', { detail: JSON.parse(ev.data) }));
        } catch {
          // ignore malformed frame
        }
      });
      es.addEventListener('billing_paid', () => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminBilling });
        window.dispatchEvent(new CustomEvent('zupirus:admin-billing-refresh'));
      });
    }

    return () => {
      es.close();
    };
  }, [portal, enabled, queryClient]);
}
