import { useEffect, useState } from 'react';

type OrderResponse = { orders: any[]; total?: number };
type OrderQuery = { url: string; data?: OrderResponse; status: 'loading' | 'ready' | 'offline' };

export function useOrderQuery(url: string | null, sessionKey: string | null) {
  const [result, setResult] = useState<(OrderQuery & { sessionKey: string }) | null>(null);

  useEffect(() => {
    if (!url || !sessionKey) return;
    let active = true;
    let controller: AbortController | undefined;

    async function refresh() {
      if (controller) return;
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch(url!, { signal: request.signal });
        if (!response.ok) throw new Error('Order request failed');
        const data: OrderResponse = await response.json();
        if (!Array.isArray(data.orders)) throw new Error('Invalid order response');
        if (active) setResult({ url: url!, sessionKey: sessionKey!, data, status: 'ready' });
      } catch {
        if (active) setResult((previous) => ({
          url: url!, sessionKey: sessionKey!, status: 'offline',
          data: previous?.url === url && previous.sessionKey === sessionKey ? previous.data : undefined,
        }));
      } finally {
        controller = undefined;
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [url, sessionKey]);

  if (result && result.url === url && result.sessionKey === sessionKey) return result;
  return { status: 'loading' as const, data: undefined };
}
