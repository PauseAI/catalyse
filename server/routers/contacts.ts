import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { notifyUser, clearNotifications } from '@/lib/notify'
import { html } from '@/lib/email'
import { canReach } from '@/lib/contact'
import { authedProcedure, confirmedProcedure } from '../procedures'
import { ContactRequestStatus } from '@/generated/prisma/enums'

/** New requests one volunteer may send in a day. */
export const CONTACT_REQUESTS_PER_DAY = 5
/** How long a declined request keeps the same pair from asking again. */
const DECLINED_COOLDOWN_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

export const contactsRouter = {
  /** Asks someone in the directory, who does not work with the sender, to connect. */
  request: confirmedProcedure
    .input(
      z.object({
        toVolunteerId: z.number().int(),
        message: z
          .string()
          .trim()
          .min(20, 'Say a little more: at least 20 characters')
          .max(1000, 'Keep it under 1000 characters'),
      }),
    )
    .handler(async ({ input, context }) => {
      const me = context.volunteer
      if (input.toVolunteerId === me.id) {
        throw new ORPCError('BAD_REQUEST', { message: 'That is you' })
      }
      const target = await prisma.volunteer.findFirst({
        where: {
          id: input.toVolunteerId,
          deletedAt: null,
          consentMakeProfileVisibleInDirectory: true,
        },
        select: { id: true, name: true },
      })
      if (!target) throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
      if (await canReach(me, target.id)) {
        throw new ORPCError('BAD_REQUEST', { message: 'You can already message them' })
      }

      const now = Date.now()
      const [open, recentlyDeclined, sentToday] = await Promise.all([
        prisma.contactRequest.findFirst({
          where: {
            status: ContactRequestStatus.pending,
            OR: [
              { fromVolunteerId: me.id, toVolunteerId: target.id },
              { fromVolunteerId: target.id, toVolunteerId: me.id },
            ],
          },
        }),
        prisma.contactRequest.findFirst({
          where: {
            fromVolunteerId: me.id,
            toVolunteerId: target.id,
            status: ContactRequestStatus.declined,
            respondedAt: { gt: new Date(now - DECLINED_COOLDOWN_DAYS * DAY) },
          },
        }),
        prisma.contactRequest.count({
          where: { fromVolunteerId: me.id, createdAt: { gt: new Date(now - DAY) } },
        }),
      ])
      if (open) {
        throw new ORPCError('BAD_REQUEST', {
          message:
            open.fromVolunteerId === me.id
              ? 'Your request is still waiting for an answer'
              : 'They have already asked to connect with you: answer it in your Inbox',
        })
      }
      if (recentlyDeclined) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'They did not accept your last request. You can ask again later.',
        })
      }
      if (sentToday >= CONTACT_REQUESTS_PER_DAY) {
        throw new ORPCError('TOO_MANY_REQUESTS', {
          message: `You can send ${CONTACT_REQUESTS_PER_DAY} contact requests a day. Try again tomorrow.`,
        })
      }

      const request = await prisma.contactRequest.create({
        data: { fromVolunteerId: me.id, toVolunteerId: target.id, message: input.message },
      })
      await notifyUser(
        target.id,
        'contact_request',
        `Contact request: ${me.name} would like to connect`,
        input.message.slice(0, 200),
        `/volunteers/${me.id}`,
        {
          subject: `${me.name} would like to connect on Catalyse`,
          message: html`<strong>${me.name}</strong>, a fellow volunteer, would like to connect with
            you. Accepting lets you both see each other's contact details and message each other.
            <div style="padding: 12px; background: #f7fafc; border-radius: 8px; margin: 16px 0;">
              <strong>Their message:</strong> ${input.message}
            </div>`,
          ctaLabel: 'Answer in your Inbox',
          ctaUrl: '/inbox',
        },
        request.id,
      )
      return { message: 'Request sent' }
    }),

  /**
   * The person asked says yes or no. Yes opens a conversation that starts with the request's
   * message, and tells the sender; no is quiet.
   */
  respond: authedProcedure
    .input(z.object({ id: z.number().int(), accept: z.boolean() }))
    .handler(async ({ input, context }) => {
      const me = context.volunteer
      const request = await prisma.contactRequest.findFirst({
        where: { id: input.id, toVolunteerId: me.id, status: ContactRequestStatus.pending },
        include: { from: { select: { id: true, name: true } } },
      })
      if (!request) throw new ORPCError('NOT_FOUND', { message: 'Request not found' })
      const now = new Date()
      await prisma.contactRequest.update({
        where: { id: request.id },
        data: {
          status: input.accept ? ContactRequestStatus.accepted : ContactRequestStatus.declined,
          respondedAt: now,
        },
      })
      await clearNotifications('contact_request', request.id)
      if (!input.accept) return { message: 'Request declined', threadId: null }

      const thread = await prisma.message.create({
        data: {
          fromVolunteerId: request.fromVolunteerId,
          toVolunteerId: me.id,
          subject: `${request.from.name} and ${me.name}`,
          message: request.message,
          readAt: now,
        },
      })
      notifyUser(
        request.fromVolunteerId,
        'contact_request_accepted',
        `Accepted: ${me.name} connected with you`,
        'You can now see each other’s contact details and message each other.',
        `/inbox/messages/${thread.id}`,
      )
      return { message: 'Connected', threadId: thread.id }
    }),
}
