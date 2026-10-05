import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createAdmin, createVolunteer, createProject, createTask } from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import AdminBugsPage from './bugs/page'
import TriagePage from './triage/page'

describe('admin bugs', () => {
  it('filters, opens, marks in progress and assigns reports', async () => {
    const admin = await createAdmin()
    const reporter = await createVolunteer({ name: 'Rita Reporter' })
    const fixer = await createVolunteer({ name: 'Fiona Fixer' })
    const open = await prisma.bugReport.create({
      data: {
        title: 'Broken button',
        description: 'It does nothing at all',
        category: 'bug',
        severity: 'high',
        reporterId: reporter.id,
        pageUrl: 'http://localhost:3000/projects/1',
      },
    })
    await prisma.bugReport.create({
      data: {
        title: 'Nice to have',
        description: 'Would be lovely to have',
        category: 'feature',
        status: 'resolved',
        resolutionNotes: 'Shipped',
        assigneeId: fixer.id,
        pageUrl: 'javascript:alert(1)',
      },
    })
    await renderApp(<AdminBugsPage />, { as: admin, url: '/admin/bugs' })
    const card = (
      await screen.findByRole('heading', { name: 'Broken button' })
    ).closest<HTMLElement>('[role="link"]')!
    expect(card).toHaveTextContent('bug· high· Rita Reporter')
    expect(card).toHaveTextContent('/projects/1')
    expect(screen.getByRole('heading', { name: 'Open: 1' })).toBeInTheDocument()
    // Resolved reports sit in a section that starts collapsed.
    expect(screen.queryByText('Nice to have')).toBeNull()
    const resolvedToggle = screen.getByRole('button', { name: 'Resolved: 1' })
    expect(resolvedToggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(resolvedToggle)
    const resolved = screen
      .getByRole('heading', { name: 'Nice to have' })
      .closest<HTMLElement>('[role="link"]')!
    expect(resolved).toHaveTextContent('Resolution: Shipped')
    expect(resolved).toHaveTextContent('· javascript:alert(1)')
    expect(resolved).toHaveTextContent('Assigned to: Fiona Fixer')
    expect(within(resolved).queryByRole('button', { name: 'Mark In Progress' })).toBeNull()
    resolvedToggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByText('Nice to have')).toBeNull()

    // Export builds a markdown file from every listed report and hands it to the browser.
    // jsdom has no object URLs; capture the blob and swallow the anchor click that would download it.
    let exported = ''
    const revokeObjectURL = vi.fn()
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        void blob.text().then((t) => (exported = t))
        return 'blob:fake'
      },
      revokeObjectURL,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await userEvent.click(screen.getByRole('button', { name: 'Export as Markdown' }))
    await waitFor(() => expect(exported).toContain('# Bug Reports'))
    expect(exported).toContain('## [#')
    expect(exported).toContain('- **Status:** Open')
    expect(exported).toMatch(/- \*\*Page URL:\*\* (http:\/\/localhost:3000)?\/projects\/1\n/)
    expect(exported).toContain('- **Page URL:** javascript:alert(1)')
    expect(exported).toContain('- **Assignee:** Fiona Fixer')
    expect(exported).toContain('**Resolution notes:**\n\nShipped')
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    click.mockRestore()

    await userEvent.click(screen.getByRole('button', { name: 'Filter by type' }))
    await userEvent.click(screen.getByRole('option', { name: 'Feature' }))
    await waitFor(() => expect(screen.queryByText('Broken button')).toBeNull())
    await screen.findByRole('button', { name: 'Resolved: 1' })
    await userEvent.click(screen.getByRole('button', { name: 'Filter by type' }))
    await userEvent.click(screen.getByRole('option', { name: 'UX Issue' }))
    await screen.findByText('No bug reports found.')
    expect(screen.getByRole('button', { name: 'Export as Markdown' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Filter by type' }))
    await userEvent.click(screen.getByRole('option', { name: 'All' }))
    await screen.findByRole('heading', { name: 'Broken button' })

    await userEvent.click(screen.getByRole('button', { name: 'Assign volunteer to Broken button' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Fiona Fixer' }))
    const openCard = () =>
      screen.getByRole('heading', { name: 'Broken button' }).closest<HTMLElement>('[role="link"]')!
    await userEvent.click(within(openCard()).getByRole('button', { name: 'Assign' }))
    await screen.findByText('Bug report assigned')
    await waitFor(() => expect(openCard()).toHaveTextContent('Assigned to: Fiona Fixer'))
    await userEvent.click(within(openCard()).getByRole('button', { name: 'Mark In Progress' }))
    await screen.findByText('Marked in progress')
    await waitFor(async () =>
      expect((await prisma.bugReport.findUniqueOrThrow({ where: { id: open.id } })).status).toBe(
        'in_progress',
      ),
    )
    // The card re-mounts under its new section once the list refetches; click the settled one.
    await screen.findByRole('heading', { name: 'In Progress: 1' })

    await userEvent.click(openCard())
    expect(navigation.push).toHaveBeenCalledWith(`/bugs/${open.id}`)
    openCard().focus()
    await userEvent.keyboard('{Enter}')
    expect(navigation.push).toHaveBeenCalledTimes(2)
    // Keys and clicks inside the action row stay there rather than opening the report.
    within(openCard()).getByRole('button', { name: 'Assign volunteer to Broken button' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(navigation.push).toHaveBeenCalledTimes(2)
  })

  it('reports failed updates', async () => {
    const admin = await createAdmin()
    await createVolunteer({ name: 'Ada Assignee' })
    await prisma.bugReport.create({
      data: { title: 'Fragile', description: 'Will fail to update' },
    })
    await renderApp(<AdminBugsPage />, { as: admin })
    const fragile = (await screen.findByRole('heading', { name: 'Fragile' })).closest<HTMLElement>(
      '[role="link"]',
    )!
    await userEvent.click(screen.getByRole('button', { name: 'Assign volunteer to Fragile' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Ada Assignee' }))
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(within(fragile).getByRole('button', { name: 'Assign' }))
    await screen.findByText('Unauthorized')
    cleanup()
    localStorage.clear()
    await renderApp(<AdminBugsPage />, { as: admin })
    const again = (await screen.findByRole('heading', { name: 'Fragile' })).closest<HTMLElement>(
      '[role="link"]',
    )!
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(within(again).getByRole('button', { name: 'Mark In Progress' }))
    await screen.findByText('Unauthorized')
  })
})

describe('triage', () => {
  it('shows each tab with counts, submits drafts, and responds to interests', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer({ name: 'Ivy Interested' })
    await prisma.volunteerSkill.create({ data: { volunteerId: vol.id, skillId: 1 } })
    const pending = await createProject({ title: 'Needs review', status: 'pending_review' })
    await createProject({ title: 'Talk about it', status: 'needs_discussion' })
    const stale = await createProject({ title: 'All done really', status: 'in_progress' })
    await createTask(stale.id, { status: 'completed' })
    const draft = await createProject({ title: 'Half a draft', status: 'draft', creatorId: vol.id })
    await createProject({ title: 'Empty draft', status: 'draft', creatorId: vol.id })
    await createTask(draft.id)
    await prisma.workItemInterest.create({
      data: {
        workItemId: pending.id,
        volunteerId: vol.id,
        interestType: 'want_to_own',
        message: 'Pick me',
      },
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: stale.id,
        volunteerId: vol.id,
        interestType: 'want_to_contribute',
        status: 'withdrawn',
      },
    })

    await renderApp(<TriagePage />, { as: admin, url: '/admin/triage' })
    await screen.findByRole('link', { name: 'Needs review' })
    expect(screen.getByRole('tab', { name: 'Pending Review1' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      `/projects/${pending.id}`,
    )

    await userEvent.click(screen.getByRole('tab', { name: 'Needs Changes1' }))
    await screen.findByRole('link', { name: 'Talk about it' })
    await userEvent.click(await screen.findByRole('tab', { name: 'No Open Tasks1' }))
    await screen.findByRole('link', { name: 'All done really' })

    await userEvent.click(await screen.findByRole('tab', { name: 'Drafts2' }))
    await screen.findByRole('link', { name: 'Half a draft' })
    expect(screen.getAllByRole('link', { name: 'View' })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/projects\/\d+$/),
    )
    const emptyCard = screen
      .getByRole('link', { name: 'Empty draft' })
      .closest<HTMLElement>('.card')!
    await userEvent.click(within(emptyCard).getByRole('button', { name: 'Submit for Review' }))
    await screen.findByText(/Add at least one task/)
    const draftCard = screen
      .getByRole('link', { name: 'Half a draft' })
      .closest<HTMLElement>('.card')!
    await userEvent.click(within(draftCard).getByRole('button', { name: 'Submit for Review' }))
    await screen.findByText('Draft submitted for review')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Half a draft' })).toBeNull())
    await userEvent.click(await screen.findByRole('tab', { name: 'Pending Review2' }))
    await screen.findByRole('link', { name: 'Half a draft' })

    await userEvent.click(await screen.findByRole('tab', { name: 'Volunteer Interests1' }))
    const interest = (await screen.findByText('Pick me', { exact: false })).closest<HTMLElement>(
      '.card',
    )!
    expect(interest).toHaveTextContent('Ivy Interested wants to own Needs review')
    expect(interest).toHaveTextContent('Owner: None')
    expect(within(interest).getByRole('link', { name: 'View Project' })).toHaveAttribute(
      'href',
      `/projects/${pending.id}`,
    )
    await userEvent.click(within(interest).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(screen.queryByText('Pick me', { exact: false })).toBeNull())
    await screen.findByText('No pending interests found.')
    await userEvent.click(screen.getByRole('button', { name: 'Status' }))
    await userEvent.click(screen.getByRole('option', { name: 'All' }))
    await screen.findByText(/wants to contribute to/)
    expect(screen.getByText('declined')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })

  it('accepts an interest, shows empty tabs, and reports failures', async () => {
    await prisma.workItemInterest.deleteMany()
    await prisma.workItem.deleteMany()
    const admin = await createAdmin()
    const vol = await createVolunteer({ name: 'Ken Keen' })
    const project = await createProject({ title: 'Wanted', status: 'ready' })
    const interest = await prisma.workItemInterest.create({
      data: { workItemId: project.id, volunteerId: vol.id, interestType: 'want_to_contribute' },
    })
    await renderApp(<TriagePage />, { as: admin })
    await screen.findByText('No projects awaiting review.')
    await userEvent.click(screen.getByRole('tab', { name: 'Needs Changes' }))
    await screen.findByText('No projects awaiting discussion.')
    await userEvent.click(screen.getByRole('tab', { name: 'No Open Tasks' }))
    await screen.findByText('No in-progress projects with all tasks completed.')
    await userEvent.click(screen.getByRole('tab', { name: 'Drafts' }))
    await screen.findByText('No volunteer drafts in progress.')
    await userEvent.click(await screen.findByRole('tab', { name: 'Volunteer Interests1' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(async () =>
      expect(
        (await prisma.workItemInterest.findUniqueOrThrow({ where: { id: interest.id } })).status,
      ).toBe('accepted'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Accepted' }))
    await screen.findByText('accepted')
    await prisma.workItemInterest.update({
      where: { id: interest.id },
      data: { status: 'pending' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Pending' }))
    const decline = await screen.findByRole('button', { name: 'Decline' })
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(decline)
    await screen.findByText('Unauthorized')
  })

  it('reports a failed draft submission', async () => {
    await prisma.workItemInterest.deleteMany()
    await prisma.workItem.deleteMany()
    const admin = await createAdmin()
    const vol = await createVolunteer()
    const draft = await createProject({ title: 'Doomed draft', status: 'draft', creatorId: vol.id })
    await createTask(draft.id)
    await renderApp(<TriagePage />, { as: admin })
    await screen.findByText('No projects awaiting review.')
    await userEvent.click(await screen.findByRole('tab', { name: 'Drafts1' }))
    const submit = await screen.findByRole('button', { name: 'Submit for Review' })
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(submit)
    await screen.findByText('Unauthorized')
  })
})
