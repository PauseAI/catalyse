import { Browser, Page } from '@playwright/test'
import { DemoEngine } from '../engine'
import { buildTitleCardHtml } from '../html'
import { createDemoApiClient } from '../api'
import {
  FLYER_PROJECT,
  FLYER_VOLUNTEER_ONE,
  FLYER_VOLUNTEER_TWO,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  SUPERADMIN_EMAIL,
  SUPERADMIN_PASSWORD,
  BASE_URL,
} from '../data'

export const meta = {
  name: 'project-setup-task-flow',
  title: 'Project Setup & Volunteer Tasks',
} as const

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Drags the mouse from (startX, startY) to (endX, endY), keeping the engine's visible
 * cursor graphic in sync — raw page.mouse.move calls don't move it, since it's a DOM
 * element the engine animates itself, not the real OS cursor.
 */
async function dragGesture(
  engine: DemoEngine,
  page: Page,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps = 20,
): Promise<void> {
  await engine.moveCursorToXY(startX, startY)
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = startX + (endX - startX) * t
    const y = startY + (endY - startY) * t
    await page.mouse.move(x, y)
    await page.evaluate(
      `(function(){
        var el = document.getElementById('__demo-cursor__')
        if (el) el.style.transform = 'translate(${x}px,${y}px)'
      })()`,
    )
    engine.cursorX = x
    engine.cursorY = y
    await new Promise((r) => setTimeout(r, 15))
  }
  await page.mouse.up()
}

// Tokens/ids threaded between segments
let _projectId = 0
let _taskOneId = 0
let _taskTwoId = 0
let _volunteerOneToken = ''
let _volunteerTwoToken = ''

export async function run(engine: DemoEngine, browser: Browser): Promise<void> {
  await recordProjectSetup(engine, browser)
  await recordVolunteerTwo(engine, browser)
  await recordVolunteerOne(engine, browser)
}

// ─── Segment 1: admin sets up the project, adds tasks, assigns volunteers ────

