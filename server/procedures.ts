import { os, ORPCError } from '@orpc/server'
import { ApprovalStatus } from '@/generated/prisma/enums'
import { touchLastActive } from '@/lib/activity'
import { actingOn, isStaff, type ChapterAccess } from '@/lib/chapter-access'
import { prisma } from '@/lib/prisma'
import { inputLimitViolation } from '@/lib/input-limits'
import { canBypassMaintenance, isMaintenanceMode } from '@/lib/maintenance'
import { MAINTENANCE_MESSAGE } from '@/lib/maintenance-message'
import type { Context } from './context'

// The procedures that keep working while maintenance mode is on: enough for the client to
// learn the site is down, and for a super admin to sign in and be recognised as one.
const MAINTENANCE_OPEN = new Set([
  'maintenance.status',
  'version.get',
  'auth.googleClientId',
  'auth.login',
  'auth.google',
  'auth.me',
  'auth.logout',
])

const base = os.$context<Context>().use(async ({ context, next, path }, input) => {
  const violation = inputLimitViolation(input)
  if (violation) throw new ORPCError('BAD_REQUEST', { message: violation })
  if (
    !MAINTENANCE_OPEN.has(path.join('.')) &&
    !canBypassMaintenance(context.volunteer) &&
    (await isMaintenanceMode())
  ) {
    throw new ORPCError('SERVICE_UNAVAILABLE', { message: MAINTENANCE_MESSAGE })
  }
  return next()
})

export const publicProcedure = base

export const authedProcedure = base.use(async ({ context, next }) => {
  if (!context.volunteer) throw new ORPCError('UNAUTHORIZED')
  await touchLastActive(context.volunteer)
  return next({ context: { volunteer: context.volunteer, token: context.token } })
})

export const approvedProcedure = authedProcedure.use(({ context, next }) => {
  if (context.volunteer.approvalStatus !== ApprovalStatus.approved && !context.volunteer.isAdmin) {
    throw new ORPCError('FORBIDDEN', { message: 'Your account is pending approval' })
  }
  return next({ context })
})

/** Approved, with the email address proven: the gate for browsing and joining projects. */
export const confirmedProcedure = approvedProcedure.use(({ context, next }) => {
  if (!context.volunteer.emailConfirmed && !context.volunteer.isAdmin) {
    throw new ORPCError('FORBIDDEN', {
      message: 'Please confirm your email address to browse projects',
    })
  }
  return next({ context })
})

/** A global admin: `isAdmin` holds only for an address in ADMIN_EMAILS (lib/auth.ts). */
export const adminProcedure = base.use(({ context, next }) => {
  if (!context.volunteer) throw new ORPCError('UNAUTHORIZED')
  if (!context.volunteer.isAdmin) throw new ORPCError('FORBIDDEN')
  return next({ context: { volunteer: context.volunteer } })
})

/**
 * A global admin, or a chapter's lead or deputy. Handlers hold what they read and change to
 * the caller's chapter through `context.access` (lib/chapter-access-server.ts).
 */
export const staffProcedure = base.use(({ context, next }) => {
  if (!context.volunteer) throw new ORPCError('UNAUTHORIZED')
  if (!context.access.globalAdmin && !isStaff(context.access)) throw new ORPCError('FORBIDDEN')
  return next({ context: { volunteer: context.volunteer } })
})

/**
 * Makes `context.volunteer.isAdmin` mean "an admin over this project": a global admin, or a
 * staff member of the project's chapter (`actingOn`, lib/chapter-access.ts). The project
 * procedures' admin checks then hold for a chapter's staff on its own projects, and nowhere else.
 */
export const asProjectAdmin = os
  .$context<{ volunteer: NonNullable<Context['volunteer']>; access: ChapterAccess }>()
  .middleware(async ({ context, next }, projectId: number) => {
    const project = await prisma.workItem.findUnique({
      where: { id: projectId },
      select: { nationalChapterId: true },
    })
    const chapterId = project?.nationalChapterId ?? null
    return next({ context: { volunteer: actingOn(context.volunteer, context.access, chapterId) } })
  })
