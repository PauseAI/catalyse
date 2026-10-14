import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTeam,
  createLocalGroup,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import SuggestPage from './suggest/page'
import SuggestTeamPage from './suggest-team/page'
import SuggestLocalGroupPage from './suggest-local-group/page'
import PrivacyPage from './privacy/page'

describe('/suggest', () => {
  it('sends first-time proposers to the form, and lists drafts otherwise', async () => {
    const me = await createVolunteer()
    await renderApp(<SuggestPage />, { as: me })
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/suggest/new'))
    cleanup()
    const draft = await createProject({
      status: 'draft',
      creatorId: me.id,
      isOrgProposed: false,
      title: 'Half done',
    })
    await renderApp(<SuggestPage />, { as: me })
    await screen.findByText('Half done')
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      `/projects/${draft.id}/edit`,
    )
    expect(screen.getByRole('link', { name: 'Propose a project' })).toHaveAttribute(
      'href',
      '/suggest/new',
    )
    cleanup()

    // At the draft limit the page says so instead of offering a form that would refuse.
    await createProject({ status: 'draft', creatorId: me.id, isOrgProposed: false })
    await renderApp(<SuggestPage />, { as: me })
    await screen.findByText('You have 2 drafts. Finish or delete one first.')
    expect(screen.queryByRole('link', { name: 'Propose a project' })).toBeNull()
  })
})

describe('/suggest-team', () => {
  it('submits a suggestion and lists mine with status, merge target and notes', async () => {
    const me = await createVolunteer()
    const admin = await createAdmin()
    const team = await createTeam({ name: 'Existing' })
    await prisma.teamSuggestion.create({
      data: {
        name: 'Merged one',
        suggestedById: me.id,
        status: 'accepted',
        mergedIntoId: team.id,
        adminNotes: 'Same thing',
      },
    })
    await prisma.teamSuggestion.create({
      data: { name: 'Odd one', suggestedById: me.id, status: 'on_hold' },
    })
    await renderApp(<SuggestTeamPage />, { as: me })
    await screen.findByText('(merged into Existing)')
    expect(screen.getByRole('link', { name: 'propose a project' })).toHaveAttribute(
      'href',
      '/suggest',
    )
    expect(screen.getByText('Same thing')).toBeInTheDocument()
    expect(screen.getByText('Under review')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit Suggestion' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Team Name'), 'Comms')
    await userEvent.type(screen.getByLabelText(/Description/), 'Talking to press')
    await userEvent.click(screen.getByRole('button', { name: 'Submit Suggestion' }))
    await screen.findByText('Suggestion submitted!')
    await screen.findByText('Comms')
    expect(screen.getByLabelText('Team Name')).toHaveValue('')
    await waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: admin.id, type: 'team_suggestion' },
        }),
      ).toBe(1),
    )
    localStorage.setItem('authToken', 'stale')
    await userEvent.type(screen.getByLabelText('Team Name'), 'Again')
    await userEvent.click(screen.getByRole('button', { name: 'Submit Suggestion' }))
    await screen.findByText('Unauthorized')
  })
})

describe('/suggest-local-group', () => {
  it('prefills the country, submits, and lists mine', async () => {
    const me = await createVolunteer({ country: 'UK' })
    const group = await createLocalGroup({ name: 'Old Town', country: 'UK' })
    await prisma.localGroupSuggestion.create({
      data: {
        name: 'Merged town',
        country: 'UK',
        suggestedById: me.id,
        status: 'merged',
        mergedIntoId: group.id,
        adminNotes: 'dupe',
      },
    })
    await renderApp(<SuggestLocalGroupPage />, { as: me })
    await screen.findByText('(merged into Old Town)')
    expect(screen.getByText('merged')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Select country/group' })).toHaveTextContent(
        'United Kingdom',
      ),
    )
    expect(screen.getByRole('button', { name: 'Submit Suggestion' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Local Group Name'), 'Bristol')
    await userEvent.click(screen.getByRole('button', { name: 'Submit Suggestion' }))
    await screen.findByText('Suggestion submitted!')
    await screen.findByText('United Kingdom, Bristol')
    // An unknown stored country is not prefilled; a failed submit is reported.
    cleanup()
    const elsewhere = await createVolunteer({ country: 'Narnia' })
    await renderApp(<SuggestLocalGroupPage />, { as: elsewhere })
    await screen.findByLabelText('Local Group Name')
    expect(screen.getByRole('button', { name: 'Select country/group' })).toHaveTextContent(
      'Australia',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Select country/group' }))
    await userEvent.click(screen.getByRole('option', { name: 'France' }))
    await userEvent.type(screen.getByLabelText('Local Group Name'), 'Lyon')
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(screen.getByRole('button', { name: 'Submit Suggestion' }))
    await screen.findByText('Unauthorized')
  })
})

describe('/privacy', () => {
  it('lets a signed-in volunteer export their data, and reports failures', async () => {
    const me = await createVolunteer()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await renderApp(<PrivacyPage />, { as: me })
    await userEvent.click(await screen.findByRole('button', { name: 'Download My Data' }))
    await screen.findByText('Data exported successfully!')
    expect(click).toHaveBeenCalled()
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(screen.getByRole('button', { name: 'Download My Data' }))
    await screen.findByText('Unauthorized')
    click.mockRestore()
    cleanup()
    await renderApp(<PrivacyPage />)
    expect(screen.queryByRole('button', { name: 'Download My Data' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Privacy & data' })).toBeInTheDocument()
    expect(
      screen.getByText(/a reminder after 14 days, a final warning after 21, and after 28 days/),
    ).toBeInTheDocument()
  })
})
