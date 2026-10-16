import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { notifyUser, notifyChapterStaff, clearNotifications } from '@/lib/notify'
import { canAdminChapter, inChapter, type ChapterAccess } from '@/lib/chapter-access'
import { chapterFilter } from '@/lib/chapter-access-server'
import {
  CreateQuickTaskSchema,
  AssignQuickTaskSchema,
  ReviewQuickTaskSchema,
  RequestChangesSchema,
  SubmitWorkSchema,
  SUBMISSION_ASK_FIELDS,
} from '@/lib/schemas'
import {
  CLAIM_BLOCKING_INTEREST_STATUSES,
  CLEARED_SUBMISSION,
  projectScopeWhere,
  resolveClaimViewers,
  serializeStarterTask,
  submissionData,
} from '@/lib/work-item'
import { recordChange, updateWorkItem } from '@/lib/work-item-events'
import { approvedProcedure, authedProcedure, staffProcedure } from '../procedures'
import { TERMINAL_STATUSES } from '@/lib/project-status'
import { ApprovalStatus, QuickTaskStatus, TaskStatus, WorkItemType } from '@/generated/prisma/enums'

/** A quick task in a chapter the caller runs; any other is not found. */
async function quickTaskRunBy(access: ChapterAccess, id: number) {
  const task = await prisma.workItem.findFirst({ where: { id, type: WorkItemType.QUICK_TASK } })
  if (!task || !canAdminChapter(access, task.nationalChapterId)) {
    throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
  }
  return task
}

