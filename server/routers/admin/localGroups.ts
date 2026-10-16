import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { sendLocalGroupSuggestionEmail } from '@/lib/email'
import { canAdminChapter, type ChapterAccess } from '@/lib/chapter-access'
import { chapterFilter } from '@/lib/chapter-access-server'
import { createNotification, clearNotifications } from '@/lib/notify'
import { LocalGroupBodySchema, ReviewSuggestionSchema } from '@/lib/schemas'
import { staffProcedure } from '../../procedures'
import { LocalGroupSuggestionStatus, ProjectReach } from '@/generated/prisma/enums'

/**
 * The chapter for `country`, which the caller must run. A local group belongs to a chapter, and
 * a chapter to exactly one country, so the country names it.
 */
async function chapterForCountry(access: ChapterAccess, country: string) {
  const chapter = await prisma.nationalChapter.findUnique({ where: { country } })
  if (!chapter) {
    throw new ORPCError('BAD_REQUEST', { message: 'That country has no chapter yet' })
  }
  if (!canAdminChapter(access, chapter.id)) {
    throw new ORPCError('FORBIDDEN', { message: "Local groups are run by their country's chapter" })
  }
  return chapter
}

/** A group in a chapter the caller runs; any other is not found. */
async function groupRunBy(access: ChapterAccess, id: number) {
  const group = await prisma.localGroup.findUnique({ where: { id } })
  if (!group || !canAdminChapter(access, group.nationalChapterId)) {
    throw new ORPCError('NOT_FOUND', { message: 'Not found' })
  }
  return group
}

async function suggestionRunBy(access: ChapterAccess, id: number) {
  const suggestion = await prisma.localGroupSuggestion.findUnique({
    where: { id },
    include: { suggestedBy: { select: { id: true, name: true, email: true } } },
  })
  if (!suggestion || !canAdminChapter(access, suggestion.nationalChapterId)) {
    throw new ORPCError('NOT_FOUND', { message: 'Not found' })
  }
  return suggestion
}

async function assertNameFree(chapterId: number, name: string) {
  if (await prisma.localGroup.findFirst({ where: { nationalChapterId: chapterId, name } })) {
    throw new ORPCError('BAD_REQUEST', { message: 'This chapter already has a group of that name' })
  }
}

const NOTIFICATION_TITLES: Record<string, (name: string) => string> = {
  accepted: (n) => `Approved: your local group suggestion "${n}"`,
  merge: (n) => `Merged: your local group suggestion "${n}"`,
  on_hold: (n) => `Under review: your local group suggestion "${n}"`,
  declined: (n) => `Declined: your local group suggestion "${n}"`,
}

