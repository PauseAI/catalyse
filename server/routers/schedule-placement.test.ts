import { describe, it, expect } from 'vitest'
import { createVolunteer, createAdmin, createProject, createTask } from '@/test/factories'
import { clientAs } from '@/test/rpc'

/**
 * Where the scheduler puts each task and project, read back through
 * `projects.listTasks` and `projects.ganttOverview`: the placement rules, the
 * critical path, what a dependency does to its successor, and what a pin or a
 * deletion does to the rest.
 */

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ymd = (d: string | Date) => new Date(d).toISOString().slice(0, 10)

type Placed = {
  id: number
  start: string | Date
  end: string | Date
  isPinned: boolean
  isDerived: boolean
  pinnedBeforePredecessor: boolean
  breachesDeadline: boolean
  isCritical: boolean
  isAnchor: boolean
}

async function schedule(projectId: number) {
  const admin = await createAdmin()
  const result = await clientAs(admin).projects.listTasks({ projectId })
  return result as unknown as {
    tasks: { id: number }[]
    dependencies: { predecessorId: number; successorId: number; lagDays: number }[]
    scheduled: Placed[]
    scopeStart: string | Date
    scopeEnd: string | Date
    canManageTasks: boolean
  }
}

const placed = (s: Awaited<ReturnType<typeof schedule>>, id: number): Placed =>
  s.scheduled.find((x) => x.id === id)!

async function link(predecessorId: number, successorId: number, lagDays = 0) {
  const admin = await createAdmin()
  return clientAs(admin).dependencies.add({ predecessorId, successorId, lagDays })
}

describe('task placement', () => {
  it('places a dated task on its dates and a bare task at the project origin', async () => {
    const project = await createProject({ startDate: day('2026-03-02') })
    const pinned = await createTask(project.id, { startDate: day('2026-03-10'), durationDays: 5 })
    const bare = await createTask(project.id, { durationDays: 3 })

    const s = await schedule(project.id)
    expect(ymd(placed(s, pinned.id).start)).toBe('2026-03-10')
    expect(ymd(placed(s, pinned.id).end)).toBe('2026-03-14')
    expect(placed(s, pinned.id).isPinned).toBe(true)
    expect(ymd(placed(s, bare.id).start)).toBe('2026-03-02')
    expect(ymd(placed(s, bare.id).end)).toBe('2026-03-04')
  })

  it('starts the scope at the earliest task, even before the project origin', async () => {
    const project = await createProject()
    const past = await createTask(project.id, { startDate: day('2020-01-06'), durationDays: 4 })

    const s = await schedule(project.id)
    expect(ymd(placed(s, past.id).start)).toBe('2020-01-06')
    expect(new Date(s.scopeStart).getTime()).toBeLessThanOrEqual(
      new Date(placed(s, past.id).start).getTime(),
    )
  })

  it('flags a task whose computed end runs past its deadline', async () => {
    const project = await createProject({ startDate: day('2026-09-01') })
    const tight = await createTask(project.id, {
      startDate: day('2026-09-01'),
      durationDays: 10,
      deadline: day('2026-09-05'),
    })
    expect(placed(await schedule(project.id), tight.id).breachesDeadline).toBe(true)
  })
})

