import type { Prisma } from '@/generated/prisma/client'
import { InterestStatus, ProjectStatus, TaskStatus, WorkItemType } from '@/generated/prisma/enums'

/**
 * A volunteer's track record: each project they proposed, led, deputised on or joined, and the
 * tasks they led or helped on within it, current work first.
 */

export type ProjectRole = 'creator' | 'owner' | 'deputy' | 'member'
export type TaskRole = 'assignee' | 'helper'

export type RoleStint<R> = {
  role: R
  /** When they took it on, where that was recorded. */
  since: Date | null
  /** They left or were taken off; the work itself may carry on. */
  ended: boolean
}

export type TaskHistoryEntry = RoleStint<TaskRole> & {
  id: number
  title: string
  status: string
  completedAt: Date | null
  current: boolean
}

export type ProjectHistoryEntry = {
  id: number
  title: string
  status: string
  completedAt: Date | null
  current: boolean
  roles: RoleStint<ProjectRole>[]
  tasks: TaskHistoryEntry[]
}

const ROLE_ORDER: ProjectRole[] = ['owner', 'deputy', 'member', 'creator']

// On it now, or was until they left or were taken off. Only an accepted interest has a
// response recorded before it is withdrawn; a withdrawn application has none.
const joinedWhere = (volunteerId: number): Prisma.WorkItemInterestWhereInput => ({
  volunteerId,
  OR: [
    { status: { in: [InterestStatus.accepted, InterestStatus.removed] } },
    { status: InterestStatus.withdrawn, respondedAt: { not: null } },
  ],
})

const memberWhere = (volunteerId: number): Prisma.WorkItemInterestWhereInput => ({
  ...joinedWhere(volunteerId),
  interestType: 'want_to_contribute',
})

const helperWhere = (volunteerId: number): Prisma.WorkItemInterestWhereInput => ({
  ...joinedWhere(volunteerId),
  interestType: 'want_to_help_task',
})

const taskWhere = (volunteerId: number): Prisma.WorkItemWhereInput => ({
  type: WorkItemType.TASK,
  OR: [{ assigneeId: volunteerId }, { interests: { some: helperWhere(volunteerId) } }],
})

/** Projects `volunteerId` has held any role on, or led or helped on a task in. */
export const historyWhere = (volunteerId: number): Prisma.WorkItemWhereInput => ({
  type: WorkItemType.PROJECT,
  OR: [
    { creatorId: volunteerId },
    { assigneeId: volunteerId },
    { deputies: { some: { volunteerId } } },
    { interests: { some: memberWhere(volunteerId) } },
    { children: { some: taskWhere(volunteerId) } },
  ],
})

const stintSelect = { status: true, interestType: true, createdAt: true, respondedAt: true }

export const historySelect = (volunteerId: number) =>
  ({
    id: true,
    title: true,
    status: true,
    creatorId: true,
    assigneeId: true,
    createdAt: true,
    completedAt: true,
    deputies: { where: { volunteerId }, select: { createdAt: true } },
    interests: {
      where: {
        ...joinedWhere(volunteerId),
        interestType: { in: ['want_to_contribute', 'want_to_own'] },
      },
      select: stintSelect,
    },
    children: {
      where: taskWhere(volunteerId),
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        status: true,
        assigneeId: true,
        claimedAt: true,
        completedAt: true,
        interests: { where: helperWhere(volunteerId), select: stintSelect },
      },
    },
  }) satisfies Prisma.WorkItemSelect

type Stint = {
  status: string
  interestType: string
  createdAt: Date | null
  respondedAt: Date | null
}

export type HistoryRow = {
  id: number
  title: string
  status: string
  creatorId: number | null
  assigneeId: number | null
  createdAt: Date | null
  completedAt: Date | null
  deputies: { createdAt: Date }[]
  interests: Stint[]
  children: {
    id: number
    title: string
    status: string
    assigneeId: number | null
    claimedAt: Date | null
    completedAt: Date | null
    interests: Stint[]
  }[]
}

const joined = (s: Stint) => s.respondedAt ?? s.createdAt

function projectRoles(row: HistoryRow, volunteerId: number): RoleStint<ProjectRole>[] {
  const roles: RoleStint<ProjectRole>[] = []
  const bid = (type: string) => row.interests.find((i) => i.interestType === type)
  if (row.creatorId === volunteerId) {
    roles.push({ role: 'creator', since: row.createdAt, ended: false })
  }
  if (row.assigneeId === volunteerId) {
    const offer = bid('want_to_own')
    const since = offer ? joined(offer) : row.creatorId === volunteerId ? row.createdAt : null
    roles.push({ role: 'owner', since, ended: false })
  }
  const deputy = row.deputies[0]
  if (deputy) roles.push({ role: 'deputy', since: deputy.createdAt, ended: false })
  const member = bid('want_to_contribute')
  // An owner or deputy is a member too; the larger role says so.
  if (member && !roles.some((r) => r.role !== 'creator')) {
    roles.push({
      role: 'member',
      since: joined(member),
      ended: member.status !== InterestStatus.accepted,
    })
  }
  return roles.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
}

function taskEntries(row: HistoryRow, volunteerId: number): TaskHistoryEntry[] {
  return row.children.map((t) => {
    const done = t.status === TaskStatus.completed
    const base = { id: t.id, title: t.title, status: t.status, completedAt: t.completedAt }
    if (t.assigneeId === volunteerId) {
      return { ...base, role: 'assignee', since: t.claimedAt, ended: false, current: !done }
    }
    const helping = t.interests[0]
    // Done work keeps its helpers; taken off or leaving before then ends their part.
    const ended = helping.status !== InterestStatus.accepted
    return { ...base, role: 'helper', since: joined(helping), ended, current: !done && !ended }
  })
}

/** When the volunteer last did anything recorded on the project, for ordering past work. */
function lastActive(entry: ProjectHistoryEntry): number {
  const dates = [
    entry.completedAt,
    ...entry.roles.map((r) => r.since),
    ...entry.tasks.flatMap((t) => [t.since, t.completedAt]),
  ]
  return Math.max(0, ...dates.map((d) => d?.getTime() ?? 0))
}

/**
 * Each project's roles and tasks for `volunteerId`, current work first, then the most recent.
 * A project stays current while it is unfinished and they hold any part in it.
 */
export function projectHistory(rows: HistoryRow[], volunteerId: number): ProjectHistoryEntry[] {
  const entries = rows.map((row): ProjectHistoryEntry => {
    const roles = projectRoles(row, volunteerId)
    const tasks = taskEntries(row, volunteerId)
    const holdsPart = roles.some((r) => !r.ended) || tasks.some((t) => t.current)
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      completedAt: row.completedAt,
      current: row.status !== ProjectStatus.completed && holdsPart,
      roles,
      tasks,
    }
  })
  return entries.sort(
    (a, b) => Number(b.current) - Number(a.current) || lastActive(b) - lastActive(a),
  )
}