async function recordProjectSetup(engine: DemoEngine, browser: Browser): Promise<void> {
  console.log('  Setting up volunteers to assign tasks to...')

  // Detect mode only collects narration text (see engine.narrate) and never performs real
  // navigation, so none of this setup — or the project/task id lookups further down — is
  // needed, and skipping it avoids creating the same volunteers twice across the two passes.
  let adminApi: ReturnType<typeof createDemoApiClient> | null = null
  if (!engine.isDetecting) {
    const api = createDemoApiClient()
    const { token: adminToken } = await api.auth.login({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    })
    adminApi = createDemoApiClient(adminToken)

    const { token: superAdminToken } = await api.auth.login({
      email: SUPERADMIN_EMAIL,
      password: SUPERADMIN_PASSWORD,
    })
    const superAdminApi = createDemoApiClient(superAdminToken)

    for (const [volunteer, setToken] of [
      [FLYER_VOLUNTEER_ONE, (t: string) => (_volunteerOneToken = t)],
      [FLYER_VOLUNTEER_TWO, (t: string) => (_volunteerTwoToken = t)],
    ] as const) {
      const { id, token, emailVerificationToken } = await api.auth.signup({
        name: volunteer.name,
        email: volunteer.email,
        password: volunteer.password,
        bio: volunteer.bio,
        country: volunteer.country,
        availabilityHoursPerWeek: volunteer.availabilityHoursPerWeek,
        applicationMessage: volunteer.applicationMessage,
      })
      if (emailVerificationToken) await api.auth.verifyEmail({ token: emailVerificationToken })
      await superAdminApi.admin.applications.action({ id, action: 'approve' })
      setToken(token)
    }
  }

  console.log('  Recording project setup flow...')

  const { ctx, page } = await engine.beginSegment(browser)

  await engine.showTitleCard(`${BASE_URL}/`, buildTitleCardHtml(meta.title))
  await engine.narrate(
    "Now let's see an admin set up a project, hand out tasks, and watch volunteers work through them",
  )
  await engine.dismissTitleCard(600)
  await engine.placeCursor()
  await engine.pause(300)

  await page.goto(`${BASE_URL}/login`)
  await engine.fadeIn(600)
  await engine.narrate('An admin logs in to set up a new project', async () => {
    await engine.type(page.getByLabel('Email', { exact: true }), ADMIN_EMAIL)
    await engine.pause(200)
    await engine.type(page.getByLabel('Password'), ADMIN_PASSWORD)
    await engine.pause(300)
    await engine.click(page.getByRole('button', { name: 'Login' }), {
      navigatesTo: `${BASE_URL}/dashboard`,
    })
  })

  await engine.narrate(
    'Admins can create projects directly. This one will be for a flyering stall.',
    async () => {
      await engine.navigateTo(`${BASE_URL}/admin/projects/new`)
      await engine.pause(500)
      await engine.type(page.getByLabel('Project Title'), FLYER_PROJECT.title)
      await engine.pause(300)
      await engine.type(page.getByLabel('Description'), FLYER_PROJECT.description, 25)
    },
  )

  await engine.narrate('The project type sets expectations for how involved it is', async () => {
    await engine.click(page.getByLabel('Project Type'))
    await engine.pause(300)
    await engine.click(
      page.getByRole('option', {
        name: 'One-off task - Single deliverable, minimal coordination',
      }),
    )
  })

  await engine.narrate("It's a local event, so it gets a country and a local group", async () => {
    await engine.click(page.getByLabel('Country/Group'))
    await engine.pause(300)
    await engine.type(page.locator('#country'), 'London')
    await engine.pause(300)
    await engine.click(page.getByRole('option', { name: 'United Kingdom - London' }))
  })

  await engine.narrate('This one needs people on the ground, not remote help', async () => {
    await engine.click(page.locator('#remote-eligibility'))
    await engine.pause(300)
    await engine.click(page.getByRole('option', { name: 'No - in-person / local only' }))
  })

  const taskTitleField = page.locator('#new-task-title')
  await engine.narrate('Tasks are what volunteers actually sign up to do', async () => {
    await engine.smoothScrollTo(taskTitleField)
    await engine.type(taskTitleField, FLYER_PROJECT.taskOne.title, 25)
    await engine.pause(300)
    await engine.click(page.getByRole('button', { name: 'Add Task' }))
    await page.waitForURL(/\/projects\/\d+\/edit/, { timeout: 15_000 })
  })

  await engine.narrate('A second task for printing the flyers themselves', async () => {
    await engine.type(taskTitleField, FLYER_PROJECT.taskTwo.title, 25)
    await engine.pause(300)
    await engine.click(page.getByRole('button', { name: 'Add Task' }))
    await engine.pause(500)
  })

  const publishBtn = page.getByRole('button', { name: 'Publish', exact: true })
  await engine.smoothScrollTo(publishBtn)
  await engine.narrate('Publishing makes the project live for volunteers to see', async () => {
    await engine.click(publishBtn)
    await engine.pause(500)
    await engine.click(
      page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }),
      { navigatesTo: /\/projects\/\d+$/ },
    )
  })

  if (!engine.isDetecting && adminApi) {
    const projectId = Number(new URL(page.url()).pathname.split('/')[2])
    _projectId = projectId

    const project = await adminApi.projects.getById({ id: projectId })
    const tasks = (project as { tasks: { id: number; title: string }[] }).tasks
    _taskOneId = tasks.find((t) => t.title === FLYER_PROJECT.taskOne.title)!.id
    _taskTwoId = tasks.find((t) => t.title === FLYER_PROJECT.taskTwo.title)!.id
  }

  await engine.narrate('Tasks appear under their own tab', async () => {
    await engine.click(page.getByRole('tab', { name: /^Tasks/ }))
  })

  await engine.narrate('Tom is assigned straight to the printing task', async () => {
    await assignTask(engine, page, FLYER_PROJECT.taskTwo.title, FLYER_VOLUNTEER_TWO.name)
  })

  await engine.narrate(
    'Priya is added to the project itself, rather than assigned a task directly',
    async () => {
      await engine.click(page.getByRole('tab', { name: /^People/ }))
      await engine.pause(300)
      await engine.click(page.getByLabel('Volunteer to invite', { exact: true }))
      await engine.pause(300)
      await engine.type(page.locator('#assign-volunteer'), FLYER_VOLUNTEER_ONE.name)
      await engine.pause(300)
      await engine.click(page.getByRole('option', { name: FLYER_VOLUNTEER_ONE.name, exact: true }))
      await engine.pause(300)
      await engine.click(page.getByRole('button', { name: 'Add now' }))
      await page.getByRole('alert').filter({ hasText: 'Added to the project' }).waitFor()
    },
  )

  await engine.narrate('The Timeline shows how the tasks fit together', async () => {
    await engine.click(page.getByRole('tab', { name: 'Timeline' }))
    await engine.pause(300)
    await engine.click(page.getByRole('button', { name: 'Add all to timeline' }))
  })

  const predecessorBar = page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(FLYER_PROJECT.taskTwo.title)}:`),
  })
  const successorBar = page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(FLYER_PROJECT.taskOne.title)}:`),
  })

  await engine.narrate('The stall happens a few days after the flyers are ready', async () => {
    const box = await successorBar.boundingBox()
    if (!box) throw new Error('Could not locate the Staff the stall bar')
    const dayWidth = box.width // a freshly-added task is a one-day bar
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2

    await dragGesture(engine, page, startX, startY, startX + dayWidth * 3, startY)
    await engine.pause(200)
  })

  await engine.narrate('The stall can only happen once the flyers are printed', async () => {
    await predecessorBar.hover()
    const linkHandle = page.getByRole('button', {
      name: `Draw a dependency from ${FLYER_PROJECT.taskTwo.title}`,
    })
    const handleBox = await linkHandle.boundingBox()
    const targetBox = await successorBar.boundingBox()
    if (!handleBox || !targetBox) throw new Error('Could not locate Gantt bars to link')

    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    const endX = targetBox.x + targetBox.width / 2
    const endY = targetBox.y + targetBox.height / 2

    await dragGesture(engine, page, startX, startY, endX, endY)
    await page.getByText('Dependency added').waitFor()
  })

  await engine.pause(1000)
  await engine.endSegment(ctx, { transition: 'fade-out', transitionDurationMs: 600 })
  console.log('  Project setup segment done.')
}

