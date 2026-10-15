import { MutationCache, QueryClient } from '@tanstack/react-query'
import { ORPCError } from '@orpc/client'
import { orpc } from './orpc'

/**
 * Whether a failed query is worth another attempt. A client error (a missing row, a forbidden
 * page, bad input) will fail the same way every time, so the page shows its error state at
 * once instead of after the default three retries with backoff.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ORPCError && error.status >= 400 && error.status < 500) return false
  return failureCount < 3
}

export const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetry } },
  // Most writes add a line to a Discussion (lib/work-item-events.ts), so an open one refetches.
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.workItemComments.list.key() })
    },
  }),
})
