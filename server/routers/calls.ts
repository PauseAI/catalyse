import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { clearNotifications, notifyUser } from '@/lib/notify'
import { logger } from '@/lib/logger'
import { html, sendAdminAlertEmail } from '@/lib/email'
import { categoryOf } from '@/lib/notification-categories'
import {
  ADDRESSABLE,
  addressedToWhere,
  addresseeWhere,
  CALL_ANSWERED,
  CALL_POSTED,
} from '@/lib/calls'
import type { ChapterAccess } from '@/lib/chapter-access'
import { confirmedProcedure, coordinatorProcedure } from '../procedures'

const CallInput = z.object({
  title: z.string().trim().min(1, 'Give the call a title').max(200),
  body: z.string().trim().min(1, 'Say what you are asking for').max(2000),
  /** Empty: every chapter and the holding pool. */
  chapterIds: z.array(z.number().int()).max(200),
  skillId: z.number().int().nullable(),
})

/**
 * Tells each addressee of a call about it, in the Inbox and, unless they have muted its
 * category, by email. The addressees are read here and never returned, so a call does not tell
 * its sender whom it reached. Emails go one at a time, so a call to every chapter does not
 * burst at the mail provider.
 */
async function deliver(call: { id: number; title: string; body: string } & AddressingFields) {
  const addressees = await prisma.volunteer.findMany({
    where: addresseeWhere(call),
    select: { id: true, name: true, email: true, emailMutedCategories: true },
  })
  const title = `Call for volunteers: ${call.title}`
  const notifications = await prisma.notification.createManyAndReturn({
    data: addressees.map((v) => ({
      volunteerId: v.id,
      type: CALL_POSTED,
      title,
      body: call.body,
      link: '/calls',
      entityId: call.id,
    })),
    select: { id: true, volunteerId: true },
  })
  const notificationOf = new Map(notifications.map((n) => [n.volunteerId, n.id]))
  const category = categoryOf(CALL_POSTED)
  const message = html`${call.body}`.replace(/\n/g, '<br>')
  for (const v of addressees) {
    if (!v.email || v.emailMutedCategories.includes(category)) continue
    const sent = await sendAdminAlertEmail({
      to: v.email,
      name: v.name,
      subject: title,
      message,
      ctaLabel: 'Answer the call',
      ctaUrl: '/calls',
    }).catch((e) => {
      logger.error(e, '[CALL EMAIL]')
      return false
    })
    if (sent) {
      await prisma.notification.update({
        where: { id: notificationOf.get(v.id) },
        data: { emailedAt: new Date() },
      })
    }
  }
}

type AddressingFields = { senderId: number | null; chapterIds: number[]; skillId: number | null }

/** A call the caller may run: their own, or any for a global admin. */
async function callRunBy(volunteerId: number, access: ChapterAccess, id: number) {
  const call = await prisma.call.findUnique({ where: { id } })
  if (!call || (call.senderId !== volunteerId && !access.globalAdmin)) {
    throw new ORPCError('NOT_FOUND', { message: 'Call not found' })
  }
  return call
}

/** A call put out to `volunteerId` and still open, or not found. */
async function openCallFor(volunteerId: number, id: number) {
  const call = await prisma.call.findUnique({ where: { id } })
  const addressed =
    call &&
    (await prisma.volunteer.count({ where: { AND: [{ id: volunteerId }, addresseeWhere(call)] } }))
  if (!call || !addressed) throw new ORPCError('NOT_FOUND', { message: 'Call not found' })
  if (call.closedAt) {
    throw new ORPCError('BAD_REQUEST', { message: 'This call is no longer taking answers' })
  }
  return call
}

/**
 * Calls: a coordinator (or global admin) asks volunteers across chapters for help, and the
 * platform carries the ask to them. The sender sees each call's answers, never whom else it
 * reached.
 */
