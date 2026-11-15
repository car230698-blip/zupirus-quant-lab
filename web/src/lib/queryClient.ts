import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000, // 10 seconds cache validity
      gcTime: 5 * 60_000, // 5 minutes garbage collection
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

