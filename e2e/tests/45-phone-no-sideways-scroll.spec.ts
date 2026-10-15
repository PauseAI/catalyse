import type { Page } from '@playwright/test'
import { test, expect, readAdminToken } from '../fixtures'
import { adminCreateProjectViaApi } from '../actions/projects'
import { createApiClient } from '../client'
import { fake } from '../fake'

// On a phone, cards run edge to edge by pulling out through the page gutter; one that pulls
// further than its gutter makes the whole page scroll sideways.
const PHONE = { width: 390, height: 844 }

async function expectNoSidewaysScroll(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth, url).toBeLessThanOrEqual(innerWidth)
}

test.describe('Phone layout', () => {
  test('no page scrolls sideways at phone width', async ({ adminPage, browser, baseUrl }) => {
    const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
    const projectId = await adminCreateProjectViaApi(
      baseUrl,
      fake.projectTitle(),
      'A project to lay out on a phone',
    )
    const task = await adminApi.projects.createTask({
      body: { projectId, title: 'A task to lay out on a phone' },
    })
    expect(task.status).toBe(200)
    const taskId = (task.body as { id: number }).id

    await adminPage.setViewportSize(PHONE)
    for (const path of [
      '/dashboard',
      '/projects',
      `/projects/${projectId}`,
      `/projects/${projectId}#people`,
      `/projects/${projectId}/tasks/${taskId}`,
      '/quick-tasks',
      '/volunteers',
      '/inbox',
      '/settings',
      '/templates',
      '/suggest',
      '/admin',
      '/admin/projects',
    ]) {
      await expectNoSidewaysScroll(adminPage, `${baseUrl}${path}`)
    }

    const anon = await browser.newPage({ viewport: PHONE })
    for (const path of ['/', '/login', '/signup', '/forgot-password']) {
      await expectNoSidewaysScroll(anon, `${baseUrl}${path}`)
    }
    await anon.close()
  })
})
