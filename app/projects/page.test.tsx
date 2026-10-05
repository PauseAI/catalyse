import { describe, it, expect } from 'vitest'
import { screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createSuperAdmin,
  createAdmin,
  createProject,
  createSkill,
  createTeam,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import { emails } from '@/test/fakes/email'
import ProjectsPage from './page'

describe('projects directory', () => {
  it('shows the grouped overview with summary badges, view-all links and a collapsible completed section', async () => {
    const skill = await createSkill()
    const me = await createVolunteer({ skills: { create: [{ skillId: skill.id }] } })
    const owner = await createVolunteer()
    const team = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    await createProject({
      title: 'Seeking A',
      skills: { create: [{ skillId: skill.id, isRequired: true }] },
    })
    await createProject({ title: 'Seeking B', teamId: team.id })
    await createProject({
      title: 'Working',
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: false,
    })
    await createProject({
      title: 'Paused',
      assigneeId: owner.id,
      status: 'on_hold',
      isSeekingHelp: false,
    })
    await createProject({ title: 'Finished', status: 'completed' })
    await renderApp(<ProjectsPage />, { as: me, url: '/projects' })
    await screen.findByRole('heading', { name: 'Projects' })
    await screen.findByRole('link', { name: 'Seeking A' })
    expect(screen.getByText('Looking for People: 2')).toBeInTheDocument()
    expect(screen.getByText('In Progress: 1')).toBeInTheDocument()
    expect(screen.getByText('Your Team Projects: 1 project')).toBeInTheDocument()
    expect(screen.getByText('On Hold: 1 project')).toBeInTheDocument()
    // Completed is collapsed until clicked (mouse or keyboard).
    const completedHeading = screen.getByRole('button', { name: /Completed: 1 project/ })
    expect(screen.queryByRole('link', { name: 'Finished' })).toBeNull()
    await userEvent.click(completedHeading)
    expect(screen.getByRole('link', { name: 'Finished' })).toBeInTheDocument()
    fireEvent.keyDown(completedHeading, { key: 'Enter' })
    expect(screen.queryByRole('link', { name: 'Finished' })).toBeNull()
    fireEvent.keyDown(completedHeading, { key: 'a' })
    expect(screen.getByRole('button', { name: 'Team filter' })).toBeInTheDocument()
  })

  it('filters via the URL, pages the flat view, and clears filters', async () => {
    const me = await createVolunteer()
    const owner = await createVolunteer()
    const team = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    for (let i = 0; i < 51; i++)
      await createProject({
        title: `Flat ${i}`,
        assigneeId: owner.id,
        status: 'in_progress',
        isSeekingHelp: false,
        urgency: 'low',
      })
    await createProject({
      title: 'Urgent UK',
      urgency: 'high',
      country: 'UK',
      localGroup: 'London',
      teamId: team.id,
      isOrgProposed: true,
    })
    await renderApp(<ProjectsPage />, { as: me, url: '/projects?status=in_progress&page=2' })
    await screen.findByRole('heading', { name: 'Projects' })
    await screen.findByText('Page 2 of 2')
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('Page 1 of 2')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Page 2 of 2')
    expect(window.location.search).toContain('page=2')

    // Changing any filter resets to page 1.
    await userEvent.click(screen.getByRole('button', { name: 'Priority filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'High' }))
    await waitFor(() => expect(window.location.search).not.toContain('page='))
    await waitFor(() => expect(screen.getByText('No projects found')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Status filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'All' }))
    await userEvent.click(screen.getByRole('button', { name: 'Needs filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'Looking for People' }))
    await screen.findByRole('link', { name: 'Urgent UK' })
    // The URL updates on each keystroke; the query follows after a debounce.
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Nothing' } })
    expect(window.location.search).toContain('q=Nothing')
    await screen.findByText('No projects found')
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Urgent' } })
    await screen.findByRole('link', { name: 'Urgent UK' })
    await userEvent.click(screen.getByRole('button', { name: 'Needs filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'Seeking Help' }))
    await userEvent.click(screen.getByRole('button', { name: 'Needs filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'Seeking Owner' }))
    await screen.findByRole('link', { name: 'Urgent UK' })
    await userEvent.click(screen.getByRole('button', { name: 'Needs filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'Not Seeking' }))
    await userEvent.click(screen.getByRole('button', { name: 'Country/Group filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'United Kingdom - London' }))
    await userEvent.click(screen.getByRole('button', { name: 'Team filter' }))
    await userEvent.click(screen.getByRole('option', { name: team.name }))
    await userEvent.click(screen.getByRole('button', { name: 'Sort filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'Best match' }))
    expect(window.location.search).toContain('q=Urgent')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(navigation.replace).toHaveBeenCalledWith('?', { scroll: false })
    expect(screen.getByLabelText('Search')).toHaveValue('')
  })

  it('leaves the grouped overview for one ordered list when a sort is chosen', async () => {
    const me = await createVolunteer()
    const owner = await createVolunteer()
    const made = (title: string, day: number) =>
      createProject({
        title,
        assigneeId: owner.id,
        status: 'in_progress',
        isSeekingHelp: false,
        createdAt: new Date(Date.UTC(2026, 0, day)),
      })
    await made('Sorted older', 1)
    await made('Sorted newer', 2)
    await renderApp(<ProjectsPage />, { as: me, url: '/projects?q=Sorted' })
    await screen.findByRole('link', { name: 'Sorted older' })
    expect(screen.getByText('In Progress: 2 projects')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sort filter' }))
    await userEvent.click(screen.getByRole('option', { name: 'Newest first' }))
    await waitFor(() => expect(screen.queryByText('In Progress: 2 projects')).toBeNull())
    const links = screen.getAllByRole('link', { name: /^Sorted/ }).map((l) => l.textContent)
    expect(links).toEqual(['Sorted newer', 'Sorted older'])
  })

  it('shows admin alerts, the all-teams filter, and the email confirmation error', async () => {
    const admin = await createSuperAdmin()
    await createProject({ status: 'pending_review' })
    await createVolunteer({ approvalStatus: 'pending' })
    await createVolunteer({ approvalStatus: 'pending' })
    await renderApp(<ProjectsPage />, { as: admin, url: '/projects' })
    await screen.findByText('1 project pending review.')
    await waitFor(() =>
      expect(
        screen.getByText(
          (_, el) =>
            el?.tagName === 'STRONG' &&
            /2 applications\s+pending review/.test(el.textContent ?? ''),
        ),
      ).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Team filter' }))
    expect(screen.getByRole('option', { name: 'All teams' })).toBeInTheDocument()

    cleanup()
    const unconfirmed = await createVolunteer({ emailConfirmed: false })
    await renderApp(<ProjectsPage />, { as: unconfirmed, url: '/projects?status=ready' })
    // An unconfirmed email is a step to take, not an error.
    await screen.findByRole('heading', { name: 'Confirm your email to browse projects' })
    expect(screen.queryByText("Couldn't load projects")).toBeNull()
    // No search or filters, templates or roadmap while there is nothing to search.
    expect(screen.queryByLabelText('Search')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Status filter' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Start from a template' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Project views' })).toBeNull()
    expect(screen.getByText(`We sent a link to ${unconfirmed.email}.`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change email' })).toHaveAttribute('href', '/settings')
    await userEvent.click(screen.getByRole('button', { name: 'Send it again' }))
    await screen.findByText(/Email sent! You can request another in \d+s\./)
    expect(screen.getByRole('button', { name: 'Send it again' })).toBeDisabled()
    await waitFor(() => expect(emails.lastTo(unconfirmed.email!)).toBeDefined())
  })

  it('says once, dismissibly, that an admin page turned the viewer away', async () => {
    const me = await createVolunteer()
    await renderApp(<ProjectsPage />, { as: me, url: '/projects?notice=no-access' })
    const notice = await screen.findByText('That page is for admins.')
    await waitFor(() => expect(window.location.search).toBe(''))
    await userEvent.click(
      within(notice.closest('[role=status]') as HTMLElement).getByLabelText('Dismiss'),
    )
    expect(screen.queryByText('That page is for admins.')).toBeNull()
  })

  it('says a super-admin page is for super admins, and only they are offered its link', async () => {
    const admin = await createAdmin()
    await createVolunteer({ approvalStatus: 'pending' })
    await renderApp(<ProjectsPage />, { as: admin, url: '/projects?notice=super-admin-only' })
    await screen.findByText('That page is for super admins.')
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.queryByText('That page is for admins.')).toBeNull()
    // A regular admin is not offered the applications page they cannot open.
    expect(screen.queryByRole('link', { name: /Review applications/ })).toBeNull()
    cleanup()
    await renderApp(<ProjectsPage />, { as: await createSuperAdmin(), url: '/projects' })
    expect(await screen.findByRole('link', { name: /Review applications/ })).toBeInTheDocument()
  })

  it('switches between List and Timeline, and offers templates only once one exists', async () => {
    const me = await createVolunteer()
    await renderApp(<ProjectsPage />, { as: me, url: '/projects' })
    const views = await screen.findByRole('navigation', { name: 'Project views' })
    expect(within(views).getByRole('link', { name: 'List' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(views).getByRole('link', { name: 'Timeline' })).toHaveAttribute(
      'href',
      '/projects/gantt',
    )
    expect(screen.queryByRole('link', { name: 'Start from a template' })).toBeNull()
    cleanup()

    await prisma.template.create({ data: { title: 'Stall kit', structure: '{}' } })
    await renderApp(<ProjectsPage />, { as: me, url: '/projects' })
    expect(await screen.findByRole('link', { name: 'Start from a template' })).toHaveAttribute(
      'href',
      '/templates',
    )
  })

  it('keeps unapproved volunteers out, showing a loading state until they leave', async () => {
    const pending = await createVolunteer({ approvalStatus: 'pending' })
    await renderApp(<ProjectsPage />, { as: pending, url: '/projects' })
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'))
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByRole('heading', { name: 'Projects' })).toBeNull()
  })
})
