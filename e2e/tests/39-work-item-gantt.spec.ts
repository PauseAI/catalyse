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
  opts: { title?: string; startDate?: Date | null; deadline?: Date | null } = {},
): Promise<number> {
  const res = await api.projects.createTask({
    body: {
      projectId,
      title: opts.title ?? fake.quickTaskTitle(),
      startDate: opts.startDate ?? null,
      deadline: opts.deadline ?? null,
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

test.describe('Work item scheduling and dependencies', () => {
  test('the Timeline tab draws bars for dated tasks and lists a bare task as a row with no dates', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-11-02') })
    await addTask(api, projectId, {
      title: 'Dated task',
      startDate: day('2026-11-03'),
      deadline: day('2026-11-06'),
    })
    await addTask(api, projectId, { title: 'Floating task' })

    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
    await adminPage.getByRole('tab', { name: 'Timeline' }).click()

    // The dated task has a bar; the bare one is a row under the bars, with no track.
    await expect(adminPage.getByRole('button', { name: /Dated task:/ })).toBeVisible()
    const undated = adminPage.getByRole('group', { name: 'Tasks with no dates' })
    await expect(undated.getByRole('link', { name: 'Floating task' })).toBeVisible()
  })

  test('the Plan menu adds a link, sets its gap and removes it', async ({ baseUrl, adminPage }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2026-12-01') })
    const a = await addTask(api, projectId, {
      title: 'First',
      startDate: day('2026-12-01'),
      deadline: day('2026-12-03'),
    })
    const b = await addTask(api, projectId, {
      title: 'Second',
      startDate: day('2026-12-10'),
      deadline: day('2026-12-11'),
    })

    // The task page only shows what a task waits on; editing it is the timeline's.
    await adminPage.goto(`${baseUrl}/projects/${projectId}/tasks/${b}`)
    await expect(adminPage.getByRole('heading', { name: 'Second' })).toBeVisible()
    await expect(adminPage.getByLabel('Add a dependency')).toHaveCount(0)

    await adminPage.goto(`${baseUrl}/projects/${projectId}#timeline`)
    await adminPage.getByRole('button', { name: /^Second:/ }).click()
    const panel = adminPage.getByRole('complementary')
    await panel.getByRole('button', { name: 'Plan “Second”' }).click()
    const plan = adminPage.getByRole('dialog', { name: 'Plan “Second”' })
    await plan.getByLabel('Waits on…').selectOption({ label: 'First' })
    await plan.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(adminPage.getByText('Dependency added')).toBeVisible()
    await expect(panel.getByRole('link', { name: 'First' })).toBeVisible()
    await expect
      .poll(async () => (await schedule(api, projectId)).dependencies)
      .toMatchObject([{ predecessorId: a, successorId: b, lagDays: 0 }])

    const gap = plan.getByLabel('Gap after “First” finishes (days)')
    await gap.fill('2')
    await gap.press('Enter')
    await expect
      .poll(async () => (await schedule(api, projectId)).dependencies)
      .toMatchObject([{ predecessorId: a, successorId: b, lagDays: 2 }])

    await plan.getByRole('button', { name: 'Stop waiting on First' }).click()
    await expect(panel.getByText('Nothing — can start whenever.')).toBeVisible()
    await expect.poll(async () => (await schedule(api, projectId)).dependencies).toHaveLength(0)
  })

  test('clicking a bar on the timeline opens the item panel', async ({ baseUrl, adminPage }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-04-05') })
    await addTask(api, projectId, {
      title: 'Panel task',
      startDate: day('2027-04-06'),
      deadline: day('2027-04-08'),
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}`)
    await adminPage.getByRole('tab', { name: 'Timeline' }).click()
    await adminPage.getByRole('button', { name: /Panel task:/ }).click()

    const panel = adminPage.getByRole('complementary')
    await expect(panel.getByRole('heading', { name: 'Panel task' })).toBeVisible()
    await expect(panel.getByText('Waits on')).toBeVisible()
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
      deadline: day('2027-05-07'),
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
    // Every editing affordance the panel owns is reachable for a manager; the dates behind Edit dates.
    await panel.getByRole('button', { name: 'Edit dates' }).click()
    await expect(panel.getByLabel('Start (optional)', { exact: true })).toBeVisible()
    await expect(panel.getByLabel('Deadline', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Plan “Visible task”' })).toBeVisible()
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
      deadline: day('2027-06-09'),
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#timeline`)
    await adminPage.getByRole('button', { name: /Anchor me:/ }).click()

    const panel = adminPage.getByRole('complementary')
    // The Plan menu beside the selected bar is the same as the one in the panel footer.
    await adminPage.getByRole('button', { name: 'Plan “Anchor me”' }).first().click()
    const plan = adminPage.getByRole('dialog', { name: 'Plan “Anchor me”' })
    await plan.getByRole('button', { name: 'Make this the key date' }).click()
    // The chip is the proof the write landed and the schedule came back.
    await expect(panel.getByText('★ Key date')).toBeVisible()
    await expect(plan.getByRole('button', { name: 'Stop using as key date' })).toBeVisible()
    await adminPage.keyboard.press('Escape')

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

    // Both start as rows with no dates, with no bar to drag.
    const undated = adminPage.getByRole('group', { name: 'Tasks with no dates' })
    await expect(
      undated.getByRole('button', { name: 'Add Needs dates to the timeline' }),
    ).toBeVisible()
    await expect(adminPage.getByRole('button', { name: /Needs dates:/ })).toHaveCount(0)

    await undated.getByRole('button', { name: 'Add Needs dates to the timeline' }).click()

    // It now has a bar, and the panel opens on it so the dates can be set straight away.
    await expect(adminPage.getByRole('button', { name: /^Needs dates:/ })).toBeVisible()

    // The rest of the backlog can go on in one go.
    await adminPage.getByRole('button', { name: 'Add all to timeline' }).click()
    await expect(adminPage.getByRole('button', { name: /Also needs dates:/ })).toBeVisible()
    await expect(undated).toHaveCount(0)

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
      deadline: day('2027-07-07'),
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#timeline`)
    await adminPage.getByRole('button', { name: /Hover me:/ }).click()

    await adminPage
      .getByRole('complementary')
      .getByRole('button', { name: 'Plan “Hover me”' })
      .click()
    await adminPage
      .getByRole('dialog', { name: 'Plan “Hover me”' })
      .getByText('A fixed point the plan is built around')
      .hover()
    await expect(adminPage.getByRole('tooltip')).toContainText('measured towards the key dates')
  })

  test('a bar says what it is at once, on hover and on keyboard focus', async ({
    baseUrl,
    adminPage,
  }) => {
    const api = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await makeProject(api, { startDate: day('2027-07-05') })
    await addTask(api, projectId, {
      title: 'Tip me',
      startDate: day('2027-07-06'),
      deadline: day('2027-07-09'),
    })

    await adminPage.goto(`${baseUrl}/projects/${projectId}#timeline`)
    const bar = adminPage.getByRole('button', { name: /^Tip me:/ })
    await expect(bar).not.toHaveAttribute('title')

    await bar.hover()
    const tip = adminPage.getByRole('tooltip')
    await expect(tip).toContainText('Tip me')
    await expect(tip).toContainText('To do')
    await expect(tip).toContainText('Unclaimed')
    await expect(tip).toContainText('6 – 9 Jul 2027')
    await expect(tip).toContainText('Deadline 9 Jul 2027')

    // The tip sits beside the bar, inside the chart.
    const [tipBox, barBox] = [await tip.boundingBox(), await bar.boundingBox()]
    expect(tipBox!.x).toBeGreaterThanOrEqual(barBox!.x + barBox!.width)

    await adminPage.mouse.move(0, 0)
    await expect(tip).toHaveCount(0)
    await bar.focus()
    await expect(adminPage.getByRole('tooltip')).toContainText('Tip me')

    // The legend is one short line; the planning marks are explained in Planning tools.
    await expect(adminPage.getByText('Today', { exact: true })).toBeVisible()
    await expect(adminPage.getByText('Original plan', { exact: true })).toBeHidden()
    await adminPage.getByText('Planning tools').click()
    await expect(adminPage.getByText('What the marks mean')).toBeVisible()
    await expect(adminPage.getByText('Original plan', { exact: true })).toBeVisible()
  })
})
