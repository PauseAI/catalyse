import { createORPCClient, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import type { appRouter } from '@/server/router'
import { OUTREACH_TOKEN_HEADER, OUTREACH_TOKEN_STORAGE_KEY } from '@/lib/journalist-outreach'
import { VIEW_AS_HEADER, isViewingAsVolunteer } from '@/lib/view-as'

const link = new RPCLink({
  url:
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/rpc`
      : 'http://localhost/api/rpc',
  headers: () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
    const outreachToken =
      typeof window !== 'undefined' ? localStorage.getItem(OUTREACH_TOKEN_STORAGE_KEY) : null
    const asVolunteer = typeof window !== 'undefined' && isViewingAsVolunteer()
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(outreachToken ? { [OUTREACH_TOKEN_HEADER]: outreachToken } : {}),
      ...(asVolunteer ? { [VIEW_AS_HEADER]: 'volunteer' } : {}),
    }
  },
  interceptors: [
    async ({ next }) => {
      try {
        return await next()
      } catch (error) {
        if (error instanceof ORPCError && typeof window !== 'undefined') {
          if (error.code === 'UNAUTHORIZED') window.dispatchEvent(new Event('auth:expired'))
          // Maintenance mode switched on under an open session: MaintenanceGate takes over.
          if (error.code === 'SERVICE_UNAVAILABLE')
            window.dispatchEvent(new Event('maintenance:on'))
        }
        throw error
      }
    },
  ],
})

export const client = createORPCClient<RouterClient<typeof appRouter>>(link)
