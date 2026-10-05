import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { authedProcedure } from '../procedures'
import { ADMIN_NOTIFICATION_TYPES } from '@/lib/admin-notifications'
import {
  NON_UPDATE_TYPES,
  NOTIFICATION_CATEGORIES,
  categoryOf,
  typesIn,
  type NotificationCategory,
} from '@/lib/notification-categories'
import {
  ContactRequestStatus,
  InterestStatus,
  TeamJoinRequestStatus,
  TeamMembershipRole,
} from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'

type Viewer = { id: number; isAdmin: boolean | null }

/** A viewer's own notifications, optionally one category; admin-only types stay in admin pages. */
function mineWhere(viewer: Viewer, category?: NotificationCategory): Prisma.NotificationWhereInput {
  const and: Prisma.NotificationWhereInput[] = []
  if (viewer.isAdmin) and.push({ type: { notIn: ADMIN_NOTIFICATION_TYPES } })
  if (category === 'update') and.push({ type: { notIn: NON_UPDATE_TYPES } })
  else if (category) and.push({ type: { in: typesIn(category) } })
  return { volunteerId: viewer.id, AND: and }
}

export type NotificationAction =
  | { kind: 'interest'; projectId: number; interestId: number }
  | { kind: 'join_request'; requestId: number }
  | { kind: 'invite'; projectId: number }
  | { kind: 'contact_request'; requestId: number }

/**
 * What can be answered from the Inbox itself: an applicant still waiting on a project the
 * viewer runs, a team join request still waiting on a team they lead, or an invite to the
 * viewer or a request to connect with them, still unanswered.
 */
async function actionsFor(
  viewer: Viewer,
  rows: { id: number; type: string; entityId: number | null }[],
): Promise<Map<number, NotificationAction>> {
  const ids = (type: string) =>
    rows.filter((r) => r.type === type && r.entityId !== null).map((r) => r.entityId as number)
  const [interests, requests, invites, contactRequests] = await Promise.all([
    prisma.workItemInterest.findMany({
      where: {
        id: { in: ids('new_interest') },
        status: InterestStatus.pending,
        ...(viewer.isAdmin ? {} : { workItem: { assigneeId: viewer.id } }),
      },
      select: { id: true, workItemId: true },
    }),
    prisma.teamJoinRequest.findMany({
      where: {
        id: { in: ids('team_join_request') },
        status: TeamJoinRequestStatus.pending,
        ...(viewer.isAdmin
          ? {}
          : {
              team: {
                members: { some: { volunteerId: viewer.id, role: TeamMembershipRole.leader } },
              },
            }),
      },
      select: { id: true },
    }),
    prisma.workItemInterest.findMany({
      where: {
        id: { in: ids('project_invite') },
        volunteerId: viewer.id,
        status: InterestStatus.invited,
      },
      select: { id: true, workItemId: true },
    }),
    prisma.contactRequest.findMany({
      where: {
        id: { in: ids('contact_request') },
        toVolunteerId: viewer.id,
        status: ContactRequestStatus.pending,
      },
      select: { id: true },
    }),
  ])
  const contactRequestIds = new Set(contactRequests.map((r) => r.id))
  const inviteById = new Map(invites.map((i) => [i.id, i]))
  const interestById = new Map(interests.map((i) => [i.id, i]))
  const requestIds = new Set(requests.map((r) => r.id))
  const actions = new Map<number, NotificationAction>()
  for (const r of rows) {
    const interest = r.type === 'new_interest' ? interestById.get(r.entityId as number) : undefined
    const invite = r.type === 'project_invite' ? inviteById.get(r.entityId as number) : undefined
    if (interest) {
      actions.set(r.id, {
        kind: 'interest',
        projectId: interest.workItemId,
        interestId: interest.id,
      })
    } else if (r.type === 'team_join_request' && requestIds.has(r.entityId as number)) {
      actions.set(r.id, { kind: 'join_request', requestId: r.entityId as number })
    } else if (invite) {
      actions.set(r.id, { kind: 'invite', projectId: invite.workItemId })
    } else if (r.type === 'contact_request' && contactRequestIds.has(r.entityId as number)) {
      actions.set(r.id, { kind: 'contact_request', requestId: r.entityId as number })
    }
  }
  return actions
}

const categoryInput = z.enum(NOTIFICATION_CATEGORIES).optional()

export const notificationsRouter = {
  list: authedProcedure
    .input(
      z.object({
        filter: z.enum(['all', 'unread', 'read']).optional().default('all'),
        category: categoryInput,
        limit: z.number().int().min(1).max(100).optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
      }),
    )
    .handler(async ({ input, context }) => {
      const mine = mineWhere(context.volunteer, input.category)
      const unreadWhere = { ...mine, readAt: null }
      const readWhere = { ...mine, readAt: { not: null } }
      const newestFirst = { createdAt: 'desc' } as const

      // Every unread item precedes every read one, so the two are paged as one list.
      const [unreadTotal, readTotal] = await Promise.all([
        input.filter === 'read' ? 0 : prisma.notification.count({ where: unreadWhere }),
        input.filter === 'unread' ? 0 : prisma.notification.count({ where: readWhere }),
      ])
      const unreadPage = await prisma.notification.findMany({
        where: unreadWhere,
        orderBy: newestFirst,
        skip: input.offset,
        take: unreadTotal === 0 ? 0 : input.limit,
      })
      const readRoom = input.limit - unreadPage.length
      const readPage = await prisma.notification.findMany({
        where: readWhere,
        orderBy: newestFirst,
        skip: Math.max(0, input.offset - unreadTotal),
        take: readTotal === 0 ? 0 : readRoom,
      })
      const notifications = [...unreadPage, ...readPage]
      const total = unreadTotal + readTotal
      const actions = await actionsFor(context.volunteer, notifications)

      return {
        notifications: notifications.map((n) => ({
          id: n.id,
          volunteerId: n.volunteerId,
          type: n.type,
          category: categoryOf(n.type),
          title: n.title,
          body: n.body,
          link: n.link,
          entityId: n.entityId,
          readAt: n.readAt,
          emailedAt: n.emailedAt,
          createdAt: n.createdAt,
          action: actions.get(n.id) ?? null,
        })),
        total,
      }
    }),

  /** Unread counts per category; the nav badge shows only what needs action. */
  counts: authedProcedure.handler(async ({ context }) => {
    const [needs_action, update, message] = await Promise.all(
      NOTIFICATION_CATEGORIES.map((c) =>
        prisma.notification.count({ where: { ...mineWhere(context.volunteer, c), readAt: null } }),
      ),
    )
    return { needs_action, update, message }
  }),

  readAll: authedProcedure
    .input(z.object({ category: categoryInput }).optional())
    .handler(async ({ input, context }) => {
      await prisma.notification.updateMany({
        where: { ...mineWhere(context.volunteer, input?.category), readAt: null },
        data: { readAt: new Date() },
      })
      return { message: 'All marked as read' }
    }),

  markRead: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const result = await prisma.notification.updateMany({
        where: { id: input.id, volunteerId: context.volunteer.id },
        data: { readAt: new Date() },
      })
      if (result.count === 0) throw new ORPCError('NOT_FOUND')
      return { message: 'Marked as read' }
    }),

  markUnread: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const result = await prisma.notification.updateMany({
        where: { id: input.id, volunteerId: context.volunteer.id },
        data: { readAt: null },
      })
      if (result.count === 0) throw new ORPCError('NOT_FOUND')
      return { message: 'Marked as unread' }
    }),
}
