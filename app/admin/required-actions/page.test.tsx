import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { createAdmin, createVolunteer } from '@/test/factories'
import { navigation } from '@/test/next-navigation'
import { renderApp } from '@/test/render'
import AdminRequiredActionsPage from './page'

const section = (name: RegExp) => screen.findByRole('region', { name })

describe('outstanding actions', () => {
  it('shows a global admin who has each kind of action waiting', async () => {
    const admin = await createAdmin({ locationConfirmedAt: new Date() })
    const kept = await createVolunteer({ name: 'Kim Kept', locationConfirmedAt: new Date() })
    const twin = await createVolunteer({
      name: 'Kim Twin',
      email: 'kim-twin@example.com',
      duplicateOfId: kept.id,
      country: 'Brazil',
    })
    await renderApp(<AdminRequiredActionsPage />, { as: admin })

    const merges = await section(/^Accounts to merge/)
    expect(within(merges).getByRole('link', { name: 'Kim Twin' })).toHaveAttribute(
      'href',
      `/admin/volunteers/${twin.id}`,
    )
    expect(merges).toHaveTextContent('kim-twin@example.com · Duplicate of Kim Kept')
    expect(await section(/^No national chapter/)).toHaveTextContent('Kim Twin')
    expect(await section(/^Profiles to finish merging \(\d+\)/)).toBeInTheDocument()
    expect(await section(/^Location not confirmed/)).toHaveTextContent('Kim Twin')
  })

  it('says when nobody is waiting', async () => {
    await renderApp(<AdminRequiredActionsPage />, { as: await createAdmin() })
    expect(await section(/^Profiles to finish merging \(0\)/)).toHaveTextContent('Nobody.')
  })

  it('sends anyone but a global admin away', async () => {
    await renderApp(<AdminRequiredActionsPage />, { as: await createVolunteer() })
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/projects?notice=global-admin-only'),
    )
  })
})
