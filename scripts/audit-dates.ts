/**
 * Read-only audit of deadlines and schedules (Phase 3, D-00). Prints counts only — no titles,
 * names or ids — so the output can be pasted into a report.
 *
 * Usage:
 *   npx tsx scripts/audit-dates.ts            # the database at DATABASE_URL
 *
 * A project's origin is its pinned start, else today; the portfolio pass for projects that
 * follow other projects is skipped, which only shifts derived dates, not the counts by kind.
 */

import { fileURLToPath } from 'node:url'
import {
  computeSchedule,
  diffInDays,
  startOfUtcDay,
  type ScheduleEdge,
  type ScheduleInput,
} from '@/lib/schedule'

export type AuditItem = {
  id: number
  type: 'PROJECT' | 'TASK' | 'QUICK_TASK'
  status: string
  parentId: number | null
  deadline: Date | null
  startDate: Date | null
  durationDays: number | null
  baselineStartDate: Date | null
  baselineDurationDays: number | null
  startedAt: Date | null
  completedAt: Date | null
  isAnchor: boolean
}

const CLOSED = new Set(['completed', 'archived'])

/** Buckets for planned end minus deadline: negative is days to spare, positive days late. */
const LATE_BUCKETS: [string, (d: number) => boolean][] = [
  ['30+ days to spare', (d) => d < -30],
  ['8-30 days to spare', (d) => d >= -30 && d <= -8],
  ['1-7 days to spare', (d) => d >= -7 && d <= -1],
  ['on the day', (d) => d === 0],
  ['1-7 days late', (d) => d >= 1 && d <= 7],
  ['8-30 days late', (d) => d >= 8 && d <= 30],
  ['30+ days late', (d) => d > 30],
]

type KindCounts = {
  total: number
  open: number
  deadline: number
  schedule: number
  both: number
  neither: number
  deadlineOnly: number
  scheduleOnly: number
  overdueOpen: number
}

export type AuditReport = {
  byType: Record<AuditItem['type'], KindCounts>
  tasksWithBoth: {
    count: number
    daysLate: Record<string, number>
    endAfterDeadline: number
    oneDayBarPinnedOnOrigin: number
  }
  projects: {
    total: number
    withTasks: number
    withAnchor: number
    withDeadline: number
    deadlineBeforeForecast: number
    withMidPlanMilestone: number
    withStackedPins: number
    tasksInStackedPins: number
  }
}

function emptyCounts(): KindCounts {
  return {
    total: 0,
    open: 0,
    deadline: 0,
    schedule: 0,
    both: 0,
    neither: 0,
    deadlineOnly: 0,
    scheduleOnly: 0,
    overdueOpen: 0,
  }
}

function toInput(item: AuditItem): ScheduleInput {
  return {
    id: item.id,
    startDate: item.startDate,
    durationDays: item.durationDays,
    deadline: item.deadline,
    baselineStartDate: item.baselineStartDate,
    baselineDurationDays: item.baselineDurationDays,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    isAnchor: item.isAnchor,
  }
}

/** Pins shared by this many tasks on one day look like "Add all to timeline" rather than a plan. */
const STACK_THRESHOLD = 3

