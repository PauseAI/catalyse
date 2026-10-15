import { test, expect, readAdminToken } from '../fixtures'
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
const ymd = (d: string | Date) => new Date(d).toISOString().slice(0, 10)

test.describe('Work item scheduling and dependencies', () => {
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
