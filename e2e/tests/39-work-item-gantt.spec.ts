import { test, expect, readAdminToken, createApprovedVolunteer } from '../fixtures'
import { fake } from '../fake'
import { createApiClient } from '../client'
import type { RouterClient } from '@orpc/server'
import type { appRouter } from '../../server/router'

type Api = RouterClient<typeof appRouter>

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function makeProject(api: Api, opts: { startDate?: Date } = {}): Promise<number> {
  const created = await api.admin.projects.create({
    body: {
      title: fake.projectTitle(),
      description: 'Gantt scheduling fixture',
      projectType: null,
      estimatedDuration: null,
      timeCommitmentHoursPerWeek: null,
      urgency: 'medium',
      collaborationLink: null,
      country: null,
      localGroup: null,
      remoteEligibility: 'NONE',
      isSeekingHelp: false,
      skillIds: [],
      skillRequiredMap: {},
      startDate: opts.startDate ?? null,
      tasks: [{ title: 'Seed task' }],
    },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  return (created.body as { id: number }).id
}

async function addTask(
  api: Api,
  projectId: number,
  opts: { title?: string; startDate?: Date | null; durationDays?: number | null } = {},
): Promise<number> {
  const res = await api.projects.createTask({
    body: {
      projectId,
      title: opts.title ?? fake.quickTaskTitle(),
      startDate: opts.startDate ?? null,
      durationDays: opts.durationDays ?? null,
    },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return (res.body as { id: number }).id
}

async function schedule(api: Api, projectId: number) {
  const res = await api.projects.listTasks({ body: { projectId } })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as {
    tasks: { id: number }[]
    dependencies: { predecessorId: number; successorId: number; lagDays: number }[]
    scheduled: {
      id: number
      start: string | Date
      end: string | Date
      isPinned: boolean
      isDerived: boolean
      pinnedBeforePredecessor: boolean
      breachesDeadline: boolean
      isCritical: boolean
      isAnchor: boolean
    }[]
    scopeStart: string | Date
    scopeEnd: string | Date
  }
}

const placed = (s: Awaited<ReturnType<typeof schedule>>, id: number) =>
  s.scheduled.find((x) => x.id === id)!

/** Both string and Date forms reduce to a yyyy-mm-dd for comparison. */
const ymd = (d: string | Date) => new Date(d).toISOString().slice(0, 10)

test.describe('Work item scheduling and dependencies', () => {
  test('a task with a start date and duration is placed on those dates; a bare task falls back to the project origin', async ({
    baseUrl,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-03-02') })
    const pinned = await addTask(api, projectId, { startDate: day('2026-03-10'), durationDays: 5 })
    const bare = await addTask(api, projectId, { durationDays: 3 })

    const s = await schedule(api, projectId)
    expect(ymd(placed(s, pinned).start)).toBe('2026-03-10')
    expect(ymd(placed(s, pinned).end)).toBe('2026-03-14')
    expect(placed(s, pinned).isPinned).toBe(true)
    // No pin, no predecessors → the project's own start.
    expect(ymd(placed(s, bare).start)).toBe('2026-03-02')
    expect(ymd(placed(s, bare).end)).toBe('2026-03-04')
  })

  test('the scope starts at the earliest task, even when that is before the project origin', async ({
    baseUrl,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    // No project start date, so the origin is today — and the task is pinned well before it.
    const projectId = await makeProject(api)
    const past = await addTask(api, projectId, { startDate: day('2020-01-06'), durationDays: 4 })

    const s = await schedule(api, projectId)
    expect(ymd(placed(s, past).start)).toBe('2020-01-06')
    // The axis has to cover it: a scope beginning at the origin would leave it off the chart.
    expect(new Date(s.scopeStart).getTime()).toBeLessThanOrEqual(
      new Date(placed(s, past).start).getTime(),
    )
  })

  test('an anchor, not the last bar, decides the critical path', async ({ baseUrl }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-06-01') })
    // prep → event(anchor) → followUp. followUp finishes last but only trails the event.
    const prep = await addTask(api, projectId, { startDate: day('2026-06-01'), durationDays: 5 })
    const event = await addTask(api, projectId, { durationDays: 1 })
    const followUp = await addTask(api, projectId, { durationDays: 10 })
    for (const [p, s] of [
      [prep, event],
      [event, followUp],
    ]) {
      const link = await api.dependencies.add({ body: { predecessorId: p, successorId: s } })
      expect(link.status, JSON.stringify(link.body)).toBe(200)
    }

    // With no anchor, the tail work finishes last and so seeds the path — the old behaviour.
    let s = await schedule(api, projectId)
    expect(placed(s, followUp).isCritical).toBe(true)

    const marked = await api.projects.updateTask({
      body: { projectId, taskId: event, data: { isAnchor: true } },
    })
    expect(marked.status, JSON.stringify(marked.body)).toBe(200)

    s = await schedule(api, projectId)
    expect(placed(s, event).isAnchor).toBe(true)
    // Everything feeding the anchor is critical; everything merely trailing it is not.
    expect(placed(s, event).isCritical).toBe(true)
    expect(placed(s, prep).isCritical).toBe(true)
    expect(placed(s, followUp).isCritical).toBe(false)
  })

  test('a dependency shifts the successor, and moving the predecessor cascades', async ({
    baseUrl,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-04-01') })
    const a = await addTask(api, projectId, { startDate: day('2026-04-01'), durationDays: 5 })
    const b = await addTask(api, projectId, { durationDays: 2 })

    const link = await api.dependencies.add({
      body: { predecessorId: a, successorId: b, lagDays: 0 },
    })
    expect(link.status, JSON.stringify(link.body)).toBe(200)

    let s = await schedule(api, projectId)
    // A ends 04-05, so B starts the next day.
    expect(ymd(placed(s, b).start)).toBe('2026-04-06')
    expect(placed(s, b).isDerived).toBe(true)

    // Extend A by two days → B follows.
    const upd = await api.projects.updateTask({
      body: { projectId, taskId: a, data: { durationDays: 7 } },
    })
    expect(upd.status, JSON.stringify(upd.body)).toBe(200)

    s = await schedule(api, projectId)
    expect(ymd(placed(s, a).end)).toBe('2026-04-07')
    expect(ymd(placed(s, b).start)).toBe('2026-04-08')
  })

  test('a lag adds days between predecessor and successor', async ({ baseUrl }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-05-01') })
    const a = await addTask(api, projectId, { startDate: day('2026-05-01'), durationDays: 3 })
    const b = await addTask(api, projectId, { durationDays: 2 })

    await api.dependencies.add({ body: { predecessorId: a, successorId: b, lagDays: 2 } })

    const s = await schedule(api, projectId)
    // A ends 05-03; +1 day +2 lag → B starts 05-06.
    expect(ymd(placed(s, b).start)).toBe('2026-05-06')
  })

  test('a pinned successor does not move with its predecessor, and is flagged when the pin is too early', async ({
    baseUrl,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-06-01') })
    const a = await addTask(api, projectId, { startDate: day('2026-06-01'), durationDays: 10 })
    const b = await addTask(api, projectId, { startDate: day('2026-06-05'), durationDays: 2 })

    await api.dependencies.add({ body: { predecessorId: a, successorId: b, lagDays: 0 } })

    const s = await schedule(api, projectId)
    expect(ymd(placed(s, b).start)).toBe('2026-06-05')
    expect(placed(s, b).isPinned).toBe(true)
    expect(placed(s, b).pinnedBeforePredecessor).toBe(true)
  })

  test('a cycle is rejected and nothing is written', async ({ baseUrl }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-07-01') })
    const a = await addTask(api, projectId)
    const b = await addTask(api, projectId)
    const c = await addTask(api, projectId)

    await api.dependencies.add({ body: { predecessorId: a, successorId: b, lagDays: 0 } })
    await api.dependencies.add({ body: { predecessorId: b, successorId: c, lagDays: 0 } })
    const loop = await api.dependencies.add({
      body: { predecessorId: c, successorId: a, lagDays: 0 },
    })
    expect(loop.status).toBe(400)
    expect((loop.body as { message: string }).message).toMatch(/loop/i)

    const s = await schedule(api, projectId)
    expect(s.dependencies).toHaveLength(2)
  })

  test('a self-link and a cross-project task link are both rejected', async ({ baseUrl }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const p1 = await makeProject(api)
    const p2 = await makeProject(api)
    const t1 = await addTask(api, p1)
    const t2 = await addTask(api, p2)

    const selfLink = await api.dependencies.add({
      body: { predecessorId: t1, successorId: t1, lagDays: 0 },
    })
    expect(selfLink.status).toBe(400)

    const crossLink = await api.dependencies.add({
      body: { predecessorId: t1, successorId: t2, lagDays: 0 },
    })
    expect(crossLink.status).toBe(400)
    expect((crossLink.body as { message: string }).message).toMatch(/same project/i)
  })

  test('deleting a task removes its dependency rows and reflows the successors', async ({
    baseUrl,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-08-01') })
    const a = await addTask(api, projectId, { startDate: day('2026-08-01'), durationDays: 4 })
    const b = await addTask(api, projectId, { durationDays: 2 })
    const c = await addTask(api, projectId, { durationDays: 2 })

    await api.dependencies.add({ body: { predecessorId: a, successorId: b, lagDays: 0 } })
    await api.dependencies.add({ body: { predecessorId: b, successorId: c, lagDays: 0 } })

    let s = await schedule(api, projectId)
    expect(ymd(placed(s, c).start)).toBe('2026-08-07')

    const del = await api.projects.deleteTask({ body: { projectId, taskId: b } })
    expect(del.status).toBe(200)

    s = await schedule(api, projectId)
    expect(s.dependencies).toHaveLength(0)
    // C now has no predecessor, so it falls back to the project origin.
    expect(ymd(placed(s, c).start)).toBe('2026-08-01')
  })

  test('a task whose computed end runs past its deadline is flagged', async ({ baseUrl }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-09-01') })
    const res = await api.projects.createTask({
      body: {
        projectId,
        title: 'Tight task',
        startDate: day('2026-09-01'),
        durationDays: 10,
        deadline: day('2026-09-05'),
      },
    })
    expect(res.status).toBe(200)
    const taskId = (res.body as { id: number }).id

    const s = await schedule(api, projectId)
    expect(placed(s, taskId).breachesDeadline).toBe(true)
  })

  test('a non-manager approved volunteer cannot link tasks and sees the schedule read-only', async ({
    baseUrl,
  }) => {
    const admin = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(admin, { startDate: day('2026-10-01') })
    const a = await addTask(admin, projectId)
    const b = await addTask(admin, projectId)

    const bystander = await createApprovedVolunteer(baseUrl)
    const outsider = createApiClient(baseUrl, bystander.token)
    const attempt = await outsider.dependencies.add({
      body: { predecessorId: a, successorId: b, lagDays: 0 },
    })
    expect(attempt.status).toBe(403)

    const view = await outsider.projects.listTasks({ body: { projectId } })
    expect(view.status).toBe(200)
    expect((view.body as { canManageTasks: boolean }).canManageTasks).toBe(false)
  })

  test('the Timeline tab draws bars for dated tasks and lists a bare task as unscheduled', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-11-02') })
    await addTask(api, projectId, {
      title: 'Dated task',
      startDate: day('2026-11-03'),
      durationDays: 4,
    })
    await addTask(api, projectId, { title: 'Floating task' })

    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
    await adminPage.getByRole('tab', { name: 'Timeline' }).click()

    // The name column lists the dated task; the tray holds the bare one.
    await expect(adminPage.getByRole('button', { name: /Dated task:/ })).toBeVisible()
    const tray = adminPage.getByRole('region', { name: /Unscheduled/ })
    await expect(tray.getByRole('link', { name: 'Floating task' })).toBeVisible()
  })

  test('the Depends on picker adds a dependency, which then shifts the successor on the timeline', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-12-01') })
    const a = await addTask(api, projectId, {
      title: 'First',
      startDate: day('2026-12-01'),
      durationDays: 3,
    })
    const b = await addTask(api, projectId, { title: 'Second', durationDays: 2 })

    await adminPage.goto(`${baseUrl}/projects/${projectId}/tasks/${b}`)
    await adminPage.getByLabel('Add a dependency').selectOption({ label: 'First' })
    await adminPage.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(adminPage.getByText('Dependency added')).toBeVisible()

    const s = await schedule(api, projectId)
    // First ends 12-03, so Second now starts 12-04.
    expect(ymd(placed(s, b).start)).toBe('2026-12-04')
    expect(s.dependencies).toMatchObject([{ predecessorId: a, successorId: b, lagDays: 0 }])
  })

  test('rescheduleItems pins a following task, and a null start unpins it back onto its predecessor', async ({
    baseUrl,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-01-04') })
    const a = await addTask(api, projectId, { startDate: day('2027-01-04'), durationDays: 3 })
    const b = await addTask(api, projectId, { durationDays: 2 })
    await api.dependencies.add({ body: { predecessorId: a, successorId: b, lagDays: 0 } })

    // Following A, B starts 01-07.
    let s = await schedule(api, projectId)
    expect(ymd(placed(s, b).start)).toBe('2027-01-07')

    // Pin B far out.
    const pin = await api.schedule.rescheduleItems({
      body: { items: [{ id: b, startDate: day('2027-02-01'), durationDays: 2 }] },
    })
    expect(pin.status, JSON.stringify(pin.body)).toBe(200)
    s = await schedule(api, projectId)
    expect(ymd(placed(s, b).start)).toBe('2027-02-01')
    expect(placed(s, b).isPinned).toBe(true)

    // Unpin — B snaps back to following A.
    const unpin = await api.schedule.rescheduleItems({
      body: { items: [{ id: b, startDate: null }] },
    })
    expect(unpin.status, JSON.stringify(unpin.body)).toBe(200)
    s = await schedule(api, projectId)
    expect(ymd(placed(s, b).start)).toBe('2027-01-07')
    expect(placed(s, b).isPinned).toBe(false)
  })

  test('rescheduleItems refuses a task on a project the caller cannot manage', async ({
    baseUrl,
  }) => {
    const admin = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(admin, { startDate: day('2027-03-01') })
    const t = await addTask(admin, projectId, { durationDays: 2 })

    const bystander = await createApprovedVolunteer(baseUrl)
    const outsider = createApiClient(baseUrl, bystander.token)
    const res = await outsider.schedule.rescheduleItems({
      body: { items: [{ id: t, startDate: day('2027-03-05'), durationDays: 2 }] },
    })
    expect(res.status).toBe(403)
  })

  test('the roadmap places projects and a project-to-project link pushes the successor out', async ({
    baseUrl,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const a = await makeProject(api, { startDate: day('2027-05-01') })
    await addTask(api, a, { durationDays: 5 }) // follows A's start → 05-01..05-05, so A spans 5 days
    const b = await makeProject(api)

    const link = await api.dependencies.add({
      body: { predecessorId: a, successorId: b, lagDays: 0 },
    })
    expect(link.status, JSON.stringify(link.body)).toBe(200)

    const res = await api.projects.ganttOverview({ body: {} })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as {
      projects: { id: number; placement: { start: string | Date; end: string | Date } | null }[]
      dependencies: { predecessorId: number; successorId: number }[]
    }
    const pa = body.projects.find((p) => p.id === a)!.placement!
    const pb = body.projects.find((p) => p.id === b)!.placement!
    expect(ymd(pa.end)).toBe('2027-05-05')
    expect(ymd(pb.start)).toBe('2027-05-06')
    expect(body.dependencies).toContainEqual(
      expect.objectContaining({ predecessorId: a, successorId: b }),
    )
  })

  test('the roadmap hides archived projects until the archived filter is asked for', async ({
    baseUrl,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const live = await makeProject(api, { startDate: day('2027-06-01') })
    const archived = await makeProject(api, { startDate: day('2027-06-01') })
    const upd = await api.projects.update({ body: { id: archived, status: 'archived' } })
    expect(upd.status, JSON.stringify(upd.body)).toBe(200)

    const dflt = (await api.projects.ganttOverview({ body: {} })).body as {
      projects: { id: number }[]
    }
    expect(dflt.projects.map((p) => p.id)).toContain(live)
    expect(dflt.projects.map((p) => p.id)).not.toContain(archived)

    const withArchived = (
      await api.projects.ganttOverview({
        body: { statuses: ['ready', 'in_progress', 'on_hold', 'archived'] },
      })
    ).body as { projects: { id: number }[] }
    expect(withArchived.projects.map((p) => p.id)).toContain(archived)
  })

  test('clicking a bar on the timeline opens the item panel', async ({ baseUrl, adminPage }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-04-05') })
    await addTask(api, projectId, {
      title: 'Panel task',
      startDate: day('2027-04-06'),
      durationDays: 3,
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
    await adminPage.getByRole('tab', { name: 'Timeline' }).click()
    await adminPage.getByRole('button', { name: /Panel task:/ }).click()

    const panel = adminPage.getByRole('complementary')
    await expect(panel.getByRole('heading', { name: 'Panel task' })).toBeVisible()
    await expect(panel.getByText('Depends on')).toBeVisible()
  })

  test('the Timeline is reachable by its own URL and its controls are all usable', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-05-03') })
    await addTask(api, projectId, {
      title: 'Visible task',
      startDate: day('2027-05-04'),
      durationDays: 4,
    })

    // The hash opens the tab directly, without a click.
    await adminPage.goto(`${baseUrl}/projects/${projectId}#timeline`)
    const bar = adminPage.getByRole('button', { name: /Visible task:/ })
    await expect(bar).toBeVisible()

    // Zoom and range controls are present and respond.
    for (const label of ['Fit', 'Day', 'Week', 'Month']) {
      await expect(adminPage.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    for (const label of ['All', 'This week', 'Fortnight', 'This month', '30 days']) {
      await expect(adminPage.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    await adminPage.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(bar).toBeVisible()
    await adminPage.getByRole('button', { name: 'This month', exact: true }).click()

    // The plan summary and the legend both stay on the page with the chart.
    await expect(adminPage.getByText('Starts', { exact: true })).toBeVisible()
    await expect(adminPage.getByText('Key date').first()).toBeVisible()
    // The planner's controls are folded away until asked for.
    await adminPage.getByText('Planning tools').click()
    await expect(adminPage.getByLabel('Highlight the critical path')).toBeVisible()

    // Back to a scale that places the bar, then open it.
    await adminPage.getByRole('button', { name: 'All', exact: true }).click()
    await adminPage.getByRole('button', { name: /Visible task:/ }).click()

    const panel = adminPage.getByRole('complementary')
    await expect(panel.getByRole('heading', { name: 'Visible task' })).toBeVisible()
    // Every editing affordance the panel owns is reachable for a manager.
    await expect(panel.getByLabel('From', { exact: true })).toBeVisible()
    await expect(panel.getByLabel('Days', { exact: true })).toBeVisible()
    await expect(panel.getByRole('checkbox', { name: /Key date/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Save' })).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Open task' })).toBeVisible()

    // Each tab has its own address, so Back returns to the timeline.
    await adminPage.getByRole('tab', { name: /^Tasks/ }).click()
    await expect(adminPage).toHaveURL(new RegExp(`/projects/${projectId}#tasks$`))
    await adminPage.goBack()
    await expect(adminPage.getByRole('button', { name: /Visible task:/ })).toBeVisible()
  })

  test('a manager can set an anchor and assign a task from the timeline panel', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-06-07') })
    await addTask(api, projectId, {
      title: 'Anchor me',
      startDate: day('2027-06-08'),
      durationDays: 2,
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#timeline`)
    await adminPage.getByRole('button', { name: /Anchor me:/ }).click()

    const panel = adminPage.getByRole('complementary')
    // `click`, not `check`: the box is driven by server state, so it only ticks once the write
    // lands and the schedule comes back. The chip is the honest proof that it did.
    await panel.getByRole('checkbox', { name: /Key date/ }).click()
    await expect(panel.getByText('★ Key date')).toBeVisible()
    await expect(panel.getByRole('checkbox', { name: /Key date/ })).toBeChecked()

    await expect(panel.getByRole('button', { name: /Assign/ }).first()).toBeVisible()
  })

  test('an unscheduled task can be put on the timeline without leaving the tab', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-08-02') })
    await addTask(api, projectId, { title: 'Needs dates' })
    await addTask(api, projectId, { title: 'Also needs dates' })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#timeline`)

    // Both start in the tray, with no bar to drag.
    const tray = adminPage.getByRole('region', { name: /Unscheduled/ })
    await expect(
      tray.getByRole('button', { name: 'Add Needs dates to the timeline' }),
    ).toBeVisible()
    await expect(adminPage.getByRole('button', { name: /Needs dates:/ })).toHaveCount(0)

    await tray.getByRole('button', { name: 'Add Needs dates to the timeline' }).click()

    // It now has a bar, and the panel opens on it so the dates can be set straight away.
    await expect(adminPage.getByRole('button', { name: /^Needs dates:/ })).toBeVisible()

    // The rest of the backlog can go on in one go.
    await adminPage.getByRole('button', { name: 'Add all to timeline' }).click()
    await expect(adminPage.getByRole('button', { name: /Also needs dates:/ })).toBeVisible()
    await expect(adminPage.getByRole('region', { name: /Unscheduled/ })).toHaveCount(0)

    // The dates really were written, not just drawn: both are now pinned on the server. The bar
    // can appear before the write lands, so wait for the server rather than read it once.
    await expect
      .poll(async () => {
        const { scheduled } = await schedule(api, projectId)
        return scheduled.length >= 2 && scheduled.every((p) => p.isPinned)
      })
      .toBe(true)
  })

  test('hovering the key date label explains what a key date is', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-07-05') })
    await addTask(api, projectId, {
      title: 'Hover me',
      startDate: day('2027-07-06'),
      durationDays: 2,
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#timeline`)
    await adminPage.getByRole('button', { name: /Hover me:/ }).click()

    const panel = adminPage.getByRole('complementary')
    await panel.getByText('A fixed point the plan is built around').hover()
    await expect(adminPage.getByRole('tooltip')).toContainText('measured towards the key dates')
  })
})
