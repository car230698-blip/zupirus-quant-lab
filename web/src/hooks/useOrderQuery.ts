import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client.ts';
import { QUERY_KEYS } from './useQuantData.ts';

export type OrderResponse = { orders: any[]; total?: number };
export type OrderQuery = { url: string; data?: OrderResponse; status: 'loading' | 'ready' | 'offline' };

export function useOrderQuery(url: string | null, sessionKey: string | null): OrderQuery {
  const query = useQuery<OrderResponse>({
    queryKey: QUERY_KEYS.orders(url, sessionKey),
    queryFn: async () => {
      if (!url) return { orders: [] };
      const data = await apiGet<OrderResponse>(url);
      if (!Array.isArray(data?.orders)) throw new Error('Invalid order response');
      return data;
    },
    enabled: Boolean(url && sessionKey),
    refetchInterval: 3000,
  });

  return {
    url: url || '',
    data: query.data,
    status: query.isLoading ? 'loading' : query.isError ? 'offline' : 'ready',
  };
}
