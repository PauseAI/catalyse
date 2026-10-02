import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createAdmin,
  createProject,
  createQuickTask,
  createTask,
  createVolunteer,
} from '@/test/factories'
import { emails } from '@/test/fakes/email'
import { addDays, startOfUtcDay } from '@/lib/schedule'
import { formatDateShort } from '@/lib/format-date'
import { DEADLINE_REMINDERS_JOB, runDeadlineRemindersJob } from './deadline-reminders'

const now = new Date('2026-10-11T08:00:00Z')
const today = startOfUtcDay(now)

const notes = (volunteerId: number, type: string) =>
  prisma.notification.findMany({ where: { volunteerId, type } })

/** Reminders began before this test's dates, so overdue tasks nag as they would in steady state. */
async function remindersRunningSince(date: Date) {
  await prisma.cronJobRun.create({
    data: { jobName: DEADLINE_REMINDERS_JOB, startedAt: date, status: 'success' },
  })
}

describe('runDeadlineRemindersJob', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('reminds the assignee and the owner, one email each, and nothing twice on a rerun', async () => {
    const owner = await createVolunteer({ name: 'Olive', email: 'olive@example.org' })
    const sam = await createVolunteer({ name: 'Sam', email: 'sam@example.org' })
    const project = await createProject({
      title: 'Westminster',
      status: 'in_progress',
      assigneeId: owner.id,
    })
    // Due today.
    const task = await createTask(project.id, {
      title: 'Book venue',
      status: 'in_progress',
      assigneeId: sam.id,
      deadline: today,
      startedAt: addDays(today, -5),
    })
    // The owner does one too: one person, both sections, one email.
    await createTask(project.id, {
      title: 'Write press release',
      status: 'in_progress',
      assigneeId: owner.id,
      deadline: addDays(today, 1),
      startedAt: addDays(today, -5),
    })

    expect(await runDeadlineRemindersJob(now)).toMatchObject({ recipients: 2, emails: 2 })
    expect((await notes(sam.id, 'finish_by_today'))[0].title).toBe('“Book venue” is due today')
    const toSam = emails.lastTo('sam@example.org')!
    expect(toSam.subject).toBe('Catalyse: 1 thing needs you today')
    expect(toSam.html).toContain('Your tasks')
    const toOlive = emails.to('olive@example.org')
    expect(toOlive).toHaveLength(1)
    expect(toOlive[0].html).toContain('Your tasks')
    expect(toOlive[0].html).toContain('Westminster')
    expect(toOlive[0].html).toContain('“Book venue” is due today')
    expect(toOlive[0].html).toContain(
      `“Write press release” is due ${formatDateShort(addDays(today, 1))}`,
    )
    expect(toOlive[0].html).toContain('Projects you lead')

    const sent = emails.sent.length
    expect(await runDeadlineRemindersJob(now)).toMatchObject({ recipients: 0, emails: 0 })
    expect(emails.sent.length).toBe(sent)
    void task
  })

  it('puts a task past its plan in front of the owner every day until they act', async () => {
    const owner = await createVolunteer({ email: 'o2@example.org' })
    const deputy = await createVolunteer({ email: 'd2@example.org' })
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: deputy.id } })
    const sam = await createVolunteer({ name: 'Sam Slow', email: 's2@example.org' })
    const late = await createTask(project.id, {
      title: 'Print flyers',
      status: 'in_progress',
      assigneeId: sam.id,
      startDate: addDays(today, -6),
      durationDays: 3,
    })
    // Past its plan too, but nobody holds it: not a decision, so it nags no one.
    await createTask(project.id, {
      title: 'Unclaimed',
      startDate: addDays(today, -6),
      durationDays: 3,
    })
    await runDeadlineRemindersJob(now)
    const decision = await notes(owner.id, 'task_needs_decision')
    expect(decision).toHaveLength(1)
    expect(decision[0]).toMatchObject({
      title: '“Print flyers” is 4 days past plan',
      body: expect.stringMatching(/^Assignee: Sam Slow, .*\. Replan, reassign or release\.$/),
      entityId: late.id,
    })
    expect(await notes(deputy.id, 'task_needs_decision')).toHaveLength(1)
    expect(emails.lastTo('o2@example.org')!.html).toContain('Needs your decision')

    // The next day the same item comes back, refreshed rather than added.
    await prisma.notification.updateMany({ data: { readAt: new Date() } })
    await runDeadlineRemindersJob(addDays(now, 1))
    const again = await notes(owner.id, 'task_needs_decision')
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ title: '“Print flyers” is 5 days past plan', readAt: null })
  })

  it('tapers overdue Quick Task reminders, sends them to admins when nobody set it, and respects preferences', async () => {
    await remindersRunningSince(addDays(today, -30))
    await createAdmin({ email: 'admin9@example.org' })
    const quiet = await createVolunteer({ email: 'quiet@example.org', dailySummary: 'in_app_only' })
    const off = await createVolunteer({ email: 'off@example.org', dailySummary: 'off' })
    const late = await createQuickTask({
      title: 'Proofread leaflet',
      status: 'in_progress',
      assigneeId: quiet.id,
      deadline: addDays(today, -2),
      startedAt: addDays(today, -10),
    })
    await createQuickTask({
      title: 'Count signatures',
      status: 'in_progress',
      assigneeId: off.id,
      deadline: addDays(today, -1),
      startedAt: addDays(today, -10),
    })
    await runDeadlineRemindersJob(now)
    // In-app only: the reminder, but no email.
    expect((await notes(quiet.id, 'finish_by_overdue'))[0]).toMatchObject({
      title: '“Proofread leaflet” is 2 days past plan',
      entityId: late.id,
    })
    expect(emails.to('quiet@example.org')).toHaveLength(0)
    // Off: nothing at all.
    expect(await notes(off.id, 'finish_by_overdue')).toHaveLength(0)
    expect(emails.to('off@example.org')).toHaveLength(0)
    // Nobody set these, so the admins hear.
    expect(emails.lastTo('admin9@example.org')!.html).toContain('Quick Tasks')
    expect(emails.lastTo('admin9@example.org')!.html).toContain(
      '“Proofread leaflet” is 2 days overdue',
    )

    // Day 8 of the overdue clock has no reminder; day 10 does, refreshed in place.
    await runDeadlineRemindersJob(addDays(now, 6))
    await runDeadlineRemindersJob(addDays(now, 8))
    expect(await notes(quiet.id, 'finish_by_overdue')).toHaveLength(1)
    expect((await notes(quiet.id, 'finish_by_overdue'))[0].title).toBe(
      '“Proofread leaflet” is 10 days past plan',
    )
  })

  it('checks in on a quiet task and warns its owner, sparing both after an update', async () => {
    const owner = await createVolunteer({ email: 'o3@example.org' })
    const sam = await createVolunteer({ email: 's3@example.org' })
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    // Taken 1 Oct, due 11 Oct: the check-in is on the 6th.
    const task = await createTask(project.id, {
      title: 'Secure speakers',
      status: 'in_progress',
      assigneeId: sam.id,
      deadline: addDays(today, 5),
      startedAt: addDays(today, -5),
      updatedAt: addDays(today, -5),
    })
    await runDeadlineRemindersJob(now)
    expect((await notes(sam.id, 'finish_by_check_in'))[0].title).toBe(
      'Post a quick update on “Secure speakers”',
    )
    expect((await notes(owner.id, 'no_update_warning'))[0].title).toBe(
      'No update yet on “Secure speakers”',
    )
    expect(emails.lastTo('o3@example.org')!.html).toContain('no update yet, 5 days to go')

    // Past its deadline but with the plan still running: the owner sees the gap.
    await prisma.workItem.update({
      where: { id: task.id },
      data: { deadline: addDays(today, -1), startDate: addDays(today, -5), durationDays: 10 },
    })
    await runDeadlineRemindersJob(addDays(now, 1))
    expect(emails.lastTo('o3@example.org')!.html).toContain(
      '2 days past its deadline; the plan ends',
    )
  })

  it('tells the owner when the project will miss its deadline, and when it slips further', async () => {
    const owner = await createVolunteer({ email: 'o4@example.org' })
    const project = await createProject({
      title: 'Library',
      status: 'in_progress',
      assigneeId: owner.id,
      startDate: addDays(today, -2),
      deadline: today,
    })
    const task = await createTask(project.id, { title: 'Build', durationDays: 5 })
    await runDeadlineRemindersJob(now)
    const html = emails.lastTo('o4@example.org')!.html
    expect(html).toContain('The plan now finishes 2 days after the project deadline')
    expect(html).toContain('The project deadline is today')
    expect(await notes(owner.id, 'plan_slip')).toHaveLength(1)

    // Unchanged the next day: no new alert, just the overdue line.
    await runDeadlineRemindersJob(addDays(now, 1))
    expect(await notes(owner.id, 'plan_slip')).toHaveLength(1)
    expect(emails.lastTo('o4@example.org')!.html).toContain('The project deadline passed 1 day ago')

    // Three days further out: alerted again.
    await prisma.workItem.update({ where: { id: task.id }, data: { durationDays: 8 } })
    await runDeadlineRemindersJob(addDays(now, 2))
    expect(await notes(owner.id, 'plan_slip')).toHaveLength(2)

    // Tomorrow's deadline on another project.
    const soon = await createProject({
      status: 'in_progress',
      assigneeId: owner.id,
      deadline: addDays(today, 4),
    })
    await runDeadlineRemindersJob(addDays(now, 3))
    expect(emails.lastTo('o4@example.org')!.html).toContain('The project deadline is tomorrow')
    void soon
  })

  it('reports the day’s activity on projects the person leads', async () => {
    const owner = await createVolunteer({ email: 'o5@example.org' })
    const jo = await createVolunteer({ name: 'Jo' })
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    const task = await createTask(project.id, {
      title: 'Leaflets',
      status: 'in_progress',
      assigneeId: jo.id,
      startedAt: addDays(now, -0.5),
    })
    const done = await createTask(project.id, {
      title: 'Banner',
      status: 'completed',
      completedAt: addDays(now, -0.5),
    })
    await prisma.workItemComment.createMany({
      data: [
        { workItemId: task.id, authorId: jo.id, content: 'on it', createdAt: addDays(now, -0.5) },
        { workItemId: project.id, authorId: null, content: 'hi', createdAt: addDays(now, -0.5) },
        // The owner's own post is not news to them.
        {
          workItemId: task.id,
          authorId: owner.id,
          content: 'thanks',
          createdAt: addDays(now, -0.5),
        },
      ],
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: jo.id,
        interestType: 'want_to_contribute',
        createdAt: addDays(now, -0.5),
      },
    })
    const result = await runDeadlineRemindersJob(now)
    const sent = emails.lastTo('o5@example.org')!
    expect(sent.subject).toBe('Catalyse: your daily summary')
    for (const text of [
      'Jo posted on “Leaflets”',
      'Someone posted on the project',
      '“Banner” is done',
      'Jo took “Leaflets”',
      'Jo wants to help',
    ]) {
      expect(sent.html).toContain(text)
    }
    expect(sent.html).not.toContain('thanks')
    expect(result).toMatchObject({ recipients: 1 })
    void done

    // No email service: the lines are still recorded, but nothing is sent.
    emails.setConfigured(false)
    await prisma.workItemComment.create({
      data: { workItemId: task.id, authorId: jo.id, content: 'more', createdAt: now },
    })
    expect(await runDeadlineRemindersJob(addDays(now, 0.5))).toMatchObject({ emails: 0 })
  })
})