export function auditDates(items: AuditItem[], edges: ScheduleEdge[], today: Date): AuditReport {
  const todayDay = startOfUtcDay(today)
  const inEdge = new Set(edges.flatMap((e) => [e.predecessorId, e.successorId]))

  const byType: AuditReport['byType'] = {
    PROJECT: emptyCounts(),
    TASK: emptyCounts(),
    QUICK_TASK: emptyCounts(),
  }
  for (const item of items) {
    const c = byType[item.type]
    const open = !CLOSED.has(item.status)
    const hasDeadline = item.deadline !== null
    const hasSchedule = item.startDate !== null || item.durationDays !== null || inEdge.has(item.id)
    c.total++
    if (open) c.open++
    if (hasDeadline) c.deadline++
    if (hasSchedule) c.schedule++
    if (hasDeadline && hasSchedule) c.both++
    if (!hasDeadline && !hasSchedule) c.neither++
    if (hasDeadline && !hasSchedule) c.deadlineOnly++
    if (!hasDeadline && hasSchedule) c.scheduleOnly++
    if (open && hasDeadline && startOfUtcDay(item.deadline!).getTime() < todayDay.getTime()) {
      c.overdueOpen++
    }
  }

  const tasksWithBoth: AuditReport['tasksWithBoth'] = {
    count: 0,
    daysLate: Object.fromEntries(LATE_BUCKETS.map(([label]) => [label, 0])),
    endAfterDeadline: 0,
    oneDayBarPinnedOnOrigin: 0,
  }
  const projectItems = items.filter((i) => i.type === 'PROJECT')
  const projects: AuditReport['projects'] = {
    total: projectItems.length,
    withTasks: 0,
    withAnchor: 0,
    withDeadline: 0,
    deadlineBeforeForecast: 0,
    withMidPlanMilestone: 0,
    withStackedPins: 0,
    tasksInStackedPins: 0,
  }

  for (const project of projectItems) {
    const tasks = items.filter((i) => i.type === 'TASK' && i.parentId === project.id)
    if (project.deadline) projects.withDeadline++
    if (tasks.length === 0) continue
    projects.withTasks++

    const ids = new Set(tasks.map((t) => t.id))
    const taskEdges = edges.filter((e) => ids.has(e.predecessorId) && ids.has(e.successorId))
    const origin = project.startDate ? startOfUtcDay(project.startDate) : todayDay
    const schedule = computeSchedule(tasks.map(toInput), taskEdges, origin)

    if (tasks.some((t) => t.isAnchor)) projects.withAnchor++
    const scheduled = tasks.filter(
      (t) => t.startDate !== null || t.durationDays !== null || inEdge.has(t.id),
    )
    if (
      project.deadline &&
      scheduled.length > 0 &&
      diffInDays(project.deadline, schedule.end) > 0
    ) {
      projects.deadlineBeforeForecast++
    }

    // A milestone with work on both sides is the shape of a key date (the protest example).
    const hasPred = new Set(taskEdges.map((e) => e.successorId))
    const hasSucc = new Set(taskEdges.map((e) => e.predecessorId))
    if (tasks.some((t) => t.durationDays === 0 && hasPred.has(t.id) && hasSucc.has(t.id))) {
      projects.withMidPlanMilestone++
    }

    const pinsByDay = new Map<number, number>()
    for (const t of tasks) {
      if (!t.startDate) continue
      const day = startOfUtcDay(t.startDate).getTime()
      pinsByDay.set(day, (pinsByDay.get(day) ?? 0) + 1)
    }
    const stacked = [...pinsByDay.values()].filter((n) => n >= STACK_THRESHOLD)
    if (stacked.length > 0) {
      projects.withStackedPins++
      projects.tasksInStackedPins += stacked.reduce((a, b) => a + b, 0)
    }

    for (const t of scheduled) {
      if (!t.deadline) continue
      const placed = schedule.byId.get(t.id)!
      const late = diffInDays(t.deadline, placed.end)
      tasksWithBoth.count++
      for (const [label, test] of LATE_BUCKETS) if (test(late)) tasksWithBoth.daysLate[label]++
      if (late > 0) tasksWithBoth.endAfterDeadline++
      if (
        t.startDate &&
        (t.durationDays ?? 1) === 1 &&
        startOfUtcDay(t.startDate).getTime() === origin.getTime()
      ) {
        tasksWithBoth.oneDayBarPinnedOnOrigin++
      }
    }
  }

  return { byType, tasksWithBoth, projects }
}

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const [items, edges] = await Promise.all([
    prisma.workItem.findMany({
      select: {
        id: true,
        type: true,
        status: true,
        parentId: true,
        deadline: true,
        startDate: true,
        durationDays: true,
        baselineStartDate: true,
        baselineDurationDays: true,
        startedAt: true,
        completedAt: true,
        isAnchor: true,
      },
    }),
    prisma.workItemDependency.findMany({
      select: { predecessorId: true, successorId: true, lagDays: true },
    }),
  ])
  const baselined = await prisma.workItem.count({ where: { baselineSetAt: { not: null } } })
  const report = auditDates(items as AuditItem[], edges, new Date())
  console.log(JSON.stringify({ ...report, itemsWithOriginalPlan: baselined }, null, 2))
  await prisma.$disconnect()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
