import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { reportHandledError } from './errorReporting';

export const queryClient = new QueryClient({
  // Every failed query or mutation reaches Sentry, even when the page shows
  // its own error state.
  queryCache: new QueryCache({
    onError: (error, query) => reportHandledError(error, { queryKey: query.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      reportHandledError(error, { mutationKey: mutation.options.mutationKey }),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
