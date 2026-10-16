import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { redactVolunteer } from '@/lib/auth'
import { staffProcedure } from '../../procedures'
import { canAdminChapter, type ChapterAccess } from '@/lib/chapter-access'
import { WorkItemType } from '@/generated/prisma/enums'

const MAX_DETAIL_ROWS = 100

const EndorsementInputSchema = z.object({
  skillId: z.number().int({ message: 'skillId is required' }),
  // Mirrors the SkillEndorsementRating / SkillEndorsementSource enums; anything else fails at the database.
  rating: z.enum(['verified', 'strong', 'developing']).optional().default('verified'),
  source: z
    .enum(['project_outcome', 'quick_task', 'direct_observation'])
    .optional()
    .default('direct_observation'),
  sourceId: z.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
})

/** Throws unless the volunteer is in a chapter the caller runs. */
async function assertRunsVolunteer(access: ChapterAccess, volunteerId: number) {
  const target = await prisma.volunteer.findUnique({
    where: { id: volunteerId },
    select: { nationalChapterId: true },
  })
  if (!target || !canAdminChapter(access, target.nationalChapterId)) {
    throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
  }
}

/** A volunteer as their chapter's staff, or a global admin, see them. */
export const adminVolunteersRouter = {
  getById: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const vol = await prisma.volunteer.findUnique({
        where: { id: input.id },
        include: {
          group: { select: { name: true } },
          skills: {
            include: { skill: { include: { category: true } } },
            orderBy: [
              { skill: { category: { sortOrder: 'asc' } } },
              { skill: { sortOrder: 'asc' } },
            ],
          },
          skillEndorsementsReceived: {
            include: { skill: true },
          },
        },
      })

      if (!vol || !canAdminChapter(context.access, vol.nationalChapterId)) {
        throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
      }

      const [adminNotes, endorsements, quickTasks, projectHistory] = await Promise.all([
        prisma.adminNote.findMany({
          where: { volunteerId: input.id },
          include: { author: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: MAX_DETAIL_ROWS,
        }),
        prisma.skillEndorsement.findMany({
          where: { volunteerId: input.id },
          include: {
            skill: { include: { category: true } },
            endorsedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_DETAIL_ROWS,
        }),
        prisma.workItem.findMany({
          where: { type: WorkItemType.QUICK_TASK, assigneeId: input.id },
          include: { skill: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: MAX_DETAIL_ROWS,
        }),
        prisma.workItem.findMany({
          where: {
            type: WorkItemType.PROJECT,
            OR: [{ assigneeId: input.id }, { creatorId: input.id }],
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_DETAIL_ROWS,
        }),
      ])

      const skills = vol.skills.map((vs) => ({
        id: vs.skill.id,
        categoryId: vs.skill.categoryId,
        name: vs.skill.name,
        description: vs.skill.description,
        sortOrder: vs.skill.sortOrder,
        createdAt: vs.skill.createdAt,
        categoryName: vs.skill.category.name,
        proficiencyLevel: vs.proficiencyLevel,
      }))
      const publicEndorsements = vol.skillEndorsementsReceived.map((se) => ({
        skillId: se.skillId,
        rating: se.rating,
        skillName: se.skill.name,
      }))

      return {
        ...redactVolunteer(vol, {
          showContact: true,
          skills,
          endorsements: publicEndorsements,
        }),
        adminNotes: adminNotes.map((n) => ({
          id: n.id,
          volunteerId: n.volunteerId,
          authorId: n.authorId,
          content: n.content,
          category: n.category,
          relatedProjectId: n.relatedWorkItemId,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          authorName: n.author.name,
        })),
        endorsements: endorsements.map((e) => ({
          id: e.id,
          volunteerId: e.volunteerId,
          skillId: e.skillId,
          endorsedById: e.endorsedById,
          source: e.source,
          sourceId: e.sourceId,
          rating: e.rating,
          notes: e.notes,
          createdAt: e.createdAt,
          skillName: e.skill.name,
          skillCategory: e.skill.category.name,
          endorsedByName: e.endorsedBy.name,
        })),
        quickTasks: quickTasks.map((t) => ({
          id: t.id,
          projectId: t.contextProjectId,
          title: t.title,
          description: t.description,
          skillId: t.skillId,
          assignedToId: t.assigneeId,
          assignedById: t.creatorId,
          status: t.status,
          reviewRating: t.reviewRating,
          reviewNotes: t.reviewNotes,
          reviewedById: t.reviewedById,
          reviewedAt: t.reviewedAt,
          estimatedHours: t.estimatedHours,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          skillName: t.skill?.name ?? null,
        })),
        projectHistory: projectHistory.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          status: p.status,
          ownerId: p.assigneeId,
          proposedById: p.creatorId,
          outcome: p.outcome,
          outcomeNotes: p.outcomeNotes,
          completedAt: p.completedAt,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      }
    }),

  listEndorsements: staffProcedure
    .input(z.object({ volunteerId: z.number().int() }))
    .handler(async ({ input, context }) => {
      await assertRunsVolunteer(context.access, input.volunteerId)
      const endorsements = await prisma.skillEndorsement.findMany({
        where: { volunteerId: input.volunteerId },
        include: {
          skill: { include: { category: true } },
          endorsedBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_DETAIL_ROWS,
      })
      return endorsements.map((e) => ({
        id: e.id,
        volunteerId: e.volunteerId,
        skillId: e.skillId,
        endorsedById: e.endorsedById,
        source: e.source,
        sourceId: e.sourceId,
        rating: e.rating,
        notes: e.notes,
        createdAt: e.createdAt,
        skillName: e.skill.name,
        skillCategory: e.skill.category.name,
        endorsedByName: e.endorsedBy.name,
      }))
    }),

  addEndorsement: staffProcedure
    .input(z.object({ volunteerId: z.number().int() }).merge(EndorsementInputSchema))
    .handler(async ({ input, context }) => {
      await assertRunsVolunteer(context.access, input.volunteerId)
      const { skillId, rating, source, sourceId, notes } = input
      await prisma.skillEndorsement.upsert({
        where: {
          volunteerId_skillId_endorsedById: {
            volunteerId: input.volunteerId,
            skillId,
            endorsedById: context.volunteer.id,
          },
        },
        update: { rating, source, sourceId: sourceId ?? null, notes: notes ?? null },
        create: {
          volunteerId: input.volunteerId,
          skillId,
          endorsedById: context.volunteer.id,
          rating,
          source,
          sourceId: sourceId ?? null,
          notes: notes ?? null,
        },
      })
      return { message: 'Skill endorsed' }
    }),
}
