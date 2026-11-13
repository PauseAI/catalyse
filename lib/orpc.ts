import { createORPCReactQueryUtils } from '@orpc/react-query'
import { client } from './client'

// Widen ThrowableError from Error to unknown so mutationOptions() spreads
// cleanly into useMutation without throwOnError callback type conflicts.
declare module '@orpc/shared' {
  interface Registry {
    throwableError: unknown
  }
}

export const orpc = createORPCReactQueryUtils(client)

/**
 * Reschedule saves run one at a time, in order: the server places a follower after its
 * predecessors' stored dates, so a save must not start before the one before it has committed.
 */
export const rescheduleMutationOptions = () => ({
  ...orpc.schedule.rescheduleItems.mutationOptions(),
  scope: { id: 'reschedule' },
})