async function assignTask(
  engine: DemoEngine,
  page: Awaited<ReturnType<DemoEngine['beginSegment']>>['page'],
  taskTitle: string,
  volunteerName: string,
): Promise<void> {
  const menuBtn = page.getByRole('button', { name: `Task actions for ${taskTitle}` })
  await engine.smoothScrollTo(menuBtn)
  await engine.click(menuBtn)
  await engine.pause(300)
  await engine.click(page.getByLabel(`Assign volunteer to ${taskTitle}`, { exact: true }))
  await engine.pause(300)
  await engine.click(page.getByRole('option', { name: volunteerName, exact: true }))
  await engine.pause(300)
  await engine.click(page.getByRole('button', { name: 'Assign', exact: true }))
  await engine.pause(500)
}

// ─── Segment 2 & 3: volunteers pick up and complete their tasks ──────────────

async function recordVolunteerOne(engine: DemoEngine, browser: Browser): Promise<void> {
  console.log(`  Recording ${FLYER_VOLUNTEER_ONE.name} completing their task...`)

  await dismissWelcomeNotification(engine, _volunteerOneToken)
  const { ctx, page } = await engine.beginSegment(browser, { authToken: _volunteerOneToken })

  await page.goto(`${BASE_URL}/projects/${_projectId}`)
  await page.waitForSelector('#projectContent', { timeout: 15_000 })
  await engine.pause(300)
  await engine.click(page.getByRole('tab', { name: /^Tasks/ }))
  await engine.pause(300)

  await engine.narrate(
    `${FLYER_VOLUNTEER_ONE.name} is on the project, but not assigned to a task — so she claims this one herself`,
    async () => {
      const taskRow = page.getByRole('listitem').filter({ hasText: FLYER_PROJECT.taskOne.title })
      await engine.smoothScrollTo(taskRow)
      await engine.readText(taskRow)
      await engine.click(taskRow.getByRole('button', { name: /Claim/ }))
      await page.getByText('Task claimed').waitFor()
    },
  )

  await engine.narrate('Once claimed, the task behaves just like a direct assignment', async () => {
    const taskLink = page.getByRole('link', { name: FLYER_PROJECT.taskOne.title })
    await engine.click(taskLink)
    await page.waitForURL(new RegExp(`/tasks/${_taskOneId}$`))
    await engine.readText(
      page.getByRole('heading', { level: 1, name: FLYER_PROJECT.taskOne.title }),
    )
  })

  await submitTaskWork(
    engine,
    page,
    FLYER_PROJECT.taskOne,
    'Once the work is done, they submit it for review',
  )

  await engine.pause(1200)
  await engine.endSegment(ctx, { transition: 'fade-out', transitionDurationMs: 600 })
  console.log(`  ${FLYER_VOLUNTEER_ONE.name} segment done.`)
}

