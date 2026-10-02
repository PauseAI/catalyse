import { prisma } from '@/lib/prisma'
import { isEmailConfigured, sendDailySummaryEmail } from '@/lib/email'
import { createNotification, refreshNotification } from '@/lib/notify'
import { lateProjects, loadProjectTaskSchedule } from '@/lib/project-schedule'
import { addDays, diffInDays, startOfUtcDay } from '@/lib/schedule'
import { daysPastPlan, pastPlanDetail } from '@/lib/replan'
import { shouldAlertSlip, stagesToday, type OwnerStage } from '@/lib/deadline-reminders'
import { summarySections, summarySubject, type SummaryLine } from '@/lib/daily-summary'
import { formatDateShort } from '@/lib/format-date'
import { plural } from '@/lib/plural'
import {
  DailySummaryPreference,
  InterestStatus,
  ProjectStatus,
  QuickTaskStatus,
  TaskStatus,
  WorkItemType,
} from '@/generated/prisma/enums'

export const DEADLINE_REMINDERS_JOB = 'deadline-reminders'

const LIVE_PROJECT_STATUSES: string[] = [ProjectStatus.ready, ProjectStatus.in_progress]
const OPEN_TASK_STATUSES: string[] = [TaskStatus.open, TaskStatus.in_progress]
const OPEN_QUICK_TASK_STATUSES: string[] = [QuickTaskStatus.open, QuickTaskStatus.in_progress]

type Person = {
  name: string
  email: string | null
  dailySummary: DailySummaryPreference
}

type ReminderTask = {
  id: number
  title: string
  assigneeId: number | null
  deadline: Date
  startedAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
}

function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b
}

/**
 * Deadline reminders, past-plan decisions and the daily summary (Phase 3, D-09). Runs once a day;
 * a rerun on the same day adds nothing, because every line given to someone is recorded in
 * `finish_by_reminders` first and only a line recorded by this run is sent.
 */
