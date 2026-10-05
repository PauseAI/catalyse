import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createLocalGroup, createProject, createSkill } from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import SignupPage from './page'

import { google as googleAuth } from '@/test/fakes/google'

const type = (label: string, text: string) => userEvent.type(screen.getByLabelText(label), text)
/** Submits the step on screen, as Enter would, whatever state its button is in. */
const submitStep = () =>
  fireEvent.submit(screen.getByRole('heading', { level: 2 }).closest('form')!)
const onStep = (name: string) => screen.findByRole('heading', { level: 2, name })

async function accountStep(email = 'ann.applicant@example.com') {
  await type('Your Name', 'Ann Applicant')
  await type('Email', email)
  await type('Password', 'a-long-password')
  await type('Confirm Password', 'a-long-password')
  await userEvent.click(screen.getByRole('button', { name: 'Next: About you' }))
  await onStep('About you')
}

async function aboutStep() {
  await type('Your Application', 'I want to help with campaigns and policy work.')
  await type('About You', 'A biography that comfortably passes twenty characters.')
  await type('Hours per week you can give (1–40)', '5')
  await userEvent.click(screen.getByRole('button', { name: 'Select country' }))
  await userEvent.click(await screen.findByRole('option', { name: 'United Kingdom' }))
}

async function toSkillsStep() {
  await userEvent.click(screen.getByRole('button', { name: 'Next: Skills and privacy' }))
  await onStep('Skills and privacy')
}

beforeEach(() => sessionStorage.clear())