/** Quick tasks belong to a chapter: its members take them, and its staff run them. */
export const quickTasksRouter = {
  list: staffProcedure
    .input(
      z.object({
        status: z.nativeEnum(QuickTaskStatus).optional(),
        skillId: z.number().int().optional(),
        chapter: z.union([z.number().int(), z.literal('pool')]).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const tasks = await prisma.workItem.findMany({
        where: {
          type: WorkItemType.QUICK_TASK,
          nationalChapterId: chapterFilter(context.access, input.chapter),
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
  featuredProjectTasks: staffProcedure.handler(async ({ context }) => {
    const tasks = await prisma.workItem.findMany({
      where: {
        type: WorkItemType.TASK,
        featuredAsQuickTask: true,
        parent: { nationalChapterId: chapterFilter(context.access) },
      },
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
        deadline: t.deadline,
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
        workItem: { type: WorkItemType.PROJECT },
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
          nationalChapterId: context.volunteer.nationalChapterId,
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
          status: TaskStatus.not_started,
          assigneeId: null,
          requestedById: null,
          featuredAsQuickTask: true,
          parentId: { not: null, notIn: blockedProjectIds },
          // Only from projects the volunteer may see: their chapter's, outside any team of
          // which they are not a member.
          parent: {
            status: { notIn: TERMINAL_STATUSES },
            AND: [projectScopeWhere({ ...context.volunteer, isAdmin: false })],
          },
        },
        include: {
          parent: { select: { id: true, title: true, teamId: true, assigneeId: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    const claimViewerOn = await resolveClaimViewers(
      projectTasks.flatMap((t) => (t.parent ? [t.parent] : [])),
      context.volunteer,
    )

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
        deadline: t.deadline,
        createdAt: t.createdAt,
      })),
      ...projectTasks.flatMap((t) =>
        t.parent
          ? [
              {
                kind: 'project_task' as const,
                id: t.id,
                title: t.title,
                description: t.description,
                projectId: t.parent.id,
                projectTitle: t.parent.title,
                claimViewer: claimViewerOn(t.parent),
                estimatedHours: t.estimatedHours,
                deadline: t.deadline,
                createdAt: t.createdAt,
              },
            ]
          : [],
      ),
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
      const isMine = task?.assigneeId === volunteer.id
      if (!task || (!isMine && !inChapter(context.access, task.nationalChapterId))) {
        throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      }
      const isOpenAndUnclaimed = task.status === QuickTaskStatus.open && task.assigneeId === null
      if (
        !isMine &&
        !canAdminChapter(context.access, task.nationalChapterId) &&
        !isOpenAndUnclaimed
      ) {
        throw new ORPCError('FORBIDDEN', { message: 'You do not have access to this task' })
      }
      return {
        ...serializeStarterTask(task),
        projectTitle: task.contextProject?.title ?? null,
        skillName: task.skill?.name ?? null,
        reviewedByName: task.reviewedBy?.name ?? null,
        viewerCanAdmin: canAdminChapter(context.access, task.nationalChapterId),
      }
    }),

  /** In the chapter of the project it is for, else the creator's, or a global admin's choice. */
  create: staffProcedure.input(CreateQuickTaskSchema).handler(async ({ input, context }) => {
    const project = input.contextProjectId
      ? await prisma.workItem.findFirst({
          where: { id: input.contextProjectId, type: WorkItemType.PROJECT },
          select: { nationalChapterId: true },
        })
      : null
    const nationalChapterId = project
      ? project.nationalChapterId
      : input.chapterId !== undefined && context.access.globalAdmin
        ? input.chapterId
        : context.access.chapterId
    if (
      (input.contextProjectId && !project) ||
      !canAdminChapter(context.access, nationalChapterId)
    ) {
      throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
    }
    const task = await prisma.workItem.create({
      data: {
        type: WorkItemType.QUICK_TASK,
        nationalChapterId,
        status: QuickTaskStatus.open,
        title: input.title,
        description: input.description,
        skillId: input.skillId ?? null,
        contextProjectId: input.contextProjectId ?? null,
        estimatedHours: input.estimatedHours ?? null,
        deadline: input.deadline ?? null,
        submissionPrompt: input.submissionPrompt ?? null,
        submissionAsksLink: input.submissionAsksLink ?? false,
      },
    })
    return { id: task.id, message: 'Quick Task created' }
  }),

  update: staffProcedure
    .input(
      z.object({
        id: z.number().int(),
        title: z.string().optional(),
        description: z.string().optional(),
        skillId: z.number().int().nullable().optional(),
        estimatedHours: z.number().nullable().optional(),
        deadline: z.coerce.date().nullable().optional(),
        ...SUBMISSION_ASK_FIELDS,
      }),
    )
    .handler(async ({ input, context }) => {
      const task = await quickTaskRunBy(context.access, input.id)

      await updateWorkItem(
        task,
        {
          ...(input.title !== undefined && { title: input.title.trim() }),
          ...(input.description !== undefined && { description: input.description.trim() }),
          ...('skillId' in input && { skillId: input.skillId }),
          ...('estimatedHours' in input && { estimatedHours: input.estimatedHours }),
          ...('deadline' in input && { deadline: input.deadline }),
          ...(input.submissionPrompt !== undefined && { submissionPrompt: input.submissionPrompt }),
          ...(input.submissionAsksLink !== undefined && {
            submissionAsksLink: input.submissionAsksLink,
          }),
        },
        { actorId: context.volunteer.id },
      )
      return { id: task.id, message: 'Task updated' }
    }),

  delete: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await quickTaskRunBy(context.access, input.id)
      await prisma.skillEndorsement.deleteMany({
        where: { source: 'quick_task', sourceId: input.id },
      })
      await prisma.workItem.delete({ where: { id: input.id } })
      return { message: 'Task deleted' }
    }),

  assign: staffProcedure
    .input(z.object({ id: z.number().int() }).merge(AssignQuickTaskSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const task = await quickTaskRunBy(context.access, input.id)

      const assignee = await prisma.volunteer.findFirst({
        where: { id: input.volunteerId, deletedAt: null },
      })
      if (!assignee) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
      if (!context.access.globalAdmin && assignee.nationalChapterId !== task.nationalChapterId) {
        throw new ORPCError('BAD_REQUEST', {
          message: "Assign it to someone in the task's chapter",
        })
      }
      if (assignee.approvalStatus !== ApprovalStatus.approved) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Cannot assign a task to a volunteer who is not yet approved',
        })
      }

      await updateWorkItem(
        task,
        {
          assigneeId: input.volunteerId,
          creatorId: admin.id,
          status: QuickTaskStatus.in_progress,
          updatedAt: new Date(),
          // Actual start, recorded once — reassigning a task in flight does not restart it.
          ...(task.startedAt === null ? { startedAt: new Date() } : {}),
        },
        { actorId: admin.id },
      )

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
      if (!task || !inChapter(context.access, task.nationalChapterId)) {
        throw new ORPCError('NOT_FOUND', { message: 'Task not found' })
      }
      // Guarded update rather than check-then-write: two volunteers claiming at the same
      // moment must not both succeed, with the second silently taking the task.
      const data = {
        assigneeId: volunteer.id,
        status: QuickTaskStatus.in_progress,
        updatedAt: new Date(),
        // The guard below proves the task was open and unheld, so this is a fresh start.
        startedAt: new Date(),
      }
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.workItem.updateMany({
          where: { id: input.id, status: QuickTaskStatus.open, assigneeId: null },
          data,
        })
        if (claimed.count === 0) {
          throw new ORPCError('BAD_REQUEST', { message: 'This task has already been claimed' })
        }
        await recordChange(tx, { row: task, data, actorId: volunteer.id, kind: 'claimed' })
      })

      return { message: 'Task claimed' }
    }),

  unassign: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const task = await quickTaskRunBy(context.access, input.id)

      await updateWorkItem(
        task,
        {
          assigneeId: null,
          creatorId: null,
          status: QuickTaskStatus.open,
          updatedAt: new Date(),
          // Back to unstarted: the actual start and any submission describe nobody's work.
          startedAt: null,
          ...CLEARED_SUBMISSION,
        },
        { actorId: context.volunteer.id, kind: 'released' },
      )
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

      await updateWorkItem(
        task,
        { ...submission, status: QuickTaskStatus.under_review, updatedAt: new Date() },
        { actorId: volunteer.id, kind: 'submitted' },
      )
      await clearNotifications('task_changes_requested', input.id)

      // A task someone claimed has no creator, so its chapter's staff review it.
      const notice = [
        'quick_task_submitted',
        `Submitted for review: '${task.title}'`,
        `${volunteer.name}: ${submission.submissionNote ?? submission.submissionUrl}`,
        `/quick-tasks/${input.id}`,
      ] as const
      // Awaited, so a review straight after finds these rows there to clear.
      if (task.creatorId) await notifyUser(task.creatorId, ...notice, undefined, input.id)
      else await notifyChapterStaff(task.nationalChapterId, ...notice, undefined, input.id)

      return { message: 'Task submitted for review' }
    }),

  requestChanges: staffProcedure
    .input(z.object({ id: z.number().int() }).merge(RequestChangesSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const task = await quickTaskRunBy(context.access, input.id)
      if (task.status !== QuickTaskStatus.under_review)
        throw new ORPCError('BAD_REQUEST', { message: 'Task is not awaiting review' })

      await updateWorkItem(
        task,
        {
          status: QuickTaskStatus.in_progress,
          changesRequestedNote: input.message,
          reviewedById: admin.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
        { actorId: admin.id, kind: 'changes_requested' },
      )
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

  review: staffProcedure
    .input(z.object({ id: z.number().int() }).merge(ReviewQuickTaskSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const task = await quickTaskRunBy(context.access, input.id)
      if (task.status !== QuickTaskStatus.under_review)
        throw new ORPCError('BAD_REQUEST', { message: 'Task is not awaiting review' })

      await updateWorkItem(
        task,
        {
          status: QuickTaskStatus.completed,
          reviewRating: input.reviewRating,
          reviewNotes: input.reviewNotes ?? null,
          reviewedById: admin.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
          changesRequestedNote: null,
        },
        { actorId: admin.id, kind: 'accepted' },
      )

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
