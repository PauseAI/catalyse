import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createProject, createTask } from '@/test/factories'
import { computeSchedule, startOfUtcDay } from './schedule'
import {
  toScheduleInput,
  spanDays,
  loadTaskEdges,
  loadProjectEdges,
  resolveProjectOrigin,
  scheduleProjectsByIds,
  loadProjectTaskSchedule,
} from './project-schedule'

const today = new Date('2026-06-01T00:00:00Z')

describe('toScheduleInput / spanDays', () => {
  it('defaults isAnchor, reads fixed timing and measures an inclusive span', () => {
    const input = toScheduleInput({
      id: 1,
      startDate: null,
      durationDays: 2,
      deadline: null,
      baselineStartDate: null,
      baselineDurationDays: null,
      startedAt: null,
      completedAt: null,
      timing: 'flexible',
    })
    expect(input.isAnchor).toBe(false)
    expect(input.fixed).toBe(false)
    expect(toScheduleInput({ ...input, timing: 'fixed' }).fixed).toBe(true)
    expect(spanDays(computeSchedule([], [], today))).toBe(1)
    expect(spanDays(computeSchedule([input], [], today))).toBe(2)
  })
})

describe('edge loading', () => {
  it('loads only task edges within the project, and project-level edges globally', async () => {
    const p1 = await createProject()
    const p2 = await createProject()
    const t1 = await createTask(p1.id)
    const t2 = await createTask(p1.id)
    const t3 = await createTask(p2.id)
    await prisma.workItemDependency.createMany({
      data: [
        { predecessorId: t1.id, successorId: t2.id },
        { predecessorId: t2.id, successorId: t3.id },
        { predecessorId: p1.id, successorId: p2.id },
      ],
    })
    expect(await loadTaskEdges(p1.id)).toEqual([{ predecessorId: t1.id, successorId: t2.id }])
    expect(await loadProjectEdges()).toEqual([{ predecessorId: p1.id, successorId: p2.id }])
  })
})

describe('resolveProjectOrigin', () => {
  it('uses a pinned start, else today when unlinked', async () => {
    const pinned = await createProject({ startDate: new Date('2026-03-03T15:00:00Z') })
    expect(await resolveProjectOrigin(pinned, today)).toEqual(new Date('2026-03-03T00:00:00Z'))
    const free = await createProject()
    expect(await resolveProjectOrigin(free, today)).toEqual(startOfUtcDay(today))
    expect(await resolveProjectOrigin(free)).toEqual(startOfUtcDay(new Date()))
  })

  it('runs the portfolio pass for a project with a project-level predecessor', async () => {
    const pred = await createProject({ durationDays: 5 })
    const succ = await createProject()
    await prisma.workItemDependency.create({
      data: { predecessorId: pred.id, successorId: succ.id },
    })
    expect(await resolveProjectOrigin(succ, today)).toEqual(new Date('2026-06-06T00:00:00Z'))
  })
})

describe('scheduleProjectsByIds', () => {
  it('uses the task span as a project duration when none is set', async () => {
    const pred = await createProject()
    const a = await createTask(pred.id, { durationDays: 2 })
    const b = await createTask(pred.id, { durationDays: 3 })
    await prisma.workItemDependency.create({ data: { predecessorId: a.id, successorId: b.id } })
    const empty = await createProject()
    const succ = await createProject()
    const edges = [
      { predecessorId: pred.id, successorId: succ.id },
      { predecessorId: empty.id, successorId: succ.id },
    ]
    const schedule = await scheduleProjectsByIds([pred.id, empty.id, succ.id], edges, today)
    expect(schedule.byId.get(pred.id)?.end).toEqual(new Date('2026-06-05T00:00:00Z'))
    expect(schedule.byId.get(empty.id)?.end).toEqual(new Date('2026-06-01T00:00:00Z'))
    expect(schedule.byId.get(succ.id)?.start).toEqual(new Date('2026-06-06T00:00:00Z'))
    const defaulted = await scheduleProjectsByIds([empty.id], [])
    expect(defaulted.byId.get(empty.id)?.start).toEqual(startOfUtcDay(new Date()))
  })
})

describe('loadProjectTaskSchedule', () => {
  it('places tasks from the resolved origin with their edges', async () => {
    const p = await createProject({ startDate: new Date('2026-06-10T00:00:00Z') })
    const a = await createTask(p.id, { durationDays: 2 })
    const b = await createTask(p.id, { durationDays: 1 })
    await prisma.workItemDependency.create({ data: { predecessorId: a.id, successorId: b.id } })
    const tasks = await prisma.workItem.findMany({ where: { parentId: p.id } })
    const { schedule, edges, origin } = await loadProjectTaskSchedule(p, tasks)
    expect(origin).toEqual(new Date('2026-06-10T00:00:00Z'))
    expect(edges).toHaveLength(1)
    expect(schedule.byId.get(b.id)?.start).toEqual(new Date('2026-06-12T00:00:00Z'))
  })
})
