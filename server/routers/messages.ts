import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { sendRelayMessage, isEmailConfigured } from '@/lib/email'
import { checkRateLimit } from '@/lib/rate-limit'
import { canReach } from '@/lib/contact'
import { projectScopeWhere } from '@/lib/work-item'
import { authedProcedure, approvedProcedure } from '../procedures'
import { WorkItemType } from '@/generated/prisma/enums'
import type { Context } from '../context'

const ContactSchema = z.object({
  recipientId: z.number().int(),
  subject: z
    .string()
    .min(1, 'Subject is required')
    .max(200, 'Subject must be 200 characters or fewer'),
  message: z.string().min(1, 'Message is required'),
  relatedProjectId: z.number().int().optional().nullable(),
  /** Lets the recipient reply by email, which shows them the sender's address. */
  shareEmail: z.boolean().optional().default(false),
})

type Sender = { id: number; name: string; email: string | null }

/** Every send fans out to a real email; without a cap one account could spam the directory. */
function limitSends(context: Pick<Context, 'request'>) {
  const { allowed, retryAfterMs } = checkRateLimit(context.request, 'messages-send', {
    limit: 20,
    windowMs: 60 * 60 * 1000,
  })
  if (!allowed) {
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `Rate limited. Retry after ${retryAfterMs}ms`,
    })
  }
}

/**
 * Stores one message in its conversation, tells the recipient in the Inbox, and emails them a
 * copy. `threadId` is null for a new conversation, which then becomes its own thread.
 */
async function deliver(
  sender: Sender,
  recipient: { id: number; name: string; email: string | null },
  message: {
    subject: string
    body: string
    threadId: number | null
    relatedProjectId: number | null
    projectTitle: string | null
    shareEmail: boolean
  },
) {
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.message.create({
      data: {
        fromVolunteerId: sender.id,
        toVolunteerId: recipient.id,
        subject: message.subject,
        message: message.body,
        relatedWorkItemId: message.relatedProjectId,
        threadId: message.threadId,
      },
    })
    const threadId = message.threadId ?? row.id
    await tx.notification.create({
      data: {
        volunteerId: recipient.id,
        type: 'message_received',
        title: `Message from ${sender.name}`,
        body: message.subject,
        link: `/inbox/messages/${threadId}`,
        entityId: threadId,
      },
    })
    return { id: row.id, threadId }
  })

  if (recipient.email && isEmailConfigured()) {
    sendRelayMessage({
      to: recipient.email,
      toName: recipient.name,
      fromName: sender.name,
      replyTo: message.shareEmail ? sender.email : null,
      subject: message.subject,
      message: message.body,
      projectTitle: message.projectTitle ?? undefined,
      threadId: created.threadId,
    }).catch((e) => console.error('[EMAIL ERROR]', e))
  }
  return created
}

/** The first message of a thread the viewer takes part in, or NOT_FOUND. */
async function loadThread(threadId: number, viewerId: number) {
  const root = await prisma.message.findFirst({
    where: {
      id: threadId,
      threadId: null,
      OR: [{ fromVolunteerId: viewerId }, { toVolunteerId: viewerId }],
    },
    include: {
      from: { select: { id: true, name: true, email: true, deletedAt: true } },
      to: { select: { id: true, name: true, email: true, deletedAt: true } },
      relatedWorkItem: { select: { id: true, title: true } },
    },
  })
  if (!root) throw new ORPCError('NOT_FOUND', { message: 'Conversation not found' })
  const other = root.fromVolunteerId === viewerId ? root.to : root.from
  return { root, other }
}

