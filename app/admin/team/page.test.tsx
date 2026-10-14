import { describe, it, expect } from 'vitest'
import { screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createAdmin, createSuperAdmin } from '@/test/factories'
import { renderApp } from '@/test/render'
import AdminTeamPage from './page'

describe('admin team', () => {
  it('lets a super admin invite, cancel invites, toggle bug notifications and revoke admins', async () => {
    const sa = await createSuperAdmin()
    const other = await createAdmin({ name: 'Olly Other', isTechnicalAdmin: true })
    await prisma.adminInvite.create({
      data: {
        email: 'old@example.com',
        inviteToken: 'old-token',
        invitedById: sa.id,
        status: 'accepted',
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    await renderApp(<AdminTeamPage />, { as: sa })
    const card = (await screen.findByText('Olly Other')).closest<HTMLElement>('.card')!
    expect(within(card).getByRole('checkbox', { name: 'Notify of bug reports' })).toBeChecked()
    const mine = screen.getByText(sa.name).closest<HTMLElement>('.card')!
    expect(within(mine).queryByRole('button', { name: 'Revoke access' })).toBeNull()

    await userEvent.click(within(card).getByRole('checkbox'))
    await screen.findByText('Olly Other will no longer be notified of bug reports')
    await waitFor(async () =>
      expect(
        (await prisma.volunteer.findUniqueOrThrow({ where: { id: other.id } })).isTechnicalAdmin,
      ).toBe(false),
    )

    await userEvent.click(within(card).getByRole('button', { name: 'Revoke access' }))
    const revokeDialog = await screen.findByRole('dialog', {
      name: 'Revoke admin access for Olly Other?',
    })
    await userEvent.click(within(revokeDialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(within(card).getByRole('button', { name: 'Revoke access' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke access' }),
    )
    await screen.findByText('Admin access revoked')
    await waitFor(() => expect(screen.queryByText('Olly Other')).toBeNull())

    await userEvent.click(screen.getByRole('tab', { name: 'Pending Invites' }))
    await screen.findByText('No pending invites.')
    await userEvent.click(screen.getByRole('button', { name: 'Invite admin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Invite admin' }))
    await userEvent.type(screen.getByLabelText('Email Address'), 'new.admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invite sent to new.admin@example.com',
    )
    await userEvent.click(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
    const invite = (await screen.findByText('new.admin@example.com')).closest<HTMLElement>('.card')!
    expect(invite).toHaveTextContent(`Invited by ${sa.name}`)
    await userEvent.click(within(invite).getByRole('button', { name: 'Cancel' }))
    await screen.findByText('Invite cancelled')
    await screen.findByText('No pending invites.')

    // A refused invite closes the dialog with the reason.
    await userEvent.click(screen.getByRole('button', { name: 'Invite admin' }))
    await userEvent.type(screen.getByLabelText('Email Address'), sa.email!)
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await screen.findByText('This person is already an admin')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a plain admin the read-only view', async () => {
    const admin = await createAdmin({ name: 'Plain Admin', isTechnicalAdmin: true })
    const sa = await createSuperAdmin()
    await prisma.adminInvite.create({
      data: {
        email: 'pending@example.com',
        inviteToken: 'pending-token',
        invitedById: sa.id,
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    await renderApp(<AdminTeamPage />, { as: admin })
    await screen.findByText('Plain Admin')
    expect(screen.queryByRole('button', { name: 'Invite admin' })).toBeNull()
    expect(screen.getByText('Notified of bug reports')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: 'Pending Invites' }))
    await screen.findByText('pending@example.com')
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('reports failed cancels, revokes and toggles', async () => {
    const sa = await createSuperAdmin()
    const other = await createAdmin({ name: 'Rob Revoked' })
    await prisma.adminInvite.create({
      data: {
        email: 'cancel@example.com',
        inviteToken: 'cancel-token',
        invitedById: sa.id,
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    await renderApp(<AdminTeamPage />, { as: sa })
    const card = (await screen.findByText('Rob Revoked')).closest<HTMLElement>('.card')!
    await prisma.volunteer.delete({ where: { id: other.id } })
    await userEvent.click(within(card).getByRole('checkbox'))
    await screen.findByText(/not found/i)
    await userEvent.click(within(card).getByRole('button', { name: 'Revoke access' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke access' }),
    )
    await screen.findAllByText(/not found/i)
    cleanup()
    await renderApp(<AdminTeamPage />, { as: sa })
    await userEvent.click(await screen.findByRole('tab', { name: 'Pending Invites' }))
    const invite = (await screen.findByText('cancel@example.com')).closest<HTMLElement>('.card')!
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(within(invite).getByRole('button', { name: 'Cancel' }))
    await screen.findByText('Unauthorized')
  })
})
