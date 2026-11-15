import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface ExchangeRateData {
  base: string;
  target: string;
  rate: number;
  source: string;
  is_cached?: boolean;
  updated_at?: number;
}

export interface CloudAccountItem {
  id: string;
  login: string;
  broker_server: string;
  equity: number;
  balance: number;
  deployment_state: string;
  is_active: boolean;
  auto_trade?: boolean;
  cloud_slot_expires_at?: number | null;
  risk_multiplier?: number;
  auto_compounding?: boolean;
  prop_firm_mode?: boolean;
  max_daily_drawdown_pct?: number;
  profit_target_pct?: number;
  [key: string]: any;
}

export function useExchangeRate() {
  return useQuery<ExchangeRateData>({
    queryKey: ['exchange-rate'],
    queryFn: async () => {
      const res = await fetch('/api/v1/billing/exchange-rate');
      if (!res.ok) throw new Error('Không thể tải tỷ giá USD/VND');
      return res.json();
    },
    staleTime: 60_000, // Cache valid for 60s
  });
}

export function useCloudAccounts() {
  return useQuery<{ accounts: CloudAccountItem[]; total: number }>({
    queryKey: ['accounts'],
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

export function useUserSubscription() {
  return useQuery({
    queryKey: ['subscription'],
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
    refetchInterval: 15_000, // Live poll every 15s for admin
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

