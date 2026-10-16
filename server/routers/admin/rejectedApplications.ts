import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { adminProcedure } from '../../procedures'

export const adminRejectedApplicationsRouter = {
  list: adminProcedure.handler(async () => {
    const records = await prisma.rejectedApplication.findMany({
      orderBy: { rejectedAt: 'desc' },
    })

    const emailHashes = records.map((r) => r.emailHash)
    const anonymisedEmails =
      emailHashes.length > 0
        ? await prisma.anonymisedEmail.findMany({
            where: { emailHash: { in: emailHashes } },
            select: { emailHash: true, reapplyAllowedAt: true },
          })
        : []
    const reapplyAllowedByHash = new Map(
      anonymisedEmails.map((a) => [a.emailHash, a.reapplyAllowedAt]),
    )

    return records.map((r) => ({
      id: r.id,
      emailHash: r.emailHash,
      rejectedAt: r.rejectedAt,
      adminNotes: r.adminNotes,
      applicantNotes: r.applicantNotes,
      reapplyAllowedAt: reapplyAllowedByHash.get(r.emailHash) ?? null,
    }))
  }),

  allowReapply: adminProcedure
    .input(z.object({ emailHash: z.string().min(1) }))
    .handler(async ({ input }) => {
      const anonymisedEmail = await prisma.anonymisedEmail.findUnique({
        where: { emailHash: input.emailHash },
      })
      if (!anonymisedEmail) throw new ORPCError('NOT_FOUND', { message: 'Record not found' })

      await prisma.anonymisedEmail.update({
        where: { emailHash: input.emailHash },
        data: { reapplyAllowedAt: new Date() },
      })
      return { message: 'Reapplication allowed' }
    }),
}
