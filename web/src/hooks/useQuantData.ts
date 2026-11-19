import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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

function getActiveUserKey(explicitKey?: string | null): string {
  if (explicitKey) return explicitKey;
  if (typeof window !== 'undefined' && (window as any).__ZUPIRUS_USER_KEY__) {
    return String((window as any).__ZUPIRUS_USER_KEY__);
  }
  return 'anonymous';
}

export function useEquityHistory(days: number = 30, userKey?: string | null) {
  const uKey = getActiveUserKey(userKey);
  return useQuery<EquityPoint[]>({
    queryKey: ['equity-history', uKey, days],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard?days=${days}`, {
        headers: { 'X-Zupirus': '1' },
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data.series) && data.series.length > 0) {
        return data.series.map((item: any) => ({
          timestamp: item.timestamp || item.time || item.ts || item.bucket,
          equity: Number(item.equity ?? item.balance ?? 0),
          balance: Number(item.balance ?? item.equity ?? 0),
        }));
      }
      return [];
    },
    staleTime: 15_000,
  });
}

export function useCloudAccounts(userKey?: string | null) {
  const uKey = getActiveUserKey(userKey);
  return useQuery<{ accounts: CloudAccountItem[]; total: number }>({
    queryKey: ['accounts', uKey],
    queryFn: async () => {
      const res = await fetch('/api/v1/accounts', {
        headers: { 'X-Zupirus': '1' },
      });
      if (!res.ok) throw new Error('Không thể tải danh sách tài khoản MT5');
      return res.json();
    },
    staleTime: 15_000,
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
    nearest_title: string | null;
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
  region: string;
  active_sources_count: number;
  shadow_sources_count: number;
  system_status: string;
  server_time: number;
}

export function useLiveTopbarTelemetry() {
  const queryClient = useQueryClient();
  const [sseConnected, setSseConnected] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/v1/stream/topbar', { withCredentials: true });
    es.onopen = () => setSseConnected(true);
    es.addEventListener('topbar', (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as LiveTopbarTelemetry;
        queryClient.setQueryData(['telemetry', 'topbar'], parsed);
        setSseConnected(true);
      } catch {
        // ignore malformed frame
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
    queryKey: ['telemetry', 'topbar'],
    queryFn: async () => {
      const res = await fetch('/api/v1/telemetry/topbar', { credentials: 'include' });
      if (!res.ok) throw new Error('Không thể tải dữ liệu telemetry');
      return res.json();
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
        void queryClient.invalidateQueries({ queryKey: ['accounts'] });
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        void queryClient.invalidateQueries({ queryKey: ['equity-history'] });
      };
      es.addEventListener('payment_paid', refreshUser);
      es.addEventListener('order_update', refreshUser);
      es.addEventListener('account_update', refreshUser);
    } else {
      es.addEventListener('billing_paid', () => {
        void queryClient.invalidateQueries({ queryKey: ['admin-billing'] });
      });
    }

    return () => {
      es.close();
    };
  }, [portal, enabled, queryClient]);
}