export const adminLocalGroupsRouter = {
  list: staffProcedure.handler(async ({ context }) => {
    const groups = await prisma.localGroup.findMany({
      where: { nationalChapterId: chapterFilter(context.access) },
      orderBy: [{ country: 'asc' }, { name: 'asc' }],
    })
    return { groups }
  }),

  create: staffProcedure.input(LocalGroupBodySchema).handler(async ({ input, context }) => {
    const chapter = await chapterForCountry(context.access, input.country)
    await assertNameFree(chapter.id, input.name)
    const group = await prisma.localGroup.create({
      data: { name: input.name, country: chapter.country, nationalChapterId: chapter.id },
    })
    return { id: group.id, name: group.name, country: group.country }
  }),

  update: staffProcedure
    .input(z.object({ id: z.number().int() }).merge(LocalGroupBodySchema))
    .handler(async ({ input, context }) => {
      const existing = await groupRunBy(context.access, input.id)
      const chapter = await chapterForCountry(context.access, input.country)
      if (chapter.id !== existing.nationalChapterId || input.name !== existing.name) {
        await assertNameFree(chapter.id, input.name)
      }
      const group = await prisma.$transaction(async (tx) => {
        // A group moved to another chapter leaves the members and projects of the old one.
        if (chapter.id !== existing.nationalChapterId) {
          await tx.volunteer.updateMany({
            where: { localGroupId: existing.id },
            data: { localGroupId: null },
          })
          await tx.workItem.updateMany({
            where: { localGroupId: existing.id },
            data: { localGroupId: null, reach: ProjectReach.COUNTRY_WIDE },
          })
        }
        return tx.localGroup.update({
          where: { id: input.id },
          data: { name: input.name, country: chapter.country, nationalChapterId: chapter.id },
        })
      })
      return { id: group.id, name: group.name, country: group.country }
    }),

  /** Its members keep their chapter; its local projects become country-wide. */
  delete: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const existing = await groupRunBy(context.access, input.id)
      await prisma.$transaction([
        prisma.localGroupSuggestion.updateMany({
          where: { mergedIntoId: input.id },
          data: { mergedIntoId: null },
        }),
        prisma.workItem.updateMany({
          where: { localGroupId: existing.id },
          data: { reach: ProjectReach.COUNTRY_WIDE },
        }),
        prisma.localGroup.delete({ where: { id: input.id } }),
      ])
      return { message: 'Group deleted' }
    }),

  listSuggestions: staffProcedure
    .input(
      z.object({
        status: z.enum(['pending', 'on_hold', 'accepted', 'declined'] as const).default('pending'),
      }),
    )
    .handler(async ({ input, context }) => {
      const suggestions = await prisma.localGroupSuggestion.findMany({
        where: { status: input.status, nationalChapterId: chapterFilter(context.access) },
        orderBy: { createdAt: 'asc' },
        include: {
          suggestedBy: { select: { id: true, name: true, email: true } },
          mergedInto: { select: { id: true, name: true } },
        },
      })

      return {
        suggestions: suggestions.map((s) => ({
          id: s.id,
          name: s.name,
          country: s.country,
          status: s.status,
          adminNotes: s.adminNotes,
          createdAt: s.createdAt,
          suggestedBy: {
            id: s.suggestedBy.id,
            name: s.suggestedBy.name,
            email: s.suggestedBy.email,
          },
          mergedInto: s.mergedInto ? { id: s.mergedInto.id, name: s.mergedInto.name } : null,
        })),
      }
    }),

  reviewSuggestion: staffProcedure
    .input(z.object({ id: z.number().int() }).merge(ReviewSuggestionSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const suggestion = await suggestionRunBy(context.access, input.id)

      const body = input
      const action = body.action
      const adminNotes = typeof body.adminNotes === 'string' ? body.adminNotes.trim() || null : null
      const now = new Date()
      const reviewBase = { reviewedById: admin.id, reviewedAt: now, updatedAt: now }

      let finalName = suggestion.name
      let notificationAction: string = action
      let targetGroupId: number | null = null

      if (action === 'accept') {
        const name = body.name?.trim() || suggestion.name
        const country = body.country?.trim() || suggestion.country
        if (!name || !country) {
          throw new ORPCError('BAD_REQUEST', { message: 'Name and country required' })
        }
        finalName = name
        const chapter = await chapterForCountry(context.access, country)
        await assertNameFree(chapter.id, name)
        const [createdGroup] = await prisma.$transaction([
          prisma.localGroup.create({ data: { name, country, nationalChapterId: chapter.id } }),
          prisma.localGroupSuggestion.update({
            where: { id: input.id },
            data: {
              ...reviewBase,
              status: LocalGroupSuggestionStatus.accepted,
              name,
              country,
              adminNotes,
            },
          }),
        ])
        targetGroupId = createdGroup.id
        notificationAction = LocalGroupSuggestionStatus.accepted
      } else if (action === 'merge') {
        const mergedIntoId = body.mergedIntoId ?? null
        if (!mergedIntoId) {
          throw new ORPCError('BAD_REQUEST', { message: 'mergedIntoId required for merge' })
        }
        const target = await prisma.localGroup.findUnique({ where: { id: mergedIntoId } })
        if (!target || !canAdminChapter(context.access, target.nationalChapterId)) {
          throw new ORPCError('NOT_FOUND', { message: 'Target local group not found' })
        }

        await prisma.localGroupSuggestion.update({
          where: { id: input.id },
          data: {
            ...reviewBase,
            status: LocalGroupSuggestionStatus.accepted,
            mergedIntoId,
            adminNotes,
          },
        })
        targetGroupId = mergedIntoId
        notificationAction = 'merge'
      } else if (action === 'on_hold') {
        await prisma.localGroupSuggestion.update({
          where: { id: input.id },
          data: { ...reviewBase, status: LocalGroupSuggestionStatus.on_hold, adminNotes },
        })
      } else if (action === 'decline') {
        await prisma.localGroupSuggestion.update({
          where: { id: input.id },
          data: { ...reviewBase, status: LocalGroupSuggestionStatus.declined, adminNotes },
        })
        notificationAction = LocalGroupSuggestionStatus.declined
      }

      const titleFn = NOTIFICATION_TITLES[notificationAction]
      const title = titleFn ? titleFn(finalName) : `Update on your local group suggestion`

      const notificationLink = targetGroupId
        ? `/local-groups/${targetGroupId}`
        : '/suggest-local-group'

      await createNotification(
        suggestion.suggestedBy.id,
        'local_group_suggestion_reviewed',
        title,
        adminNotes,
        notificationLink,
      )

      await sendLocalGroupSuggestionEmail({
        to: suggestion.suggestedBy.email ?? '',
        name: suggestion.suggestedBy.name ?? 'there',
        action: notificationAction,
        groupName: finalName,
        adminNotes,
      })

      await clearNotifications('local_group_suggestion', input.id)

      return { message: 'Suggestion updated' }
    }),

  deleteSuggestion: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await suggestionRunBy(context.access, input.id)
      await prisma.localGroupSuggestion.delete({ where: { id: input.id } })
      return { message: 'Suggestion deleted' }
    }),
}
