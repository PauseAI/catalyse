import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/chapter-roles'
import { ChapterAuditAction } from '@/generated/prisma/enums'
import { adminProcedure } from '../../procedures'

const remit = z.string().trim().max(100).nullable()

/**
 * The coordinators, whom only a global admin appoints and removes. Each change is written to the
 * audit log with no chapter, since the role is over none in particular.
 */
export const adminCoordinatorsRouter = {
  list: adminProcedure.handler(async () => {
    const rows = await prisma.coordinator.findMany({
      where: { volunteer: { deletedAt: null } },
      select: {
        remit: true,
        createdAt: true,
        volunteer: { select: { id: true, name: true, email: true } },
        appointedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r) => ({
      volunteerId: r.volunteer.id,
      name: r.volunteer.name,
      email: r.volunteer.email,
      remit: r.remit,
      appointedByName: r.appointedBy?.name ?? null,
      createdAt: r.createdAt,
    }))
  }),

  appoint: adminProcedure
    .input(z.object({ volunteerId: z.number().int(), remit }))
    .handler(async ({ input, context }) => {
      const volunteer = await prisma.volunteer.findFirst({
        where: { id: input.volunteerId, deletedAt: null },
        select: { id: true, name: true },
      })
      if (!volunteer) throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
      const remitText = input.remit || null
      await prisma.$transaction(async (tx) => {
        const existing = await tx.coordinator.findUnique({ where: { volunteerId: volunteer.id } })
        if (existing) {
          await tx.coordinator.update({ where: { id: existing.id }, data: { remit: remitText } })
          return
        }
        await tx.coordinator.create({
          data: {
            volunteerId: volunteer.id,
            remit: remitText,
            appointedById: context.volunteer.id,
          },
        })
        await audit(tx, ChapterAuditAction.COORDINATOR_APPOINTED, {
          actorId: context.volunteer.id,
          chapterId: null,
          targetVolunteerId: volunteer.id,
          details: { remit: remitText },
        })
      })
      return { message: `${volunteer.name} is a coordinator` }
    }),

  /** Takes the role away and closes their open calls, whose answers would reach nobody. */
  remove: adminProcedure
    .input(z.object({ volunteerId: z.number().int() }))
    .handler(async ({ input, context }) => {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.coordinator.deleteMany({
          where: { volunteerId: input.volunteerId },
        })
        if (!count) throw new ORPCError('NOT_FOUND', { message: 'Coordinator not found' })
        await tx.call.updateMany({
          where: { senderId: input.volunteerId, closedAt: null },
          data: { closedAt: new Date() },
        })
        await audit(tx, ChapterAuditAction.COORDINATOR_REMOVED, {
          actorId: context.volunteer.id,
          chapterId: null,
          targetVolunteerId: input.volunteerId,
        })
      })
      return { message: 'They are no longer a coordinator' }
    }),
}
