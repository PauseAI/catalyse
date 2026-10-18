import { describe, it, expect } from 'vitest'
import { screen, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createVolunteer, createLocalGroup } from '@/test/factories'
import { renderApp } from '@/test/render'
import Analytics from './Analytics'
import FullVolunteerSelect from './FullVolunteerSelect'

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

describe('FullVolunteerSelect', () => {
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
          <FullVolunteerSelect
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
      <FullVolunteerSelect
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

void act
