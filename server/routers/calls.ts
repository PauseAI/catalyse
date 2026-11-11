import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { clearNotifications, notifyUser } from '@/lib/notify'
import type { Prisma } from '@/generated/prisma/client'
import {
  ADDRESSABLE,
  addressedToWhere,
  addresseeWhere,
  audienceWhere,
  CALL_ANSWERED,
  CALL_POSTED,
  visibleToWhere,
} from '@/lib/calls'
import type { ChapterAccess } from '@/lib/chapter-access'
import { confirmedProcedure, coordinatorProcedure } from '../procedures'

const CallInput = z.object({
  title: z.string().trim().min(1, 'Give the call a title').max(200),
  body: z.string().trim().min(1, 'Say what you are asking for').max(2000),
  /** Empty: every chapter and the holding pool. */
  chapterIds: z.array(z.number().int()).max(200),
  /** Any one of these addresses the call to a volunteer; empty: anyone. */
  skillIds: z.array(z.number().int()).max(50),
})

/**
 * Tells each addressee of a call about it in their Inbox, and never by email: one call can reach
 * every volunteer, so emailing each would spend the mail provider's quota in one send. The
 * addressees are read here and never returned, so a call does not tell its sender whom it reached.
 */
async function deliver(
  tx: Prisma.TransactionClient,
  call: { id: number; title: string; body: string } & Addressing,
) {
  const addressees = await tx.volunteer.findMany({
    where: addresseeWhere(call),
    select: { id: true },
  })
  await tx.notification.createMany({
    data: addressees.map((v) => ({
      volunteerId: v.id,
      type: CALL_POSTED,
      title: `Call for volunteers: ${call.title}`,
      body: call.body,
      link: '/calls',
      entityId: call.id,
    })),
  })
}

type Addressing = { senderId: number | null; chapterIds: number[]; skillIds: number[] }

/** Reads a call's skill names, in alphabetical order, with `skillNames`. */
const SKILL_NAMES = {
  skills: { select: { skill: { select: { name: true } } }, orderBy: { skill: { name: 'asc' } } },
} as const
const skillNames = (call: { skills: { skill: { name: string } }[] }) =>
  call.skills.map((s) => s.skill.name)

/** A call the caller may run: their own, or any for a global admin. */
async function callRunBy(volunteerId: number, access: ChapterAccess, id: number) {
  const call = await prisma.call.findUnique({ where: { id } })
  if (!call || (call.senderId !== volunteerId && !access.globalAdmin)) {
    throw new ORPCError('NOT_FOUND', { message: 'Call not found' })
  }
  return call
}

/** A call `volunteerId` may see, skill or not, and still open; or not found. */
async function openCallFor(volunteerId: number, id: number) {
  const call = await prisma.call.findUnique({ where: { id } })
  const visible =
    call &&
    (await prisma.volunteer.count({ where: { AND: [{ id: volunteerId }, audienceWhere(call)] } }))
  if (!call || !visible) throw new ORPCError('NOT_FOUND', { message: 'Call not found' })
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
    const skillIds = [...new Set(input.skillIds)]
    // One transaction, so a delivery that fails takes its call with it and the sender can resend.
    return prisma.$transaction(async (tx) => {
      // Shared row locks keep the skills from being deleted until the call is in.
      const found = skillIds.length
        ? await tx.$queryRaw<{ id: number }[]>`
            SELECT id FROM skills WHERE id = ANY(${skillIds}::int[]) FOR SHARE`
        : []
      if (found.length !== skillIds.length) {
        throw new ORPCError('BAD_REQUEST', { message: 'Choose a skill from the list' })
      }
      const call = await tx.call.create({
        data: {
          senderId: context.volunteer.id,
          title: input.title,
          body: input.body,
          chapterIds,
          skills: { create: skillIds.map((skillId) => ({ skillId })) },
        },
      })
      await deliver(tx, { ...call, skillIds })
      return { id: call.id }
    })
  }),

  /** The caller's own calls, or every call for a global admin, with how many have answered. */
  sent: coordinatorProcedure.handler(async ({ context }) => {
    const calls = await prisma.call.findMany({
      where: context.access.globalAdmin ? {} : { senderId: context.volunteer.id },
      include: {
        ...SKILL_NAMES,
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
      skillNames: skillNames(c),
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

  /**
   * Open calls the caller may see, and any they have answered, each marked by whether it was
   * addressed to them: it asks for no skill, or for one they have.
   */
  forMe: confirmedProcedure.handler(async ({ context }) => {
    const me = context.volunteer
    if (!(await prisma.volunteer.count({ where: { id: me.id, ...ADDRESSABLE } }))) return []
    const calls = await prisma.call.findMany({
      where: {
        AND: [
          visibleToWhere(me),
          { OR: [{ closedAt: null }, { responses: { some: { volunteerId: me.id } } }] },
        ],
      },
      include: {
        ...SKILL_NAMES,
        sender: { select: { name: true, coordinatorRole: { select: { remit: true } } } },
        responses: { where: { volunteerId: me.id }, select: { message: true, createdAt: true } },
        dismissals: { where: { volunteerId: me.id }, select: { callId: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const addressed = await prisma.call.findMany({
      where: { AND: [{ id: { in: calls.map((c) => c.id) } }, addressedToWhere(me)] },
      select: { id: true },
    })
    const addressedIds = new Set(addressed.map((c) => c.id))
    return calls.map((c) => ({
      id: c.id,
      title: c.title,
      body: c.body,
      skillNames: skillNames(c),
      matchesSkills: addressedIds.has(c.id),
      senderName: c.sender?.name ?? null,
      senderRemit: c.sender?.coordinatorRole?.remit ?? null,
      createdAt: c.createdAt,
      open: c.closedAt === null,
      myResponse: c.responses[0] ?? null,
      // A merge of two accounts can bring a dismissal to a call already answered.
      dismissed: c.dismissals.length > 0 && c.responses.length === 0,
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
      await prisma.callDismissal.deleteMany({ where: { callId: call.id, volunteerId: me.id } })
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

  /**
   * Sets a call aside for the caller, and reads its Inbox notification. The sender is not told,
   * and it is not an answer: a call already answered is withdrawn from instead.
   */
  dismiss: confirmedProcedure
    .input(z.object({ callId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const me = context.volunteer
      const call = await openCallFor(me.id, input.callId)
      const answered = await prisma.callResponse.count({
        where: { callId: call.id, volunteerId: me.id },
      })
      if (answered) {
        throw new ORPCError('BAD_REQUEST', { message: 'Withdraw your answer to dismiss this call' })
      }
      await prisma.callDismissal.createMany({
        data: [{ callId: call.id, volunteerId: me.id }],
        skipDuplicates: true,
      })
      await prisma.notification.updateMany({
        where: { volunteerId: me.id, type: CALL_POSTED, entityId: call.id, readAt: null },
        data: { readAt: new Date() },
      })
      return { message: 'Call dismissed' }
    }),

  /** Brings a dismissed call back among the caller's calls. */
  undismiss: confirmedProcedure
    .input(z.object({ callId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const me = context.volunteer
      const call = await openCallFor(me.id, input.callId)
      await prisma.callDismissal.deleteMany({ where: { callId: call.id, volunteerId: me.id } })
      return { message: 'Call restored' }
    }),
}
