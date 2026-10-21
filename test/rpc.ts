import { createRouterClient } from '@orpc/server'
import type { Volunteer } from '@/generated/prisma/client'
import { isSuperAdmin } from '@/lib/auth'
import { loadAccess } from '@/lib/chapter-access-server'
import { withoutChapterRights } from '@/lib/view-as'
import type { Context } from '@/server/context'
import { appRouter } from '@/server/router'
import { createTask } from './factories'

/**
 * A fully typed in-process client for the whole oRPC router, acting as `volunteer` (or
 * anonymously). Skips HTTP and the auth header — the context is built directly, the way
 * `server/context.ts` would after resolving a session. Chapter access is read afresh on every
 * call, as a request would, so a role given after the client was made takes effect.
 */
export function clientAs(signedIn: Volunteer | null, extra: Partial<Context> = {}) {
  // As getCurrentVolunteer does, `isAdmin` holds only for an address in ADMIN_EMAILS.
  const volunteer = signedIn && {
    ...signedIn,
    isAdmin: Boolean(signedIn.isAdmin) && isSuperAdmin(signedIn),
  }
  const request = extra.request ?? new Request('http://localhost/api/rpc')
  const token = 'token' in extra ? (extra.token ?? null) : volunteer ? 'test-token' : null
  const viewingAsVolunteer = extra.viewingAsVolunteer ?? false
  return createRouterClient(appRouter, {
    context: async () => {
      const access = extra.access ?? (await loadAccess(volunteer))
      return {
        volunteer,
        access: viewingAsVolunteer ? withoutChapterRights(access) : access,
        viewingAsVolunteer,
        token,
        request,
      }
    },
  })
}

export const anon = () => clientAs(null)

/**
 * `volunteer` asks to join the project the way a volunteer does: by asking to take one of its
 * tasks, made here for the purpose. Returns the task, held for them until the owner answers.
 */
export async function askToJoin(volunteer: Volunteer, projectId: number) {
  const task = await createTask(projectId)
  await clientAs(volunteer).projects.updateTask({
    projectId,
    taskId: task.id,
    data: { assigneeId: volunteer.id },
  })
  return task
}