async function recordVolunteerTwo(engine: DemoEngine, browser: Browser): Promise<void> {
  await recordVolunteerCompletesTask(
    engine,
    browser,
    _volunteerTwoToken,
    FLYER_VOLUNTEER_TWO.name,
    _taskTwoId,
    FLYER_PROJECT.taskTwo,
    `${FLYER_VOLUNTEER_TWO.name} has his task waiting for him`,
    'A quick note on what was done, and it goes to the admin for review',
  )
}

/** Clears the "You're approved" welcome notification via the API, so it never pops up mid-recording. */
async function dismissWelcomeNotification(engine: DemoEngine, authToken: string): Promise<void> {
  if (engine.isDetecting) return
  const api = createDemoApiClient(authToken)
  const { approvalWelcome } = await api.dashboard.get()
  if (approvalWelcome) await api.notifications.markRead({ id: approvalWelcome.notificationId })
}

async function submitTaskWork(
  engine: DemoEngine,
  page: Page,
  task: { title: string; workNote: string },
  submitNarration: string,
): Promise<void> {
  const submitBtn = page.getByRole('button', { name: 'Submit work' })
  await engine.narrate(submitNarration, async () => {
    await engine.click(submitBtn)
    await engine.pause(400)
    const dialog = page.getByRole('dialog', { name: 'Submit your work' })
    await engine.type(dialog.getByLabel('What did you do?'), task.workNote, 25)
    await engine.pause(300)
    await engine.click(dialog.getByRole('button', { name: 'Submit work' }))
  })
}

async function recordVolunteerCompletesTask(
  engine: DemoEngine,
  browser: Browser,
  authToken: string,
  volunteerName: string,
  taskId: number,
  task: { title: string; workNote: string },
  assignedNarration: string,
  submitNarration: string,
): Promise<void> {
  console.log(`  Recording ${volunteerName} completing their task...`)

  await dismissWelcomeNotification(engine, authToken)
  const { ctx, page } = await engine.beginSegment(browser, { authToken })

  await page.goto(`${BASE_URL}/dashboard`)
  await engine.pause(300)

  await engine.narrate(assignedNarration, async () => {
    const taskLink = page.getByRole('link', { name: task.title })
    await engine.smoothScrollTo(taskLink)
    await engine.readText(taskLink)
    await engine.click(taskLink)
    await page.waitForURL(new RegExp(`/tasks/${taskId}$`))
    await engine.readText(page.getByRole('heading', { level: 1, name: task.title }))
  })

  await submitTaskWork(engine, page, task, submitNarration)

  await engine.pause(1200)
  await engine.endSegment(ctx, { transition: 'fade-out', transitionDurationMs: 600 })
  console.log(`  ${volunteerName} segment done.`)
}
