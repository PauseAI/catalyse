import { InterestStatus, TaskStatus, WorkItemType } from '@/generated/prisma/enums'
import { prisma } from './prisma'

/**
 * A task's helpers work beside its assignee, the lead, and are WorkItemInterest rows on the task,
 * the same table that holds a project's members. On a task the row is always this type, and only
 * `accepted` (helping), `withdrawn` (left) and `removed` (taken off) occur: a member joins without
 * being asked or accepted, as they claim a task.
 */
export const TASK_HELPER = 'want_to_help_task'

/** The `_count` that gives each loaded work item its number of helpers. */
export const HELPER_COUNT = {
  _count: { select: { interests: { where: { status: InterestStatus.accepted } } } },
} as const

/** The helpers on a task, longest-standing first. */
export async function loadTaskHelpers(
  taskId: number,
): Promise<{ interestId: number; volunteerId: number; name: string }[]> {
  const rows = await prisma.workItemInterest.findMany({
    where: { workItemId: taskId, status: InterestStatus.accepted },
    include: { volunteer: { select: { name: true } } },
    orderBy: [{ respondedAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map((r) => ({ interestId: r.id, volunteerId: r.volunteerId, name: r.volunteer.name }))
}

/** The ids of a task's helpers, less `exceptId` (usually whoever acted). */
export async function taskHelperIds(taskId: number, exceptId: number | null = null) {
  const rows = await prisma.workItemInterest.findMany({
    where: { workItemId: taskId, status: InterestStatus.accepted },
    select: { volunteerId: true },
  })
  return rows.map((r) => r.volunteerId).filter((id) => id !== exceptId)
}

/** Someone who becomes a task's lead stops being one of its helpers. */
export async function stopHelpingAsLead(taskId: number, volunteerId: number): Promise<void> {
  await prisma.workItemInterest.updateMany({
    where: { workItemId: taskId, volunteerId, status: InterestStatus.accepted },
    data: { status: InterestStatus.withdrawn, respondedAt: new Date() },
  })
}

/**
 * Leaving a project, or being taken off it, ends helping on its unfinished tasks too: `withdrawn`
 * when they left, `removed` when someone else took them off. Done tasks keep their helpers as a
 * record of who did the work.
 */
export async function endHelpingOnProject(
  projectId: number,
  volunteerId: number,
  status: typeof InterestStatus.withdrawn | typeof InterestStatus.removed,
): Promise<void> {
  await prisma.workItemInterest.updateMany({
    where: {
      volunteerId,
      status: InterestStatus.accepted,
      workItem: {
        parentId: projectId,
        type: WorkItemType.TASK,
        status: { not: TaskStatus.completed },
      },
    },
    data: { status, respondedAt: new Date() },
  })
}
