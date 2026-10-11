import { Browser, Locator } from '@playwright/test'
import { DemoEngine } from '../engine'
import { buildTitleCardHtml } from '../html'
import { createDemoApiClient } from '../api'
import { showEmailClient } from '../helpers'
import {
  APPLICANT,
  REJECT_APPLICANT,
  SUPERADMIN_EMAIL,
  SUPERADMIN_PASSWORD,
  NOREPLY_EMAIL,
  BASE_URL,
} from '../data'
import { buildWelcomeAndConfirmHtml } from '../../lib/email'

export const meta = {
  name: 'volunteer-signup-approval-flow',
  title: 'Volunteer Signup & Approval Flow',
} as const

export async function run(engine: DemoEngine, browser: Browser): Promise<void> {
  await recordApplicantSignup(engine, browser)
  await recordApplicantPending(engine, browser)
  await recordAdminReview(engine, browser)
}

// ─── Segment 1: signup form ───────────────────────────────────────────────────

async function recordApplicantSignup(engine: DemoEngine, browser: Browser): Promise<void> {
  console.log('  Recording applicant signup flow...')

  const { ctx, page } = await engine.beginSegment(browser)

  await engine.showTitleCard(`${BASE_URL}/`, buildTitleCardHtml(meta.title))
  await engine.narrate(
    "Let me walk you through Catalyse. We'll see how a volunteer applies, and how an admin reviews and approves their application",
  )
  await engine.dismissTitleCard(600)
  await engine.placeCursor()
  await engine.pause(300)

  await engine.narrate('Catalyse connects AI safety projects with volunteers')

  await engine.narrate('New applicants start with their account details', async () => {
    await engine.navigateTo(`${BASE_URL}/signup`)
    await engine.pause(800)
    await engine.type(page.getByLabel('Your Name'), APPLICANT.name)
    await engine.pause(300)
    await engine.type(page.getByLabel('Email', { exact: true }), APPLICANT.email)
    await engine.pause(300)
    await engine.type(page.getByLabel('Password', { exact: true }), APPLICANT.password)
    await engine.pause(200)
    await engine.type(page.getByLabel('Confirm Password'), APPLICANT.password)
    await engine.pause(300)
    await engine.click(page.getByRole('button', { name: 'Next: About you' }))
  })

  const appField = page.getByLabel('Your Application')
  await engine.narrate(
    'Applicants explain why they want to join. This is only visible to admins',
    async () => {
      await engine.smoothScrollTo(appField)
      await engine.readText(page.locator('label[for="applicationMessage"] + p'), 240)
      await engine.pause(300)
      await engine.type(appField, APPLICANT.applicationMessage, 18)
    },
  )

  await engine.narrate('The bio is shown on the public volunteer directory', async () => {
    const bioField = page.getByLabel('About You')
    await engine.smoothScrollTo(bioField)
    await engine.type(bioField, APPLICANT.bio, 35)
  })

  await engine.narrate('Contact details help project owners reach out', async () => {
    await engine.type(page.getByLabel('Discord Handle'), APPLICANT.discord, 45)
    await engine.pause(300)
    // Preferred contact is now a radio next to each contact field rather than a single
    // dropdown — scope to the field's own wrapper since every radio shares the same label.
    const discordFieldWrapper = page.locator('div.mb-5:has(#discord)')
    await engine.click(discordFieldWrapper.getByText('Preferred contact method'))
    await engine.pause(300)
    await engine.type(page.getByLabel('Contact Notes'), APPLICANT.contactNotes, 40)
  })

  await engine.narrate(
    'Availability and location help match volunteers to local projects',
    async () => {
      await engine.type(page.getByLabel(/Hours per week/), APPLICANT.availability, 80)
      await engine.pause(200)
      // FilterDropdown's accessible name comes from its aria-label, not the visible label text.
      await engine.click(page.getByLabel('Select country'))
      await engine.pause(300)
      await engine.click(page.getByRole('option', { name: APPLICANT.country, exact: true }))
      await engine.pause(300)
      // A Local Group dropdown only appears when the chosen country has any — otherwise a
      // plain City / Area text field takes its place.
      const localGroupDropdown = page.getByLabel('Select local group')
      if (await localGroupDropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
        await engine.click(localGroupDropdown)
        await engine.pause(300)
        await engine.click(page.getByRole('option', { name: APPLICANT.localGroup, exact: true }))
      } else {
        await engine.type(page.getByLabel('City / Area'), APPLICANT.location, 45)
      }
    },
  )

  await engine.narrate('Skills help match volunteers with the right projects', async () => {
    await engine.click(page.getByRole('button', { name: 'Next: Skills and privacy' }))
    await page
      .locator('.skill-option')
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => {})
    const allSkillLabels = await page.locator('.skill-option').all()
    const resolved = (
      await Promise.all(
        allSkillLabels.map(async (l) => {
          const text = (await l.textContent())?.trim() ?? ''
          if (!APPLICANT.skills.has(text)) return null
          const box = await l.boundingBox()
          return box ? { l, text, y: box.y, x: box.x } : null
        }),
      )
    ).filter((r): r is { l: Locator; text: string; y: number; x: number } => r !== null)
    resolved.sort((a, b) => a.y - b.y || a.x - b.x)
    for (const { l } of resolved) {
      await engine.click(l)
      await engine.pause(350)
    }
  })

  const submitBtn = page.getByRole('button', { name: 'Submit Application' })
  await engine.smoothScrollTo(submitBtn)
  await engine.narrate('Privacy preferences round out the profile', async () => {
    const checkboxLabels = page
      .locator('label')
      .filter({ hasText: /Show me in the volunteer directory|Allow Google Analytics/i })
    for (const label of await checkboxLabels.all()) {
      await engine.readText(label, 220)
      await engine.pause(150)
    }
  })

  // Capture the signup response to extract auth token + email verification token for use in
  // next segment. Detect mode's page is a stub (see DemoEngine.makeStub) that can't answer a
  // real waitForResponse, and only needs the narration text anyway, so this is real-mode only.
  let authToken = ''
  let verifyToken = ''
  if (!engine.isDetecting) {
    const [signupResp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/auth/signup') && r.status() === 200, {
        timeout: 15_000,
      }),
      engine.click(submitBtn),
    ])
    // oRPC's fetch link wraps the payload as `{ json: ... }` (see e2e/actions/projects.ts's
    // waitForAutosavedDraft for the same convention).
    const {
      json: { token, emailVerificationToken },
    } = (await signupResp.json()) as {
      json: { id: number; token: string; emailVerificationToken?: string }
    }

    if (!emailVerificationToken) {
      throw new Error(
        'No emailVerificationToken returned. Ensure STUB_EMAIL=true is set in .env.local',
      )
    }
    authToken = token
    verifyToken = emailVerificationToken
  }

  await engine.pause(1500)

  // Stash tokens on the context so the next segment can pick them up
  ;(ctx as { _demoAuthToken?: string; _demoVerifyToken?: string })._demoAuthToken = authToken
  ;(ctx as { _demoAuthToken?: string; _demoVerifyToken?: string })._demoVerifyToken = verifyToken

  await engine.endSegment(ctx, { transition: 'fade-out', transitionDurationMs: 600 })

  // Pass tokens forward via module-level vars (simplest approach across segments)
  _authToken = authToken
  _verifyToken = verifyToken
  console.log('  Signup segment done.')
}

