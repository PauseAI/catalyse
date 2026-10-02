import { prisma } from '@/lib/prisma'
import { projectScopeWhere, type ProjectViewer } from '@/lib/work-item'
import { authedProcedure } from '../procedures'
import { ADVERTISABLE_STATUSES, TERMINAL_STATUSES, projectStatusLabel } from '@/lib/project-status'
import {
  INTEREST_STATUS_LABELS,
  QUICK_TASK_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from '@/lib/status-labels'
import { daysQuiet } from '@/lib/staleness'
import { lateProjects, pastPlanTasks } from '@/lib/project-schedule'
import { pastPlanDetail } from '@/lib/replan'
import { plural } from '@/lib/plural'
import {
  ApprovalStatus,
  ContactRequestStatus,
  InterestStatus,
  ProjectStatus,
  QuickTaskStatus,
  TaskStatus,
  TeamMembershipRole,
  WorkItemType,
} from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'

// Home orders the page as: what needs me, what I'm doing, then what I could pick up.

export type AttentionKind =
  | 'applicants'
  | 'changes_requested'
  | 'quiet_task'
  | 'past_plan'
  | 'mention'
  | 'submission'
  | 'invite'
  | 'contact_request'

export type AttentionItem = {
  key: string
  kind: AttentionKind
  title: string
  detail: string | null
  href: string
  action: string
  /** Set for an item that is a notification, so opening it marks it read. */
  notificationId: number | null
  at: Date | null
}

export type WorkKind = 'project' | 'task' | 'team'

export type WorkRow = {
  key: string
  kind: WorkKind
  title: string
  href: string
  role: 'Lead' | 'Deputy' | 'Helper' | 'Proposed' | 'Task' | 'Member'
  status: string | null
  /** The project a task belongs to. */
  context: string | null
  /** Finished or archived work, listed after the rest. */
  done: boolean
  /** A project whose plan runs past its deadline, by this many days. */
  daysLate?: number
  /** A task's deadline, shown with its Overdue flag. */
  deadline?: Date | null
  /** A task of mine whose plan ended this many days ago while it is not done. */
  pastPlanDays?: number
}

export type FindItem = { id: number; title: string; href: string; reason: string | null }
export type FindRow = { count: number; items: FindItem[] }

const FIND_ROW_SIZE = 3

type Viewer = ProjectViewer & { id: number }

/** Where a claimed task is worked on; a project task with no project has nowhere better. */
function taskHref(t: { id: number; type: string; parentId: number | null }): string {
  if (t.type === WorkItemType.QUICK_TASK) return `/quick-tasks/${t.id}`
  return t.parentId ? `/projects/${t.parentId}/tasks/${t.id}` : '/dashboard'
}

async function attentionFor(viewer: Viewer): Promise<AttentionItem[]> {
  const [applicants, changes, quietTasks, mentions, submissions, sentBack, invites, connects] =
    await Promise.all([
      prisma.workItemInterest.findMany({
        where: {
          status: InterestStatus.pending,
          workItem: { type: WorkItemType.PROJECT, assigneeId: viewer.id },
        },
        include: {
          volunteer: { select: { name: true } },
          workItem: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.projectReviewRequest.findMany({
        where: {
          resolvedAt: null,
          project: {
            status: ProjectStatus.needs_discussion,
            OR: [{ creatorId: viewer.id }, { assigneeId: viewer.id }],
          },
        },
        include: { project: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.workItem.findMany({
        where: {
          assigneeId: viewer.id,
          changesRequestedNote: null,
          OR: [
            { type: WorkItemType.TASK, status: TaskStatus.in_progress },
            { type: WorkItemType.QUICK_TASK, status: QuickTaskStatus.in_progress },
          ],
        },
        select: { id: true, type: true, title: true, parentId: true, updatedAt: true },
      }),
      prisma.notification.findMany({
        where: { volunteerId: viewer.id, type: 'mention', readAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      // Quick Tasks I set, or any nobody set when I'm an admin; tasks on projects I own or
      // am a deputy on.
      prisma.workItem.findMany({
        where: {
          status: QuickTaskStatus.under_review,
          OR: [
            {
              type: WorkItemType.QUICK_TASK,
              OR: [{ creatorId: viewer.id }, ...(viewer.isAdmin ? [{ creatorId: null }] : [])],
            },
            {
              type: WorkItemType.TASK,
              parent: {
                OR: [{ assigneeId: viewer.id }, { deputies: { some: { volunteerId: viewer.id } } }],
              },
            },
          ],
        },
        select: { id: true, type: true, title: true, parentId: true, submittedAt: true },
      }),
      prisma.workItem.findMany({
        where: {
          assigneeId: viewer.id,
          changesRequestedNote: { not: null },
          OR: [
            { type: WorkItemType.TASK, status: TaskStatus.in_progress },
            { type: WorkItemType.QUICK_TASK, status: QuickTaskStatus.in_progress },
          ],
        },
        select: {
          id: true,
          type: true,
          title: true,
          parentId: true,
          changesRequestedNote: true,
          reviewedAt: true,
        },
      }),
      prisma.workItemInterest.findMany({
        where: { volunteerId: viewer.id, status: InterestStatus.invited },
        include: {
          workItem: { select: { id: true, title: true } },
          invitedBy: { select: { name: true } },
        },
      }),
      prisma.contactRequest.findMany({
        where: { toVolunteerId: viewer.id, status: ContactRequestStatus.pending },
        include: { from: { select: { id: true, name: true } } },
      }),
    ])

  const items: AttentionItem[] = []

  const byProject = new Map<number, typeof applicants>()
  for (const a of applicants) {
    byProject.set(a.workItem.id, [...(byProject.get(a.workItem.id) ?? []), a])
  }
  for (const [projectId, rows] of byProject) {
    const who = rows.length === 1 ? `${rows[0].volunteer.name} wants` : `${rows.length} people want`
    items.push({
      key: `applicants-${projectId}`,
      kind: 'applicants',
      title: `${who} to help on "${rows[0].workItem.title}"`,
      detail: null,
      href: `/projects/${projectId}`,
      action: 'Review',
      notificationId: null,
      at: rows[0].createdAt,
    })
  }

  // One per project: a newer round has already closed the older.
  for (const r of changes) {
    items.push({
      key: `changes-${r.project.id}`,
      kind: 'changes_requested',
      title: `Changes requested on "${r.project.title}"`,
      detail: r.message,
      href: `/projects/${r.project.id}`,
      action: 'Open',
      notificationId: null,
      at: r.createdAt,
    })
  }

  for (const c of connects) {
    items.push({
      key: `contact-${c.id}`,
      kind: 'contact_request',
      title: `${c.from.name} would like to connect`,
      detail: c.message,
      href: `/volunteers/${c.from.id}`,
      action: 'See profile',
      notificationId: null,
      at: c.createdAt,
    })
  }

  for (const i of invites) {
    items.push({
      key: `invite-${i.id}`,
      kind: 'invite',
      title: `${i.invitedBy?.name ?? 'The owner'} invited you to help on "${i.workItem.title}"`,
      detail: i.message,
      href: `/projects/${i.workItem.id}`,
      action: 'Answer',
      notificationId: null,
      at: i.createdAt,
    })
  }

  for (const t of sentBack) {
    items.push({
      key: `task-changes-${t.id}`,
      kind: 'changes_requested',
      title: `Changes requested on "${t.title}"`,
      detail: t.changesRequestedNote,
      href: taskHref(t),
      action: 'Open',
      notificationId: null,
      at: t.reviewedAt,
    })
  }

  for (const t of quietTasks) {
    const days = daysQuiet(t.updatedAt)
    if (days === null) continue
    items.push({
      key: `quiet-${t.id}`,
      kind: 'quiet_task',
      title: `"${t.title}": no update for ${days} days`,
      detail: null,
      href: taskHref(t),
      action: 'Add update',
      notificationId: null,
      at: t.updatedAt,
    })
  }

  for (const n of mentions) {
    items.push({
      key: `mention-${n.id}`,
      kind: 'mention',
      title: n.title,
      detail: n.body,
      href: n.link ?? '/dashboard',
      action: 'Open',
      notificationId: n.id,
      at: n.createdAt,
    })
  }

  for (const t of submissions) {
    items.push({
      key: `submission-${t.id}`,
      kind: 'submission',
      title: `"${t.title}" is submitted for review`,
      detail: null,
      href: taskHref(t),
      action: 'Review',
      notificationId: null,
      at: t.submittedAt,
    })
  }

  // A task past its plan waits on the owner's decision, so it goes above everything else.
  const led = await prisma.workItem.findMany({
    where: {
      type: WorkItemType.PROJECT,
      OR: [{ assigneeId: viewer.id }, { deputies: { some: { volunteerId: viewer.id } } }],
    },
    select: { id: true },
  })
  const decisions: AttentionItem[] = (await pastPlanTasks(led.map((p) => p.id))).map((t) => ({
    key: `past-plan-${t.id}`,
    kind: 'past_plan',
    title: `"${t.title}" is ${plural(t.daysPast, 'day')} past plan`,
    detail: pastPlanDetail(t),
    href: `/projects/${t.projectId}/tasks/${t.id}`,
    action: 'Decide',
    notificationId: null,
    at: null,
  }))

  return [...decisions, ...items.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))]
}

async function workFor(viewer: Viewer): Promise<WorkRow[]> {
  const projectSelect = {
    id: true,
    title: true,
    status: true,
    updatedAt: true,
    startDate: true,
    deadline: true,
  } as const
  const [owned, interests, proposed, tasks, memberships, deputyRows] = await Promise.all([
    prisma.workItem.findMany({
      where: { type: WorkItemType.PROJECT, assigneeId: viewer.id },
      select: projectSelect,
    }),
    prisma.workItemInterest.findMany({
      where: {
        volunteerId: viewer.id,
        status: { in: [InterestStatus.accepted, InterestStatus.pending] },
        workItem: { type: WorkItemType.PROJECT },
      },
      include: { workItem: { select: projectSelect } },
    }),
    prisma.workItem.findMany({
      where: {
        type: WorkItemType.PROJECT,
        creatorId: viewer.id,
        OR: [{ assigneeId: null }, { assigneeId: { not: viewer.id } }],
      },
      select: projectSelect,
    }),
    prisma.workItem.findMany({
      where: {
        assigneeId: viewer.id,
        OR: [
          {
            type: WorkItemType.TASK,
            status: { in: [TaskStatus.in_progress, TaskStatus.under_review] },
          },
          {
            type: WorkItemType.QUICK_TASK,
            status: { in: [QuickTaskStatus.in_progress, QuickTaskStatus.under_review] },
          },
        ],
      },
      include: { parent: { select: { title: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.teamMembership.findMany({
      where: { volunteerId: viewer.id },
      include: { team: { select: { id: true, name: true } } },
      orderBy: { joinedAt: 'desc' },
    }),
    prisma.projectDeputy.findMany({
      where: { volunteerId: viewer.id },
      select: { projectId: true },
    }),
  ])
  const deputyOf = new Set(deputyRows.map((d) => d.projectId))

  // A project appears once, under the closest tie: leading, deputising, helping, proposing,
  // applying.
  const projects = new Map<number, WorkRow & { updatedAt: Date | null }>()
  const projectRowsById = new Map<number, (typeof owned)[number]>()
  const addProject = (p: (typeof owned)[number], role: WorkRow['role'], status: string) => {
    if (projects.has(p.id)) return
    projectRowsById.set(p.id, p)
    projects.set(p.id, {
      key: `project-${p.id}`,
      kind: 'project',
      title: p.title,
      href: p.status === ProjectStatus.draft ? `/projects/${p.id}/edit` : `/projects/${p.id}`,
      role,
      status,
      context: null,
      done: TERMINAL_STATUSES.includes(p.status),
      updatedAt: p.updatedAt,
    })
  }
  for (const p of owned) addProject(p, 'Lead', projectStatusLabel(p.status))
  for (const i of interests.filter((i) => i.status === InterestStatus.accepted)) {
    addProject(
      i.workItem,
      deputyOf.has(i.workItem.id) ? 'Deputy' : 'Helper',
      projectStatusLabel(i.workItem.status),
    )
  }
  for (const p of proposed) addProject(p, 'Proposed', projectStatusLabel(p.status))
  for (const i of interests.filter((i) => i.status === InterestStatus.pending)) {
    addProject(
      i.workItem,
      i.interestType === 'want_to_own' ? 'Lead' : 'Helper',
      INTEREST_STATUS_LABELS[i.status],
    )
  }

  const late = await lateProjects([...projectRowsById.values()])
  for (const [id, row] of projects) {
    const days = late.get(id)
    if (days) row.daysLate = days
  }

  const projectRows = [...projects.values()]
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
    )
    .map(({ updatedAt: _updatedAt, ...row }) => row)

  const pastPlan = new Map(
    (
      await pastPlanTasks([
        ...new Set(
          tasks.flatMap((t) => (t.type === WorkItemType.TASK && t.parentId ? [t.parentId] : [])),
        ),
      ])
    ).map((p) => [p.id, p.daysPast]),
  )
  const taskRows: WorkRow[] = tasks.map((t) => ({
    key: `task-${t.id}`,
    kind: 'task',
    title: t.title,
    href: taskHref(t),
    role: 'Task',
    status:
      t.type === WorkItemType.QUICK_TASK
        ? QUICK_TASK_STATUS_LABELS[t.status]
        : TASK_STATUS_LABELS[t.status],
    context: t.parent?.title ?? null,
    done: false,
    deadline: t.deadline,
    pastPlanDays: pastPlan.get(t.id),
  }))

  const teamRows: WorkRow[] = memberships.map((m) => ({
    key: `team-${m.team.id}`,
    kind: 'team',
    title: m.team.name,
    href: `/teams/${m.team.id}`,
    role: m.role === TeamMembershipRole.leader ? 'Lead' : 'Member',
    status: null,
    context: null,
    done: false,
  }))

  return [...taskRows, ...projectRows.filter((r) => !r.done), ...teamRows].concat(
    projectRows.filter((r) => r.done),
  )
}

async function findFor(
  viewer: Viewer,
  skillIds: number[],
): Promise<{ quickTasks: FindRow; matches: FindRow; nearYou: FindRow }> {
  // Any interest, including a declined or withdrawn one, means it is not new to them.
  const involved = await prisma.workItemInterest.findMany({
    where: { volunteerId: viewer.id },
    select: { workItemId: true },
  })
  const excluded = [...involved.map((i) => i.workItemId), -1]

  // Live, unfinished projects this volunteer may see and is not already part of.
  const open: Prisma.WorkItemWhereInput = {
    type: WorkItemType.PROJECT,
    status: { in: ADVERTISABLE_STATUSES },
    id: { notIn: excluded },
    AND: [
      { OR: [{ isSeekingHelp: true }, { assigneeId: null }] },
      { OR: [{ assigneeId: null }, { assigneeId: { not: viewer.id } }] },
      { OR: [{ creatorId: null }, { creatorId: { not: viewer.id } }] },
      projectScopeWhere(viewer),
    ],
  }
  const matchWhere: Prisma.WorkItemWhereInput = {
    ...open,
    skills: { some: { skillId: { in: skillIds } } },
  }
  const nearWhere: Prisma.WorkItemWhereInput = { ...open, country: viewer.country }
  const quickWhere: Prisma.WorkItemWhereInput = {
    type: WorkItemType.QUICK_TASK,
    status: QuickTaskStatus.open,
    assigneeId: null,
  }

  const [quickCount, quick, matchCount, matches, nearCount, near] = await Promise.all([
    prisma.workItem.count({ where: quickWhere }),
    prisma.workItem.findMany({
      where: quickWhere,
      include: { skill: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: FIND_ROW_SIZE,
    }),
    skillIds.length > 0 ? prisma.workItem.count({ where: matchWhere }) : 0,
    skillIds.length > 0
      ? prisma.workItem.findMany({
          where: matchWhere,
          include: { skills: { include: { skill: { select: { id: true, name: true } } } } },
          orderBy: { createdAt: 'desc' },
          take: FIND_ROW_SIZE,
        })
      : [],
    viewer.country ? prisma.workItem.count({ where: nearWhere }) : 0,
    viewer.country
      ? prisma.workItem.findMany({
          where: nearWhere,
          select: { id: true, title: true, localGroup: true },
          orderBy: { createdAt: 'desc' },
          take: FIND_ROW_SIZE,
        })
      : [],
  ])

  const mine = new Set(skillIds)
  return {
    quickTasks: {
      count: quickCount,
      items: quick.map((t) => ({
        id: t.id,
        title: t.title,
        href: `/quick-tasks/${t.id}`,
        reason: t.skill ? `Skill: ${t.skill.name}` : null,
      })),
    },
    matches: {
      count: matchCount,
      items: matches.map((p) => ({
        id: p.id,
        title: p.title,
        href: `/projects/${p.id}`,
        reason: `Uses your skills: ${p.skills
          .filter((s) => mine.has(s.skill.id))
          .map((s) => s.skill.name)
          .join(', ')}`,
      })),
    },
    nearYou: {
      count: nearCount,
      items: near.map((p) => ({
        id: p.id,
        title: p.title,
        href: `/projects/${p.id}`,
        reason: p.localGroup ? `${p.localGroup}, ${viewer.country}` : `In ${viewer.country}`,
      })),
    },
  }
}

export const dashboardRouter = {
  get: authedProcedure.handler(async ({ context }) => {
    const volunteer = context.volunteer
    const viewer: Viewer = {
      id: volunteer.id,
      isAdmin: Boolean(volunteer.isAdmin),
      country: volunteer.country,
    }

    const me = await prisma.volunteer.findUnique({
      where: { id: volunteer.id },
      select: { emailConfirmed: true, skills: { select: { skillId: true } } },
    })
    const approvalWelcome = await prisma.notification.findFirst({
      where: { volunteerId: volunteer.id, type: 'application_approved', readAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    const isMember = volunteer.approvalStatus === ApprovalStatus.approved || viewer.isAdmin

    const [attention, work, find, hasTakenWork] = await Promise.all([
      isMember ? attentionFor(viewer) : [],
      isMember ? workFor(viewer) : [],
      isMember
        ? findFor(
            viewer,
            (me?.skills ?? []).map((s) => s.skillId),
          )
        : null,
      prisma.workItem.count({
        where: {
          assigneeId: volunteer.id,
          type: { in: [WorkItemType.TASK, WorkItemType.QUICK_TASK] },
        },
      }),
    ])

    const steps = {
      approved: volunteer.approvalStatus === ApprovalStatus.approved,
      emailConfirmed: me?.emailConfirmed ?? false,
      firstTask: hasTakenWork > 0,
    }
    const gettingStarted = viewer.isAdmin || Object.values(steps).every(Boolean) ? null : steps

    return {
      attention,
      work,
      find,
      gettingStarted,
      hasSkills: (me?.skills.length ?? 0) > 0,
      // Shown once as a welcome dialog; reading the notification dismisses it for good.
      approvalWelcome: approvalWelcome
        ? { notificationId: approvalWelcome.id, emailConfirmed: me?.emailConfirmed ?? false }
        : null,
    }
  }),
}
