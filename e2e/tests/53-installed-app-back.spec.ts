import type { BrowserContext } from '@playwright/test'
import { test, expect, readAdminToken } from '../fixtures'
import { adminCreateProjectViaApi } from '../actions/projects'
import { createApiClient } from '../client'
import { fake } from '../fake'

/** Makes pages in `context` report the display mode of an app opened from the home screen. */
async function openAsInstalledApp(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query) =>
      query === '(display-mode: standalone)' ? matchMedia('(min-width: 0px)') : matchMedia(query)
  })
}

async function projectWithTask(baseUrl: string) {
  const title = fake.projectTitle()
  const projectId = await adminCreateProjectViaApi(baseUrl, title, 'A project to go back from')
  const taskTitle = fake.quickTaskTitle()
  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  const task = await adminApi.projects.createTask({ body: { projectId, title: taskTitle } })
  expect(task.status).toBe(200)
  return { title, projectId, taskTitle, taskId: (task.body as { id: number }).id }
}

test.describe('Back in the installed app', () => {
  test('a browser tab has no Back of ours, since the browser has its own', async ({
    adminPage,
    baseUrl,
  }) => {
    const { title, projectId, taskTitle } = await projectWithTask(baseUrl)
    await adminPage.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(adminPage.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 })
    await adminPage.getByRole('link', { name: taskTitle }).first().click()
    await expect(adminPage.getByRole('heading', { name: taskTitle })).toBeVisible()
    await adminPage.waitForLoadState('networkidle')
    await expect(adminPage.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
    await expect(adminPage.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
  })

  test('goes back through the pages opened, then up to the parent page', async ({
    adminPage,
    baseUrl,
    snap,
  }) => {
    const { title, projectId, taskTitle } = await projectWithTask(baseUrl)
    await openAsInstalledApp(adminPage.context())
    const page = await adminPage.context().newPage()

    await page.goto(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 })
    // The first page of the session has nothing behind it, so Back goes up to all projects.
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveAttribute(
      'href',
      '/projects',
    )

    await page.getByRole('link', { name: taskTitle }).first().click()
    await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible()
    await snap(page, 'back button in the header')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page).toHaveURL(`${baseUrl}/projects/${projectId}#tasks`)
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveAttribute(
      'href',
      '/projects',
    )

    await page.getByRole('link', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
  })

  test('a task opened from a notification goes back to its project', async ({
    adminPage,
    baseUrl,
    snap,
  }) => {
    const { title, projectId, taskTitle, taskId } = await projectWithTask(baseUrl)
    await openAsInstalledApp(adminPage.context())
    const page = await adminPage.context().newPage()

    await page.goto(`${baseUrl}/projects/${projectId}/tasks/${taskId}`)
    await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible({ timeout: 10_000 })
    await snap(page, 'back link up to the project')
    await page.getByRole('link', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page).toHaveURL(`${baseUrl}/projects/${projectId}`)
  })

  test('the dashboard opened first has no Back', async ({ adminPage, baseUrl }) => {
    await openAsInstalledApp(adminPage.context())
    const page = await adminPage.context().newPage()
    await page.goto(`${baseUrl}/dashboard`)
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible({ timeout: 10_000 })
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
  })
})
