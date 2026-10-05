import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { notifyUser, notifyAdmins, clearNotifications } from '@/lib/notify'
import {
  CreateQuickTaskSchema,
  AssignQuickTaskSchema,
  ReviewQuickTaskSchema,
  RequestChangesSchema,
  SubmitWorkSchema,
} from '@/lib/schemas'
import {
  CLAIM_BLOCKING_INTEREST_STATUSES,
  CLEARED_SUBMISSION,
  serializeStarterTask,
  submissionData,
} from '@/lib/work-item'
import { adminProcedure, approvedProcedure, authedProcedure } from '../procedures'
import { ApprovalStatus, QuickTaskStatus, TaskStatus, WorkItemType } from '@/generated/prisma/enums'

export const quickTasksRouter = {
  list: adminProcedure
    .input(
      z.object({
        status: z.nativeEnum(QuickTaskStatus).optional(),
        skillId: z.number().int().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const tasks = await prisma.workItem.findMany({
        where: {
          type: WorkItemType.QUICK_TASK,
          ...(input.status ? { status: input.status } : {}),
          ...(input.skillId ? { skillId: input.skillId } : {}),
        },
        include: {
          skill: { include: { category: true } },
          contextProject: { select: { title: true } },
          assignee: { select: { name: true } },
          reviewedBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      return tasks.map((t) => ({
        ...serializeStarterTask(t),
        skillName: t.skill?.name ?? null,
        skillCategory: t.skill?.category?.name ?? null,
        projectTitle: t.contextProject?.title ?? null,
        assignedToName: t.assignee?.name ?? null,
        reviewedByName: t.reviewedBy?.name ?? null,
      }))
    }),

  // Project tasks flagged featuredAsQuickTask, regardless of status/assignee — so an admin
  // checking this page can confirm a flag actually took effect and see who holds it,
  // instead of only being able to see it once claimed via `available` (open+unclaimed only).
  // Management (edit/assign/unassign) still happens on the task's own project page — these
  // aren't WorkItemType.QUICK_TASK rows, so the quick-task-specific mutations don't apply.
  featuredProjectTasks: adminProcedure.handler(async () => {
    const tasks = await prisma.workItem.findMany({
      where: { type: WorkItemType.TASK, featuredAsQuickTask: true },
      include: {
        parent: { select: { id: true, title: true } },
        assignee: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return tasks
      .filter((t) => t.parentId !== null)
      .map((t) => ({
        id: t.id,
        projectId: t.parentId as number,
        projectTitle: t.parent?.title ?? null,
        title: t.title,
        description: t.description,
        status: t.status,
        assignedToId: t.assigneeId,
        assignedToName: t.assignee?.name ?? null,
        estimatedHours: t.estimatedHours,
        createdAt: t.createdAt,
      }))
  }),

  // The open, unclaimed browse pool: real quick tasks plus project tasks a
  // project owner/admin has flagged to also surface here (featuredAsQuickTask).
  available: approvedProcedure.handler(async ({ context }) => {
    // Projects this volunteer was declined from or withdrew from — they can't claim
    // those tasks, so don't advertise them here either.
    const blockedInterests = await prisma.workItemInterest.findMany({
      where: {
        volunteerId: context.volunteer.id,
        status: { in: CLAIM_BLOCKING_INTEREST_STATUSES },
      },
      select: { workItemId: true },
    })
    const blockedProjectIds = blockedInterests.map((i) => i.workItemId)

    const [quickTasks, projectTasks] = await Promise.all([
      prisma.workItem.findMany({
        where: {
          type: WorkItemType.QUICK_TASK,
          status: QuickTaskStatus.open,
          assigneeId: null,
        },
        include: {
          skill: { include: { category: true } },
          contextProject: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.workItem.findMany({
        where: {
          type: WorkItemType.TASK,
          status: TaskStatus.open,
          assigneeId: null,
          requestedById: null,
          featuredAsQuickTask: true,
          parentId: { not: null, notIn: blockedProjectIds },
        },
        include: { parent: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    return [
      ...quickTasks.map((t) => ({
        kind: 'quick' as const,
        id: t.id,
        title: t.title,
        description: t.description,
        skillId: t.skillId,
        skillName: t.skill?.name ?? null,
        skillCategory: t.skill?.category?.name ?? null,
        estimatedHours: t.estimatedHours,
        createdAt: t.createdAt,
      })),
      ...projectTasks
        .filter((t) => t.parentId !== null)
        .map((t) => ({
          kind: 'project_task' as const,
          id: t.id,
          title: t.title,
          description: t.description,
          projectId: t.parentId as number,
          projectTitle: t.parent?.title ?? null,
          estimatedHours: t.estimatedHours,
          createdAt: t.createdAt,
        })),
    ].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
  }),

  get: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const task = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.QUICK_TASK },
        include: {
          skill: true,
          contextProject: { select: { title: true, id: true } },
          reviewedBy: { select: { name: true } },
        },
      })
      if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      const isOpenAndUnclaimed = task.status === QuickTaskStatus.open && task.assigneeId === null
      if (task.assigneeId !== volunteer.id && !volunteer.isAdmin && !isOpenAndUnclaimed) {
        throw new ORPCError('FORBIDDEN', { message: 'You do not have access to this task' })
      }
      return {
        ...serializeStarterTask(task),
        projectTitle: task.contextProject?.title ?? null,
        skillName: task.skill?.name ?? null,
        reviewedByName: task.reviewedBy?.name ?? null,
      }
    }),

  create: adminProcedure.input(CreateQuickTaskSchema).handler(async ({ input }) => {
    const task = await prisma.workItem.create({
      data: {
        type: WorkItemType.QUICK_TASK,
        status: QuickTaskStatus.open,
        title: input.title,
        description: input.description,
        skillId: input.skillId ?? null,
        contextProjectId: input.contextProjectId ?? null,
        estimatedHours: input.estimatedHours ?? null,
      },
    })
    return { id: task.id, message: 'Quick Task created' }
  }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        title: z.string().optional(),
        description: z.string().optional(),
        skillId: z.number().int().nullable().optional(),
        estimatedHours: z.number().nullable().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const task = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.QUICK_TASK },
      })
      if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })

      const updated = await prisma.workItem.update({
        where: { id: input.id },
        data: {
          ...(input.title !== undefined && { title: input.title.trim() }),
          ...(input.description !== undefined && { description: input.description.trim() }),
          ...('skillId' in input && { skillId: input.skillId }),
          ...('estimatedHours' in input && { estimatedHours: input.estimatedHours }),
        },
      })
      return { id: updated.id, message: 'Task updated' }
    }),

  delete: adminProcedure.input(z.object({ id: z.number().int() })).handler(async ({ input }) => {
    const task = await prisma.workItem.findFirst({
      where: { id: input.id, type: WorkItemType.QUICK_TASK },
    })
    if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })

    await prisma.skillEndorsement.deleteMany({
      where: { source: 'quick_task', sourceId: input.id },
    })
    await prisma.workItem.delete({ where: { id: input.id } })
    return { message: 'Task deleted' }
  }),

  assign: adminProcedure
    .input(z.object({ id: z.number().int() }).merge(AssignQuickTaskSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const task = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.QUICK_TASK },
      })
      if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })

      const assignee = await prisma.volunteer.findFirst({
        where: { id: input.volunteerId, deletedAt: null },
      })
      if (!assignee) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
      if (assignee.approvalStatus !== ApprovalStatus.approved) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Cannot assign a task to a volunteer who is not yet approved',
        })
      }

      await prisma.workItem.update({
        where: { id: input.id },
        data: {
          assigneeId: input.volunteerId,
          creatorId: admin.id,
          status: QuickTaskStatus.in_progress,
          updatedAt: new Date(),
          // Actual start, recorded once — reassigning a task in flight does not restart it.
          ...(task.startedAt === null ? { startedAt: new Date() } : {}),
        },
      })

      notifyUser(
        input.volunteerId,
        'quick_task_assigned',
        `Assigned: Quick Task '${task.title}'`,
        (task.description ?? '').slice(0, 200),
        `/quick-tasks/${input.id}`,
      )

      return { message: 'Task assigned' }
    }),

  claim: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const task = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.QUICK_TASK },
      })
      if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      // Guarded update rather than check-then-write: two volunteers claiming at the same
      // moment must not both succeed, with the second silently taking the task.
      const claimed = await prisma.workItem.updateMany({
        where: { id: input.id, status: QuickTaskStatus.open, assigneeId: null },
        data: {
          assigneeId: volunteer.id,
          status: QuickTaskStatus.in_progress,
          updatedAt: new Date(),
          // The guard above proves the task was open and unheld, so this is a fresh start.
          startedAt: new Date(),
        },
      })
      if (claimed.count === 0) {
        throw new ORPCError('BAD_REQUEST', { message: 'This task has already been claimed' })
      }

      return { message: 'Task claimed' }
    }),

  unassign: adminProcedure.input(z.object({ id: z.number().int() })).handler(async ({ input }) => {
    const task = await prisma.workItem.findFirst({
      where: { id: input.id, type: WorkItemType.QUICK_TASK },
    })
    if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })

    await prisma.workItem.update({
      where: { id: input.id },
      data: {
        assigneeId: null,
        creatorId: null,
        status: QuickTaskStatus.open,
        updatedAt: new Date(),
        // Back to unstarted: the actual start and any submission describe nobody's work.
        startedAt: null,
        ...CLEARED_SUBMISSION,
      },
    })
    return { message: 'Task unassigned' }
  }),

  submit: authedProcedure
    .input(z.object({ id: z.number().int() }).merge(SubmitWorkSchema))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const task = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.QUICK_TASK, assigneeId: volunteer.id },
      })
      if (!task)
        throw new ORPCError('NOT_FOUND', { message: 'Task not found or not assigned to you' })
      if (task.status !== QuickTaskStatus.in_progress) {
        throw new ORPCError('BAD_REQUEST', { message: 'Only a task in progress can be submitted' })
      }
      const submission = submissionData(input)
      if (!submission) {
        throw new ORPCError('BAD_REQUEST', { message: 'Say what you did or add a link to it' })
      }

      await prisma.workItem.update({
        where: { id: input.id },
        data: { ...submission, status: QuickTaskStatus.under_review, updatedAt: new Date() },
      })
      await clearNotifications('task_changes_requested', input.id)

      // A task someone claimed has no creator, so any admin may review it.
      const notice = [
        'quick_task_submitted',
        `Submitted for review: '${task.title}'`,
        `${volunteer.name}: ${submission.submissionNote ?? submission.submissionUrl}`,
        `/quick-tasks/${input.id}`,
      ] as const
      if (task.creatorId) notifyUser(task.creatorId, ...notice, undefined, input.id)
      else notifyAdmins(...notice, undefined, input.id)

      return { message: 'Task submitted for review' }
    }),

  requestChanges: adminProcedure
    .input(z.object({ id: z.number().int() }).merge(RequestChangesSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const task = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.QUICK_TASK },
      })
      if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      if (task.status !== QuickTaskStatus.under_review)
        throw new ORPCError('BAD_REQUEST', { message: 'Task is not awaiting review' })

      await prisma.workItem.update({
        where: { id: input.id },
        data: {
          status: QuickTaskStatus.in_progress,
          changesRequestedNote: input.message,
          reviewedById: admin.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      await clearNotifications('quick_task_submitted', input.id)
      if (task.assigneeId) {
        notifyUser(
          task.assigneeId,
          'task_changes_requested',
          `Changes requested: '${task.title}'`,
          input.message,
          `/quick-tasks/${input.id}`,
          undefined,
          input.id,
        )
      }
      return { message: 'Changes requested' }
    }),

  review: adminProcedure
    .input(z.object({ id: z.number().int() }).merge(ReviewQuickTaskSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const task = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.QUICK_TASK },
      })
      if (!task) throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      if (task.status !== QuickTaskStatus.under_review)
        throw new ORPCError('BAD_REQUEST', { message: 'Task is not awaiting review' })

      await prisma.workItem.update({
        where: { id: input.id },
        data: {
          status: QuickTaskStatus.completed,
          reviewRating: input.reviewRating,
          reviewNotes: input.reviewNotes ?? null,
          reviewedById: admin.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
          changesRequestedNote: null,
        },
      })

      if (input.comment && input.comment.trim()) {
        await prisma.workItemComment.create({
          data: { workItemId: input.id, authorId: admin.id, content: input.comment.trim() },
        })
      }

      await clearNotifications('quick_task_submitted', input.id)

      if (task.assigneeId) {
        const noteContent = `Quick Task '${task.title}': ${input.reviewRating}${input.reviewNotes ? ` - ${input.reviewNotes}` : ''}`
        await prisma.adminNote.create({
          data: {
            volunteerId: task.assigneeId,
            authorId: admin.id,
            content: noteContent,
            category: 'skill_feedback',
            relatedWorkItemId: task.contextProjectId ?? null,
          },
        })

        if (['excellent', 'good'].includes(input.reviewRating) && task.skillId) {
          const rating = input.reviewRating === 'excellent' ? 'strong' : 'verified'
          await prisma.skillEndorsement.upsert({
            where: {
              volunteerId_skillId_endorsedById: {
                volunteerId: task.assigneeId,
                skillId: task.skillId,
                endorsedById: admin.id,
              },
            },
            update: {
              rating,
              notes: input.reviewNotes ?? null,
              source: 'quick_task',
              sourceId: input.id,
            },
            create: {
              volunteerId: task.assigneeId,
              skillId: task.skillId,
              endorsedById: admin.id,
              source: 'quick_task',
              sourceId: input.id,
              rating,
              notes: input.reviewNotes ?? null,
            },
          })
        }

        notifyUser(
          task.assigneeId,
          'quick_task_reviewed',
          `Reviewed: your Quick Task '${task.title}'`,
          `Rating: ${input.reviewRating}${input.comment ? ` - ${input.comment}` : ''}`,
          `/quick-tasks/${input.id}`,
        )
      }

      return { message: 'Task reviewed' }
    }),
}
