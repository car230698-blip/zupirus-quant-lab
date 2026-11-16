import { useQuery } from '@tanstack/react-query';

export interface ExchangeRateData {
  base: string;
  target: string;
  rate: number;
  usd_vnd_rate?: number;
  source: string;
  is_cached?: boolean;
  updated_at?: number;
}

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

export function useExchangeRate() {
  return useQuery<ExchangeRateData>({
    queryKey: ['exchange-rate'],
    queryFn: async () => {
      const res = await fetch('/api/v1/billing/exchange-rate');
      if (!res.ok) throw new Error('Không thể tải tỷ giá USD/VND');
      return res.json();
    },
    staleTime: 60_000,
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

export function useUserSubscription(userKey?: string | null) {
  const uKey = getActiveUserKey(userKey);
  return useQuery({
    queryKey: ['subscription', uKey],
    queryFn: async () => {
      const res = await fetch('/api/v1/billing/subscription', {
        headers: { 'X-Zupirus': '1' },
      });
      if (!res.ok) throw new Error('Không thể tải thông tin gói cước');
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useSignalAuditLogs(limit: number = 20) {
  return useQuery({
    queryKey: ['signals', 'audit-logs', limit],
    queryFn: async () => {
      const res = await fetch(`/api/v1/signals/audit-logs?limit=${limit}`, {
        headers: { 'X-Zupirus': '1' },
      });
      if (!res.ok) throw new Error('Không thể tải nhật ký tín hiệu');
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useSignalStats() {
  return useQuery({
    queryKey: ['signals', 'stats'],
    queryFn: async () => {
      const res = await fetch('/api/v1/signals/stats', {
        headers: { 'X-Zupirus': '1' },
      });
      if (!res.ok) throw new Error('Không thể tải thống kê tín hiệu');
      return res.json();
    },
    staleTime: 15_000,
  });
}

export function useMetaApiTelemetry() {
  return useQuery({
    queryKey: ['metaapi', 'telemetry'],
    queryFn: async () => {
      const res = await fetch('/api/metaapi/telemetry', {
        headers: { 'X-Zupirus': '1' },
      });
      if (!res.ok) throw new Error('Không thể tải telemetry MetaApi');
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
  return useQuery<LiveTopbarTelemetry>({
    queryKey: ['telemetry', 'topbar'],
    queryFn: async () => {
      const res = await fetch('/api/v1/telemetry/topbar', { credentials: 'include' });
      if (!res.ok) throw new Error('Không thể tải dữ liệu telemetry');
      return res.json();
    },
    staleTime: 2500,
    refetchInterval: 3000,
  });
}
