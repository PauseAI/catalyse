import { test as base, Browser, BrowserContext, Page, TestInfo, WorkerInfo } from '@playwright/test'
import { workerAuthFile, workerBaseUrl, parallelIndexFromBaseUrl } from './config'
import { fake, seedFake } from './fake'
import fs from 'fs'
import { createApiClient } from './client'
import { SNAPSHOTS_ENABLED, snapshotServerIndex } from './snapshots/config'
import {
  captureFailure,
  captureSnapshot,
  laneFor,
  prepareSnapshotContext,
  type CaptureOptions,
} from './snapshots/capture'

interface Volunteer {
  page: Page
  name: string
  email: string
  password: string
}

/**
 * Take a picture of the page as it stands, under a label that names the
 * moment: `snap(page, 'dialog open')`. Only does anything in a snapshot run
 * (`npm run snapshots`); a plain test run returns at once.
 */
export type Snap = (page: Page, label: string, options?: CaptureOptions) => Promise<void>

interface Fixtures {
  adminPage: Page
  volunteer: Volunteer
  snap: Snap
  /** Seeds fake data per test; every other fixture that fakes data depends on it. */
  seededFake: void
  snapshots: Snapshots
}

/**
 * How a test's browser contexts take part in a snapshot run. Every context
 * the test opens is prepared for the lane as it is created, and shoots the
 * last page it was looking at as a final frame as it closes; `role` names
 * that frame (`end (admin)`) where the fixture that opened the context knows
 * whose it is.
 */
interface Snapshots {
  role: (context: BrowserContext, role: string) => void
}

interface WorkerFixtures {
  baseUrl: string
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  baseUrl: [
    async ({}, runFixture, workerInfo: WorkerInfo) => {
      // A snapshot lane has a block of servers to itself (see snapshotServerIndex).
      const index = SNAPSHOTS_ENABLED
        ? snapshotServerIndex(workerInfo.parallelIndex)
        : workerInfo.parallelIndex
      await runFixture(workerBaseUrl(index))
    },
    { scope: 'worker' },
  ],

  seededFake: [
    async ({}, runFixture, testInfo) => {
      // The lane is part of the seed: the same test runs once per lane, and
      // two lanes can share a server, so each must make its own people.
      seedFake(`${testInfo.project.name} ${testInfo.titlePath.join(' › ')}`)
      await runFixture()
    },
    { auto: true },
  ],

  snap: async ({}, runFixture, testInfo) => {
    let seq = 0
    await runFixture(async (page, label, options) => {
      if (!SNAPSHOTS_ENABLED) return
      seq += 1
      await captureSnapshot(page, testInfo, seq, label, options)
    })
  },

  snapshots: [
    async ({ browser, snap }, runFixture, testInfo) => {
      const roles = new WeakMap<BrowserContext, string>()
      const api: Snapshots = { role: (context, role) => roles.set(context, role) }
      if (!SNAPSHOTS_ENABLED) {
        await runFixture(api)
        return
      }
      // Contexts are opened by fixtures and by tests alike, and the one place
      // they all pass through is the worker's browser, which this test has to
      // itself for as long as it runs.
      const lane = laneFor(testInfo)
      const newContext = browser.newContext
      let unnamed = 0
      browser.newContext = async (options) => {
        const context = await newContext.call(browser, options)
        await prepareSnapshotContext(context, lane)
        const close = context.close
        context.close = async (closeOptions) => {
          let label = roles.get(context)
          if (label === undefined) {
            unnamed += 1
            label = unnamed === 1 ? 'end' : `end ${String(unnamed)}`
          } else {
            label = `end (${label})`
          }
          await finalFrame(context, label, testInfo, snap)
          return close.call(context, closeOptions)
        }
        return context
      }
      try {
        await runFixture(api)
      } finally {
        browser.newContext = newContext
      }
    },
    { auto: true },
  ],