describe('signup with email and password', () => {
  it('shows the steps, and fills Contact Email from the sign-up email', async () => {
    await renderApp(<SignupPage />)
    await onStep('Account')
    const steps = screen.getByRole('list', { name: 'Sign-up steps' })
    expect(steps).toHaveTextContent('1. Account')
    expect(screen.getByText('1. Account')).toHaveAttribute('aria-current', 'step')
    await accountStep()
    expect(screen.getByText('✓ Account')).toBeInTheDocument()
    const contact = screen.getByLabelText('Contact Email')
    expect(contact).toBeDisabled()
    expect(contact).toHaveValue('ann.applicant@example.com')
  })

  it('validates each step before moving on, and keeps values going back', async () => {
    await renderApp(<SignupPage />)
    await onStep('Account')
    submitStep()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your name is required')
    await type('Your Name', 'Ann Applicant')
    await type('Email', 'not-an-email')
    submitStep()
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address')
    await userEvent.clear(screen.getByLabelText('Email'))
    await type('Email', 'ann@example.com')
    await type('Password', 'a-long-password')
    await type('Confirm Password', 'different')
    submitStep()
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match')
    await userEvent.clear(screen.getByLabelText('Confirm Password'))
    await userEvent.clear(screen.getByLabelText('Password'))
    await type('Password', 'short')
    await type('Confirm Password', 'short')
    submitStep()
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters')
    await userEvent.clear(screen.getByLabelText('Confirm Password'))
    await userEvent.clear(screen.getByLabelText('Password'))
    await type('Password', 'a-long-password')
    await type('Confirm Password', 'a-long-password')
    submitStep()
    await onStep('About you')
    expect(screen.queryByRole('alert')).toBeNull()

    submitStep()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your application must be at least 20 characters',
    )
    await type('Your Application', 'I want to help with campaigns and policy work.')
    submitStep()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'About You must be at least 20 characters',
    )
    await type('About You', 'A biography that comfortably passes twenty characters.')
    submitStep()
    expect(await screen.findByRole('alert')).toHaveTextContent('Availability is required')
    await type('Hours per week you can give (1–40)', '5')
    submitStep()
    expect(await screen.findByRole('alert')).toHaveTextContent('Country is required')
    await userEvent.click(screen.getByRole('button', { name: 'Select country' }))
    await userEvent.click(await screen.findByRole('option', { name: 'United Kingdom' }))
    await toSkillsStep()

    // Back keeps what was typed on each step.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onStep('About you')
    expect(screen.getByLabelText('About You')).toHaveValue(
      'A biography that comfortably passes twenty characters.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onStep('Account')
    expect(screen.getByLabelText('Your Name')).toHaveValue('Ann Applicant')
  })

  it('submits a full application, lands on the confirmation, and can resend the email', async () => {
    await createLocalGroup({ name: 'Signup Town', country: 'UK' })
    const needed = await createSkill({ name: 'Needed Skill' })
    const other = await createSkill({ name: 'Rare Skill' })
    const p = await createProject({ status: 'in_progress', isSeekingHelp: true })
    await prisma.workItemSkill.create({ data: { workItemId: p.id, skillId: needed.id } })
    await renderApp(<SignupPage />)
    await onStep('Account')
    await accountStep()
    await aboutStep()
    await userEvent.click(await screen.findByRole('button', { name: 'Select local group' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Signup Town' }))
    await type('Discord Handle', 'ann#1')
    await userEvent.click(screen.getAllByLabelText('Preferred contact method')[0])
    await type('Signal', '+44 1')
    await type('WhatsApp', '+44 2')
    await type('Contact Notes', 'DM first')
    await userEvent.click(
      screen.getByRole('button', { name: 'Keep me in the loop about new projects' }),
    )
    await userEvent.click(screen.getByRole('option', { name: 'Send me a fortnightly digest' }))
    // Hints describe their field and are not themselves something to fill in.
    expect(screen.getByLabelText('Your Application')).toHaveAccessibleDescription(
      /Only admins read this/,
    )
    await toSkillsStep()

    // The skills projects need most come first; search reaches the rest.
    await screen.findByText('Most needed by projects right now:')
    await userEvent.click(await screen.findByLabelText('Needed Skill'))
    await type('Search skills', 'zzz-nothing')
    expect(screen.getByText('No skills match that search.')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Search skills'))
    await type('Search skills', 'Rare')
    await userEvent.click(screen.getByLabelText('Rare Skill'))
    await userEvent.clear(screen.getByLabelText('Search skills'))
    // Picked skills stay in view alongside the most needed.
    expect(screen.getByLabelText('Rare Skill')).toBeChecked()
    await userEvent.click(screen.getByLabelText('Rare Skill'))
    await userEvent.click(screen.getByRole('button', { name: 'Show all skills' }))
    await userEvent.click(await screen.findByLabelText('Rare Skill'))
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer skills' }))
    await type('Other Skills', 'juggling')
    const directory = screen.getByLabelText('Show me in the volunteer directory')
    expect(directory).toBeChecked()
    await userEvent.click(directory)
    const analytics = screen.getByLabelText('Allow Google Analytics (recommended)')
    expect(analytics).not.toBeChecked()
    await userEvent.click(analytics)
    expect(screen.queryByText(/Allow project owners to contact me/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Submit Application' }))

    await screen.findByRole('heading', { name: 'Application received' })
    const done = screen.getByRole('status')
    expect(done).toHaveTextContent('usually reviews applications within a few days')
    expect(done).toHaveTextContent('ann.applicant@example.com')
    const row = await prisma.volunteer.findFirstOrThrow({
      where: { email: 'ann.applicant@example.com' },
      include: { skills: true },
    })
    expect(row).toMatchObject({
      name: 'Ann Applicant',
      country: 'UK',
      localGroup: 'Signup Town',
      discordHandle: 'ann#1',
      contactPreference: 'discord',
      signalNumber: '+44 1',
      whatsappNumber: '+44 2',
      contactNotes: 'DM first',
      otherSkills: 'juggling',
      availabilityHoursPerWeek: 5,
      consentMakeProfileVisibleInDirectory: false,
      consentContactableByProjectOwners: true,
      consentShareContactInfoWithProjectOwner: false,
      cookieConsentAnalytics: true,
      emailDigest: 'fortnightly',
      approvalStatus: 'pending',
    })
    expect(row.skills.map((s) => s.skillId).sort()).toEqual([needed.id, other.id].sort())
    expect(sessionStorage.getItem('signup_draft')).toBeNull()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }))
    await vi.waitFor(() => expect(screen.getByText(/request another in 60s/)).toBeInTheDocument())
    for (let i = 0; i < 60; i++) act(() => vi.advanceTimersByTime(1000))
    vi.useRealTimers()
    expect(screen.getByText('Email sent! Check your inbox.')).toBeInTheDocument()
  })

  it('clears a preferred contact method when its field is emptied, and picks a city with no local group', async () => {
    await renderApp(<SignupPage />)
    await onStep('Account')
    await accountStep()
    await type('Discord Handle', 'x')
    await userEvent.click(screen.getAllByLabelText('Preferred contact method')[0])
    expect(screen.getAllByLabelText('Preferred contact method')[0]).toBeChecked()
    await userEvent.clear(screen.getByLabelText('Discord Handle'))
    expect(screen.getAllByLabelText('Preferred contact method')[0]).not.toBeChecked()
    await type('Signal', 's')
    await userEvent.click(screen.getAllByLabelText('Preferred contact method')[1])
    await userEvent.clear(screen.getByLabelText('Signal'))
    await type('WhatsApp', 'w')
    await userEvent.click(screen.getAllByLabelText('Preferred contact method')[2])
    await userEvent.clear(screen.getByLabelText('WhatsApp'))
    await userEvent.click(screen.getAllByLabelText('Preferred contact method')[3])
    expect(screen.getAllByLabelText('Preferred contact method')[3]).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Select country' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Serbia' }))
    expect(screen.getByLabelText('City / Area')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select country' }))
    await userEvent.click(await screen.findByRole('option', { name: 'United Kingdom' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Select local group' }))
    await userEvent.click(
      await screen.findByRole('option', { name: "None of these, I'll enter my city" }),
    )
    await type('City / Area', 'Leeds')

    // Emptying the sign-up email drops it as the preferred method.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onStep('Account')
    await userEvent.clear(screen.getByLabelText('Email'))
    await type('Email', 'e@x.yz')
    await type('Password', 'a-long-password')
    await type('Confirm Password', 'a-long-password')
    submitStep()
    await onStep('About you')
    expect(
      screen
        .getAllByLabelText('Preferred contact method')
        .some((r) => (r as HTMLInputElement).checked),
    ).toBe(false)
  })

  it('keeps answers in the session, without the password, and drops a corrupt draft', async () => {
    await renderApp(<SignupPage />)
    await onStep('Account')
    await accountStep()
    await type('About You', 'Kept across a reload.')
    expect(JSON.parse(sessionStorage.getItem('signup_draft')!)).toMatchObject({
      step: 2,
      name: 'Ann Applicant',
      bio: 'Kept across a reload.',
    })
    expect(sessionStorage.getItem('signup_draft')).not.toContain('a-long-password')
    cleanup()
    await renderApp(<SignupPage />)
    await screen.findByText('Your answers so far were kept. Enter your password again to carry on.')
    expect(screen.getByLabelText('Your Name')).toHaveValue('Ann Applicant')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    await type('Password', 'a-long-password')
    await type('Confirm Password', 'a-long-password')
    submitStep()
    await onStep('About you')
    expect(screen.getByLabelText('About You')).toHaveValue('Kept across a reload.')

    cleanup()
    sessionStorage.setItem('signup_draft', '{not json')
    await renderApp(<SignupPage />)
    await onStep('Account')
    expect(screen.getByLabelText('Your Name')).toHaveValue('')
    expect(screen.queryByText(/Your answers so far were kept/)).toBeNull()
  })

  it('shows a server refusal, and signs straight in when approval is off', async () => {
    await createVolunteer({ email: 'taken@example.com' })
    await renderApp(<SignupPage />)
    await onStep('Account')
    await accountStep('taken@example.com')
    await aboutStep()
    await toSkillsStep()
    await userEvent.click(screen.getByRole('button', { name: 'Submit Application' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered')

    await prisma.platformSettings.update({
      where: { id: 1 },
      data: { requireApplicationApproval: false },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onStep('Account')
    await userEvent.clear(screen.getByLabelText('Email'))
    await type('Email', 'open@example.com')
    await type('Password', 'a-long-password')
    await type('Confirm Password', 'a-long-password')
    submitStep()
    await onStep('About you')
    await toSkillsStep()
    await userEvent.click(screen.getByRole('button', { name: 'Submit Application' }))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/dashboard'))
    await prisma.platformSettings.update({
      where: { id: 1 },
      data: { requireApplicationApproval: true },
    })
  })

  it('bounces a signed-in visitor to the dashboard', async () => {
    const vol = await createVolunteer()
    await renderApp(<SignupPage />, { as: vol })
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'))
  })
})

describe('signup with Google', () => {
  function installGoogle() {
    let callback: ((r: { credential: string }) => void) | undefined
    const google = {
      accounts: {
        id: {
          initialize: vi.fn((c: { callback: typeof callback }) => {
            callback = c.callback
          }),
          renderButton: vi.fn(),
        },
      },
    }
    Object.assign(window, { google })
    return { google, signIn: (credential: string) => act(() => callback!({ credential })) }
  }

  const stubAuth = () =>
    sessionStorage.setItem(
      'google_pending_auth',
      JSON.stringify({ stub: true, name: 'Stub User', email: 'stub@example.com' }),
    )

  it('the dev stub opens the application form; a bad credential errors; a known one signs in', async () => {
    const { google, signIn } = installGoogle()
    await renderApp(<SignupPage />)
    await waitFor(() => expect(google.accounts.id.renderButton).toHaveBeenCalled())
    await signIn('bad')
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid Google token')
    const existing = await createVolunteer({ email: 'g-existing@example.com' })
    googleAuth.accept('known', { email: existing.email!, name: existing.name })
    await signIn('known')
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/dashboard'))

    cleanup()
    localStorage.clear()
    await renderApp(<SignupPage />)
    vi.spyOn(prisma.volunteer, 'findFirst').mockRejectedValueOnce(new Error('db') as never)
    await userEvent.click(await screen.findByRole('button', { name: /dev stub/ }))
    await screen.findByRole('alert')
    await userEvent.click(await screen.findByRole('button', { name: /dev stub/ }))
    await screen.findByText('Complete your application')
    // Google stands in for the account step.
    await onStep('About you')
    expect(screen.getByText('✓ Account (Google)')).toBeInTheDocument()
    expect(screen.getByLabelText('Your Name')).toHaveValue('Stub User')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('google_pending_auth')!)).toMatchObject({
      stub: true,
      email: 'stub@example.com',
    })
    Object.assign(window, { google: undefined })
  })

  it('validates and submits the Google application (restored from storage)', async () => {
    stubAuth()
    await createLocalGroup({ name: 'Google Town', country: 'UK' })
    await renderApp(<SignupPage />)
    await screen.findByText('Complete your application')
    await onStep('About you')
    submitStep()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your application must be')
    await aboutStep()
    await userEvent.click(await screen.findByRole('button', { name: 'Select local group' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Google Town' }))
    expect(screen.getByLabelText('Contact Email')).toHaveValue('stub@example.com')
    await userEvent.click(screen.getAllByLabelText('Preferred contact method')[3])
    await type('Contact Notes', 'n')
    await userEvent.click(
      screen.getByRole('button', { name: 'Keep me in the loop about new projects' }),
    )
    await userEvent.click(screen.getByRole('option', { name: "Don't email me" }))
    // Leaving mid-application is guarded.
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    await toSkillsStep()
    await type('Other Skills', 'o')
    await userEvent.click(screen.getByLabelText('Allow Google Analytics (recommended)'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit Application' }))
    await screen.findByRole('heading', { name: 'Application received' })
    expect(screen.getByRole('status')).toHaveTextContent('Your Google email is already confirmed.')
    const row = await prisma.volunteer.findFirstOrThrow({ where: { email: 'stub@example.com' } })
    expect(row).toMatchObject({
      name: 'Stub User',
      cookieConsentAnalytics: true,
      localGroup: 'Google Town',
      contactPreference: 'email',
      contactNotes: 'n',
      emailDigest: 'none',
      consentContactableByProjectOwners: true,
    })
  })

  it('resumes a Google application at the step it was on, with its answers', async () => {
    sessionStorage.setItem(
      'google_pending_auth',
      JSON.stringify({ stub: true, name: 'Draft User', email: 'draft@example.com' }),
    )
    sessionStorage.setItem(
      'signup_draft',
      JSON.stringify({
        step: 3,
        name: 'Ignored',
        otherSkills: 'kept',
        skills: [],
        consentVisible: false,
        consentAnalytics: true,
        emailDigest: 'none',
      }),
    )
    await renderApp(<SignupPage />)
    await onStep('Skills and privacy')
    expect(screen.getByLabelText('Other Skills')).toHaveValue('kept')
    expect(screen.getByLabelText('Show me in the volunteer directory')).not.toBeChecked()
    expect(screen.getByLabelText('Allow Google Analytics (recommended)')).toBeChecked()
    expect(screen.queryByText(/Your answers so far were kept/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Your Name')).toHaveValue('Draft User')
  })

  it('reports a refused Google application, signs in directly when bootstrapped, and ignores corrupt storage', async () => {
    stubAuth()
    if (!(await prisma.volunteer.findFirst({ where: { email: 'stub@example.com' } })))
      await createVolunteer({ email: 'stub@example.com' })
    await renderApp(<SignupPage />)
    await onStep('About you')
    await aboutStep()
    await toSkillsStep()
    await userEvent.click(screen.getByRole('button', { name: 'Submit Application' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered')

    cleanup()
    sessionStorage.clear()
    sessionStorage.setItem(
      'google_pending_auth',
      JSON.stringify({ credential: 'boot', name: 'Boot', email: 'admin12@example.com' }),
    )
    googleAuth.accept('boot', { email: 'admin12@example.com', name: 'Boot' })
    await renderApp(<SignupPage />)
    await onStep('About you')
    await aboutStep()
    await toSkillsStep()
    await userEvent.click(screen.getByRole('button', { name: 'Submit Application' }))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/dashboard'))
    expect(sessionStorage.getItem('google_pending_auth')).toBeNull()

    cleanup()
    sessionStorage.setItem('google_pending_auth', '{not json')
    await renderApp(<SignupPage />)
    await onStep('Account')
    expect(sessionStorage.getItem('google_pending_auth')).toBeNull()
  })
})
