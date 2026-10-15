import { prisma } from '@/lib/prisma'
import {
  sendTaskNudgeEmail,
  sendTaskFinalWarningEmail,
  sendTaskSurrenderedOwnerEmail,
  sendTaskSurrenderedAssigneeEmail,
  isEmailConfigured,
} from '@/lib/email'
import { createNotification } from '@/lib/notify'
import { RELEASED_TASK } from '@/lib/work-item'
import { updateWorkItem } from '@/lib/work-item-events'
import {
  TASK_FINAL_WARNING_AFTER_DAYS,
  TASK_RELEASE_AFTER_DAYS,
  TASK_REMINDER_AFTER_DAYS,
} from '@/lib/staleness'
import { TaskStatus, WorkItemType } from '@/generated/prisma/enums'

const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export async function runNudgesJob(): Promise<Record<string, unknown>> {
  if (!isEmailConfigured()) {
    console.log('[CRON NUDGES] Email not configured, skipping')
    return { skipped: true, reason: 'email not configured' }
  }

  const assignedTasks = await prisma.workItem.findMany({
    where: {
      type: WorkItemType.TASK,
      // Held, started or not: claiming stamps `updatedAt` as well as `claimedAt`.
      status: { in: [TaskStatus.not_started, TaskStatus.in_progress] },
      assigneeId: { not: null },
      updatedAt: { lt: daysAgo(TASK_REMINDER_AFTER_DAYS) },
      assignee: { email: { not: null }, deletedAt: null },
    },
    include: {
      assignee: true,
      parent: { include: { assignee: true } },
    },
  })

  let nudgesSent = 0
  let warningsSent = 0
  let surrendered = 0

  for (const task of assignedTasks) {
    const assignee = task.assignee!
    const project = task.parent!
    const updatedAt = task.updatedAt!
    const now = new Date()
    const daysInactive = Math.floor((now.getTime() - updatedAt.getTime()) / DAY_MS)
    const lastActivityDate = formatDate(updatedAt)

    if (daysInactive >= TASK_RELEASE_AFTER_DAYS) {
      await updateWorkItem(
        task,
        { ...RELEASED_TASK, updatedAt: now },
        { actorId: null, kind: 'released' },
      )
      await createNotification(
        assignee.id,
        'task_released',
        `Released: ${task.title}`,
        `No update for ${TASK_RELEASE_AFTER_DAYS} days, so the task is open for others. Claim it again if you are still working on it.`,
        `/projects/${task.parentId}/tasks/${task.id}`,
        task.id,
      )
      await sendTaskSurrenderedAssigneeEmail({
        to: assignee.email!,
        name: assignee.name,
        taskTitle: task.title,
        projectTitle: project.title,
        projectId: task.parentId!,
      })
      if (project.assignee?.email) {
        await sendTaskSurrenderedOwnerEmail({
          to: project.assignee.email,
          ownerName: project.assignee.name,
          volunteerName: assignee.name,
          taskTitle: task.title,
          projectTitle: project.title,
          projectId: task.parentId!,
        })
      }
      surrendered++
      console.log(`[CRON NUDGES] Surrendered task ${task.id} (${daysInactive} days inactive)`)
    } else if (daysInactive >= TASK_FINAL_WARNING_AFTER_DAYS && !task.finalWarningSentAt) {
      const surrenderDate = formatDate(
        new Date(updatedAt.getTime() + TASK_RELEASE_AFTER_DAYS * DAY_MS),
      )
      const sent = await sendTaskFinalWarningEmail({
        to: assignee.email!,
        name: assignee.name,
        taskTitle: task.title,
        projectTitle: project.title,
        projectId: task.parentId!,
        taskId: task.id,
        daysInactive,
        activityPhrase: 'you last updated',
        lastActivityDate,
        surrenderDate,
      })
      if (sent) {
        await prisma.workItem.update({
          where: { id: task.id },
          data: { finalWarningSentAt: now },
        })
        warningsSent++
        console.log(`[CRON NUDGES] Final warning sent for task ${task.id} (${daysInactive} days)`)
      }
    } else if (
      daysInactive >= TASK_REMINDER_AFTER_DAYS &&
      !task.nudgeSentAt &&
      !task.finalWarningSentAt
    ) {
      const sent = await sendTaskNudgeEmail({
        to: assignee.email!,
        name: assignee.name,
        taskTitle: task.title,
        projectTitle: project.title,
        projectId: task.parentId!,
        taskId: task.id,
        daysInactive,
        activityPhrase: 'you last updated',
        lastActivityDate,
      })
      if (sent) {
        await prisma.workItem.update({ where: { id: task.id }, data: { nudgeSentAt: now } })
        nudgesSent++
        console.log(`[CRON NUDGES] Nudge sent for task ${task.id} (${daysInactive} days)`)
      }
    }
  }

  console.log(
    `[CRON NUDGES] Done — nudges: ${nudgesSent}, warnings: ${warningsSent}, surrendered: ${surrendered}`,
  )
  return { nudgesSent, warningsSent, surrendered }
}
