import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { staffProcedure } from '../../procedures'
import { ADMIN_NOTIFICATION_TYPES } from '@/lib/admin-notifications'

export const adminNotificationsRouter = {
  list: staffProcedure.handler(async ({ context }) => {
    const notifications = await prisma.notification.findMany({
      where: { volunteerId: context.volunteer.id, type: { in: ADMIN_NOTIFICATION_TYPES } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: n.readAt,
      createdAt: n.createdAt,
    }))
  }),

  readAll: staffProcedure.handler(async ({ context }) => {
    await prisma.notification.updateMany({
      where: {
        volunteerId: context.volunteer.id,
        readAt: null,
        type: { in: ADMIN_NOTIFICATION_TYPES },
      },
      data: { readAt: new Date() },
    })
    return { message: 'All marked as read' }
  }),

  markRead: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const result = await prisma.notification.updateMany({
        where: {
          id: input.id,
          volunteerId: context.volunteer.id,
          type: { in: ADMIN_NOTIFICATION_TYPES },
        },
        data: { readAt: new Date() },
      })
      if (result.count === 0) throw new ORPCError('NOT_FOUND')
      return { message: 'Marked as read' }
    }),
}
