import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { createNotification, clearNotifications } from '@/lib/notify'
import { TeamBodySchema, ReviewTeamSuggestionSchema } from '@/lib/schemas'
import { adminProcedure, staffProcedure } from '../../procedures'
import { canAdminChapter, type ChapterAccess } from '@/lib/chapter-access'
import { chapterFilter } from '@/lib/chapter-access-server'
import { audit } from '@/lib/chapter-roles'
import {
  ChapterAuditAction,
  TeamSuggestionStatus,
  TeamMembershipRole,
} from '@/generated/prisma/enums'

const NOTIFICATION_TITLES: Record<string, (name: string) => string> = {
  accepted: (n) => `Approved: your team suggestion "${n}"`,
  merge: (n) => `Merged: your team suggestion "${n}"`,
  on_hold: (n) => `Under review: your team suggestion "${n}"`,
  declined: (n) => `Declined: your team suggestion "${n}"`,
}

async function teamRunBy(access: ChapterAccess, id: number) {
  const team = await prisma.team.findUnique({ where: { id } })
  if (!team || !canAdminChapter(access, team.nationalChapterId)) {
    throw new ORPCError('NOT_FOUND', { message: 'Not found' })
  }
  return team
}

async function suggestionRunBy(access: ChapterAccess, id: number) {
  const suggestion = await prisma.teamSuggestion.findUnique({
    where: { id },
    include: { suggestedBy: { select: { id: true, name: true, email: true } } },
  })
  if (!suggestion || !canAdminChapter(access, suggestion.nationalChapterId)) {
    throw new ORPCError('NOT_FOUND', { message: 'Not found' })
  }
  return suggestion
}

