import { createRouterClient } from '@orpc/server'
import type { Volunteer } from '@/generated/prisma/client'
import type { Context } from '@/server/context'
import { appRouter } from '@/server/router'

/**
 * A fully typed in-process client for the whole oRPC router, acting as `volunteer` (or
 * anonymously). Skips HTTP and the auth header — the context is built directly, the way
 * `server/context.ts` would after resolving a session.
 */
export function clientAs(volunteer: Volunteer | null, extra: Partial<Context> = {}) {
  const request = extra.request ?? new Request('http://localhost/api/rpc')
  const token = 'token' in extra ? (extra.token ?? null) : volunteer ? 'test-token' : null
  const viewingAsVolunteer = extra.viewingAsVolunteer ?? false
  return createRouterClient(appRouter, {
    context: { volunteer, viewingAsVolunteer, token, request },
  })
}

export const anon = () => clientAs(null)
