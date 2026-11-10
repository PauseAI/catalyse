import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createAdmin, createCoordinator, createSuperAdmin, createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import AdminTeamPage from './page'

describe('admin team', () => {
  it('lists the global admins and toggles their bug notifications', async () => {
    const sa = await createSuperAdmin()
    const other = await createAdmin({ name: 'Olly Other', isTechnicalAdmin: true })
    await renderApp(<AdminTeamPage />, { as: sa })
    expect(await screen.findByRole('heading', { name: 'Global admins' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'National chapters' })).toHaveAttribute(
      'href',
      '/admin/chapters',
    )
    const card = (await screen.findByText('Olly Other')).closest<HTMLElement>('.card')!
    expect(within(card).getByRole('checkbox', { name: 'Notify of bug reports' })).toBeChecked()

    await userEvent.click(within(card).getByRole('checkbox'))
    await screen.findByText('Olly Other will no longer be notified of bug reports')
    await waitFor(async () =>
      expect(
        (await prisma.volunteer.findUniqueOrThrow({ where: { id: other.id } })).isTechnicalAdmin,
      ).toBe(false),
    )
  })

  it('reports a failed toggle', async () => {
    const sa = await createSuperAdmin()
    await createAdmin({ name: 'Flaky Admin' })
    await renderApp(<AdminTeamPage />, { as: sa })
    const card = (await screen.findByText('Flaky Admin')).closest<HTMLElement>('.card')!
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(within(card).getByRole('checkbox'))
    await screen.findByText('Unauthorized')
  })

  it('appoints a coordinator with a remit, and removes one', async () => {
    const sa = await createSuperAdmin()
    const nina = await createVolunteer({ name: 'Nina Newcoord' })
    const old = await createCoordinator(undefined, { name: 'Oscar Oldcoord' })
    await renderApp(<AdminTeamPage />, { as: sa })
    expect(await screen.findByRole('heading', { name: 'Coordinators' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Volunteer to make a coordinator' }))
    await userEvent.click(await screen.findByRole('option', { name: /Nina Newcoord/ }))
    await userEvent.type(screen.getByLabelText('What they coordinate'), 'Media')
    await userEvent.click(screen.getByRole('button', { name: 'Appoint' }))
    await screen.findByText('Nina Newcoord is a coordinator')
    expect(
      await prisma.coordinator.findUniqueOrThrow({ where: { volunteerId: nina.id } }),
    ).toMatchObject({ remit: 'Media' })
    expect(screen.getByLabelText('What they coordinate')).toHaveValue('')

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Oscar Oldcoord as a coordinator' }),
    )
    await screen.findByText('They are no longer a coordinator')
    expect(await prisma.coordinator.count({ where: { volunteerId: old.id } })).toBe(0)
  })

  it('reports a failed appointment and a failed removal', async () => {
    const sa = await createSuperAdmin()
    const gone = await createVolunteer({ name: 'Gina Gone' })
    const removed = await createCoordinator(undefined, { name: 'Rory Removed' })
    await renderApp(<AdminTeamPage />, { as: sa })
    await userEvent.click(
      await screen.findByRole('button', { name: 'Volunteer to make a coordinator' }),
    )
    await userEvent.click(await screen.findByRole('option', { name: /Gina Gone/ }))
    await prisma.volunteer.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
    await userEvent.click(screen.getByRole('button', { name: 'Appoint' }))
    await screen.findByText('Volunteer not found')

    const button = await screen.findByRole('button', {
      name: 'Remove Rory Removed as a coordinator',
    })
    await prisma.coordinator.deleteMany({ where: { volunteerId: removed.id } })
    await userEvent.click(button)
    await screen.findByText('Coordinator not found')
  })
})
