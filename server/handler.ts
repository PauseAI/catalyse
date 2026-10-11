import { ORPCError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { appRouter } from './router'

interface Issue {
  message: string
  path?: readonly (string | number | { key: string | number })[]
}

/**
 * A schema rejection carries every failed field in `data.issues` and a message
 * that says only that validation failed. The message a form shows is the
 * first issue's, which names what was wrong, so an address that is not a URL
 * or too many hours a week reads as such rather than as a generic refusal.
 */
function withIssueMessage(error: unknown): unknown {
  if (!(error instanceof ORPCError) || error.code !== 'BAD_REQUEST') return error
  const issues = (error.data as { issues?: Issue[] } | undefined)?.issues
  const first = issues?.[0]
  if (!first || error.message !== 'Input validation failed') return error
  return new ORPCError('BAD_REQUEST', { message: first.message, data: error.data, cause: error })
}

/** The one handler the route and the test harness both serve the router through. */
export function createHandler(): RPCHandler<Record<never, never>> {
  return new RPCHandler(appRouter, {
    clientInterceptors: [
      async (options) => {
        try {
          return await options.next()
        } catch (error) {
          throw withIssueMessage(error)
        }
      },
    ],
  }) as RPCHandler<Record<never, never>>
}