// Tokens threaded between segments
let _authToken = ''
let _verifyToken = ''

// ─── Segment 2: email verification + pending dashboard ───────────────────────

async function recordApplicantPending(engine: DemoEngine, browser: Browser): Promise<void> {
  const { ctx, page } = await engine.beginSegment(browser, { authToken: _authToken })

  // Navigate to a real URL first so init scripts (cursor overlay) run
  await page.goto(`${BASE_URL}/dashboard`)
  await engine.pause(300)

  const confirmUrl = `${BASE_URL}/verify-email?token=${_verifyToken}`
  const emailHtml = buildWelcomeAndConfirmHtml(APPLICANT.name, confirmUrl)
  await showEmailClient(engine, page, {
    subject: 'Confirm your Catalyse email address',
    from: NOREPLY_EMAIL,
    to: APPLICANT.email,
    bodyHtml: emailHtml,
  })

  await engine.narrate(
    "Alex checks their email. There's a verification email from Catalyse",
    async () => {
      const emailItem = page.locator('.email-item.selected')
      await engine.mouseMoveTo(emailItem)
      await engine.readText(
        page
          .frameLocator('iframe[title="email"]')
          .getByText('Thanks for joining the PauseAI volunteer community'),
      )
    },
  )
  await engine.narrate('They click the confirmation link to verify the account')
  const confirmBtn = page
    .frameLocator('iframe[title="email"]')
    .locator('a.button')
    .filter({ hasText: /Confirm Email/i })
    .first()
  await engine.click(confirmBtn, { navigatesTo: '**/verify-email**' })

  await engine.narrate('Email confirmed! Their application is now under review')
  await engine.navigateTo(`${BASE_URL}/dashboard`)

  await engine.narrate(
    "They'll be able to browse and join projects once an admin reviews the application",
    async () => {
      await engine.readText(page.locator('text=Your account is pending approval').first(), 320)
    },
  )

  await engine.endSegment(ctx, { transition: 'fade-out', transitionDurationMs: 600 })
  console.log('  Pending segment done.')
}

// ─── Segment 3: admin review ──────────────────────────────────────────────────