/** A chapter's teams, run by its staff and the global admins. */
export const adminTeamsRouter = {
  list: staffProcedure.handler(async ({ context }) => {
    const teams = await prisma.team.findMany({
      where: { nationalChapterId: chapterFilter(context.access) },
      orderBy: { name: 'asc' },
      include: {
        members: { include: { volunteer: { select: { id: true, name: true, email: true } } } },
      },
    })
    return {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        lumaUrl: t.lumaUrl,
        docUrl: t.docUrl,
        nationalChapterId: t.nationalChapterId,
        members: t.members.map((m) => ({
          id: m.volunteer.id,
          name: m.volunteer.name,
          email: m.volunteer.email,
          role: m.role,
        })),
      })),
    }
  }),

  /** In the creator's chapter. */
  create: staffProcedure.input(TeamBodySchema).handler(async ({ input, context }) => {
    const team = await prisma.team.create({
      data: {
        nationalChapterId: context.access.chapterId,
        name: input.name,
        description: input.description ?? null,
        lumaUrl: input.lumaUrl ?? null,
        docUrl: input.docUrl ?? null,
      },
    })
    return { id: team.id, name: team.name }
  }),

  /** Moves a team to another chapter, or the pool; its members stay in it, wherever they are. */
  setChapter: adminProcedure
    .input(z.object({ id: z.number().int(), chapterId: z.number().int().nullable() }))
    .handler(async ({ input, context }) => {
      const team = await prisma.team.findUnique({ where: { id: input.id } })
      if (!team) throw new ORPCError('NOT_FOUND', { message: 'Not found' })
      if (input.chapterId !== null) {
        const chapter = await prisma.nationalChapter.findUnique({ where: { id: input.chapterId } })
        if (!chapter) throw new ORPCError('NOT_FOUND', { message: 'Chapter not found' })
      }
      await prisma.$transaction(async (tx) => {
        await tx.team.update({
          where: { id: team.id },
          data: { nationalChapterId: input.chapterId },
        })
        await audit(tx, ChapterAuditAction.TEAM_CHAPTER_CHANGED, {
          actorId: context.volunteer.id,
          chapterId: input.chapterId,
          details: { teamId: team.id, fromChapterId: team.nationalChapterId },
        })
      })
      return { message: `${team.name} moved` }
    }),

  delete: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await teamRunBy(context.access, input.id)

      await prisma.$transaction([
        prisma.teamSuggestion.updateMany({
          where: { mergedIntoId: input.id },
          data: { mergedIntoId: null },
        }),
        prisma.team.delete({ where: { id: input.id } }),
      ])

      return { message: 'Team deleted' }
    }),

  listSuggestions: staffProcedure
    .input(
      z.object({
        status: z.enum(['pending', 'on_hold', 'accepted', 'declined'] as const).default('pending'),
      }),
    )
    .handler(async ({ input, context }) => {
      const suggestions = await prisma.teamSuggestion.findMany({
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
          description: s.description,
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
    .input(z.object({ id: z.number().int() }).merge(ReviewTeamSuggestionSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const suggestion = await suggestionRunBy(context.access, input.id)

      const action = input.action
      const adminNotes =
        typeof input.adminNotes === 'string' ? input.adminNotes.trim() || null : null
      const now = new Date()
      const reviewBase = { reviewedById: admin.id, reviewedAt: now, updatedAt: now }

      let finalName = suggestion.name
      let notificationAction: string = action
      let targetTeamId: number | null = null

      if (action === 'accept') {
        const name = input.name?.trim() || suggestion.name
        const description = input.description?.trim() || suggestion.description
        if (!name) throw new ORPCError('BAD_REQUEST', { message: 'Name required' })

        const leaderId = input.leaderId ?? suggestion.suggestedBy.id
        const leader = await prisma.volunteer.findUnique({ where: { id: leaderId } })
        if (!leader) throw new ORPCError('BAD_REQUEST', { message: 'Leader not found' })

        finalName = name
        const [createdTeam] = await prisma.$transaction([
          prisma.team.create({
            data: {
              name,
              description: description ?? null,
              nationalChapterId: suggestion.nationalChapterId,
            },
          }),
          prisma.teamSuggestion.update({
            where: { id: input.id },
            data: {
              ...reviewBase,
              status: TeamSuggestionStatus.accepted,
              name,
              description,
              adminNotes,
            },
          }),
        ])
        await prisma.teamMembership.create({
          data: {
            teamId: createdTeam.id,
            volunteerId: leaderId,
            role: TeamMembershipRole.leader,
          },
        })
        targetTeamId = createdTeam.id
        notificationAction = TeamSuggestionStatus.accepted
      } else if (action === 'merge') {
        const mergedIntoId = input.mergedIntoId ?? null
        if (!mergedIntoId) {
          throw new ORPCError('BAD_REQUEST', { message: 'mergedIntoId required for merge' })
        }
        const target = await prisma.team.findUnique({ where: { id: mergedIntoId } })
        if (!target || !canAdminChapter(context.access, target.nationalChapterId)) {
          throw new ORPCError('NOT_FOUND', { message: 'Target team not found' })
        }

        await prisma.$transaction([
          prisma.teamSuggestion.update({
            where: { id: input.id },
            data: {
              ...reviewBase,
              status: TeamSuggestionStatus.accepted,
              mergedIntoId,
              adminNotes,
            },
          }),
          prisma.teamMembership.upsert({
            where: {
              teamId_volunteerId: { teamId: mergedIntoId, volunteerId: suggestion.suggestedBy.id },
            },
            create: { teamId: mergedIntoId, volunteerId: suggestion.suggestedBy.id },
            update: {},
          }),
        ])
        targetTeamId = mergedIntoId
        notificationAction = 'merge'
      } else if (action === 'on_hold') {
        await prisma.teamSuggestion.update({
          where: { id: input.id },
          data: { ...reviewBase, status: TeamSuggestionStatus.on_hold, adminNotes },
        })
      } else if (action === 'decline') {
        await prisma.teamSuggestion.update({
          where: { id: input.id },
          data: { ...reviewBase, status: TeamSuggestionStatus.declined, adminNotes },
        })
        notificationAction = TeamSuggestionStatus.declined
      }

      const titleFn = NOTIFICATION_TITLES[notificationAction]
      const title = titleFn ? titleFn(finalName) : `Update on your team suggestion`
      const notificationLink = targetTeamId ? `/teams/${targetTeamId}` : '/suggest-team'

      await createNotification(
        suggestion.suggestedBy.id,
        'team_suggestion_reviewed',
        title,
        adminNotes,
        notificationLink,
      )

      await clearNotifications('team_suggestion', input.id)

      return { message: 'Suggestion updated' }
    }),

  deleteSuggestion: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await suggestionRunBy(context.access, input.id)
      await prisma.teamSuggestion.delete({ where: { id: input.id } })
      return { message: 'Suggestion deleted' }
    }),
}