export const messagesRouter = {
  /** My conversations, most recent first, each with its latest message and unread count. */
  threads: authedProcedure.handler(async ({ context }) => {
    const me = context.volunteer.id
    const rows = await prisma.message.findMany({
      where: { OR: [{ fromVolunteerId: me }, { toVolunteerId: me }] },
      include: {
        from: { select: { id: true, name: true } },
        to: { select: { id: true, name: true } },
        relatedWorkItem: { select: { id: true, title: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const threads = new Map<
      number,
      {
        id: number
        subject: string
        with: { id: number; name: string }
        last: { body: string; fromMe: boolean; createdAt: Date | null }
        unread: number
        relatedProject: { id: number; title: string } | null
      }
    >()
    for (const m of rows) {
      const id = m.threadId ?? m.id
      let thread = threads.get(id)
      if (!thread) {
        const other = m.fromVolunteerId === me ? m.to : m.from
        thread = {
          id,
          subject: m.subject,
          with: other,
          last: { body: m.message, fromMe: m.fromVolunteerId === me, createdAt: m.createdAt },
          unread: 0,
          relatedProject: m.relatedWorkItem,
        }
        threads.set(id, thread)
      }
      if (m.toVolunteerId === me && m.readAt === null) thread.unread++
    }
    return [...threads.values()]
  }),

  /** One conversation, oldest first; opening it reads it. */
  thread: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const me = context.volunteer.id
      const { root, other } = await loadThread(input.id, me)
      const messages = await prisma.message.findMany({
        where: { OR: [{ id: root.id }, { threadId: root.id }] },
        include: { from: { select: { name: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      const now = new Date()
      await prisma.message.updateMany({
        where: { OR: [{ id: root.id }, { threadId: root.id }], toVolunteerId: me, readAt: null },
        data: { readAt: now },
      })
      await prisma.notification.updateMany({
        where: { volunteerId: me, type: 'message_received', entityId: root.id, readAt: null },
        data: { readAt: now },
      })
      return {
        id: root.id,
        subject: root.subject,
        with: { id: other.id, name: other.name },
        relatedProject: root.relatedWorkItem,
        canReply: other.deletedAt === null,
        messages: messages.map((m) => ({
          id: m.id,
          fromMe: m.fromVolunteerId === me,
          fromName: m.from.name,
          body: m.message,
          createdAt: m.createdAt,
        })),
      }
    }),

  reply: approvedProcedure
    .input(
      z.object({
        threadId: z.number().int(),
        message: z.string().trim().min(1, 'Message is required'),
        shareEmail: z.boolean().optional().default(false),
      }),
    )
    .handler(async ({ input, context }) => {
      limitSends(context)
      const sender = context.volunteer
      const { root, other } = await loadThread(input.threadId, sender.id)
      if (other.deletedAt) {
        throw new ORPCError('BAD_REQUEST', { message: 'This volunteer has left Catalyse' })
      }
      await deliver(sender, other, {
        subject: root.subject,
        body: input.message,
        threadId: root.id,
        relatedProjectId: root.relatedWorkItemId,
        projectTitle: root.relatedWorkItem?.title ?? null,
        shareEmail: input.shareEmail,
      })
      return { message: 'Reply sent' }
    }),

  send: approvedProcedure.input(ContactSchema).handler(async ({ input, context }) => {
    limitSends(context)
    const sender = context.volunteer
    if (sender.id === input.recipientId) {
      throw new ORPCError('BAD_REQUEST', { message: 'Cannot message yourself' })
    }

    const recipient = await prisma.volunteer.findFirst({
      where: { id: input.recipientId, deletedAt: null },
      select: { id: true, name: true, email: true },
    })
    if (!recipient) throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
    if (!(await canReach(sender, recipient.id))) {
      throw new ORPCError('FORBIDDEN', {
        message: 'You can message people you work with. Send them a contact request first.',
      })
    }

    let projectTitle: string | null = null
    if (input.relatedProjectId) {
      const project = await prisma.workItem.findFirst({
        where: {
          id: input.relatedProjectId,
          type: WorkItemType.PROJECT,
          AND: [projectScopeWhere(sender)],
        },
        select: { title: true },
      })
      // The id is written as a foreign key below, so an unknown one must be refused here
      // rather than surfacing as a constraint violation. The title goes to the recipient and
      // back to the sender in the thread, so only a project the sender may see qualifies.
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      projectTitle = project.title
    }

    const { threadId } = await deliver(sender, recipient, {
      subject: input.subject,
      body: input.message,
      threadId: null,
      relatedProjectId: input.relatedProjectId ?? null,
      projectTitle,
      shareEmail: input.shareEmail,
    })
    return { message: 'Message sent', threadId }
  }),
}
