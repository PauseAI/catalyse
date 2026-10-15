import { ORPCError, os } from '@orpc/server'
import { TaskStatus, WorkItemType } from '@/generated/prisma/enums'
import { prisma } from '@/lib/prisma'
import { TERMINAL_STATUSES } from '@/lib/project-status'

export const REOPEN_TASK_TO_CHANGE = 'Reopen the task to change it'
export const REOPEN_PROJECT_TO_CHANGE = 'This project is completed. Reopen it to make changes.'

/**
 * A done task is read-only until someone reopens it: its fields, its assignee and the links it
 * waits on. Links where it is the predecessor belong to the task that waits, so stay editable.
 */
export function assertTaskEditable(task: { status: string }): void {
  if (task.status === TaskStatus.completed) {
    throw new ORPCError('FORBIDDEN', { message: REOPEN_TASK_TO_CHANGE })
  }
}

/** A completed or archived project, and everything under it, is frozen until it is reopened. */
export function isProjectLocked(project: { status: string }): boolean {
  return TERMINAL_STATUSES.includes(project.status)
}

/**
 * Nobody joins, leaves or edits a locked project, its tasks, links, people or schedule. Its
 * Discussion stays open, and its owner or an admin reopens it through projects.update.
 */
export function assertProjectEditable(project: { status: string }): void {
  if (isProjectLocked(project)) {
    throw new ORPCError('FORBIDDEN', { message: REOPEN_PROJECT_TO_CHANGE })
  }
}

/**
 * assertProjectEditable as procedure middleware, given the project's id from the input. A
 * missing project passes through so the procedure answers NOT_FOUND in its own words.
 */
export const projectEditable = os.middleware(async ({ next }, projectId: number) => {
  const project = await prisma.workItem.findFirst({
    where: { id: projectId, type: WorkItemType.PROJECT },
    select: { status: true },
  })
  if (project) assertProjectEditable(project)
  return next()
})
