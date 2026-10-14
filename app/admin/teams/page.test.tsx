import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createAdmin, createVolunteer, createTeam } from '@/test/factories'
import { renderApp } from '@/test/render'
import AdminTeamsPage from './page'

const article = (name: string) =>
  screen.getByText(name, { selector: 'span' }).closest<HTMLElement>('article')!

describe('admin teams', () => {
  it('lists teams and suggestions, filters by status, adds teams, and reviews every way', async () => {
    const admin = await createAdmin()
    const suggester = await createVolunteer({ name: 'Sue Suggester' })
    const leader = await createVolunteer({ name: 'Lee Leader' })
    const team = await createTeam({ name: 'Alpha Team' })
    await prisma.teamMembership.create({
      data: { teamId: team.id, volunteerId: leader.id, role: 'leader' },
    })
    const pending = await prisma.teamSuggestion.create({
      data: { name: 'Beta Idea', suggestedById: suggester.id, description: 'A beta' },
    })
    const held = await prisma.teamSuggestion.create({
      data: {
        name: 'Gamma Idea',
        suggestedById: suggester.id,
        status: 'on_hold',
        adminNotes: 'Waiting on budget',
      },
    })
    const declined = await prisma.teamSuggestion.create({
      data: { name: 'Delta Idea', suggestedById: suggester.id, status: 'declined' },
    })
    const toMerge = await prisma.teamSuggestion.create({
      data: { name: 'Epsilon Idea', suggestedById: suggester.id },
    })
    const toDecline = await prisma.teamSuggestion.create({
      data: { name: 'Zeta Idea', suggestedById: suggester.id },
    })

    await renderApp(<AdminTeamsPage />, { as: admin })
    await screen.findByText('Alpha Team', { selector: 'span' })
    expect(article('Alpha Team')).toHaveTextContent('1 member')
    expect(within(article('Alpha Team')).getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      `/admin/teams/${team.id}`,
    )
    expect(article('Gamma Idea')).toHaveTextContent('On hold')
    expect(article('Gamma Idea')).toHaveTextContent('Waiting on budget')
    expect(
      within(article('Gamma Idea')).getByRole('button', { name: 'Re-review' }),
    ).toBeInTheDocument()
    expect(
      within(article('Beta Idea')).getByRole('link', { name: 'Sue Suggester' }),
    ).toHaveAttribute('href', `/admin/volunteers/${suggester.id}`)

    for (const [label, present, absent] of [
      ['Active', 'Alpha Team', 'Beta Idea'],
      ['Pending', 'Beta Idea', 'Alpha Team'],
      ['On hold', 'Gamma Idea', 'Beta Idea'],
      ['Declined', 'Delta Idea', 'Gamma Idea'],
      ['All statuses', 'Alpha Team', ''],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: 'Status filter' }))
      await userEvent.click(screen.getByRole('option', { name: label }))
      await screen.findByText(present, { selector: 'span' })
      if (absent) expect(screen.queryByText(absent, { selector: 'span' })).toBeNull()
    }

    // Add a team: backdrop and × close it; the submit needs a name.
    await userEvent.click(screen.getByRole('button', { name: 'Add team' }))
    await userEvent.click(screen.getByRole('heading', { name: 'Add team' }).closest('.fixed')!)
    expect(screen.queryByRole('heading', { name: 'Add team' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Add team' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add team' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add team' }))
    expect(screen.getAllByRole('button', { name: 'Add team' }).at(-1)).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Team Name'), 'Omega Team')
    await userEvent.type(screen.getByLabelText('Description'), 'The end')
    await userEvent.type(screen.getByLabelText('Luma calendar URL'), 'https://luma.example')
    await userEvent.type(screen.getByLabelText('Team doc URL'), 'https://doc.example')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add team' }).at(-1)!)
    await screen.findByText('Team added')
    await screen.findByText('Omega Team', { selector: 'span' })
    expect(await prisma.team.findFirst({ where: { name: 'Omega Team' } })).toMatchObject({
      description: 'The end',
      lumaUrl: 'https://luma.example',
      docUrl: 'https://doc.example',
    })

    // Review: accept with a different leader found by search.
    await userEvent.click(within(article('Beta Idea')).getByRole('button', { name: 'Review' }))
    expect(screen.getByText('Suggested by Sue Suggester')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('heading', { name: 'Review suggestion' }).closest('.fixed')!,
    )
    await userEvent.click(within(article('Beta Idea')).getByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(within(article('Beta Idea')).getByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(article('Beta Idea')).getByRole('button', { name: 'Review' }))
    expect(screen.getByLabelText('Team Name')).toHaveValue('Beta Idea')
    expect(screen.getByLabelText('Description')).toHaveValue('A beta')
    await userEvent.type(screen.getByLabelText('Team Name'), ' Team')
    await userEvent.type(screen.getByLabelText('Description'), ' indeed')
    await userEvent.click(screen.getByRole('button', { name: 'Select team leader' }))
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'Lee')
    await userEvent.click(await screen.findByRole('option', { name: 'Lee Leader' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Suggestion accepted')
    await screen.findByText('Beta Idea Team', { selector: 'span' })
    const beta = await prisma.team.findFirstOrThrow({ where: { name: 'Beta Idea Team' } })
    expect(beta.description).toBe('A beta indeed')
    expect(
      await prisma.teamMembership.findFirst({
        where: { teamId: beta.id, volunteerId: leader.id },
      }),
    ).toMatchObject({ role: 'leader' })
    void pending

    // Merge into an existing team.
    await userEvent.click(within(article('Epsilon Idea')).getByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('radio', { name: /Merge/ }))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Select existing team to merge into' }),
    )
    await userEvent.click(screen.getByRole('option', { name: 'Alpha Team' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Suggestion merged')
    expect(
      (await prisma.teamSuggestion.findUniqueOrThrow({ where: { id: toMerge.id } })).mergedIntoId,
    ).toBe(team.id)

    // On hold with a note, then decline with a note.
    await userEvent.click(within(article('Zeta Idea')).getByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('radio', { name: /On hold/ }))
    await userEvent.type(screen.getByLabelText(/Note for volunteer/), 'Ask again in spring')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Suggestion put on hold')
    await waitFor(() => expect(article('Zeta Idea')).toHaveTextContent('Ask again in spring'))
    await userEvent.click(within(article('Zeta Idea')).getByRole('button', { name: 'Re-review' }))
    await userEvent.click(screen.getByRole('radio', { name: /Decline/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Suggestion declined')
    await waitFor(() => expect(article('Zeta Idea')).toHaveTextContent('Declined'))
    void held
    void declined
    void toDecline

    // Delete a suggestion and a team; the confirm dialog closes by backdrop, ×, and Cancel.
    await userEvent.click(within(article('Delta Idea')).getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByRole('heading', { name: 'Confirm delete' }).parentElement!.parentElement,
    ).toHaveTextContent('Delete Delta Idea?')
    await userEvent.click(
      screen.getByRole('heading', { name: 'Confirm delete' }).closest('.fixed')!,
    )
    await userEvent.click(within(article('Delta Idea')).getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(within(article('Delta Idea')).getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(article('Delta Idea')).getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await screen.findByText('Deleted')
    await waitFor(() => expect(screen.queryByText('Delta Idea', { selector: 'span' })).toBeNull())
    await userEvent.click(within(article('Omega Team')).getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await waitFor(() => expect(screen.queryByText('Omega Team', { selector: 'span' })).toBeNull())
    expect(await prisma.team.count({ where: { name: 'Omega Team' } })).toBe(0)
  })

  it('shows the empty state and reports failures', async () => {
    const admin = await createAdmin()
    await prisma.teamSuggestion.deleteMany()
    await prisma.team.deleteMany()
    await renderApp(<AdminTeamsPage />, { as: admin })
    await screen.findByText('No teams found.')
    const sug = await prisma.teamSuggestion.create({
      data: { name: 'Doomed Idea', suggestedById: admin.id },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Add team' }))
    await userEvent.type(screen.getByLabelText('Team Name'), 'x')
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add team' }).at(-1)!)
    await screen.findByText('Unauthorized')
    void sug
  })

  it('reports failed reviews and deletes', async () => {
    const admin = await createAdmin()
    await prisma.teamSuggestion.deleteMany()
    await prisma.team.deleteMany()
    const sug = await prisma.teamSuggestion.create({
      data: { name: 'Doomed Idea', suggestedById: admin.id },
    })
    await renderApp(<AdminTeamsPage />, { as: admin })
    await screen.findByText('Doomed Idea', { selector: 'span' })
    await prisma.teamSuggestion.delete({ where: { id: sug.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Not found')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    // The review's toast is still showing, so wait for the delete's own.
    await waitFor(() => expect(screen.getAllByText('Not found')).toHaveLength(2))
    expect(screen.queryByRole('heading', { name: 'Confirm delete' })).toBeNull()
  })
})