describe('dependencies and the schedule', () => {
  it('shifts the successor, and a longer predecessor cascades', async () => {
    const project = await createProject({ startDate: day('2026-04-01') })
    const a = await createTask(project.id, { startDate: day('2026-04-01'), durationDays: 5 })
    const b = await createTask(project.id, { durationDays: 2 })
    await link(a.id, b.id)

    let s = await schedule(project.id)
    expect(ymd(placed(s, b.id).start)).toBe('2026-04-06')
    expect(placed(s, b.id).isDerived).toBe(true)

    const admin = await createAdmin()
    await clientAs(admin).projects.updateTask({
      projectId: project.id,
      taskId: a.id,
      data: { durationDays: 7 },
    })
    s = await schedule(project.id)
    expect(ymd(placed(s, a.id).end)).toBe('2026-04-07')
    expect(ymd(placed(s, b.id).start)).toBe('2026-04-08')
  })

  it('adds the lag between predecessor and successor', async () => {
    const project = await createProject({ startDate: day('2026-05-01') })
    const a = await createTask(project.id, { startDate: day('2026-05-01'), durationDays: 3 })
    const b = await createTask(project.id, { durationDays: 2 })
    await link(a.id, b.id, 2)
    expect(ymd(placed(await schedule(project.id), b.id).start)).toBe('2026-05-06')
  })

  it('leaves a pinned successor where it is and flags a pin before its predecessor', async () => {
    const project = await createProject({ startDate: day('2026-06-01') })
    const a = await createTask(project.id, { startDate: day('2026-06-01'), durationDays: 10 })
    const b = await createTask(project.id, { startDate: day('2026-06-05'), durationDays: 2 })
    await link(a.id, b.id)

    const s = await schedule(project.id)
    expect(ymd(placed(s, b.id).start)).toBe('2026-06-05')
    expect(placed(s, b.id).isPinned).toBe(true)
    expect(placed(s, b.id).pinnedBeforePredecessor).toBe(true)
  })

  it('lets an anchor, not the last bar, decide the critical path', async () => {
    const project = await createProject({ startDate: day('2026-06-01') })
    const prep = await createTask(project.id, { startDate: day('2026-06-01'), durationDays: 5 })
    const event = await createTask(project.id, { durationDays: 1 })
    const followUp = await createTask(project.id, { durationDays: 10 })
    await link(prep.id, event.id)
    await link(event.id, followUp.id)

    // With no anchor the tail work finishes last and seeds the path.
    let s = await schedule(project.id)
    expect(placed(s, followUp.id).isCritical).toBe(true)

    const admin = await createAdmin()
    await clientAs(admin).projects.updateTask({
      projectId: project.id,
      taskId: event.id,
      data: { isAnchor: true },
    })
    s = await schedule(project.id)
    expect(placed(s, event.id).isAnchor).toBe(true)
    expect(placed(s, event.id).isCritical).toBe(true)
    expect(placed(s, prep.id).isCritical).toBe(true)
    expect(placed(s, followUp.id).isCritical).toBe(false)
  })

  it('refuses a cycle and writes nothing', async () => {
    const project = await createProject({ startDate: day('2026-07-01') })
    const a = await createTask(project.id)
    const b = await createTask(project.id)
    const c = await createTask(project.id)
    await link(a.id, b.id)
    await link(b.id, c.id)
    await expect(link(c.id, a.id)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/loop/i),
    })
    expect((await schedule(project.id)).dependencies).toHaveLength(2)
  })

  it('refuses a self-link and a link across projects', async () => {
    const p1 = await createProject()
    const p2 = await createProject()
    const t1 = await createTask(p1.id)
    const t2 = await createTask(p2.id)
    await expect(link(t1.id, t1.id)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(link(t1.id, t2.id)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/same project/i),
    })
  })

  it('drops the dependency rows of a deleted task and reflows its successors', async () => {
    const project = await createProject({ startDate: day('2026-08-01') })
    const a = await createTask(project.id, { startDate: day('2026-08-01'), durationDays: 4 })
    const b = await createTask(project.id, { durationDays: 2 })
    const c = await createTask(project.id, { durationDays: 2 })
    await link(a.id, b.id)
    await link(b.id, c.id)

    let s = await schedule(project.id)
    expect(ymd(placed(s, c.id).start)).toBe('2026-08-07')

    const admin = await createAdmin()
    await clientAs(admin).projects.deleteTask({ projectId: project.id, taskId: b.id })
    s = await schedule(project.id)
    expect(s.dependencies).toHaveLength(0)
    expect(ymd(placed(s, c.id).start)).toBe('2026-08-01')
  })

  it('keeps a non-manager read-only: no linking, and the schedule says so', async () => {
    const project = await createProject({ startDate: day('2026-10-01') })
    const a = await createTask(project.id)
    const b = await createTask(project.id)
    const bystander = await createVolunteer()
    await expect(
      clientAs(bystander).dependencies.add({ predecessorId: a.id, successorId: b.id, lagDays: 0 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const view = (await clientAs(bystander).projects.listTasks({ projectId: project.id })) as {
      canManageTasks: boolean
    }
    expect(view.canManageTasks).toBe(false)
  })
})

describe('rescheduleItems and the schedule', () => {
  it('pins a following task, and a null start unpins it back onto its predecessor', async () => {
    const project = await createProject({ startDate: day('2027-01-04') })
    const a = await createTask(project.id, { startDate: day('2027-01-04'), durationDays: 3 })
    const b = await createTask(project.id, { durationDays: 2 })
    await link(a.id, b.id)
    const admin = await createAdmin()

    let s = await schedule(project.id)
    expect(ymd(placed(s, b.id).start)).toBe('2027-01-07')

    await clientAs(admin).schedule.rescheduleItems({
      items: [{ id: b.id, startDate: day('2027-02-01'), durationDays: 2 }],
    })
    s = await schedule(project.id)
    expect(ymd(placed(s, b.id).start)).toBe('2027-02-01')
    expect(placed(s, b.id).isPinned).toBe(true)

    await clientAs(admin).schedule.rescheduleItems({ items: [{ id: b.id, startDate: null }] })
    s = await schedule(project.id)
    expect(ymd(placed(s, b.id).start)).toBe('2027-01-07')
    expect(placed(s, b.id).isPinned).toBe(false)
  })
})

describe('ganttOverview', () => {
  it('places projects, and a project-to-project link pushes the successor out', async () => {
    const a = await createProject({ startDate: day('2027-05-01') })
    await createTask(a.id, { durationDays: 5 })
    const b = await createProject()
    await link(a.id, b.id)

    const admin = await createAdmin()
    const body = (await clientAs(admin).projects.ganttOverview({})) as {
      projects: { id: number; placement: { start: string | Date; end: string | Date } | null }[]
      dependencies: { predecessorId: number; successorId: number }[]
    }
    const pa = body.projects.find((p) => p.id === a.id)!.placement!
    const pb = body.projects.find((p) => p.id === b.id)!.placement!
    expect(ymd(pa.end)).toBe('2027-05-05')
    expect(ymd(pb.start)).toBe('2027-05-06')
    expect(body.dependencies).toMatchObject([{ predecessorId: a.id, successorId: b.id }])
  })

  it('hides archived projects until the archived filter is asked for', async () => {
    const live = await createProject({ startDate: day('2027-06-01') })
    const archived = await createProject({ startDate: day('2027-06-01'), status: 'archived' })
    const admin = await createAdmin()

    const dflt = (await clientAs(admin).projects.ganttOverview({})) as {
      projects: { id: number }[]
    }
    expect(dflt.projects.map((p) => p.id)).toContain(live.id)
    expect(dflt.projects.map((p) => p.id)).not.toContain(archived.id)

    const withArchived = (await clientAs(admin).projects.ganttOverview({
      statuses: ['ready', 'in_progress', 'on_hold', 'archived'],
    })) as { projects: { id: number }[] }
    expect(withArchived.projects.map((p) => p.id)).toContain(archived.id)
  })
})
