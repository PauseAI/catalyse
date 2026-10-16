import { describe, it, expect } from 'vitest'
import { screen, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createLocalGroup } from '@/test/factories'
import { renderApp } from '@/test/render'
import Analytics from './Analytics'
import VolunteerSelect from './VolunteerSelect'
import ConfirmLocationModal from './ConfirmLocationModal'
import { LocationModalProvider } from '@/lib/location-modal-context'

describe('Analytics', () => {
  it('loads Google Analytics for a visitor who has not declined, and shows no banner', async () => {
    await renderApp(<Analytics />)
    expect(await screen.findByTestId('ga-init')).toBeInTheDocument()
    expect(screen.queryByText('Accept')).toBeNull()
    expect(screen.queryByText('Decline')).toBeNull()
  })

  it('stays off for a visitor who declined on this device', async () => {
    localStorage.setItem('cookieConsent', 'false')
    await renderApp(<Analytics />)
    await act(async () => {})
    expect(screen.queryByTestId('ga-init')).toBeNull()
  })

  it("follows the signed-in volunteer's account choice, and keeps it on the device", async () => {
    const accepted = await createVolunteer({ cookieConsentAnalytics: true })
    await renderApp(<Analytics />, { as: accepted })
    expect(await screen.findByTestId('ga-init')).toBeInTheDocument()
    expect(localStorage.getItem('cookieConsent')).toBe('true')

    // A Decline kept on the account beats an older answer stored on the device.
    cleanup()
    localStorage.setItem('cookieConsent', 'true')
    const declined = await createVolunteer({ cookieConsentAnalytics: false })
    await renderApp(<Analytics />, { as: declined })
    await waitFor(() => expect(localStorage.getItem('cookieConsent')).toBe('false'))
    expect(screen.queryByTestId('ga-init')).toBeNull()
  })

  it('loads for a signed-in volunteer who has not chosen', async () => {
    const undecided = await createVolunteer({ cookieConsentAnalytics: null })
    await renderApp(<Analytics />, { as: undecided })
    expect(await screen.findByTestId('ga-init')).toBeInTheDocument()
  })
})

describe('VolunteerSelect', () => {
  it('searches volunteers server-side and remembers the picked option', async () => {
    const me = await createVolunteer()
    const ann = await createVolunteer({
      name: 'Annabelle Zed',
      country: 'UK',
      localGroupId: (await createLocalGroup({ name: 'Leeds' })).id,
      bio: 'Loves zebrafish and long walks',
    })
    await createVolunteer({ name: 'Bartholomew Zed', country: 'US' })
    function Host() {
      const [value, setValue] = useState('')
      return (
        <>
          <VolunteerSelect
            id="vs"
            label="Volunteer"
            ariaLabel="Volunteer"
            value={value}
            onChange={setValue}
          />
          <span data-testid="v">{value}</span>
        </>
      )
    }
    await renderApp(<Host />, { as: me })
    await userEvent.click(screen.getByRole('button', { name: 'Volunteer' }))
    expect(await screen.findByRole('option', { name: 'Annabelle Zed' })).toBeInTheDocument()
    expect(screen.getByText('Leeds, UK')).toBeInTheDocument()
    // The client-side filter matches names only; the server search also matches bios, so a
    // bio word first empties the list and then, once the debounced fetch lands, refills it.
    await userEvent.type(screen.getByRole('searchbox'), 'zebrafish')
    expect(screen.getByText('No results')).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'Bartholomew')
    // Let the debounce elapse so the server-side search actually runs.
    await new Promise((r) => setTimeout(r, 400))
    await waitFor(
      () => expect(screen.queryByRole('option', { name: 'Annabelle Zed' })).toBeNull(),
      { timeout: 3000 },
    )
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.click(
      await screen.findByRole('option', { name: 'Annabelle Zed' }, { timeout: 3000 }),
    )
    expect(screen.getByTestId('v')).toHaveTextContent(String(ann.id))
    // Searching away from the selected volunteer keeps their name on the trigger and in the list.
    await userEvent.click(screen.getByRole('button', { name: 'Volunteer' }))
    await userEvent.type(screen.getByRole('searchbox'), 'Bartholomew')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1), { timeout: 3000 })
    await userEvent.clear(screen.getByRole('searchbox'))
    expect(screen.getByRole('option', { name: 'Annabelle Zed' })).toBeInTheDocument()
  })

  it('does nothing when disabled', async () => {
    const me = await createVolunteer()
    await renderApp(
      <VolunteerSelect
        id="vs"
        label="V"
        ariaLabel="V"
        value=""
        onChange={() => {}}
        enabled={false}
        placeholder="Pick"
      />,
      { as: me },
    )
    await userEvent.click(screen.getByRole('button', { name: 'V' }))
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })
})

describe('ConfirmLocationModal', () => {
  const mount = (as: Awaited<ReturnType<typeof createVolunteer>>) =>
    renderApp(
      <LocationModalProvider>
        <ConfirmLocationModal />
      </LocationModalProvider>,
      { as },
    )

  it('stays hidden for confirmed users, and can be postponed', async () => {
    const confirmed = await createVolunteer({ locationConfirmedAt: new Date() })
    await mount(confirmed)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const fresh = await createVolunteer({ locationConfirmedAt: null, country: null })
    await mount(fresh)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Ask me later'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('collects country, local group or city, and saves', async () => {
    const town = await createLocalGroup({ name: 'Testtown', country: 'UK' })
    const fresh = await createVolunteer({
      locationConfirmedAt: null,
      country: null,
      location: 'Somewhere',
    })
    await mount(fresh)
    await screen.findByRole('dialog')
    // No country yet → nothing but the country picker.
    expect(screen.queryByLabelText('City / Area')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Select country' }))
    await userEvent.click(await screen.findByRole('option', { name: 'United Kingdom' }))
    await userEvent.click(screen.getByRole('button', { name: 'Select local group' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Testtown' }))
    expect(screen.queryByLabelText('City / Area')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(async () => {
      const row = await prisma.volunteer.findUniqueOrThrow({ where: { id: fresh.id } })
      expect(row).toMatchObject({
        country: 'UK',
        nationalChapterId: town.nationalChapterId,
        localGroupId: town.id,
        location: 'Somewhere',
      })
      expect(row.locationConfirmedAt).not.toBeNull()
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('handles a known country with no groups, and the "none of these" choice', async () => {
    const berlin = await createLocalGroup({ name: 'Berlin', country: 'Germany' })
    const noGroups = await createVolunteer({
      locationConfirmedAt: null,
      country: 'Spain',
      location: null,
    })
    await mount(noGroups)
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Select country' })).toBeNull()
    await userEvent.type(await screen.findByLabelText('City / Area'), '  Madrid ')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(async () =>
      expect(
        await prisma.volunteer.findUniqueOrThrow({ where: { id: noGroups.id } }),
      ).toMatchObject({ country: 'Spain', location: 'Madrid', localGroupId: null }),
    )

    const german = await createVolunteer({
      locationConfirmedAt: null,
      country: 'Germany',
      nationalChapterId: berlin.nationalChapterId,
      localGroupId: berlin.id,
    })
    await mount(german)
    await screen.findByRole('dialog')
    await userEvent.click(await screen.findByRole('button', { name: 'Select local group' }))
    await userEvent.click(
      await screen.findByRole('option', { name: "None of these, I'll enter my city" }),
    )
    await userEvent.type(screen.getByLabelText('City / Area'), 'Hamburg')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(async () =>
      expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: german.id } })).toMatchObject({
        localGroupId: null,
        location: 'Hamburg',
      }),
    )
  })
})
void act
