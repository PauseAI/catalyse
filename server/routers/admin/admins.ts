import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { globalAdminWhere } from '@/lib/chapter-access-server'
import { acceptChapterInvite } from '@/lib/chapter-roles'
import { adminProcedure, authedProcedure } from '../../procedures'
import { InviteStatus } from '@/generated/prisma/enums'

/**
 * The global admins, who are whoever ADMIN_EMAILS lists, and redeeming an invite to run a
 * chapter. Chapter staff are appointed and invited in admin.chapters.
 */
export const adminAdminsRouter = {
  list: adminProcedure.handler(async () => {
    const admins = await prisma.volunteer.findMany({
      where: globalAdminWhere(),
      select: { id: true, name: true, email: true, createdAt: true, isTechnicalAdmin: true },
      orderBy: { name: 'asc' },
    })
    return admins.map((a) => ({ ...a, isTechnicalAdmin: Boolean(a.isTechnicalAdmin) }))
  }),

  setTechnicalAdmin: adminProcedure
    .input(z.object({ id: z.number().int(), isTechnicalAdmin: z.boolean() }))
    .handler(async ({ input }) => {
      const target = await prisma.volunteer.findFirst({
        where: { ...globalAdminWhere(), id: input.id },
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

  acceptInvite: authedProcedure
    .input(z.object({ inviteToken: z.string().min(1) }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      // Only someone holding the token learns which of these applies to it.
      const invite = await prisma.adminInvite.findFirst({
        where: { inviteToken: input.inviteToken },
        include: { chapter: { select: { name: true } } },
      })
      if (!invite) {
        throw new ORPCError('NOT_FOUND', {
          message: "This invite link isn't valid. Check you opened the whole link from the email.",
        })
      }
      if (invite.status === InviteStatus.accepted) {
        throw new ORPCError('BAD_REQUEST', { message: 'This invite has already been used.' })
      }
      if (invite.status === InviteStatus.revoked || !invite.chapter) {
        throw new ORPCError('BAD_REQUEST', { message: 'This invite has been withdrawn.' })
      }
      if (invite.status === InviteStatus.expired || invite.expiresAt <= new Date()) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'This invite has expired. Ask the person who invited you to send a new one.',
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

      await prisma.$transaction((tx) => acceptChapterInvite(tx, volunteer.id, invite))
      const role = invite.role === 'LEAD' ? 'the lead' : 'a deputy lead'
      return { message: `You are now ${role} of the ${invite.chapter.name} chapter!` }
    }),
}
