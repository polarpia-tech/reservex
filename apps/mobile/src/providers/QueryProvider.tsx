import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';

/**
 * One QueryClient for the app's lifetime. This is where every piece of
 * SERVER state lives from Phase 04 onward -- session-derived data like
 * "which restaurants am I staff at" today, reservations/tables data from
 * Phase 06-07 tomorrow. Local-only UI state stays in useUIStore (Zustand);
 * see Part 01 of the blueprint for why we did not reach for Redux.
 */
export function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
