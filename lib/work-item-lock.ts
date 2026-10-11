import { ORPCError } from '@orpc/server'
import { TaskStatus } from '@/generated/prisma/enums'

export const REOPEN_TASK_TO_CHANGE = 'Reopen the task to change it'

/**
 * A done task is read-only until someone reopens it: its fields, its assignee and the links it
 * waits on. Links where it is the predecessor belong to the task that waits, so stay editable.
 */
export function assertTaskEditable(task: { status: string }): void {
  if (task.status === TaskStatus.completed) {
    throw new ORPCError('FORBIDDEN', { message: REOPEN_TASK_TO_CHANGE })
  }
}
