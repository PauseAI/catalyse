import { os, ORPCError } from '@orpc/server'
import { ApprovalStatus } from '@/generated/prisma/enums'
import { isSuperAdmin } from '@/lib/auth'
import { touchLastActive } from '@/lib/activity'
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

export const adminProcedure = base.use(({ context, next }) => {
  if (!context.volunteer) throw new ORPCError('UNAUTHORIZED')
  if (!context.volunteer.isAdmin) throw new ORPCError('FORBIDDEN')
  return next({ context: { volunteer: context.volunteer } })
})

export const superAdminProcedure = base.use(({ context, next }) => {
  if (!context.volunteer) throw new ORPCError('UNAUTHORIZED')
  if (!context.volunteer.isAdmin) throw new ORPCError('FORBIDDEN')
  if (!isSuperAdmin(context.volunteer)) throw new ORPCError('FORBIDDEN')
  return next({ context: { volunteer: context.volunteer } })
})
