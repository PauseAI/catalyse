import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createAdmin, createSuperAdmin } from '@/test/factories'
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
})