export async function runDeadlineRemindersJob(now: Date = new Date()) {
  const today = startOfUtcDay(now)
  const firstRun = await prisma.cronJobRun.findFirst({
    where: { jobName: DEADLINE_REMINDERS_JOB },
    orderBy: { startedAt: 'asc' },
    select: { startedAt: true },
  })
  const remindersSince = firstRun ? startOfUtcDay(firstRun.startedAt) : today

  const people = new Map<number, Person | null>()
  async function person(id: number): Promise<Person | null> {
    if (!people.has(id)) {
      people.set(
        id,
        await prisma.volunteer.findFirst({
          where: { id, deletedAt: null },
          select: { name: true, email: true, dailySummary: true },
        }),
      )
    }
    return people.get(id) ?? null
  }

  /** Records a line for today; true only the first time, so a rerun sends nothing twice. */
  async function record(workItemId: number, stage: string, finishBy: Date, recipientId: number) {
    try {
      await prisma.finishByReminder.create({
        data: { workItemId, stage, finishBy, recipientId, sentOn: today },
      })
      return true
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return false
      throw e
    }
  }

  const lines = new Map<number, SummaryLine[]>()
  let notifications = 0
  async function tell(
    recipientId: number,
    key: { workItemId: number; stage: string; finishBy: Date },
    line: Omit<SummaryLine, 'text'> & { text: string },
    note?: {
      type: string
      title: string
      body: string | null
      entityId: number
      /** Replace this person's earlier copy rather than adding another. */
      refresh?: boolean
      /** Sent even to someone who turned reminders off: a decision is waiting on them. */
      always?: boolean
    },
  ) {
    const who = await person(recipientId)
    if (!who) return
    if (!(await record(key.workItemId, key.stage, key.finishBy, recipientId))) return
    lines.set(recipientId, [...(lines.get(recipientId) ?? []), line])
    // "Off" stops the reminders; it never hides a decision that is waiting.
    if (!note || (who.dailySummary === DailySummaryPreference.off && !note.always)) return
    if (note.refresh) {
      await refreshNotification(
        recipientId,
        note.type,
        note.title,
        note.body,
        line.href,
        note.entityId,
      )
    } else {
      await createNotification(
        recipientId,
        note.type,
        note.title,
        note.body,
        line.href,
        note.entityId,
      )
    }
    notifications++
  }

  async function lastUpdate(
    task: Pick<ReminderTask, 'id' | 'assigneeId' | 'updatedAt'>,
  ): Promise<Date | null> {
    if (task.assigneeId === null) return null
    const comment = await prisma.workItemComment.findFirst({
      where: { workItemId: task.id, authorId: task.assigneeId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    const times = [comment?.createdAt, task.updatedAt].filter((d): d is Date => !!d)
    return times.length > 0 ? new Date(Math.max(...times.map((d) => d.getTime()))) : null
  }

  /** The reminders one task with a deadline gives its assignee and its owners today. */
  async function remind(
    task: ReminderTask,
    finishBy: Date,
    plannedStart: Date | null,
    owners: number[],
    group: string,
    href: string,
    skipOwnerOverdue: boolean,
  ) {
    const takenAt = task.assigneeId !== null ? (task.startedAt ?? task.updatedAt ?? today) : null
    const created = task.createdAt ?? today
    const clockStart = plannedStart
      ? laterOf(takenAt ?? created, plannedStart)
      : (takenAt ?? created)
    const st = stagesToday(
      { clockStart, finishBy, takenAt, lastUpdateAt: await lastUpdate(task), remindersSince },
      today,
    )
    const key = (stage: string) => ({ workItemId: task.id, stage, finishBy })
    const t = `“${task.title}”`
    const assigneeId = task.assigneeId
    if (assigneeId !== null) {
      for (const stage of st.assignee) {
        const base = { role: 'assignee' as const, group, href }
        if (stage === 'check_in') {
          await tell(
            assigneeId,
            key(stage),
            { ...base, kind: 'check_in', text: `${t}: post a quick update` },
            {
              type: 'finish_by_check_in',
              title: `Post a quick update on ${t}`,
              body: `Due ${formatDateShort(finishBy)}.`,
              entityId: task.id,
            },
          )
        } else if (stage === 'day_before') {
          await tell(
            assigneeId,
            key(stage),
            { ...base, kind: 'due_tomorrow', text: `${t} is due ${formatDateShort(finishBy)}` },
            {
              type: 'finish_by_soon',
              title: `${t} is due ${formatDateShort(finishBy)}`,
              body: null,
              entityId: task.id,
            },
          )
        } else if (stage === 'due_today') {
          await tell(
            assigneeId,
            key(stage),
            { ...base, kind: 'due_today', text: `${t} is due today` },
            {
              type: 'finish_by_today',
              title: `${t} is due today`,
              body: null,
              entityId: task.id,
            },
          )
        } else {
          const days = plural(st.daysOverdue ?? 0, 'day')
          await tell(
            assigneeId,
            key(stage),
            { ...base, kind: 'overdue', text: `${t} is ${days} past plan` },
            {
              type: 'finish_by_overdue',
              title: `${t} is ${days} past plan`,
              body: 'The owner has been told. Post an update or mark it done.',
              entityId: task.id,
              refresh: true,
            },
          )
        }
      }
    }
    const ownerText: Record<OwnerStage, string> = {
      at_risk: `${t}: no update yet, ${plural(st.daysLeft ?? 0, 'day')} to go`,
      due_tomorrow: `${t} is due tomorrow`,
      due_today: `${t} is due today`,
      overdue: `${t} is ${plural(st.daysOverdue ?? 0, 'day')} overdue`,
    }
    for (const owner of owners) {
      for (const stage of st.owner) {
        if (stage === 'overdue' && skipOwnerOverdue) continue
        await tell(
          owner,
          key(`owner_${stage}`),
          { role: 'owner', kind: stage, group, href, text: ownerText[stage] },
          stage === 'at_risk'
            ? {
                type: 'no_update_warning',
                title: `No update yet on ${t}`,
                body: `Due ${formatDateShort(finishBy)}.`,
                entityId: task.id,
              }
            : undefined,
        )
      }
      // Late against its deadline while the plan still runs: a fact the owner should see.
      const pastDeadline = diffInDays(task.deadline, today)
      if (pastDeadline > 0 && finishBy.getTime() >= today.getTime()) {
        await tell(owner, key('owner_past_deadline'), {
          role: 'owner',
          kind: 'past_deadline',
          group,
          href,
          text: `${t} is ${plural(pastDeadline, 'day')} past its deadline; the plan ends ${formatDateShort(finishBy)}`,
        })
      }
    }
  }

  // ── Project tasks ────────────────────────────────────────────────────────────
  const projects = await prisma.workItem.findMany({
    where: { type: WorkItemType.PROJECT, status: { in: LIVE_PROJECT_STATUSES } },
    include: { deputies: { select: { volunteerId: true } } },
  })
  for (const project of projects) {
    const owners = [
      ...new Set([
        ...(project.assigneeId !== null ? [project.assigneeId] : []),
        ...project.deputies.map((d) => d.volunteerId),
      ]),
    ]
    const tasks = await prisma.workItem.findMany({
      where: { parentId: project.id, type: WorkItemType.TASK },
      include: { assignee: { select: { name: true } } },
    })
    const { schedule, edges } = await loadProjectTaskSchedule(project, tasks)
    const hasPredecessor = new Set(edges.map((e) => e.successorId))
    for (const [i, task] of tasks.entries()) {
      if (!OPEN_TASK_STATUSES.includes(task.status)) continue
      const href = `/projects/${project.id}/tasks/${task.id}`
      const dated =
        task.startDate !== null || task.durationDays !== null || hasPredecessor.has(task.id)
      const placed = dated ? schedule.scheduled[i] : null

      const pastPlan = placed
        ? daysPastPlan(placed.end, { done: false, assigned: task.assignee !== null }, today)
        : null
      if (placed && pastPlan !== null && task.assignee !== null) {
        const detail = pastPlanDetail(
          { assigneeName: task.assignee.name, lastUpdateAt: await lastUpdate(task) },
          today,
        )
        const title = `“${task.title}” is ${plural(pastPlan, 'day')} past plan`
        for (const owner of owners) {
          await tell(
            owner,
            { workItemId: task.id, stage: 'needs_decision', finishBy: placed.end },
            {
              role: 'owner',
              kind: 'needs_decision',
              group: project.title,
              href,
              text: `${title}. ${detail}`,
            },
            {
              type: 'task_needs_decision',
              title,
              body: detail,
              entityId: task.id,
              refresh: true,
              always: true,
            },
          )
        }
      }

      if (task.deadline) {
        const finishBy = placed
          ? laterOf(startOfUtcDay(task.deadline), placed.end)
          : startOfUtcDay(task.deadline)
        await remind(
          { ...task, deadline: task.deadline },
          finishBy,
          placed?.start ?? null,
          owners,
          project.title,
          href,
          pastPlan !== null,
        )
      }
    }
  }

  // ── Quick Tasks ──────────────────────────────────────────────────────────────
  const quickTasks = await prisma.workItem.findMany({
    where: {
      type: WorkItemType.QUICK_TASK,
      status: { in: OPEN_QUICK_TASK_STATUSES },
      deadline: { not: null },
    },
  })
  const admins = (
    await prisma.volunteer.findMany({
      where: { isAdmin: true, deletedAt: null },
      select: { id: true },
    })
  ).map((a) => a.id)
  for (const qt of quickTasks) {
    const deadline = qt.deadline
    if (!deadline) continue // the query asked for one; this narrows the type
    await remind(
      { ...qt, deadline },
      startOfUtcDay(deadline),
      null,
      qt.creatorId !== null ? [qt.creatorId] : admins,
      'Quick Tasks',
      `/quick-tasks/${qt.id}`,
      false,
    )
  }

  // ── Project deadlines and slip ───────────────────────────────────────────────
  const withDeadline = projects.flatMap((p) =>
    p.deadline !== null && p.assigneeId !== null
      ? [{ ...p, deadline: p.deadline, owner: p.assigneeId }]
      : [],
  )
  const late = await lateProjects(withDeadline)
  for (const project of withDeadline) {
    const owner = project.owner
    const deadline = startOfUtcDay(project.deadline)
    const href = `/projects/${project.id}#timeline`
    const daysLate = late.get(project.id) ?? 0
    const previous = await prisma.finishByReminder.findFirst({
      where: { workItemId: project.id, recipientId: owner, stage: { startsWith: 'plan_slip:' } },
      orderBy: { createdAt: 'desc' },
      select: { stage: true },
    })
    const lastAlerted = previous ? parseInt(previous.stage.slice('plan_slip:'.length), 10) : null
    if (shouldAlertSlip(daysLate, lastAlerted)) {
      const text = `The plan now finishes ${plural(daysLate, 'day')} after the project deadline (${formatDateShort(deadline)})`
      await tell(
        owner,
        { workItemId: project.id, stage: `plan_slip:${daysLate}`, finishBy: deadline },
        { role: 'owner', kind: 'plan_slip', group: project.title, href, text },
        {
          type: 'plan_slip',
          title: `${project.title}: ${text.toLowerCase()}`,
          body: null,
          entityId: project.id,
        },
      )
    }
    const toGo = diffInDays(today, deadline)
    if (toGo <= 1) {
      const kind = toGo === 1 ? 'due_tomorrow' : toGo === 0 ? 'due_today' : 'overdue'
      const text =
        toGo === 1
          ? 'The project deadline is tomorrow'
          : toGo === 0
            ? 'The project deadline is today'
            : `The project deadline passed ${plural(-toGo, 'day')} ago`
      await tell(
        owner,
        { workItemId: project.id, stage: `project_${kind}`, finishBy: deadline },
        { role: 'owner', kind, group: project.title, href, text },
      )
    }
  }

  // ── What happened on projects I lead in the last day ─────────────────────────
  const since = addDays(now, -1)
  for (const project of projects) {
    const owners = [
      ...new Set([
        ...(project.assigneeId !== null ? [project.assigneeId] : []),
        ...project.deputies.map((d) => d.volunteerId),
      ]),
    ]
    if (owners.length === 0) continue
    const [comments, done, claimed, interests] = await Promise.all([
      prisma.workItemComment.findMany({
        where: {
          createdAt: { gte: since },
          deletedAt: null,
          OR: [{ workItemId: project.id }, { workItem: { parentId: project.id } }],
        },
        include: {
          author: { select: { name: true } },
          workItem: { select: { id: true, title: true, type: true } },
        },
      }),
      prisma.workItem.findMany({
        where: { parentId: project.id, completedAt: { gte: since } },
        select: { id: true, title: true },
      }),
      prisma.workItem.findMany({
        where: { parentId: project.id, startedAt: { gte: since }, assigneeId: { not: null } },
        select: { id: true, title: true, assigneeId: true, assignee: { select: { name: true } } },
      }),
      prisma.workItemInterest.findMany({
        where: {
          workItemId: project.id,
          status: InterestStatus.pending,
          createdAt: { gte: since },
        },
        include: { volunteer: { select: { name: true } } },
      }),
    ])
    for (const owner of owners) {
      const activity = (workItemId: number, stage: string, text: string, href: string) =>
        tell(
          owner,
          { workItemId, stage: `activity:${stage}`, finishBy: today },
          { role: 'owner', kind: 'activity', group: project.title, href, text },
        )
      for (const c of comments) {
        if (c.authorId === owner) continue
        const onTask = c.workItem.type === WorkItemType.TASK
        await activity(
          c.workItem.id,
          `comment:${c.id}`,
          `${c.author?.name ?? 'Someone'} posted on ${onTask ? `“${c.workItem.title}”` : 'the project'}`,
          onTask
            ? `/projects/${project.id}/tasks/${c.workItem.id}`
            : `/projects/${project.id}#discussion`,
        )
      }
      for (const t of done) {
        await activity(
          t.id,
          'done',
          `“${t.title}” is done`,
          `/projects/${project.id}/tasks/${t.id}`,
        )
      }
      for (const t of claimed) {
        if (t.assigneeId === owner) continue
        await activity(
          t.id,
          'claimed',
          `${t.assignee?.name ?? 'Someone'} took “${t.title}”`,
          `/projects/${project.id}/tasks/${t.id}`,
        )
      }
      for (const i of interests) {
        await activity(
          project.id,
          `interest:${i.id}`,
          `${i.volunteer.name} wants to help`,
          `/projects/${project.id}#people`,
        )
      }
    }
  }

  // ── One email per person ─────────────────────────────────────────────────────
  let emails = 0
  if (isEmailConfigured()) {
    for (const [recipientId, personLines] of lines) {
      const who = await person(recipientId)
      if (!who?.email || who.dailySummary !== DailySummaryPreference.email_and_in_app) continue
      const sent = await sendDailySummaryEmail({
        to: who.email,
        name: who.name,
        subject: summarySubject(personLines),
        sections: summarySections(personLines),
      })
      if (sent) emails++
    }
  }

  const result = { recipients: lines.size, notifications, emails }
  console.log(`[CRON DEADLINE REMINDERS] ${JSON.stringify(result)}`)
  return result
}
