import { prisma } from '@/lib/prisma'
import { loadTaskStatusViews, serializeSubmissionAsk } from '@/lib/work-item'
import { authedProcedure } from '../procedures'
import { TaskStatus, WorkItemType } from '@/generated/prisma/enums'

export const myRouter = {
  /** Project tasks the volunteer has claimed and not handed in, started or not. */
  projectTasks: authedProcedure.handler(async ({ context }) => {
    const tasks = await prisma.workItem.findMany({
      where: {
        type: WorkItemType.TASK,
        status: { in: [TaskStatus.not_started, TaskStatus.in_progress] },
        assigneeId: context.volunteer.id,
      },
      include: { parent: { select: { title: true } } },
      orderBy: { updatedAt: 'asc' },
    })
    const views = await loadTaskStatusViews(tasks)

    return tasks.map((t, i) => ({
      id: t.id,
      projectId: t.parentId,
      title: t.title,
      projectTitle: t.parent?.title ?? null,
      status: t.status,
      ...views[i],
      updatedAt: t.updatedAt,
    }))
  }),

  quickTasks: authedProcedure.handler(async ({ context }) => {
    const tasks = await prisma.workItem.findMany({
      where: { type: WorkItemType.QUICK_TASK, assigneeId: context.volunteer.id },
      include: {
        skill: true,
        contextProject: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return tasks.map((t) => ({
      id: t.id,
      projectId: t.contextProjectId,
      title: t.title,
      description: t.description,
      skillId: t.skillId,
      skillName: t.skill?.name ?? null,
      projectTitle: t.contextProject?.title ?? null,
      assignedToId: t.assigneeId,
      assignedById: t.creatorId,
      status: t.status,
      reviewRating: t.reviewRating,
      reviewNotes: t.reviewNotes,
      reviewedById: t.reviewedById,
      reviewedAt: t.reviewedAt,
      changesRequested: t.changesRequestedNote,
      ...serializeSubmissionAsk(t),
      estimatedHours: t.estimatedHours,
      deadline: t.deadline,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))
  }),
}
