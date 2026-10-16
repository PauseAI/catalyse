import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createSuperAdmin,
  TEST_PASSWORD,
  createStaffInvite,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { emails } from '@/test/fakes/email'
import { navigation } from '@/test/next-navigation'
import { anon } from '@/test/rpc'
import LoginPage from './login/page'
import ForgotPasswordPage from './forgot-password/page'
import ResetPasswordPage from './reset-password/page'
import VerifyEmailPage from './verify-email/page'
import AcceptInvitePage from './accept-invite/page'

describe('login', () => {
  it('logs in with email and password, then goes to the dashboard', async () => {
    const vol = await createVolunteer({ email: 'login@example.com' })
    await renderApp(<LoginPage />, { url: '/login?email=login@example.com' })
    const email = await screen.findByLabelText('Email')
    expect(email).toHaveValue('login@example.com')
    await userEvent.clear(email)
    await userEvent.type(email, ' login@example.com ')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    await userEvent.clear(screen.getByLabelText('Password'))
    await userEvent.type(screen.getByLabelText('Password'), TEST_PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Login' }))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/dashboard'))
    expect(await prisma.session.count({ where: { volunteerId: vol.id } })).toBe(1)
  })

  it('posts even without JavaScript, so a password never lands in the URL', async () => {
    await renderApp(<LoginPage />, { url: '/login' })
    expect((await screen.findByLabelText('Password')).closest('form')).toHaveAttribute(
      'method',
      'post',
    )
  })

  it('bounces an already signed-in visitor to the dashboard', async () => {
    const vol = await createVolunteer()
    await renderApp(<LoginPage />, { as: vol })
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'))
  })
})

describe('forgot / reset password', () => {
  it('requests a reset link (showing the dev link) and resets with it', async () => {
    const vol = await createVolunteer()
    await renderApp(<ForgotPasswordPage />)
    await userEvent.type(screen.getByLabelText('Email'), vol.email!)
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    const link = await screen.findByText(/reset-password\?token=/)
    const token = link.textContent!.split('token=')[1]

    await renderApp(<ResetPasswordPage />, { url: `/reset-password?token=${token}` })
    const pw = screen.getByLabelText('New password')
    const confirm = screen.getByLabelText('Confirm password')
    await userEvent.type(pw, 'new-password-1')
    await userEvent.type(confirm, 'different')
    fireEvent.submit(pw.closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match')
    await userEvent.clear(pw)
    await userEvent.clear(confirm)
    await userEvent.type(pw, 'short')
    await userEvent.type(confirm, 'short')
    fireEvent.submit(pw.closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters')
    await userEvent.clear(pw)
    await userEvent.clear(confirm)
    await userEvent.type(pw, 'new-password-1')
    await userEvent.type(confirm, 'new-password-1')
    fireEvent.submit(pw.closest('form')!)
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/login'))
    expect(
      (await anon().auth.login({ email: vol.email!, password: 'new-password-1' })).token,
    ).toBeTruthy()

    // The same token is now spent.
    cleanup()
    await renderApp(<ResetPasswordPage />, { url: `/reset-password?token=${token}` })
    const pw2 = screen.getByLabelText('New password')
    await userEvent.type(pw2, 'another-long-one')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'another-long-one')
    fireEvent.submit(pw2.closest('form')!)
    expect(await screen.findByText('Invalid or expired reset token')).toBeInTheDocument()
  })

  it('shows an error when the request is refused, and a message without a token', async () => {
    await renderApp(<ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'someone@example.com' } })
    // The server accepts any address, so make the lookup itself fail.
    vi.spyOn(prisma.volunteer, 'findFirst').mockRejectedValueOnce(new Error('db down') as never)
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    cleanup()
    await renderApp(<ResetPasswordPage />, { url: '/reset-password' })
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument()
  })
})

