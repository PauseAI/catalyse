import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { canAdminChapter } from '@/lib/chapter-access'
import { chapterFilter } from '@/lib/chapter-access-server'
import { assertKnownCountry } from '@/lib/chapter-placement'
import { audit, moveToChapter } from '@/lib/chapter-roles'
import { countryName } from '@/lib/countries'
import { clearNotifications, notifyChapterStaff, notifyUser } from '@/lib/notify'
import { ChapterAuditAction, ChapterTransferStatus } from '@/generated/prisma/enums'
import { authedProcedure, staffProcedure } from '../procedures'

/**
 * A member moving country asks to move chapter. The chapter they are moving to decides (its
 * staff, or the global admins when it has none); on approval they leave their old chapter's
 * staff role and local group but keep the projects and teams they are on.
 */
export const chapterTransfersRouter = {
  /** The caller's own request still waiting, if any. */
  mine: authedProcedure.handler(({ context }) =>
    prisma.chapterTransferRequest.findFirst({
      where: { volunteerId: context.volunteer.id, status: ChapterTransferStatus.pending },
      select: { id: true, toCountry: true, reason: true, createdAt: true },
    }),
  ),

  request: authedProcedure
    .input(
      z.object({
        country: z.string(),
        reason: z.string().trim().max(1000).optional().nullable(),
      }),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      assertKnownCountry(input.country)
      if (input.country === volunteer.country) {
        throw new ORPCError('BAD_REQUEST', { message: 'That is already your country' })
      }
      const waiting = await prisma.chapterTransferRequest.findFirst({
        where: { volunteerId: volunteer.id, status: ChapterTransferStatus.pending },
      })
      if (waiting) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'You already asked to move; cancel that first',
        })
      }
      const to = await prisma.nationalChapter.findUnique({ where: { country: input.country } })
      const request = await prisma.chapterTransferRequest.create({
        data: {
          volunteerId: volunteer.id,
          fromChapterId: volunteer.nationalChapterId,
          toChapterId: to?.id ?? null,
          toCountry: input.country,
          reason: input.reason || null,
        },
      })
      await notifyChapterStaff(
        request.toChapterId,
        'chapter_transfer_request',
        `${volunteer.name} asks to move to ${countryName(input.country)}`,
        input.reason || null,
        '/admin/transfers',
        undefined,
        request.id,
      )
      return { message: 'Request sent' }
    }),

  cancel: authedProcedure.handler(async ({ context }) => {
    const { count } = await prisma.chapterTransferRequest.updateMany({
      where: { volunteerId: context.volunteer.id, status: ChapterTransferStatus.pending },
      data: { status: ChapterTransferStatus.cancelled },
    })
    if (!count) throw new ORPCError('NOT_FOUND', { message: 'No request to cancel' })
    return { message: 'Request cancelled' }
  }),

  /** Requests to move into the caller's chapter; a global admin sees every chapter's. */
  list: staffProcedure
    .input(
      z
        .object({
          status: z.nativeEnum(ChapterTransferStatus).optional(),
          chapter: z.union([z.number().int(), z.literal('pool')]).optional(),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const requests = await prisma.chapterTransferRequest.findMany({
        where: {
          status: input?.status ?? ChapterTransferStatus.pending,
          toChapterId: chapterFilter(context.access, input?.chapter),
        },
        include: {
          volunteer: { select: { id: true, name: true, country: true } },
          fromChapter: { select: { name: true } },
          toChapter: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
      return requests.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        toCountry: r.toCountry,
        createdAt: r.createdAt,
        volunteer: r.volunteer,
        fromChapterName: r.fromChapter?.name ?? null,
        toChapterName: r.toChapter?.name ?? null,
      }))
    }),

  decide: staffProcedure
    .input(
      z.object({
        id: z.number().int(),
        approve: z.boolean(),
        note: z.string().trim().max(1000).optional().nullable(),
      }),
    )
    .handler(async ({ input, context }) => {
      const request = await prisma.chapterTransferRequest.findUnique({ where: { id: input.id } })
      if (!request || !canAdminChapter(context.access, request.toChapterId)) {
        throw new ORPCError('NOT_FOUND', { message: 'Request not found' })
      }
      if (request.status !== ChapterTransferStatus.pending) {
        throw new ORPCError('BAD_REQUEST', { message: 'This request has already been answered' })
      }
      const actorId = context.volunteer.id
      const decided = {
        status: input.approve ? ChapterTransferStatus.approved : ChapterTransferStatus.declined,
        decidedById: actorId,
        decidedAt: new Date(),
        decisionNote: input.note || null,
      }
      await prisma.$transaction(async (tx) => {
        await tx.chapterTransferRequest.update({ where: { id: request.id }, data: decided })
        if (input.approve) {
          await moveToChapter(
            tx,
            request.volunteerId,
            request.toChapterId,
            actorId,
            ChapterAuditAction.TRANSFER_APPROVED,
          )
          // The holding pool has no country of its own, so the one they named is kept.
          await tx.volunteer.update({
            where: { id: request.volunteerId },
            data: { country: request.toCountry, locationConfirmedAt: new Date() },
          })
        } else {
          await audit(tx, ChapterAuditAction.TRANSFER_DECLINED, {
            actorId,
            chapterId: request.toChapterId,
            targetVolunteerId: request.volunteerId,
          })
        }
      })
      await clearNotifications('chapter_transfer_request', request.id)
      const where = countryName(request.toCountry)
      await notifyUser(
        request.volunteerId,
        'chapter_transfer_decided',
        input.approve ? `Moved: you're now in ${where}` : `Declined: your move to ${where}`,
        input.note || null,
        '/settings',
      )
      return { message: input.approve ? 'Moved' : 'Declined' }
    }),
}
