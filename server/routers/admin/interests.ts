import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { staffProcedure } from '../../procedures'
import { chapterFilter } from '@/lib/chapter-access-server'
import { InterestStatus, WorkItemType } from '@/generated/prisma/enums'

export const adminInterestsRouter = {
  list: staffProcedure
    .input(
      z.object({
        status: z.nativeEnum(InterestStatus).optional(),
        chapter: z.union([z.number().int(), z.literal('pool')]).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const interests = await prisma.workItemInterest.findMany({
        // A project's applications and members; a task's helpers are the task's business.
        where: {
          workItem: {
            type: WorkItemType.PROJECT,
            nationalChapterId: chapterFilter(context.access, input.chapter),
          },
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          workItem: {
            select: {
              title: true,
              status: true,
              assignee: { select: { name: true } },
            },
          },
          volunteer: {
            select: {
              name: true,
              email: true,
              skills: {
                include: { skill: { include: { category: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      return interests.map((i) => ({
        id: i.id,
        volunteerId: i.volunteerId,
        projectId: i.workItemId,
        interestType: i.interestType,
        message: i.message,
        status: i.status,
        responseMessage: i.responseMessage,
        createdAt: i.createdAt,
        respondedAt: i.respondedAt,
        projectTitle: i.workItem.title,
        projectStatus: i.workItem.status,
        volunteerName: i.volunteer.name,
        volunteerEmail: i.volunteer.email,
        ownerName: i.workItem.assignee?.name ?? null,
        volunteerSkills: i.volunteer.skills.map((vs) => ({
          id: vs.skill.id,
          categoryId: vs.skill.categoryId,
          name: vs.skill.name,
          description: vs.skill.description,
          sortOrder: vs.skill.sortOrder,
          createdAt: vs.skill.createdAt,
          categoryName: vs.skill.category.name,
          proficiencyLevel: vs.proficiencyLevel,
        })),
      }))
    }),
}