describe('verify email', () => {
  it('sends the owner of an admin address to set a new password', async () => {
    const vol = await createVolunteer({ email: 'admin16@example.com', emailConfirmed: false })
    await prisma.emailVerificationToken.create({
      data: {
        volunteerId: vol.id,
        token: 'verify-admin',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    await renderApp(<VerifyEmailPage />, { url: '/verify-email?token=verify-admin' })
    expect(await screen.findByRole('link', { name: 'Set a new password' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('confirms a valid token, explains a used one, and can resend a link', async () => {
    const vol = await createVolunteer({ emailConfirmed: false })
    const token = (
      await prisma.emailVerificationToken.create({
        data: { volunteerId: vol.id, token: 'verify-me', expiresAt: new Date(Date.now() + 60_000) },
      })
    ).token
    await renderApp(<VerifyEmailPage />, { url: `/verify-email?token=${token}` })
    await screen.findByText('Email confirmed!')

    cleanup()
    await renderApp(<VerifyEmailPage />, { url: `/verify-email?token=${token}` })
    await screen.findByText('Confirmation failed')
    await screen.findByRole('link', { name: 'Go to login' })

    cleanup()
    await renderApp(<VerifyEmailPage />, { url: '/verify-email?token=nonsense' })
    await screen.findByText('Invalid or expired confirmation link')

    cleanup()
    await renderApp(<VerifyEmailPage />, { url: '/verify-email' })
    expect(screen.getByText('Confirm your email')).toBeInTheDocument()
    const input = screen.getByPlaceholderText('Your email address')
    await userEvent.type(input, vol.email!)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await vi.waitFor(() => expect(screen.getByText(/request another in 60s/)).toBeInTheDocument())
    for (let i = 0; i < 60; i++) act(() => vi.advanceTimersByTime(1000))
    vi.useRealTimers()
    expect(screen.getByText('Email sent! Check your inbox.')).toBeInTheDocument()
  })

  it('resends to the address of a signed-in volunteer without asking for it', async () => {
    const me = await createVolunteer({ emailConfirmed: false, email: 'waiting@example.org' })
    await renderApp(<VerifyEmailPage />, { as: me, url: '/verify-email' })
    await screen.findByText('waiting@example.org')
    expect(screen.queryByPlaceholderText('Your email address')).toBeNull()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }))
    await vi.waitFor(() => expect(screen.getByText(/request another in 60s/)).toBeInTheDocument())
    for (let i = 0; i < 60; i++) act(() => vi.advanceTimersByTime(1000))
    vi.useRealTimers()
    expect(screen.getByText('Email sent! Check your inbox.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send it again' })).toBeEnabled()
    await vi.waitFor(() => expect(emails.lastTo('waiting@example.org')).toBeDefined())
  })
})

describe('accept invite', () => {
  it('walks through login prompt, acceptance and error states', async () => {
    await renderApp(<AcceptInvitePage />, { url: '/accept-invite?token=abc' })
    expect(await screen.findByText('Admin invite')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      expect.stringContaining('redirect='),
    )

    cleanup()
    const inviter = await createSuperAdmin()
    const invitee = await createVolunteer({ email: 'invitee@example.com' })
    await createStaffInvite({
      email: 'invitee@example.com',
      inviteToken: 'good-token',
      invitedById: inviter.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await renderApp(<AcceptInvitePage />, { url: '/accept-invite?token=good-token', as: invitee })
    expect(await screen.findByText('Welcome to the team!')).toBeInTheDocument()
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/dashboard'))
    expect(
      await prisma.chapterDeputy.findUnique({ where: { volunteerId: invitee.id } }),
    ).not.toBeNull()

    // Each way an invite can fail says which it was, with someone to ask.
    const failsWith = async (token: string | null, message: string) => {
      cleanup()
      const url = token === null ? '/accept-invite' : `/accept-invite?token=${token}`
      await renderApp(<AcceptInvitePage />, { url, as: invitee })
      await screen.findByText('Invite not accepted')
      expect(screen.getByText(message)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'uk@pauseai.info' })).toHaveAttribute(
        'href',
        'mailto:uk@pauseai.info',
      )
    }
    const invite = (inviteToken: string, data: object) =>
      createStaffInvite({
        email: 'invitee@example.com',
        inviteToken,
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 60_000),
        ...data,
      })
    await invite('old-token', { expiresAt: new Date(Date.now() - 60_000) })
    await invite('revoked-token', { status: 'revoked' })
    await failsWith('good-token', 'This invite has already been used.')
    await failsWith(
      'old-token',
      'This invite has expired. Ask the person who invited you to send a new one.',
    )
    await failsWith('revoked-token', 'This invite has been withdrawn.')
    await failsWith(
      'bad',
      "This invite link isn't valid. Check you opened the whole link from the email.",
    )
    await failsWith(
      null,
      'This link is missing its invite code. Open the link from your invite email again.',
    )
  })
})