  adminPage: async ({ browser, baseUrl, snapshots, seededFake: _seeded }, runFixture) => {
    const authFile = workerAuthFile(parallelIndexFromBaseUrl(baseUrl))
    const context = await browser.newContext({ storageState: authFile })
    await context.addInitScript(dismissCookieConsentScript)
    snapshots.role(context, 'admin')
    const page = await context.newPage()
    await runFixture(page)
    await context.close()
  },

  volunteer: async (
    {
      browser,
      baseUrl,
      snapshots,
      seededFake: _seeded,
    }: {
      browser: Browser
      baseUrl: string
      snapshots: Snapshots
      seededFake: void
    },
    runFixture: (v: Volunteer) => Promise<void>,
  ) => {
    const person = fake.person()
    const credentials = {
      name: person.name,
      email: person.email,
      password: 'testpassword1',
    }
    const api = createApiClient(baseUrl)
    const result = await api.auth.signup({
      body: {
        name: credentials.name,
        email: credentials.email,
        password: credentials.password,
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'e2e test application message',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    if (result.status !== 200)
      throw new Error(`Volunteer signup failed: ${JSON.stringify(result.body)}`)
    const { id: volunteerId, token: auth_token, emailVerificationToken } = result.body

    if (emailVerificationToken) {
      await confirmVolunteerEmail(baseUrl, emailVerificationToken)
    }
    await approveVolunteer(baseUrl, volunteerId, auth_token)

    const context = await browser.newContext()
    await context.addInitScript((token: string) => {
      localStorage.setItem('authToken', token)
    }, auth_token)
    await context.addInitScript(dismissCookieConsentScript)
    snapshots.role(context, 'volunteer')
    const page = await context.newPage()
    await runFixture({ page, ...credentials })
    await context.close()
  },
})

export { expect } from '@playwright/test'

/** The page a role was last looking at: the newest one still open on the app. */
function lastOpenPage(context: BrowserContext): Page | undefined {
  return context
    .pages()
    .filter((page) => !page.isClosed() && page.url().startsWith('http'))
    .at(-1)
}

async function finalFrame(
  context: BrowserContext,
  label: string,
  testInfo: TestInfo,
  snap: Snap,
): Promise<void> {
  const page = lastOpenPage(context)
  if (!page) return
  // A context closed from inside a test body has no status yet; an error on
  // record is the sign the test is on its way out.
  const failing =
    testInfo.errors.length > 0 ||
    (testInfo.status !== undefined && testInfo.status !== testInfo.expectedStatus)
  if (failing) {
    await captureFailure(page, testInfo)
    return
  }
  await snap(page, label, { dismissToasts: true })
}

// Analytics loads for anyone who has not declined it. Declining up front keeps Google
// Analytics from loading in a test browser.
export function dismissCookieConsentScript(): void {
  localStorage.setItem('cookieConsent', 'false')
}

export async function confirmVolunteerEmail(baseUrl: string, token: string): Promise<void> {
  const api = createApiClient(baseUrl)
  await api.auth.verifyEmail({ body: { token } })
}

export function readAdminToken(baseUrl: string): string | null {
  const parallelIndex = parallelIndexFromBaseUrl(baseUrl)
  const authFile = workerAuthFile(parallelIndex)
  try {
    const data = JSON.parse(fs.readFileSync(authFile, 'utf-8'))
    const origin = data.origins?.find((o: { origin: string }) => o.origin === baseUrl)
    return (
      origin?.localStorage?.find((ls: { name: string }) => ls.name === 'authToken')?.value ?? null
    )
  } catch {
    return null
  }
}

export interface ApiVolunteer {
  id: number
  token: string
  name: string
  email: string
}

export async function createPendingVolunteer(baseUrl: string): Promise<ApiVolunteer> {
  const person = fake.person()
  const api = createApiClient(baseUrl)
  const result = await api.auth.signup({
    body: {
      name: person.name,
      email: person.email,
      password: 'testpassword1',
      bio: 'e2e test bio, at least twenty characters long',
      country: 'UK',
      availabilityHoursPerWeek: 5,
      applicationMessage: 'e2e test application message',
      consentMakeProfileVisibleInDirectory: true,
      consentContactableByProjectOwners: true,
    },
  })
  if (result.status !== 200)
    throw new Error(`Volunteer signup failed: ${JSON.stringify(result.body)}`)
  const { id, token, emailVerificationToken } = result.body as {
    id: number
    token: string
    emailVerificationToken?: string
  }
  if (emailVerificationToken) {
    await confirmVolunteerEmail(baseUrl, emailVerificationToken)
  }
  return { id, token, name: person.name, email: person.email }
}

export async function createApprovedVolunteer(baseUrl: string): Promise<ApiVolunteer> {
  const pending = await createPendingVolunteer(baseUrl)
  await approveVolunteer(baseUrl, pending.id, pending.token)
  return pending
}

// Approved volunteer with a caller-chosen name and directory visibility. Used by tests
// that need a deterministic name (pagination) or a profile hidden from the public
// directory (hidden-volunteer access rules).
export async function createApprovedVolunteerNamed(
  baseUrl: string,
  name: string,
  opts: { hidden?: boolean } = {},
): Promise<ApiVolunteer> {
  const api = createApiClient(baseUrl)
  const email = fake.uniqueEmail()
  const result = await api.auth.signup({
    body: {
      name,
      email,
      password: 'testpassword1',
      bio: 'e2e test bio, at least twenty characters long',
      country: 'UK',
      availabilityHoursPerWeek: 5,
      applicationMessage: 'e2e test application message',
      consentMakeProfileVisibleInDirectory: !opts.hidden,
      consentContactableByProjectOwners: true,
    },
  })
  if (result.status !== 200)
    throw new Error(`Volunteer signup failed: ${JSON.stringify(result.body)}`)
  const { id, token, emailVerificationToken } = result.body as {
    id: number
    token: string
    emailVerificationToken?: string
  }
  if (emailVerificationToken) {
    await confirmVolunteerEmail(baseUrl, emailVerificationToken)
  }
  await approveVolunteer(baseUrl, id, token)
  return { id, token, name, email }
}

export async function rejectVolunteer(
  baseUrl: string,
  volunteerId: number,
  adminNotes?: string,
): Promise<void> {
  const adminToken = readAdminToken(baseUrl)
  if (!adminToken) return
  const api = createApiClient(baseUrl, adminToken)
  await api.admin.applications.action({
    params: { id: volunteerId },
    body: { action: 'reject', ...(adminNotes && { adminNotes }) },
  })
}

// Approval leaves an unread welcome that opens as a dialog over the dashboard. Passing the
// volunteer's token marks it read, so tests that open the dashboard are not covered by it.
export async function approveVolunteer(
  baseUrl: string,
  volunteerId: number,
  volunteerToken?: string,
): Promise<void> {
  const adminToken = readAdminToken(baseUrl)
  if (!adminToken) return
  const api = createApiClient(baseUrl, adminToken)
  await api.admin.applications.action({
    params: { id: volunteerId },
    body: { action: 'approve' },
  })
  if (volunteerToken) await createApiClient(baseUrl, volunteerToken).notifications.readAll()
}

export async function requestMoreInfo(
  baseUrl: string,
  volunteerId: number,
  applicantNotes?: string,
): Promise<void> {
  const adminToken = readAdminToken(baseUrl)
  if (!adminToken) return
  const api = createApiClient(baseUrl, adminToken)
  await api.admin.applications.action({
    params: { id: volunteerId },
    body: { action: 'request_info', ...(applicantNotes && { applicantNotes }) },
  })
}

export async function reopenApplication(
  baseUrl: string,
  volunteerId: number,
  applicantNotes?: string,
): Promise<void> {
  const adminToken = readAdminToken(baseUrl)
  if (!adminToken) return
  const api = createApiClient(baseUrl, adminToken)
  await api.admin.applications.action({
    params: { id: volunteerId },
    body: { action: 'reopen', ...(applicantNotes && { applicantNotes }) },
  })
}

export function getAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)').last()
}