export const callsRouter = {
  send: coordinatorProcedure.input(CallInput).handler(async ({ input, context }) => {
    const chapterIds = [...new Set(input.chapterIds)]
    const found = await prisma.nationalChapter.count({ where: { id: { in: chapterIds } } })
    if (found !== chapterIds.length) {
      throw new ORPCError('BAD_REQUEST', { message: 'Choose chapters from the list' })
    }
    if (input.skillId !== null && !(await prisma.skill.count({ where: { id: input.skillId } }))) {
      throw new ORPCError('BAD_REQUEST', { message: 'Choose a skill from the list' })
    }
    const call = await prisma.call.create({
      data: {
        senderId: context.volunteer.id,
        title: input.title,
        body: input.body,
        chapterIds,
        skillId: input.skillId,
      },
    })
    deliver(call).catch((e) => logger.error(e, '[CALL DELIVERY]'))
    return { id: call.id }
  }),

  /** The caller's own calls, or every call for a global admin, with how many have answered. */
  sent: coordinatorProcedure.handler(async ({ context }) => {
    const calls = await prisma.call.findMany({
      where: context.access.globalAdmin ? {} : { senderId: context.volunteer.id },
      include: {
        skill: { select: { name: true } },
        sender: { select: { name: true } },
        _count: { select: { responses: { where: { volunteer: { deletedAt: null } } } } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const chapters = await prisma.nationalChapter.findMany({ select: { id: true, name: true } })
    const chapterName = new Map(chapters.map((c) => [c.id, c.name]))
    return calls.map((c) => ({
      id: c.id,
      title: c.title,
      body: c.body,
      chapters: c.chapterIds.map((id) => chapterName.get(id) ?? 'A removed chapter'),
      skillName: c.skill?.name ?? null,
      senderName: c.sender?.name ?? null,
      createdAt: c.createdAt,
      closedAt: c.closedAt,
      responseCount: c._count.responses,
    }))
  }),

  /** Who has answered a call, with what each chose to send. */
  responses: coordinatorProcedure
    .input(z.object({ callId: z.number().int() }))
    .handler(async ({ input, context }) => {
      await callRunBy(context.volunteer.id, context.access, input.callId)
      const responses = await prisma.callResponse.findMany({
        where: { callId: input.callId, volunteer: { deletedAt: null } },
        select: {
          id: true,
          message: true,
          createdAt: true,
          volunteer: {
            select: { id: true, name: true, email: true, chapter: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      })
      return responses.map((r) => ({
        id: r.id,
        message: r.message,
        createdAt: r.createdAt,
        volunteerId: r.volunteer.id,
        name: r.volunteer.name,
        email: r.volunteer.email,
        chapterName: r.volunteer.chapter?.name ?? null,
      }))
    }),

  close: coordinatorProcedure
    .input(z.object({ callId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const call = await callRunBy(context.volunteer.id, context.access, input.callId)
      if (!call.closedAt) {
        await prisma.call.update({ where: { id: call.id }, data: { closedAt: new Date() } })
      }
      return { message: 'The call is closed to new answers' }
    }),

  /** Open calls put out to the caller, and any they have answered. */
  forMe: confirmedProcedure.handler(async ({ context }) => {
    const me = context.volunteer
    if (!(await prisma.volunteer.count({ where: { id: me.id, ...ADDRESSABLE } }))) return []
    const calls = await prisma.call.findMany({
      where: {
        AND: [
          addressedToWhere(me),
          { OR: [{ closedAt: null }, { responses: { some: { volunteerId: me.id } } }] },
        ],
      },
      include: {
        skill: { select: { name: true } },
        sender: { select: { name: true, coordinatorRole: { select: { remit: true } } } },
        responses: { where: { volunteerId: me.id }, select: { message: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return calls.map((c) => ({
      id: c.id,
      title: c.title,
      body: c.body,
      skillName: c.skill?.name ?? null,
      senderName: c.sender?.name ?? null,
      senderRemit: c.sender?.coordinatorRole?.remit ?? null,
      createdAt: c.createdAt,
      open: c.closedAt === null,
      myResponse: c.responses[0] ?? null,
    }))
  }),

  /** Answers a call, which shares the caller's name, email and message with its sender. */
  respond: confirmedProcedure
    .input(z.object({ callId: z.number().int(), message: z.string().trim().min(1).max(2000) }))
    .handler(async ({ input, context }) => {
      const me = context.volunteer
      const call = await openCallFor(me.id, input.callId)
      const where = { callId_volunteerId: { callId: call.id, volunteerId: me.id } }
      // Create first, so of two first answers sent at once only one notifies the sender.
      const { count: created } = await prisma.callResponse.createMany({
        data: [{ callId: call.id, volunteerId: me.id, message: input.message }],
        skipDuplicates: true,
      })
      const response = created
        ? await prisma.callResponse.findUnique({ where })
        : await prisma.callResponse.update({ where, data: { message: input.message } })
      // Null when a withdrawal got in first: there is nothing left to tell the sender about.
      if (created && response && call.senderId !== null) {
        await notifyUser(
          call.senderId,
          CALL_ANSWERED,
          `${me.name} answered your call: ${call.title}`,
          null,
          '/coordinate',
          undefined,
          response.id,
        )
      }
      return { message: 'Thanks: the coordinator can now see your answer and contact you' }
    }),

  /** Takes back an answer, and the sender's notification of it. */
  withdraw: confirmedProcedure
    .input(z.object({ callId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const response = await prisma.callResponse.findUnique({
        where: { callId_volunteerId: { callId: input.callId, volunteerId: context.volunteer.id } },
      })
      if (!response)
        throw new ORPCError('NOT_FOUND', { message: 'You have not answered this call' })
      await prisma.callResponse.delete({ where: { id: response.id } })
      await clearNotifications(CALL_ANSWERED, response.id)
      return { message: 'Your answer is withdrawn' }
    }),
}
