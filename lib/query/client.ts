import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/types';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (count, err) =>
          err instanceof ApiError && [429, 503].includes(err.status)
            ? count < 2
            : false,
      },
      mutations: { retry: false },
    },
  });
}
