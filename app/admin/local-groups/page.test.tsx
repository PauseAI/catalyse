import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createAdmin, createVolunteer, createLocalGroup, createProject } from '@/test/factories'
import { renderApp } from '@/test/render'
import AdminLocalGroupsPage from './page'

const article = (name: string) =>
  screen.getByText(name, { selector: 'span' }).closest<HTMLElement>('article')!

describe('admin local groups', () => {
  it('lists groups and suggestions, filters, adds, edits, reviews and deletes', async () => {
    const admin = await createAdmin()
    const suggester = await createVolunteer({ name: 'Sam Suggester' })
    const group = await createLocalGroup({ name: 'Zz Bristol', country: 'UK' })
    await createLocalGroup({ name: 'Zz Berlin', country: 'Germany' })
    await createProject({ title: 'Bristol project', localGroup: 'Zz Bristol', country: 'UK' })
    const pending = await prisma.localGroupSuggestion.create({
      data: { name: 'Zz Bath', country: 'UK', suggestedById: suggester.id },
    })
    await prisma.localGroupSuggestion.create({
      data: {
        name: 'Zz Bonn',
        country: 'Germany',
        suggestedById: suggester.id,
        status: 'on_hold',
        adminNotes: 'Checking',
      },
    })
    const declined = await prisma.localGroupSuggestion.create({
      data: { name: 'Zz Boston', country: 'US', suggestedById: suggester.id, status: 'declined' },
    })
    const toMerge = await prisma.localGroupSuggestion.create({
      data: { name: 'Zz Brizzle', country: 'UK', suggestedById: suggester.id },
    })
    const toHold = await prisma.localGroupSuggestion.create({
      data: { name: 'Zz Bruton', country: 'UK', suggestedById: suggester.id },
    })

    await renderApp(<AdminLocalGroupsPage />, { as: admin })
    await screen.findByText('United Kingdom, Zz Bristol', { selector: 'span' })
    expect(article('Germany, Zz Bonn')).toHaveTextContent('On Hold')
    expect(article('Germany, Zz Bonn')).toHaveTextContent('Checking')
    expect(
      within(article('United Kingdom, Zz Bath')).getByRole('link', { name: 'Sam Suggester' }),
    ).toHaveAttribute('href', `/admin/volunteers/${suggester.id}`)

    for (const [label, present, absent] of [
      ['Active', 'United Kingdom, Zz Bristol', 'United Kingdom, Zz Bath'],
      ['Pending', 'United Kingdom, Zz Bath', 'United Kingdom, Zz Bristol'],
      ['On Hold', 'Germany, Zz Bonn', 'United Kingdom, Zz Bath'],
      ['Declined', 'United States, Zz Boston', 'Germany, Zz Bonn'],
      ['All statuses', 'United Kingdom, Zz Bristol', ''],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: 'Status filter' }))
      await userEvent.click(screen.getByRole('option', { name: label }))
      await screen.findByText(present, { selector: 'span' })
      if (absent) expect(screen.queryByText(absent, { selector: 'span' })).toBeNull()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Country/Group filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'Germany' }))
    expect(screen.queryByText('United Kingdom, Zz Bristol', { selector: 'span' })).toBeNull()
    expect(screen.getByText('Germany, Zz Berlin', { selector: 'span' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Country/Group filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'All countries' }))
    await screen.findByText('United Kingdom, Zz Bristol', { selector: 'span' })

    // Add: backdrop, ×, Cancel close it; needs both country and name.
    await userEvent.click(screen.getByRole('button', { name: 'Add Local Group' }))
    await userEvent.click(
      screen.getByRole('heading', { name: 'Add local group' }).closest('.fixed')!,
    )
    expect(screen.queryByRole('heading', { name: 'Add local group' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Add Local Group' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add Local Group' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add Local Group' }))
    expect(screen.getByRole('button', { name: 'Add Group' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Select country/group' }))
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'United K')
    await userEvent.click(await screen.findByRole('option', { name: 'United Kingdom' }))
    await userEvent.type(screen.getByLabelText('Group Name'), 'Zz Bangor')
    await userEvent.click(screen.getByRole('button', { name: 'Add Group' }))
    await screen.findByText('Local group added')
    await screen.findByText('United Kingdom, Zz Bangor', { selector: 'span' })

    // Edit.
    await userEvent.click(
      within(article('United Kingdom, Zz Bangor')).getByRole('button', { name: 'Edit' }),
    )
    await userEvent.click(
      screen.getByRole('heading', { name: 'Edit local group' }).closest('.fixed')!,
    )
    await userEvent.click(
      within(article('United Kingdom, Zz Bangor')).getByRole('button', { name: 'Edit' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(
      within(article('United Kingdom, Zz Bangor')).getByRole('button', { name: 'Edit' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(
      within(article('United Kingdom, Zz Bangor')).getByRole('button', { name: 'Edit' }),
    )
    expect(screen.getByLabelText('Group Name')).toHaveValue('Zz Bangor')
    await userEvent.type(screen.getByLabelText('Group Name'), ' North')
    await userEvent.click(screen.getByRole('button', { name: 'Select country/group' }))
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'Germ')
    await userEvent.click(await screen.findByRole('option', { name: 'Germany' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await screen.findByText('Local group updated')
    await screen.findByText('Germany, Zz Bangor North', { selector: 'span' })

    // Review: accept (edited), merge, on hold, decline.
    await userEvent.click(
      within(article('United Kingdom, Zz Bath')).getByRole('button', { name: 'Review' }),
    )
    expect(screen.getByText('Suggested by Sam Suggester')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('heading', { name: 'Review suggestion' }).closest('.fixed')!,
    )
    await userEvent.click(
      within(article('United Kingdom, Zz Bath')).getByRole('button', { name: 'Review' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(
      within(article('United Kingdom, Zz Bath')).getByRole('button', { name: 'Review' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(
      within(article('United Kingdom, Zz Bath')).getByRole('button', { name: 'Review' }),
    )
    await userEvent.type(screen.getByLabelText('Group Name'), ' Spa')
    await userEvent.clear(screen.getByLabelText('Country'))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Country'), 'UK')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Suggestion accepted')
    await screen.findByText('United Kingdom, Zz Bath Spa', { selector: 'span' })
    void pending

    await userEvent.click(
      within(article('United Kingdom, Zz Brizzle')).getByRole('button', { name: 'Review' }),
    )
    await userEvent.click(screen.getByRole('radio', { name: /Merge/ }))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Select existing group to merge into' }),
    )
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'Bristol')
    await userEvent.click(await screen.findByRole('option', { name: 'United Kingdom, Zz Bristol' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Suggestion merged')
    expect(
      (await prisma.localGroupSuggestion.findUniqueOrThrow({ where: { id: toMerge.id } }))
        .mergedIntoId,
    ).toBe(group.id)

    await userEvent.click(
      within(article('United Kingdom, Zz Bruton')).getByRole('button', { name: 'Review' }),
    )
    await userEvent.click(screen.getByRole('radio', { name: /On Hold/ }))
    expect(screen.getByPlaceholderText(/looking into existing groups/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Note for volunteer/), 'Soon')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Suggestion put on hold')
    await waitFor(() => expect(article('United Kingdom, Zz Bruton')).toHaveTextContent('Soon'))
    await userEvent.click(
      within(article('United Kingdom, Zz Bruton')).getByRole('button', { name: 'Re-review' }),
    )
    await userEvent.click(screen.getByRole('radio', { name: /Decline/ }))
    expect(screen.getByPlaceholderText(/Thanks for the suggestion/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Suggestion declined')
    await waitFor(() => expect(article('United Kingdom, Zz Bruton')).toHaveTextContent('Declined'))
    void toHold

    // Delete a suggestion, then a group that projects reference.
    await userEvent.click(
      within(article('United States, Zz Boston')).getByRole('button', { name: 'Delete' }),
    )
    expect(
      screen.getByRole('heading', { name: 'Confirm delete' }).closest('.fixed'),
    ).toHaveTextContent('Delete United States, Zz Boston?')
    await userEvent.click(
      screen.getByRole('heading', { name: 'Confirm delete' }).closest('.fixed')!,
    )
    await userEvent.click(
      within(article('United States, Zz Boston')).getByRole('button', { name: 'Delete' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(
      within(article('United States, Zz Boston')).getByRole('button', { name: 'Delete' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(
      within(article('United States, Zz Boston')).getByRole('button', { name: 'Delete' }),
    )
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await screen.findByText('Deleted')
    await waitFor(() =>
      expect(screen.queryByText('United States, Zz Boston', { selector: 'span' })).toBeNull(),
    )
    expect(await prisma.localGroupSuggestion.count({ where: { id: declined.id } })).toBe(0)
    await userEvent.click(
      within(article('United Kingdom, Zz Bristol')).getByRole('button', { name: 'Delete' }),
    )
    expect(await screen.findByRole('link', { name: 'Bristol project' })).toHaveAttribute(
      'target',
      '_blank',
    )
    expect(screen.getByText(/will have their local group removed/)).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await waitFor(() =>
      expect(screen.queryByText('United Kingdom, Zz Bristol', { selector: 'span' })).toBeNull(),
    )
    await screen.findByText('Germany, Zz Berlin', { selector: 'span' })
    await userEvent.click(
      within(article('Germany, Zz Berlin')).getByRole('button', { name: 'Delete' }),
    )
    await waitFor(() => expect(screen.queryByText(/Checking affected projects/)).toBeNull())
    expect(screen.queryByText(/will have their local group removed/)).toBeNull()
  })

  it('shows the empty state and reports failures', async () => {
    const admin = await createAdmin()
    await prisma.localGroupSuggestion.deleteMany()
    await prisma.localGroup.deleteMany()
    await renderApp(<AdminLocalGroupsPage />, { as: admin })
    await screen.findByText('No local groups found.')
    const sug = await prisma.localGroupSuggestion.create({
      data: { name: 'Doomed', country: 'UK', suggestedById: admin.id },
    })
    const grp = await createLocalGroup({ name: 'Doomed Group' })
    await userEvent.click(screen.getByRole('button', { name: 'Add Local Group' }))
    await userEvent.click(screen.getByRole('button', { name: 'Select country/group' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Germany' }))
    await userEvent.type(screen.getByLabelText('Group Name'), 'Doomed Group')
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(screen.getByRole('button', { name: 'Add Group' }))
    await screen.findByText('Unauthorized')
    void sug
    void grp
  })

  it('reports failed edits, reviews and deletes', async () => {
    const admin = await createAdmin()
    await prisma.localGroupSuggestion.deleteMany()
    await prisma.localGroup.deleteMany()
    const sug = await prisma.localGroupSuggestion.create({
      data: { name: 'Doomed', country: 'UK', suggestedById: admin.id },
    })
    const grp = await createLocalGroup({ name: 'Doomed Group' })
    await renderApp(<AdminLocalGroupsPage />, { as: admin })
    await screen.findByText('United Kingdom, Doomed', { selector: 'span' })
    await prisma.localGroupSuggestion.delete({ where: { id: sug.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText(/not found/i)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(
      within(article('United Kingdom, Doomed')).getByRole('button', { name: 'Delete' }),
    )
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await screen.findAllByText(/not found/i)
    await prisma.localGroup.delete({ where: { id: grp.id } })
    await userEvent.click(
      within(article('United Kingdom, Doomed Group')).getByRole('button', { name: 'Edit' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await screen.findAllByText(/not found/i)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(
      within(article('United Kingdom, Doomed Group')).getByRole('button', { name: 'Delete' }),
    )
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await screen.findAllByText(/not found/i)
  })
})
