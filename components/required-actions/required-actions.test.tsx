import { describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createChapter, createLocalGroup, createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import { emails } from '@/test/fakes/email'
import { rateLimit } from '@/test/fakes/rate-limit'
import { maskEmail } from '@/lib/mask-email'
import { RequiredActionsProvider, useRequiredActions } from '@/lib/required-actions-context'
import RequiredActions from './RequiredActions'

const mount = (as: Awaited<ReturnType<typeof createVolunteer>>) =>
  renderApp(
    <RequiredActionsProvider>
      <RequiredActions />
    </RequiredActionsProvider>,
    { as },
  )

const banner = () => screen.findByRole('region', { name: 'Things to settle' })

describe('RequiredActions', () => {
  it('opens the first action once, then keeps the rest in a banner that can be hidden', async () => {
    const vol = await createVolunteer({ locationConfirmedAt: null })
    await mount(vol)
    expect(await screen.findByRole('dialog', { name: 'Confirm your location' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ask me later' }))
    const region = await banner()
    expect(region).toHaveTextContent('Confirm your location')
    expect(region).toHaveTextContent('Help us match you with nearby projects')
    expect(region).toHaveTextContent('Join a national chapter')
    await userEvent.click(within(region).getAllByRole('button', { name: 'Continue' })[0])
    expect(await screen.findByRole('dialog', { name: 'Confirm your location' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ask me later' }))
    await userEvent.click(within(await banner()).getByRole('button', { name: 'Hide for now' }))
    expect(screen.queryByRole('region', { name: 'Things to settle' })).toBeNull()
  })

  it('opens nothing by itself on a page an emailed link lands on', async () => {
    const vol = await createVolunteer({ locationConfirmedAt: null })
    await renderApp(
      <RequiredActionsProvider>
        <RequiredActions />
      </RequiredActionsProvider>,
      { as: vol, url: '/merge-accounts?token=x' },
    )
    expect(await banner()).toHaveTextContent('Confirm your location')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Probe() {
      useRequiredActions()
      return null
    }
    expect(() => render(<Probe />)).toThrow('useRequiredActions must be used within')
    vi.restoreAllMocks()
  })
})

/** `merged` marked by a global admin as a duplicate of `kept`. */
async function markedPair() {
  const kept = await createVolunteer({ locationConfirmedAt: new Date() })
  const merged = await createVolunteer({
    name: kept.name,
    locationConfirmedAt: new Date(),
    duplicateOfId: kept.id,
  })
  return { kept, merged }
}

describe('MergeAccountDialog', () => {
  it('sends a link to the other address, and says it was sent', async () => {
    const { kept, merged } = await markedPair()
    await mount(merged)
    const dialog = await screen.findByRole('dialog', { name: 'Merge your accounts' })
    expect(dialog).toHaveTextContent(maskEmail(kept.email!))
    expect(dialog).toHaveTextContent('you choose which of the two addresses to sign in with')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send the link' }))
    expect(
      await screen.findByText(`We sent a link to ${maskEmail(kept.email!)}`, {
        selector: '[role=alert] *',
      }),
    ).toBeInTheDocument()
    expect(emails.last.to).toBe(kept.email)
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Open it to finish merging')

    rateLimit.denyNext()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send the link again' }))
    expect(await screen.findByText('Too many links sent; try later')).toBeInTheDocument()
  })

  it('clears the mark when the other account is someone else', async () => {
    const { kept, merged } = await markedPair()
    await mount(kept)
    const dialog = await screen.findByRole('dialog', { name: 'Merge your accounts' })
    await userEvent.click(within(dialog).getByRole('button', { name: "That account isn't mine" }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: merged.id } })).duplicateOfId,
    ).toBe(null)
  })
})

describe('ReconcileProfileDialog', () => {
  async function mergedWithConflicts() {
    const vol = await createVolunteer({
      locationConfirmedAt: new Date(),
      bio: 'Kept bio',
      consentContactableByProjectOwners: false,
    })
    const gone = await createVolunteer({ deletedAt: new Date(), mergedIntoId: vol.id })
    const merge = await prisma.accountMerge.create({
      data: {
        keptId: vol.id,
        mergedId: gone.id,
        conflicts: [
          { field: 'bio', kept: 'Kept bio', merged: 'Other bio' },
          { field: 'consentContactableByProjectOwners', kept: true, merged: false },
        ],
      },
    })
    return { vol, merge }
  }

  it('asks about each differing field and saves the picks', async () => {
    const { vol, merge } = await mergedWithConflicts()
    await mount(vol)
    const dialog = await screen.findByRole('dialog', { name: 'Finish merging your profile' })
    expect(dialog).toHaveTextContent('1 of 2')
    expect(within(dialog).getByRole('radio', { name: /Kept bio/ })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('radio', { name: /Other bio/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))

    expect(dialog).toHaveTextContent('Project owners may contact me')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }))
    expect(within(dialog).getByRole('radio', { name: /Other bio/ })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    await userEvent.click(within(dialog).getByRole('radio', { name: /Yes/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).toMatchObject({
      bio: 'Other bio',
      consentContactableByProjectOwners: true,
    })
    expect(
      (await prisma.accountMerge.findUniqueOrThrow({ where: { id: merge.id } }))
        .conflictsResolvedAt,
    ).not.toBeNull()
  })

  it('says so when the conflicts were settled elsewhere', async () => {
    const { vol, merge } = await mergedWithConflicts()
    await mount(vol)
    const dialog = await screen.findByRole('dialog', { name: 'Finish merging your profile' })
    await prisma.accountMerge.update({
      where: { id: merge.id },
      data: { conflictsResolvedAt: new Date() },
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    await userEvent.click(within(dialog).getByRole('radio', { name: /No/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Nothing left to settle')).toBeInTheDocument()
  })
})

describe('ChooseChapterDialog', () => {
  async function choose(name: string, beforeJoining = async () => {}) {
    const dialog = await screen.findByRole('dialog', { name: 'Join a national chapter' })
    expect(within(dialog).getByRole('button', { name: 'Join' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Select chapter' }))
    await userEvent.click(await screen.findByRole('option', { name }))
    await beforeJoining()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Join' }))
  }

  it('puts someone from the holding pool in the chapter they pick', async () => {
    const chapter = await createChapter()
    const vol = await createVolunteer({ locationConfirmedAt: new Date(), country: 'Brazil' })
    await mount(vol)
    await choose(chapter.name)
    expect(
      await screen.findByText(`You joined ${chapter.name}`, { selector: '[role=alert] *' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).nationalChapterId,
    ).toBe(chapter.id)
  })

  it('says why joining failed', async () => {
    const chapter = await createChapter()
    const vol = await createVolunteer({ locationConfirmedAt: new Date() })
    await mount(vol)
    await choose(chapter.name, async () => {
      await prisma.nationalChapter.delete({ where: { id: chapter.id } })
    })
    expect(
      await screen.findByText('Chapter not found', { selector: '[role=alert] *' }),
    ).toBeInTheDocument()
  })
})

describe('ConfirmLocationDialog', () => {
  it('stays hidden for confirmed users, and can be postponed', async () => {
    const confirmed = await createVolunteer({ locationConfirmedAt: new Date() })
    await mount(confirmed)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    cleanup()
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

    cleanup()
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