async function recordAdminReview(engine: DemoEngine, browser: Browser): Promise<void> {
  console.log('  Setting up second applicant to reject...')

  if (!engine.isDetecting) {
    const api = createDemoApiClient()
    const { emailVerificationToken: rejectVerifyToken } = await api.auth.signup({
      name: REJECT_APPLICANT.name,
      email: REJECT_APPLICANT.email,
      password: REJECT_APPLICANT.password,
      applicationMessage: REJECT_APPLICANT.applicationMessage,
      bio: REJECT_APPLICANT.bio,
      discordHandle: REJECT_APPLICANT.discordHandle,
      contactPreference: REJECT_APPLICANT.contactPreference,
      contactNotes: REJECT_APPLICANT.contactNotes,
      availabilityHoursPerWeek: Number(REJECT_APPLICANT.availabilityHoursPerWeek),
      location: REJECT_APPLICANT.location,
      country: REJECT_APPLICANT.country,
    })
    if (rejectVerifyToken) await api.auth.verifyEmail({ token: rejectVerifyToken })
  }

  console.log('  Recording admin review flow...')

  const { ctx, page } = await engine.beginSegment(browser) // no auth token — admin logs in via form

  await page.goto(`${BASE_URL}/login`)
  await engine.placeCursor()
  await engine.fadeIn(600)

  await engine.narrate('An admin logs in to review new applications', async () => {
    await engine.type(page.getByLabel('Email', { exact: true }), SUPERADMIN_EMAIL)
    await engine.pause(200)
    await engine.type(page.getByLabel('Password'), SUPERADMIN_PASSWORD)
    await engine.pause(300)
    await engine.click(page.getByRole('button', { name: 'Login' }), {
      navigatesTo: `${BASE_URL}/dashboard`,
    })
  })

  await engine.narrate('The admin section is accessible from the user menu', async () => {
    const userMenuBtn = page.locator('.xl\\:flex button').first()
    await engine.click(userMenuBtn)
    await engine.pause(400)
    await engine.click(page.getByRole('link', { name: 'Superadmin panel' }))
    await engine.pause(300)
    await engine.click(page.getByRole('link', { name: 'Manage Applications' }))
  })

  // ── Applicant to approve ──────────────────────────────────────────────────────
  const approveCard = page.getByRole('article').filter({ hasText: APPLICANT.name }).first()
  await engine.narrate('Admins see all pending applications in one place', async () => {
    await engine.scrollPage()
  })
  await engine.smoothScrollTo(approveCard)

  await engine.narrate(
    "Starting a review claims the application so other admins know it's taken, and opens the review details",
    async () => {
      await engine.pause(600)
      await engine.click(approveCard.getByRole('button', { name: 'Start Review' }), {
        navigatesTo: /\/admin\/applications\/\d+/,
      })
    },
  )

  await engine.narrate(
    'The detail view shows the full application, with the message, bio, skills, and contact details',
    async () => {
      await engine.readText(
        page
          .locator('h2')
          .filter({ hasText: /Application message/i })
          .locator('+ p'),
        220,
      )
    },
  )

  await engine.narrate(
    'Admin notes are private, useful for tracking reasoning behind decisions',
    async () => {
      await engine.type(
        page.getByPlaceholder('Notes visible only to admins…'),
        APPLICANT.adminNotes,
        40,
      )
    },
  )

  await engine.narrate('Approval triggers a welcome email to the applicant', async () => {
    await engine.click(page.getByRole('button', { name: 'Approve' }).first())
    await engine.pause(500)
    await engine.click(page.getByRole('dialog').getByRole('button', { name: 'Approve' }), {
      navigatesTo: /\/admin\/applications$/,
    })
  })

  // ── Applicant to reject ────────────────────────────────────────────────────
  const rejectCard = page.getByRole('article').filter({ hasText: REJECT_APPLICANT.name }).first()
  await engine.pause(400)
  await engine.smoothScrollTo(rejectCard)

  await engine.narrate(
    "Applications that don't align with the mission can be rejected",
    async () => {
      await engine.click(rejectCard.getByRole('button', { name: 'Start Review' }), {
        navigatesTo: /\/admin\/applications\/\d+/,
      })
      await engine.pause(400)
      await engine.readText(
        page
          .locator('h2')
          .filter({ hasText: /Application message/i })
          .locator('+ p'),
        220,
      )
    },
  )

  await engine.narrate(
    'Internal notes are only visible to admins, useful for future reference',
    async () => {
      await engine.type(
        page.getByPlaceholder('Notes visible only to admins…'),
        REJECT_APPLICANT.adminNotes,
        40,
      )
    },
  )

  await engine.narrate('A custom message can be included in the rejection email', async () => {
    await engine.type(
      page.getByPlaceholder('Optional message to applicant…'),
      REJECT_APPLICANT.rejectionMessage,
      35,
    )
  })

  await engine.click(page.getByRole('button', { name: 'Reject' }).first())
  await engine.pause(500)
  await engine.narrate(
    'Rejected applicants are notified by email with the custom message',
    async () => {
      await engine.pause(800)
      await engine.click(page.getByRole('dialog').getByRole('button', { name: 'Reject' }), {
        navigatesTo: /\/admin\/applications$/,
      })
    },
  )

  await engine.narrate('Rejected applications are anonymised after seven days', async () => {
    const anonymisedNotice = page.getByText(
      'Personally Identifiable Information will be anonymised on',
    )
    await engine.smoothScrollTo(anonymisedNotice)
    await engine.readText(anonymisedNotice)
  })

  await engine.pause(1200)
  await engine.endSegment(ctx, { transition: 'fade-out', transitionDurationMs: 800 })
  console.log('  Admin segment done.')
}
