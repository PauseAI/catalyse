import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createProject, createTask, createVolunteer } from '@/test/factories'
import { emails } from '@/test/fakes/email'
import { clientAs } from '@/test/rpc'
import {
  TASK_FINAL_WARNING_AFTER_DAYS,
  TASK_RELEASE_AFTER_DAYS,
  TASK_REMINDER_AFTER_DAYS,
} from '@/lib/staleness'
import { runNudgesJob } from './nudges'

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS - 60_000)

const subjects = {
  reminder: (task: string) => `How's it going with ${task}?`,
  finalWarning: (task: string) => `A quick nudge about ${task}`,
  releasedOwner: (task: string) => `Task unassigned due to inactivity: ${task}`,
  releasedAssignee: (task: string) => `Update on your task: ${task}`,
}

async function claimedTask(title: string, quietDays: number, status = 'in_progress') {
  const owner = await createVolunteer({ email: `owner-${title}@example.org` })
  const assignee = await createVolunteer({ email: `assignee-${title}@example.org` })
  const project = await createProject({ assigneeId: owner.id })
  const task = await createTask(project.id, {
    title,
    status,
    assigneeId: assignee.id,
    claimedAt: daysAgo(quietDays),
    startedAt: status === 'in_progress' ? daysAgo(quietDays) : null,
    updatedAt: daysAgo(quietDays),
  })
  return { owner, assignee, project, task }
}

const row = (id: number) => prisma.workItem.findUniqueOrThrow({ where: { id } })

describe('runNudgesJob', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reminds, warns and releases on the shared day counts', async () => {
    const fresh = await claimedTask('fresh', TASK_REMINDER_AFTER_DAYS - 1)
    // Claimed and never started still counts as held.
    const quiet = await claimedTask('quiet', TASK_REMINDER_AFTER_DAYS, 'not_started')
    const warned = await claimedTask('warned', TASK_FINAL_WARNING_AFTER_DAYS)
    const gone = await claimedTask('gone', TASK_RELEASE_AFTER_DAYS)

    expect(await runNudgesJob()).toEqual({ nudgesSent: 1, warningsSent: 1, surrendered: 1 })

    expect(emails.to(fresh.assignee.email!)).toEqual([])
    expect(emails.lastTo(quiet.assignee.email!)?.subject).toBe(subjects.reminder('quiet'))
    expect((await row(quiet.task.id)).nudgeSentAt).not.toBeNull()
    expect(emails.lastTo(warned.assignee.email!)?.subject).toBe(subjects.finalWarning('warned'))
    expect((await row(warned.task.id)).finalWarningSentAt).not.toBeNull()

    expect(await row(gone.task.id)).toMatchObject({
      status: 'not_started',
      assigneeId: null,
      claimedAt: null,
      startedAt: null,
    })
    expect(
      await prisma.workItemEvent.findMany({ where: { workItemId: gone.task.id } }),
    ).toMatchObject([{ actorId: null, kind: 'released', before: { assigneeId: gone.assignee.id } }])
    expect(emails.lastTo(gone.assignee.email!)?.subject).toBe(subjects.releasedAssignee('gone'))
    expect(emails.lastTo(gone.owner.email!)?.subject).toBe(subjects.releasedOwner('gone'))

    // A second run sends nothing new: each step happens once.
    const sent = emails.sent.length
    expect(await runNudgesJob()).toEqual({ nudgesSent: 0, warningsSent: 0, surrendered: 0 })
    expect(emails.sent.length).toBe(sent)
  })

  it('tells the released volunteer in the app, once, with a link to the task', async () => {
    const gone = await claimedTask('released', TASK_RELEASE_AFTER_DAYS + 3)
    await runNudgesJob()
    await runNudgesJob()
    const notes = await prisma.notification.findMany({ where: { volunteerId: gone.assignee.id } })
    expect(notes).toEqual([
      expect.objectContaining({
        type: 'task_released',
        title: 'Released: released',
        link: `/projects/${gone.project.id}/tasks/${gone.task.id}`,
        entityId: gone.task.id,
      }),
    ])
    expect(notes[0].body).toContain(`No update for ${TASK_RELEASE_AFTER_DAYS} days`)
  })

  it("restarts the clock when the assignee comments, but not for anyone else's comment", async () => {
    const mine = await claimedTask('commented', TASK_REMINDER_AFTER_DAYS + 1, 'not_started')
    const theirs = await claimedTask('owner-commented', TASK_REMINDER_AFTER_DAYS + 1, 'not_started')
    await clientAs(mine.assignee).workItemComments.add({
      workItemId: mine.task.id,
      content: 'Halfway there',
    })
    await clientAs(theirs.owner).workItemComments.add({
      workItemId: theirs.task.id,
      content: 'How is it going?',
    })
    // The assignee's first update also starts the work; anyone else's does not.
    const started = await row(mine.task.id)
    expect(started.status).toBe('in_progress')
    expect(started.startedAt).not.toBeNull()
    expect((await row(theirs.task.id)).status).toBe('not_started')
    expect(await runNudgesJob()).toMatchObject({ nudgesSent: 1 })
    expect(emails.to(mine.assignee.email!)).toEqual([])
    expect(emails.lastTo(theirs.assignee.email!)?.subject).toBe(
      subjects.reminder('owner-commented'),
    )
  })

  it('does nothing when email is not configured', async () => {
    const gone = await claimedTask('unsent', TASK_RELEASE_AFTER_DAYS)
    emails.setConfigured(false)
    expect(await runNudgesJob()).toEqual({ skipped: true, reason: 'email not configured' })
    expect((await row(gone.task.id)).assigneeId).toBe(gone.assignee.id)
  })
})
