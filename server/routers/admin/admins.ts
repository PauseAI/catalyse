import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { sendAdminInviteEmail } from '@/lib/email'
import { InviteAdminSchema } from '@/lib/schemas'
import { adminProcedure, authedProcedure } from '../../procedures'
import { env } from '@/lib/env'
import { ApprovalStatus, InviteStatus } from '@/generated/prisma/enums'

export const adminAdminsRouter = {
  list: adminProcedure.handler(async () => {
    const admins = await prisma.volunteer.findMany({
      where: { isAdmin: true, deletedAt: null },
      select: { id: true, name: true, email: true, createdAt: true, isTechnicalAdmin: true },
      orderBy: { name: 'asc' },
    })
    return admins.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      createdAt: a.createdAt,
      isTechnicalAdmin: Boolean(a.isTechnicalAdmin),
    }))
  }),

  setTechnicalAdmin: adminProcedure
    .input(z.object({ id: z.number().int(), isTechnicalAdmin: z.boolean() }))
    .handler(async ({ input }) => {
      const target = await prisma.volunteer.findFirst({
        where: { id: input.id, isAdmin: true },
        select: { id: true, name: true },
      })
      if (!target) throw new ORPCError('NOT_FOUND', { message: 'Admin not found' })

      await prisma.volunteer.update({
        where: { id: input.id },
        data: { isTechnicalAdmin: input.isTechnicalAdmin },
      })
      return {
        message: input.isTechnicalAdmin
          ? `${target.name} will now be notified of bug reports`
          : `${target.name} will no longer be notified of bug reports`,
      }
    }),

  revoke: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      if (input.id === context.volunteer.id) {
        throw new ORPCError('BAD_REQUEST', { message: 'You cannot revoke your own admin access' })
      }

      const target = await prisma.volunteer.findFirst({
        where: { id: input.id, isAdmin: true },
        select: { id: true, name: true },
      })
      if (!target) throw new ORPCError('NOT_FOUND', { message: 'Admin not found' })

      await prisma.volunteer.update({ where: { id: input.id }, data: { isAdmin: false } })
      return { message: `Admin access revoked for ${target.name}` }
    }),

  listInvites: adminProcedure.handler(async () => {
    const invites = await prisma.adminInvite.findMany({
      include: { invitedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    // The token itself stays server-side: it is the credential in the invite link, and
    // the admin list only needs to show who was invited and where the invite stands.
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      invitedById: i.invitedById,
      status: i.status,
      acceptedById: i.acceptedById,
      acceptedAt: i.acceptedAt,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      invitedByName: i.invitedBy.name,
    }))
  }),

  invite: adminProcedure.input(InviteAdminSchema).handler(async ({ input, context }) => {
    const admin = context.volunteer
    const email = input.email.trim().toLowerCase()

    const existing = await prisma.volunteer.findFirst({
      where: { email, isAdmin: true },
      select: { id: true },
    })
    if (existing) {
      throw new ORPCError('BAD_REQUEST', { message: 'This person is already an admin' })
    }

    const now = new Date()
    const pending = await prisma.adminInvite.findFirst({
      where: { email, status: InviteStatus.pending, expiresAt: { gt: now } },
      select: { id: true },
    })
    if (pending) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'An invite is already pending for this email',
      })
    }

    const inviteToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await prisma.adminInvite.create({
      data: { email, inviteToken, invitedById: admin.id, expiresAt },
    })

    const emailSent = await sendAdminInviteEmail({ to: email, inviteToken, invitedBy: admin.name })

    const result: Record<string, unknown> = {
      message: `Invite ${emailSent ? 'sent' : 'created'} for ${email}`,
      expiresAt: expiresAt.toISOString(),
    }

    if (env.STUB_EMAIL) {
      result._dev_invite_token = inviteToken
      result._dev_invite_url = `${env.APP_URL}/accept-invite?token=${inviteToken}`
      result._dev_note = 'Email stubbed. Share link manually.'
    }

    return result
  }),

  revokeInvite: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input }) => {
      const invite = await prisma.adminInvite.findFirst({
        where: { id: input.id, status: InviteStatus.pending },
        select: { id: true },
      })
      if (!invite) throw new ORPCError('NOT_FOUND', { message: 'Invite not found or already used' })

      await prisma.adminInvite.update({
        where: { id: input.id },
        data: { status: InviteStatus.revoked },
      })
      return { message: 'Invite revoked' }
    }),

  acceptInvite: authedProcedure
    .input(z.object({ inviteToken: z.string().min(1) }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      // Only someone holding the token learns which of these applies to it.
      const invite = await prisma.adminInvite.findFirst({
        where: { inviteToken: input.inviteToken },
      })
      if (!invite) {
        throw new ORPCError('NOT_FOUND', {
          message: "This invite link isn't valid. Check you opened the whole link from the email.",
        })
      }
      if (invite.status === InviteStatus.accepted) {
        throw new ORPCError('BAD_REQUEST', { message: 'This invite has already been used.' })
      }
      if (invite.status === InviteStatus.revoked) {
        throw new ORPCError('BAD_REQUEST', { message: 'This invite has been withdrawn.' })
      }
      if (invite.status === InviteStatus.expired || invite.expiresAt <= new Date()) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'This invite has expired. Ask the admin who invited you to send a new one.',
        })
      }

      if (invite.email.toLowerCase() !== (volunteer.email ?? '').toLowerCase()) {
        throw new ORPCError('FORBIDDEN', {
          message: 'This invite is for a different email address',
        })
      }
      // The token travels by email and can be forwarded; only a proven address redeems it.
      if (!volunteer.emailConfirmed) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Confirm your email address before accepting this invite',
        })
      }

      await prisma.$transaction([
        prisma.volunteer.update({
          where: { id: volunteer.id },
          data: { isAdmin: true, approvalStatus: ApprovalStatus.approved },
        }),
        prisma.adminInvite.update({
          where: { id: invite.id },
          data: {
            status: InviteStatus.accepted,
            acceptedById: volunteer.id,
            acceptedAt: new Date(),
          },
        }),
      ])

      return { message: 'You are now an admin!' }
    }),
}
