import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { redactVolunteer } from '@/lib/auth'
import { authedProcedure } from '../procedures'
import { WorkItemType } from '@/generated/prisma/enums'

export const privacyRouter = {
  export: authedProcedure.handler(async ({ context }) => {
    const [profile, interests, messagesSent, messagesReceived, projects] = await Promise.all([
      prisma.volunteer.findUnique({
        where: { id: context.volunteer.id },
        include: {
          group: { select: { name: true } },
          skills: { include: { skill: { include: { category: true } } } },
        },
      }),
      prisma.workItemInterest.findMany({ where: { volunteerId: context.volunteer.id } }),
      prisma.message.findMany({ where: { fromVolunteerId: context.volunteer.id } }),
      prisma.message.findMany({ where: { toVolunteerId: context.volunteer.id } }),
      prisma.workItem.findMany({
        where: {
          type: WorkItemType.PROJECT,
          OR: [{ assigneeId: context.volunteer.id }, { creatorId: context.volunteer.id }],
        },
      }),
    ])

    if (!profile) throw new ORPCError('NOT_FOUND')

    const skillsData = profile.skills.map((vs) => ({
      id: vs.skill.id,
      categoryId: vs.skill.categoryId,
      name: vs.skill.name,
      description: vs.skill.description,
      sortOrder: vs.skill.sortOrder,
      createdAt: vs.skill.createdAt,
      categoryName: vs.skill.category.name,
      proficiencyLevel: vs.proficiencyLevel,
    }))

    const serializedProfile = redactVolunteer(profile, {
      showContact: true,
      skills: skillsData,
    })

    return {
      exportedAt: new Date().toISOString(),
      profile: serializedProfile,
      skills: skillsData,
      projects: projects.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        status: p.status,
        ownerId: p.assigneeId,
        proposedById: p.creatorId,
        outcome: p.outcome,
        outcomeNotes: p.outcomeNotes,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      interests: interests.map((i) => ({
        id: i.id,
        projectId: i.workItemId,
        interestType: i.interestType,
        message: i.message,
        status: i.status,
        createdAt: i.createdAt,
        respondedAt: i.respondedAt,
      })),
      messagesSent: messagesSent.map((m) => ({
        id: m.id,
        toVolunteerId: m.toVolunteerId,
        subject: m.subject,
        message: m.message,
        relatedProjectId: m.relatedWorkItemId,
        createdAt: m.createdAt,
      })),
      messagesReceived: messagesReceived.map((m) => ({
        id: m.id,
        fromVolunteerId: m.fromVolunteerId,
        subject: m.subject,
        message: m.message,
        relatedProjectId: m.relatedWorkItemId,
        readAt: m.readAt,
        createdAt: m.createdAt,
      })),
    }
  }),
}
