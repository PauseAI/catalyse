import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, act, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createChapter,
  createChapterDeputy,
  createMember,
  createVolunteer,
  createProject,
  createQuickTask,
  createSkill,
  createTask,
  createTeam,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { emails } from '@/test/fakes/email'
import { navigation } from '@/test/next-navigation'
import HomePage from './page'

const DAY = 24 * 60 * 60 * 1000

/** Whether `a` comes before `b` in the document. */
const before = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('home', () => {
  it('shows a new applicant the checklist only', async () => {
    const pending = await createVolunteer({
      approvalStatus: 'pending',
      emailConfirmed: false,
      emailDigest: null,
    })
    await renderApp(<HomePage />, { as: pending, url: '/dashboard' })
    await screen.findByRole('heading', { name: 'Home' })
    expect(document.title).toBe('Catalyse | Home')
    const checklist = screen.getByRole('region', { name: 'Getting started' })
    expect(within(checklist).getByText('Application under review')).toBeInTheDocument()
    expect(within(checklist).getByText(/Your account is pending approval/)).toBeInTheDocument()
    expect(within(checklist).getByRole('link', { name: 'Confirm your email' })).toHaveAttribute(
      'href',
      '/verify-email',
    )
    // The confirmation email can be sent again from here.
    await userEvent.click(within(checklist).getByRole('button', { name: 'Send it again' }))
    await within(checklist).findByText(/Email sent!/)
    await vi.waitFor(() => expect(emails.lastTo(pending.email!)).toBeTruthy())
    // No first task to pick until approved.
    expect(within(checklist).queryByRole('link', { name: 'Pick a first task' })).toBeNull()
    expect(within(checklist).getByText('Pick a first task')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Needs your attention/ })).toBeNull()
    expect(
      screen.queryByRole('region', { name: /Your tasks|Projects you manage|Your teams/ }),
    ).toBeNull()
    expect(screen.queryByRole('link', { name: 'Propose a project' })).toBeNull()
    // Notifications live in the Inbox.
    expect(screen.queryByRole('region', { name: /Notifications/ })).toBeNull()

    expect(screen.getByText(/Stay in the loop/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText(/Stay in the loop/)).toBeNull()
    cleanup()

    const needsInfo = await createVolunteer({ approvalStatus: 'needs_info' })
    await renderApp(<HomePage />, { as: needsInfo, url: '/dashboard' })
    expect(await screen.findByRole('link', { name: 'Update application' })).toBeInTheDocument()
  })

  it('gives an applicant things to do while they wait', async () => {
    const chapter = await createChapter()
    const skill = await createSkill()
    await createProject({
      nationalChapterId: chapter.id,
      isSeekingHelp: true,
      skills: { create: [{ skillId: skill.id }] },
    })
    await createQuickTask({ nationalChapterId: chapter.id })
    const applicant = await createMember(chapter, {
      name: 'Ann Applicant',
      approvalStatus: 'pending',
      skills: { create: [{ skillId: skill.id }] },
    })
    await renderApp(<HomePage />, { as: applicant, url: '/dashboard' })
    await screen.findByRole('heading', { name: 'Thanks for applying, Ann!' })
    expect(
      screen.getByText(`1 project looking for volunteers (1 using your skills) and 1 quick task.`, {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(`Waiting for you in ${chapter.name}:`)).toBeInTheDocument()
    const actions = screen.getByRole('list', { name: 'Things you can do today' })
    expect(
      within(actions).getByRole('link', {
        name: 'Sign the PauseAI statement (opens in a new tab)',
      }),
    ).toHaveAttribute('href', 'https://pauseai.info/statement')
    expect(within(actions).getAllByRole('link')).toHaveLength(4)
    expect(screen.getByRole('link', { name: 'skills and availability' })).toHaveAttribute(
      'href',
      '/settings',
    )
    expect(screen.getByRole('region', { name: "What you'll find here" })).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'What PauseAI volunteers have done' }),
    ).toBeInTheDocument()
  })

  it('asks an applicant with nothing open yet to add skills', async () => {
    const bare = await createMember(await createChapter(), { approvalStatus: 'pending' })
    await renderApp(<HomePage />, { as: bare, url: '/dashboard' })
    await screen.findByRole('heading', { name: /Thanks for applying/ })
    expect(screen.queryByText(/Waiting for you/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Add your skills' })).toHaveAttribute(
      'href',
      '/settings',
    )
  })

  it('spares a member the applicant welcome', async () => {
    await renderApp(<HomePage />, { as: await createVolunteer(), url: '/dashboard' })
    await screen.findByRole('link', { name: 'Propose a project' })
    expect(screen.queryByRole('heading', { name: /Thanks for applying/ })).toBeNull()
  })

  it('opens discovery for someone with nothing of their own yet', async () => {
    const fresh = await createVolunteer({ country: null })
    await createQuickTask({ title: 'Open starter' })
    await renderApp(<HomePage />, { as: fresh, url: '/dashboard' })
    await screen.findByRole('link', { name: 'Propose a project' })

    const checklist = screen.getByRole('region', { name: 'Getting started' })
    expect(within(checklist).getByText('Application approved')).toBeInTheDocument()
    expect(within(checklist).getByRole('link', { name: 'Pick a first task' })).toHaveAttribute(
      'href',
      '/quick-tasks',
    )
    // Nothing waiting, so no section saying so.
    expect(screen.queryByRole('region', { name: /Needs your attention/ })).toBeNull()
    expect(screen.getByText(/not working on anything yet/)).toBeInTheDocument()

    const find = screen.getByRole('button', { name: /Find something to do/ })
    expect(find).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Open starter' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add skills' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('link', { name: 'Add your country' })).toHaveAttribute(
      'href',
      '/settings',
    )
    await userEvent.click(find)
    expect(find).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Open starter' })).toBeNull()
  })

  it('orders attention, each kind of work, then a folded Find; acts on items', async () => {
    const skill = await createSkill()
    const chapter = await createChapter()
    const me = await createMember(chapter, {
      emailDigest: 'match',
      skills: { create: [{ skillId: skill.id }] },
    })
    const other = await createVolunteer({ name: 'Sam' })
    const lead = await createProject({
      title: 'Westminster',
      assigneeId: me.id,
      status: 'in_progress',
    })
    await prisma.workItemInterest.create({
      data: { workItemId: lead.id, volunteerId: other.id, interestType: 'want_to_contribute' },
    })
    const task = await createTask(lead.id, {
      title: 'Scout',
      assigneeId: me.id,
      status: 'in_progress',
    })
    await prisma.workItem.update({
      where: { id: task.id },
      data: { updatedAt: new Date(Date.now() - 9 * DAY) },
    })
    const team = await createTeam({ name: 'Comms team' })
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    const mention = await prisma.notification.create({
      data: {
        volunteerId: me.id,
        type: 'mention',
        title: 'Sam mentioned you on "Westminster"',
        body: 'ping',
        link: `/projects/${lead.id}#comment-1`,
      },
    })
    await createProject({
      title: 'Skill match',
      status: 'ready',
      nationalChapterId: chapter.id,
      skills: { create: [{ skillId: skill.id, isRequired: true }] },
    })
    await createProject({ title: 'Local one', status: 'ready', nationalChapterId: chapter.id })

    await renderApp(<HomePage />, { as: me, url: '/dashboard' })
    const attention = await screen.findByRole('region', { name: /Needs your attention/ })
    const tasks = screen.getByRole('region', { name: /Your tasks/ })
    const managed = screen.getByRole('region', { name: /Projects you manage/ })
    const teams = screen.getByRole('region', { name: /Your teams/ })
    const find = screen.getByRole('region', { name: 'Find something to do' })
    expect(
      before(attention, tasks) &&
        before(tasks, managed) &&
        before(managed, teams) &&
        before(teams, find),
    ).toBe(true)
    // Not part of any project but their own, and no admin role.
    expect(screen.queryByRole('region', { name: /Other projects/ })).toBeNull()
    expect(screen.queryByRole('region', { name: /^Admin/ })).toBeNull()
    // Nothing left to get started on: a task is claimed.
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()

    expect(within(attention).getByText('Sam wants to help on "Westminster"')).toBeInTheDocument()
    expect(within(attention).getByText('"Scout": no update for 9 days')).toBeInTheDocument()
    expect(
      within(attention).getByRole('link', { name: 'Review: Sam wants to help on "Westminster"' }),
    ).toHaveAttribute('href', `/projects/${lead.id}`)

    // Opening a mention marks it read.
    await userEvent.click(within(attention).getByRole('link', { name: /^Open: Sam mentioned you/ }))
    await waitFor(async () =>
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: mention.id } })).readAt,
      ).not.toBeNull(),
    )
    // Other items are not notifications, so nothing is marked.
    await userEvent.click(within(attention).getByRole('link', { name: /^Add update:/ }))

    const rows = (section: HTMLElement) =>
      within(section)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    expect(rows(tasks)).toEqual([expect.stringContaining('Scout')])
    expect(within(tasks).getByText('in Westminster')).toBeInTheDocument()
    expect(rows(managed)).toEqual([expect.stringContaining('Westminster')])
    expect(rows(teams)).toEqual([expect.stringContaining('Comms team')])

    // Find is folded because there is work of my own; it opens on request.
    const toggle = within(find).getByRole('button', { name: /Find something to do/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    // It matches my skills and is in my chapter, so it is offered on both rows.
    expect(within(find).getAllByRole('link', { name: 'Skill match' })).toHaveLength(2)
    expect(within(find).getByText(/Uses your skills/)).toBeInTheDocument()
    expect(within(find).getByRole('link', { name: 'Local one' })).toBeInTheDocument()
  })

  it('moves finished projects into a folded Finished section after Find', async () => {
    const me = await createVolunteer()
    await createProject({ title: 'Wrapped up', assigneeId: me.id, status: 'completed' })
    await createProject({ title: 'Shelved', assigneeId: me.id, status: 'archived' })
    await renderApp(<HomePage />, { as: me, url: '/dashboard' })
    expect(await screen.findByText(/Nothing on the go right now/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Projects you manage/ })).toBeNull()
    // With nothing current, Find opens as it would for someone new.
    expect(screen.getByRole('button', { name: /Find something to do/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    const finished = screen.getByRole('region', { name: 'Finished (2)' })
    expect(before(screen.getByRole('region', { name: 'Find something to do' }), finished)).toBe(
      true,
    )
    const toggle = within(finished).getByRole('button', { name: 'Finished (2)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(finished).queryByRole('link', { name: 'Wrapped up' })).toBeNull()
    await userEvent.click(toggle)
    expect(within(finished).getByRole('link', { name: 'Wrapped up' })).toBeInTheDocument()
    expect(within(finished).getByRole('link', { name: 'Shelved' })).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(within(finished).queryByRole('link', { name: 'Shelved' })).toBeNull()
  })

  it('flags a project whose plan runs past its deadline', async () => {
    const me = await createVolunteer()
    const project = await createProject({
      title: 'Behind',
      assigneeId: me.id,
      status: 'in_progress',
      startDate: new Date('2026-09-20T00:00:00Z'),
      deadline: new Date('2026-09-28T00:00:00Z'),
    })
    await createTask(project.id, { durationDays: 12 })
    await renderApp(<HomePage />, { as: me, url: '/dashboard' })
    const managed = await screen.findByRole('region', { name: /Projects you manage/ })
    const row = within(managed).getByRole('link', { name: 'Behind' }).closest('li')!
    // The deadline has passed, so the row counts from it rather than from the plan's forecast.
    expect(within(row).getByText(/^\d+ days late$/)).toHaveAttribute('data-emphasis', 'filled')
  })

  it('words a request as what it asks, with the project status as the badge', async () => {
    const me = await createVolunteer()
    const project = await createProject({ title: 'Unowned', status: 'ready' })
    await prisma.workItemInterest.create({
      data: { workItemId: project.id, volunteerId: me.id, interestType: 'want_to_own' },
    })
    const team = await createTeam({ name: 'Crew' })
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    await renderApp(<HomePage />, { as: me, url: '/dashboard' })
    const others = await screen.findByRole('region', { name: /Other projects you're part of/ })
    const teams = screen.getByRole('region', { name: /Your teams/ })
    const row = (name: string) => screen.getByRole('link', { name }).closest('li')!
    expect(others).toContainElement(row('Unowned'))
    expect(teams).toContainElement(row('Crew'))
    expect(within(row('Unowned')).getByText('Asked to lead')).not.toHaveClass('status-badge')
    expect(within(row('Unowned')).getByText('To do')).toHaveClass('status-badge')
    expect(within(row('Unowned')).getByLabelText('No owner yet')).toBeInTheDocument()
    // A team has neither a status nor one person holding it.
    expect(within(row('Crew')).getByText('Member')).toBeInTheDocument()
    expect(row('Crew').querySelector('.status-badge')).toBeNull()
    expect(within(row('Crew')).queryByLabelText(/^Owner|No owner yet/)).toBeNull()
  })

  it('lists work that needs attention now with what is waiting, saying why', async () => {
    const me = await createVolunteer()
    const project = await createProject({
      title: 'Leafleting',
      assigneeId: me.id,
      status: 'in_progress',
      deadline: new Date('2099-03-04T00:00:00Z'),
    })
    const mine = { assigneeId: me.id, status: 'in_progress' as const }
    const due = (days: number) => new Date(Date.now() + days * DAY)
    await createTask(project.id, { ...mine, title: 'Undated' })
    await createTask(project.id, {
      ...mine,
      title: 'Far off',
      deadline: due(20),
      estimatedHours: 2,
    })
    await createTask(project.id, {
      ...mine,
      title: 'Big job',
      deadline: due(6),
      estimatedHours: 12,
    })
    await createTask(project.id, { ...mine, title: 'Soon', deadline: due(2) })
    await createQuickTask({
      ...mine,
      title: 'Late quick',
      deadline: new Date('2020-01-02T00:00:00Z'),
    })
    await renderApp(<HomePage />, { as: me, url: '/dashboard' })
    const attention = await screen.findByRole('region', { name: /Needs your attention/ })
    const tasks = screen.getByRole('region', { name: /Your tasks/ })
    const managed = screen.getByRole('region', { name: /Projects you manage/ })
    const titles = (section: HTMLElement) =>
      within(section)
        .getAllByRole('listitem')
        .map((li) => within(li).getAllByRole('link')[0].textContent)
    expect(titles(attention)).toEqual(['Late quick', 'Soon', 'Big job'])
    expect(titles(tasks)).toEqual(['Far off', 'Undated'])
    expect(titles(managed)).toEqual(['Leafleting'])

    const row = (name: string) => screen.getByRole('link', { name }).closest('li')!
    expect(within(row('Late quick')).getByText(/^\d+ days late$/)).toHaveClass('status-badge')
    // Already late or merely due soon reads as a badge, and no plain date repeats it.
    expect(row('Late quick')).not.toHaveTextContent('Due 2 Jan 2020')
    expect(within(row('Soon')).getByText('Due in 2 days')).toBeInTheDocument()
    expect(row('Soon')).not.toHaveTextContent(/Due \d/)
    expect(within(row('Far off')).getByText(/^Due \d+ \w+/)).toBeInTheDocument()
    expect(
      within(row('Big job')).getByText('About 12 hours of work, due in 6 days: start now'),
    ).toBeInTheDocument()
    expect(within(row('Big job')).getByText('In progress')).toBeInTheDocument()
    expect(within(row('Undated')).getByText('No deadline')).toBeInTheDocument()
    expect(within(row('Leafleting')).getByText('Due 4 Mar 2099')).toBeInTheDocument()
    // A project row: its status is the badge, the viewer's role plain text, its owner on the right.
    expect(within(row('Leafleting')).getByText('In progress')).toHaveClass('status-badge')
    expect(within(row('Leafleting')).getByText('Lead')).not.toHaveClass('status-badge')
    expect(within(row('Leafleting')).getByLabelText(`Owner ${me.name}`)).toBeInTheDocument()
    expect(within(row('Undated')).getByLabelText(`Assigned to ${me.name}`)).toBeInTheDocument()
    // Each row is one link, stretched over the whole row.
    for (const li of [attention, tasks, managed].flatMap((s) =>
      within(s).getAllByRole('listitem'),
    )) {
      expect(li).toHaveClass('relative')
      expect(within(li).getAllByRole('link')).toHaveLength(1)
      expect(within(li).getByRole('link')).toHaveClass('after:inset-0')
    }
  })

  it('puts a task past its plan at the top for its owner, and flags it for the assignee', async () => {
    const owner = await createVolunteer()
    const sam = await createVolunteer({ name: 'Sam Late' })
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    // Listed first in the database, but less overdue, so it comes second on Home.
    await createTask(project.id, {
      title: 'Slipped a little',
      status: 'in_progress',
      assigneeId: sam.id,
      startDate: new Date(Date.now() - 5 * DAY),
      durationDays: 3,
    })
    await createTask(project.id, {
      title: 'Slipped',
      status: 'in_progress',
      assigneeId: sam.id,
      startDate: new Date(Date.now() - 10 * DAY),
      durationDays: 3,
    })
    await renderApp(<HomePage />, { as: owner, url: '/dashboard' })
    const attention = await screen.findByRole('region', { name: /Needs your attention/ })
    const [first, second] = within(attention).getAllByRole('listitem')
    expect(first).toHaveTextContent(/"Slipped" in .* is \d+ days past plan/)
    expect(second).toHaveTextContent(/"Slipped a little" in .* is \d+ days past plan/)
    expect(first).toHaveTextContent('Assignee: Sam Late, no update yet.')
    expect(within(first).getByRole('link', { name: /^Decide/ })).toBeInTheDocument()
    cleanup()

    await renderApp(<HomePage />, { as: sam, url: '/dashboard' })
    const row = (await screen.findByRole('link', { name: 'Slipped' })).closest('li')!
    expect(within(row).getByText(/^\d+ days late$/)).toHaveAttribute('data-emphasis', 'filled')
  })

  it('says so when nothing matches', async () => {
    const skill = await createSkill()
    const me = await createVolunteer({
      country: 'ZZ',
      skills: { create: [{ skillId: skill.id }] },
    })
    const team = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    await renderApp(<HomePage />, { as: me, url: '/dashboard#tab-suggested' })
    await screen.findByRole('region', { name: /Your teams/ })
    // #tab-suggested opens Find even though there is work.
    expect(screen.getByRole('button', { name: /Find something to do/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByText('No projects match your skills right now.')).toBeInTheDocument()
    expect(screen.getByText('No projects in your country right now.')).toBeInTheDocument()
  })

  it('keeps old #tab- links working', async () => {
    const me = await createVolunteer()
    await createProject({ title: 'Mine', assigneeId: me.id })
    const team = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    // Applications would be among other projects; with none, it lands on the ones they manage.
    await renderApp(<HomePage />, { as: me, url: '/dashboard#tab-applications' })
    const managed = await screen.findByRole('region', { name: /Projects you manage/ })
    await waitFor(() => expect(scrollIntoView.mock.contexts[0]).toBe(managed))

    // The hash can also change while the page is open; an unknown one does nothing.
    act(() => {
      window.location.hash = '#tab-junk'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    act(() => {
      window.location.hash = '#tab-suggested'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /Find something to do/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('gives chapter staff an Admin section of what waits on them in that role', async () => {
    const [home, away] = [await createChapter(), await createChapter()]
    const deputy = await createChapterDeputy(home)
    await createVolunteer({ approvalStatus: 'pending', nationalChapterId: home.id })
    await createVolunteer({ approvalStatus: 'pending', nationalChapterId: away.id })
    await createProject({ status: 'pending_review', nationalChapterId: home.id })
    const unset = await createQuickTask({
      title: 'Nobody set this',
      status: 'under_review',
      assigneeId: (await createMember(home)).id,
      creatorId: null,
      nationalChapterId: home.id,
    })

    await renderApp(<HomePage />, { as: deputy, url: '/dashboard' })
    const admin = await screen.findByRole('region', { name: /^Admin/ })
    expect(within(admin).getByRole('link', { name: /^Review: "Nobody set this"/ })).toHaveAttribute(
      'href',
      `/quick-tasks/${unset.id}`,
    )
    // Their chapter's applications and proposals only, counted as on the admin page.
    const applications = await within(admin).findByRole('link', { name: 'Applications to review' })
    expect(applications).toHaveAttribute('href', '/admin/applications')
    expect(applications.closest('li')).toHaveTextContent(/1$/)
    expect(within(admin).getByRole('link', { name: 'Proposals to triage' })).toHaveAttribute(
      'href',
      '/admin/triage',
    )
    // Bug reports and duplicates are the global admins'.
    expect(within(admin).queryByRole('link', { name: 'Open bug reports' })).toBeNull()
    expect(within(admin).getByRole('link', { name: 'Admin area →' })).toHaveAttribute(
      'href',
      '/admin',
    )
    // Their own attention list leaves out what they review as staff.
    expect(screen.queryByRole('region', { name: /Needs your attention/ })).toBeNull()
  })

  it('sends the old notifications tab to the Inbox', async () => {
    const me = await createVolunteer()
    await renderApp(<HomePage />, { as: me, url: '/dashboard#tab-notifications' })
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/inbox'))
  })

  it('welcomes an approved volunteer once, pointing at projects or email confirmation', async () => {
    const me = await createVolunteer({ emailConfirmed: false })
    const note = () =>
      prisma.notification.findFirstOrThrow({
        where: { volunteerId: me.id, type: 'application_approved' },
      })
    await prisma.notification.create({
      data: { volunteerId: me.id, type: 'application_approved', title: 'Approved' },
    })
    await renderApp(<HomePage />, { as: me, url: '/dashboard' })
    const dialog = await screen.findByRole('dialog', { name: /You're approved/ })
    expect(within(dialog).getByRole('link', { name: 'Confirm your email' })).toHaveAttribute(
      'href',
      '/verify-email',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(async () => expect((await note()).readAt).not.toBeNull())

    // Read, so a later visit does not show it again.
    cleanup()
    await renderApp(<HomePage />, { as: me, url: '/dashboard' })
    await screen.findByRole('heading', { name: 'Home' })
    expect(screen.queryByRole('dialog')).toBeNull()

    // A confirmed volunteer is sent to the projects, and following the link dismisses it.
    await prisma.volunteer.update({ where: { id: me.id }, data: { emailConfirmed: true } })
    await prisma.notification.update({ where: { id: (await note()).id }, data: { readAt: null } })
    cleanup()
    await renderApp(<HomePage />, { as: me, url: '/dashboard' })
    const confirmed = await screen.findByRole('dialog', { name: /You're approved/ })
    await userEvent.click(within(confirmed).getByRole('link', { name: 'Browse projects' }))
    await waitFor(async () => expect((await note()).readAt).not.toBeNull())

    // Closing the dialog any other way counts as dismissing it too.
    await prisma.notification.update({ where: { id: (await note()).id }, data: { readAt: null } })
    cleanup()
    await renderApp(<HomePage />, { as: me, url: '/dashboard' })
    await screen.findByRole('dialog', { name: /You're approved/ })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(async () => expect((await note()).readAt).not.toBeNull())
  })
})
