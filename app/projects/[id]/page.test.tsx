import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent, cleanup, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEndEvent } from '@dnd-kit/core'
import { prisma } from '@/lib/prisma'
import {
  connect,
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createSkill,
  createTeam,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { clientAs } from '@/test/rpc'
import { navigation } from '@/test/next-navigation'
import ProjectDetailPage from './page'
import { queryClient } from '@/lib/query-client'
import { orpc } from '@/lib/orpc'

const drags = await vi.hoisted(() => import('@/test/dnd').then((m) => m.captureDrags()))
vi.mock('@dnd-kit/core', (importOriginal) => drags.mockDndKit(importOriginal))
// The task list sets its own collision detection; the Gantt chart leaves it to dnd-kit.
const listDrag = () => drags.find((p) => p.collisionDetection !== undefined)
const ganttDrag = () => drags.find((p) => p.collisionDetection === undefined)

const row = (id: number) => prisma.workItem.findUniqueOrThrow({ where: { id } })
const openTab = (name: RegExp) => userEvent.click(screen.getByRole('tab', { name }))
const mount = (id: number, as: Awaited<ReturnType<typeof createVolunteer>>, hash = '') =>
  renderApp(<ProjectDetailPage params={Promise.resolve({ id: String(id) })} />, {
    as,
    url: `/projects/${id}${hash}`,
  })

describe('project page — visitor', () => {
  it('shows the project, lets a volunteer express then withdraw interest, and claim tasks', async () => {
    const me = await createVolunteer()
    const owner = await createVolunteer({ name: 'Olive Owner' })
    // Connected earlier, so I can message the owner whatever my place on the project.
    await connect(me, owner)
    const skill = await createSkill()
    const team = await createTeam({ name: 'Crew' })
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    const project = await createProject({
      title: 'Visible project',
      description: 'Long description',
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
      collaborationLink: 'https://doc.example',
      country: 'UK',
      localGroup: 'Leeds',
      remoteEligibility: 'GLOBAL',
      teamId: team.id,
      projectType: 'sprint',
      timeCommitmentHoursPerWeek: 3,
      estimatedDuration: '2 weeks',
      urgency: 'high',
      skills: { create: [{ skillId: skill.id, isRequired: true }] },
    })
    const open = await createTask(project.id, {
      title: 'Open task',
      estimatedHours: 2,
      deadline: new Date('2020-01-01'),
      sortOrder: 1,
    })
    await createTask(project.id, {
      title: 'Ongoing task',
      status: 'in_progress',
      assigneeId: owner.id,
      sortOrder: 2,
    })
    await createTask(project.id, {
      title: 'Done task',
      status: 'completed',
      featuredAsQuickTask: true,
      deadline: new Date('2030-01-01'),
      sortOrder: 3,
    })
    await prisma.workItemComment.create({
      data: { workItemId: open.id, authorId: owner.id, content: 'c' },
    })
    await mount(project.id, me)
    await screen.findByRole('heading', { name: 'Visible project' })
    // Overview first: the description, skills and the doc link.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: 'Open Project Doc →' })).toHaveAttribute(
      'href',
      'https://doc.example',
    )
    expect(screen.getByText('Olive Owner')).toBeInTheDocument()
    expect(screen.getByText('You match 0 of 1 skill')).toBeInTheDocument()

    await openTab(/^Tasks/)
    expect(window.location.hash).toBe('#tasks')
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByLabelText('1 comment')).toBeInTheDocument()

    // Only people on the project can post, so there is no comment box until the claim.
    await openTab(/^Discussion/)
    await screen.findByRole('heading', { name: 'Discussion' })
    expect(screen.queryByLabelText('Add a comment')).toBeNull()
    await openTab(/^Tasks/)
    // A member of the project's team is already on it, so Claim takes the task at once.
    await userEvent.click(await screen.findByRole('button', { name: 'Claim' }))
    await screen.findByText(/Task claimed\. Post an update/)
    await waitFor(async () => expect((await row(open.id)).assigneeId).toBe(me.id))
    const taskOrder = () =>
      screen
        .getAllByRole('link')
        .filter((l) => /\/tasks\/\d+$/.test(l.getAttribute('href') ?? ''))
        .map((l) => l.textContent)
        .filter((t) => t?.endsWith(' task'))
    expect(taskOrder()).toEqual(['Open task', 'Ongoing task', 'Done task'])
    await userEvent.click(await screen.findByRole('button', { name: 'Submit work' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your work' })
    expect(within(dialog).getByText(/This marks the task done/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('What did you do?'), 'Did it')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit work' }))
    await screen.findByText('Task done. What you did is saved on the task.')
    // The finished task stays where it was; the server's order applies on the next load.
    await waitFor(() => expect(screen.getAllByText('done')).toHaveLength(2))
    expect(taskOrder()).toEqual(['Open task', 'Ongoing task', 'Done task'])
    await openTab(/^Discussion/)
    expect(await screen.findByLabelText('Add a comment')).toBeInTheDocument()

    // The claim put me on the project; leaving releases that, and the comment box goes too.
    await screen.findByText("You're on this project")
    await userEvent.click(screen.getByRole('button', { name: 'Leave project' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }),
    )
    await screen.findByText(/You've left the project/)
    await waitFor(() => expect(screen.queryByLabelText('Add a comment')).toBeNull())
    await userEvent.click(await screen.findByRole('button', { name: 'Join this project' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Join this project' }))
    await userEvent.type(await screen.findByLabelText('Message (optional)'), 'Pick me')
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await screen.findByText(/You'll get a notification when they reply/)
    await screen.findByText('Request sent: waiting for the owner')

    const contact = screen.getByRole('button', { name: 'Message owner' })
    await userEvent.click(contact)
    // It says how the message is delivered, and Escape closes it with focus back on the button.
    expect(
      within(screen.getByRole('dialog', { name: 'Message owner' })).getByText(
        `${owner.name} will see this in their Inbox and get a copy by email. You can both reply on Catalyse; your email address stays private unless you share it below.`,
      ),
    ).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Message owner' })).toBeNull()
    expect(contact).toHaveFocus()
    await userEvent.click(contact)
    await userEvent.type(screen.getByLabelText('Subject'), 'Hello')
    await userEvent.type(screen.getByLabelText('Message'), 'Can I help?')
    fireEvent.submit(screen.getByLabelText('Subject').closest('form')!)
    await screen.findByText(/Message sent/)
    expect(
      await prisma.message.count({ where: { fromVolunteerId: me.id, toVolunteerId: owner.id } }),
    ).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Message owner' }))
    await userEvent.click(screen.getByLabelText('Close'))
    await userEvent.click(screen.getByRole('button', { name: 'Message owner' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Message owner' }))
    fireEvent.click(screen.getByRole('dialog', { name: 'Message owner' }).parentElement!)
    expect(screen.queryByRole('dialog', { name: 'Message owner' })).toBeNull()
  })

  it('redirects for unknown projects and drafts, and shows want-to-own interest with a response', async () => {
    const me = await createVolunteer()
    await mount(999999, me)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/projects'))
    cleanup()
    const draft = await createProject({ status: 'draft', creatorId: me.id })
    await mount(draft.id, me)
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(`/projects/${draft.id}/edit`),
    )
    cleanup()
    // A doc link that is not http(s), however it got into the row, is never rendered.
    const project = await createProject({
      title: 'Ownerless',
      status: 'ready',
      collaborationLink: 'javascript:alert(1)',
    })
    await mount(project.id, me)
    await screen.findByRole('heading', { name: 'Ownerless' })
    expect(screen.queryByRole('link', { name: 'Open Project Doc →' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Join this project' }))
    await userEvent.click(screen.getByLabelText('Lead the project'))
    await userEvent.click(screen.getByLabelText('Help out on the project'))
    await userEvent.click(screen.getByLabelText('Lead the project'))
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await screen.findByText(/You'll get a notification when they reply/)
    const interest = await prisma.workItemInterest.findFirstOrThrow({
      where: { workItemId: project.id, volunteerId: me.id },
    })
    expect(interest.interestType).toBe('want_to_own')
    await prisma.workItemInterest.update({
      where: { id: interest.id },
      data: { status: 'declined', responseMessage: 'Sorry, no' },
    })
    cleanup()
    await mount(project.id, me)
    await screen.findByText(/Sorry, no/)
    expect(screen.getByText(/The owner declined your request/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Withdraw request' })).toBeNull()
    // A failed withdrawal is reported.
    await prisma.workItemInterest.update({
      where: { id: interest.id },
      data: { status: 'pending' },
    })
    cleanup()
    await mount(project.id, me)
    const withdraw = await screen.findByRole('button', { name: 'Withdraw request' })
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(withdraw)
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw' }),
    )
    await screen.findByText('Unauthorized')
  })

  it('says a volunteer is on the project, or what to do once removed', async () => {
    const me = await createVolunteer()
    const project = await createProject({ title: 'Added to it', status: 'ready' })
    const interest = await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: me.id,
        interestType: 'want_to_own',
        origin: 'added',
        status: 'accepted',
      },
    })
    await mount(project.id, me)
    await screen.findByText("You're on this project as its lead")
    expect(screen.queryByRole('button', { name: 'Join this project' })).toBeNull()
    cleanup()
    await prisma.workItemInterest.update({
      where: { id: interest.id },
      data: { status: 'removed' },
    })
    await mount(project.id, me)
    await screen.findByText(/You were taken off this project/)
    expect(screen.queryByRole('button', { name: 'Leave project' })).toBeNull()
  })
})

describe('project page — submitted work', () => {
  it('names the owner as reviewer, and shows the owner what is waiting', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const project = await createProject({
      title: 'Reviewed project',
      assigneeId: owner.id,
      status: 'in_progress',
      autoAcceptTasks: false,
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: me.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await createTask(project.id, { title: 'Mine', status: 'in_progress', assigneeId: me.id })
    const waiting = await createTask(project.id, {
      title: 'Waiting',
      status: 'under_review',
      assigneeId: me.id,
    })
    await mount(project.id, me, '#tasks')
    await userEvent.click(await screen.findByRole('button', { name: 'Submit work' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your work' })
    expect(within(dialog).getByText(/The project owner will look at it/)).toBeInTheDocument()
    expect(screen.getByText('Submitted for review')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Review' })).toBeNull()

    cleanup()
    await mount(project.id, owner, '#tasks')
    expect(await screen.findByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/tasks/${waiting.id}`,
    )
  })
})

describe('project page — joining and held tasks', () => {
  it('holds a task for someone not yet on the project, and summarises the people', async () => {
    const owner = await createVolunteer({ name: 'Omar Owner' })
    const me = await createVolunteer({ name: 'Mo Newcomer' })
    const project = await createProject({
      title: 'Busy project',
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
    })
    for (let i = 1; i <= 6; i++) {
      const v = await createVolunteer({ name: `Helper ${i}` })
      await prisma.workItemInterest.create({
        data: {
          workItemId: project.id,
          volunteerId: v.id,
          interestType: 'want_to_contribute',
          status: 'accepted',
        },
      })
    }
    const t = await createTask(project.id, { title: 'Poster task' })

    await mount(project.id, me, '#tasks')
    await screen.findByRole('heading', { name: 'Busy project' })
    expect(screen.getByRole('tab', { name: 'People (7)' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Helpers' })).getAllByRole('listitem'),
    ).toHaveLength(5)
    expect(screen.getByText('and 1 more')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Join and claim' }))
    await screen.findByText(/^Requested\. The task is held for you/)
    await screen.findByText('Held for you: waiting for the owner')
    await screen.findByText('Request sent: waiting for the owner')
    expect(await row(t.id)).toMatchObject({ requestedById: me.id, assigneeId: null })
    await userEvent.click(screen.getByRole('button', { name: 'See everyone' }))
    expect(screen.getByRole('tab', { name: 'People (7)' })).toHaveAttribute('aria-selected', 'true')
    expect(
      within(screen.getByRole('region', { name: 'People on this project' })).getByText('Helper 6'),
    ).toBeInTheDocument()

    cleanup()
    await mount(project.id, owner, '#tasks')
    await screen.findByText('Requested by Mo Newcomer')
    await screen.findByText('1 waiting for an answer')
    await userEvent.click(screen.getByRole('button', { name: 'Manage people' }))
    expect(window.location.hash).toBe('#people')
  })
})

describe('project page — owner', () => {
  it('manages tasks: add, assign, unassign, reorder, delete; changes status; reviews interests', async () => {
    const owner = await createVolunteer({ name: 'Owen Owner' })
    const helper = await createVolunteer({ name: 'Hana Helper' })
    const other = await createVolunteer({ name: 'Otto Other' })
    const project = await createProject({
      title: 'Owned project',
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
    })
    const t1 = await createTask(project.id, { title: 'First task', sortOrder: 1 })
    const t2 = await createTask(project.id, { title: 'Second task', sortOrder: 2 })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: helper.id,
        interestType: 'want_to_contribute',
        message: 'me please',
      },
    })
    await prisma.workItemInterest.create({
      data: { workItemId: project.id, volunteerId: other.id, interestType: 'want_to_own' },
    })
    await mount(project.id, owner, '#tasks')
    await screen.findByRole('heading', { name: 'Owned project' })

    await userEvent.click(await screen.findByRole('button', { name: 'Add Task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add Task' }))
    await userEvent.type(screen.getByLabelText('Task title'), 'Third task')
    await userEvent.type(screen.getByLabelText('Description'), 'details')
    await userEvent.type(screen.getByLabelText('Effort (hours of work)'), '2')
    fireEvent.change(screen.getByLabelText('Deadline (optional)'), {
      target: { value: '2030-01-01' },
    })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2029-12-01' } })
    // The end date and the day count keep each other in step; only the days are stored.
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2029-12-03' } })
    expect(screen.getByLabelText('Days')).toHaveValue(3)
    expect(screen.getByText(/Planned to finish 3 Dec 2029, 29 days before the deadline/))
    // An owner is not told that only the owner can change the dates later.
    expect(screen.queryByText(/Only the project owner can change these dates/)).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: /quick task/i }))
    fireEvent.submit(screen.getByLabelText('Task title').closest('form')!)
    await screen.findByText('Task added!')
    const t3 = await prisma.workItem.findFirstOrThrow({ where: { title: 'Third task' } })
    expect(t3).toMatchObject({
      estimatedHours: 2,
      durationDays: 3,
      featuredAsQuickTask: true,
      timing: 'flexible',
    })

    // Accept one interest, decline the other with a message.
    await openTab(/^People/)
    const interestCard = (name: string) =>
      within(screen.getByRole('region', { name: 'People on this project' }))
        .getByText(name)
        .closest('li') as HTMLElement
    await userEvent.click(
      within(interestCard('Hana Helper')).getByRole('button', { name: 'Accept' }),
    )
    await screen.findByText(/^Accepted\. They're on the project/)
    await userEvent.click(
      await within(interestCard('Otto Other')).findByRole('button', { name: 'Decline' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(
      within(interestCard('Otto Other')).getByRole('button', { name: 'Decline' }),
    )
    await userEvent.keyboard('{Escape}')
    await userEvent.click(
      within(interestCard('Otto Other')).getByRole('button', { name: 'Decline' }),
    )
    await userEvent.type(screen.getByLabelText('Optional message for the volunteer'), 'Not now')
    fireEvent.submit(screen.getByLabelText('Optional message for the volunteer').closest('form')!)
    await screen.findByText(/^Declined\. They've been notified/)
    await waitFor(async () =>
      expect(
        (await prisma.workItemInterest.findFirstOrThrow({ where: { volunteerId: other.id } }))
          .responseMessage,
      ).toBe('Not now'),
    )

    // The drag handle and the task menu say what they are.
    await openTab(/^Tasks/)
    expect(screen.getByLabelText('Drag to reorder First task')).toBeInTheDocument()
    expect(screen.getByLabelText('Task actions for First task')).toHaveAttribute(
      'title',
      'Task actions for First task',
    )
    // Assign a task to the accepted helper via the task menu, then unassign it.
    await userEvent.click(screen.getByLabelText('Task actions for First task'))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Assign volunteer to First task' }),
    )
    await userEvent.click(screen.getByRole('option', { name: 'Hana Helper' }))
    await userEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Assign' }))
    await screen.findByText('Task assigned!')
    await waitFor(async () => expect((await row(t1.id)).assigneeId).toBe(helper.id))
    await userEvent.click(screen.getByLabelText('Task actions for First task'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Unassign' }))
    await screen.findByText('Task unassigned!')
    // The owner sees how each person came and went.
    await openTab(/^People/)
    expect(interestCard('Otto Other')).toHaveTextContent('Applied, declined')
    expect(interestCard('Otto Other')).not.toHaveTextContent('wanted to')
    // An accepted helper is removed, not declined, and the dialog and toast say so.
    await userEvent.click(
      within(interestCard('Hana Helper')).getByRole('button', { name: 'Remove' }),
    )
    const removeDialog = await screen.findByRole('dialog', {
      name: 'Remove Hana Helper from this project?',
    })
    expect(within(removeDialog).queryByRole('button', { name: 'Decline' })).toBeNull()
    fireEvent.submit(screen.getByLabelText('Optional message for the volunteer').closest('form')!)
    await screen.findByText("Removed Hana Helper. They've been notified.")
    await waitFor(() => expect(interestCard('Hana Helper')).toHaveTextContent('Applied, removed'))
    // Clicking outside closes the menu.
    await openTab(/^Tasks/)
    await userEvent.click(screen.getByLabelText('Task actions for First task'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()

    act(() => listDrag()({ active: { id: t2.id }, over: { id: t1.id } } as DragEndEvent))
    await waitFor(async () => expect((await row(t2.id)).sortOrder).toBe(1))
    act(() => listDrag()({ active: { id: t2.id }, over: null } as never))
    act(() => listDrag()({ active: { id: t2.id }, over: { id: t2.id } } as DragEndEvent))

    await userEvent.click(screen.getByLabelText('Task actions for Second task'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(await prisma.workItem.count({ where: { id: t2.id } })).toBe(1)
    await userEvent.click(screen.getByLabelText('Task actions for Second task'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete task' }),
    )
    await screen.findByText('Task deleted!')

    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'On Hold' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'On Hold' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Status updated!')
    await waitFor(async () => expect((await row(project.id)).status).toBe('on_hold'))

    // Enter submits the invite form even while its button is disabled.
    await openTab(/^People/)
    const picker = () => screen.getByRole('button', { name: 'Volunteer to invite' })
    fireEvent.submit(picker().closest('form')!)
    await userEvent.click(picker())
    await userEvent.click(await screen.findByRole('option', { name: 'Otto Other' }))
    await userEvent.type(screen.getByLabelText('Note with the invite (optional)'), 'Leaflets?')
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await screen.findByText('Invite sent')
    // The picker empties, and the person waits under Invited until they answer.
    await waitFor(() => expect(picker()).not.toHaveTextContent('Otto Other'))
    expect(
      screen.getByText('They get an invite and join once they accept.', { exact: false }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add now' })).toBeNull()
    const invited = await screen.findByRole('region', { name: 'Invited' })
    expect(within(invited).getByText('Invited by Owen Owner')).toBeInTheDocument()
    expect(within(invited).getByText('Leaflets?')).toBeInTheDocument()
    await userEvent.click(within(invited).getByRole('button', { name: 'Cancel invite' }))
    await screen.findByText('Invite cancelled.')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Invited' })).toBeNull())
    // Everyone who has left sits folded away under Past.
    expect(screen.getByText(/^Past \(/)).toBeInTheDocument()
    expect(interestCard('Otto Other')).toHaveTextContent('Invited, cancelled')

    // Owner tools sit in the folded Manage panel, with the rarer ones under More.
    await userEvent.click(screen.getByText('Manage'))
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute(
      'href',
      `/projects/${project.id}/edit`,
    )
    await userEvent.click(screen.getByText('More'))
    await userEvent.click(screen.getByRole('button', { name: 'Export / Import' }))
    expect(screen.getByRole('dialog', { name: 'Export and import' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
  })

  it('reports failures for the owner actions', async () => {
    const owner = await createVolunteer()
    const helper = await createVolunteer({ name: 'Hana Helper' })
    const project = await createProject({
      title: 'Fragile',
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
    })
    const t1 = await createTask(project.id, { title: 'Doomed task' })
    await prisma.workItemInterest.create({
      data: { workItemId: project.id, volunteerId: helper.id, interestType: 'want_to_contribute' },
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: (await createVolunteer()).id,
        interestType: 'want_to_contribute',
        status: 'invited',
      },
    })
    await mount(project.id, owner, '#tasks')
    await screen.findByRole('heading', { name: 'Fragile' })
    await prisma.workItem.delete({ where: { id: t1.id } })
    await userEvent.click(await screen.findByLabelText('Task actions for Doomed task'))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Assign volunteer to Doomed task' }),
    )
    await userEvent.click(screen.getAllByRole('option', { name: 'Hana Helper' })[0])
    await userEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Assign' }))
    await screen.findByText('Project or task not found')
    await userEvent.click(screen.getByLabelText('Task actions for Doomed task'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete task' }),
    )
    await screen.findByText('Task not found')
    await userEvent.click(screen.getByRole('button', { name: 'Add Task' }))
    await userEvent.type(screen.getByLabelText('Task title'), 'x')
    await prisma.workItemInterest.deleteMany({ where: { workItemId: project.id } })
    await prisma.workItem.delete({ where: { id: project.id } })
    fireEvent.submit(screen.getByLabelText('Task title').closest('form')!)
    await screen.findByText('Project not found')
    await openTab(/^People/)
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await screen.findByText('Not authorized')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel invite' }))
    await waitFor(() => expect(screen.getAllByText('Not authorized')).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: 'Volunteer to invite' }))
    await userEvent.click((await screen.findAllByRole('option', { name: 'Hana Helper' }))[0])
    fireEvent.submit(screen.getByRole('button', { name: 'Volunteer to invite' }).closest('form')!)
    await waitFor(() => expect(screen.getAllByText('Project not found').length).toBeGreaterThan(1))
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Completed' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.getAllByText('Project not found').length).toBeGreaterThan(2))
    await openTab(/^Tasks/)
    act(() => listDrag()({ active: { id: t1.id }, over: { id: t1.id + 1 } } as DragEndEvent))
  })
})

describe('project page — key date', () => {
  it('labels tasks by their side of the key date and orders the timeline the same way', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    const start = new Date('2030-03-01T00:00:00Z')
    // Created after-first, so the timeline has to reorder them.
    const press = await createTask(project.id, { title: 'Press', durationDays: 1 })
    const event = await createTask(project.id, { title: 'Event', isAnchor: true, durationDays: 0 })
    const prep = await createTask(project.id, { title: 'Prep', startDate: start, durationDays: 2 })
    await prisma.workItemDependency.createMany({
      data: [
        { predecessorId: prep.id, successorId: event.id },
        { predecessorId: event.id, successorId: press.id },
      ],
    })
    await mount(project.id, owner, '#tasks')
    await screen.findByText('Before the key date')
    expect(screen.getByText('After the key date')).toBeInTheDocument()
    expect(screen.getByText('★ Key date')).toBeInTheDocument()
    // The list says which task the labels are about.
    expect(screen.getByText(/The work it waits for is marked Before/)).toHaveTextContent('Event')

    await openTab(/^Timeline/)
    const bars = await screen.findAllByRole('button', { name: /^(Prep|Event|Press):/ })
    expect(bars.map((b) => b.getAttribute('aria-label')!.split(':')[0])).toEqual([
      'Prep',
      'Event',
      'Press',
    ])
  })
})

describe('project page — past plan', () => {
  it('flags a task past its plan in the list and in the timeline panel', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    const start = new Date(Date.now() - 9 * 86_400_000)
    await createTask(project.id, {
      title: 'Behind',
      status: 'in_progress',
      assigneeId: owner.id,
      startDate: new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
      ),
      durationDays: 2,
    })
    await mount(project.id, owner, '#tasks')
    await screen.findByText('8 days past plan')
    await openTab(/^Timeline/)
    await userEvent.click(await screen.findByRole('button', { name: /^Behind:/ }))
    const panel = screen.getByRole('complementary')
    expect(within(panel).getByText('8 days past plan')).toBeInTheDocument()
    // The owner can replan from the panel without leaving the chart.
    await userEvent.click(within(panel).getByRole('button', { name: 'Replan' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent("Replan 'Behind'")
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('points a manager at the timeline when many tasks are past plan at once', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    for (let i = 0; i < 5; i++) {
      await createTask(project.id, {
        title: `Stale ${i}`,
        status: 'in_progress',
        assigneeId: owner.id,
        startDate: new Date(Date.now() - 9 * 86_400_000),
        durationDays: 1,
      })
    }
    await mount(project.id, owner, '#tasks')
    await screen.findByText(/5 tasks are past plan/)
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(await screen.findByRole('heading', { name: 'Timeline' })).toBeInTheDocument()
  })

  it('does not call an unclaimed task past its plan', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    await createTask(project.id, {
      title: 'Waiting',
      startDate: new Date(Date.now() - 9 * 86_400_000),
      durationDays: 2,
    })
    await mount(project.id, owner, '#tasks')
    await screen.findByText('Waiting')
    expect(screen.queryByText(/past plan/)).toBeNull()
  })
})

describe('project page — deputies', () => {
  async function deputyProject() {
    const owner = await createVolunteer({ name: 'Owen Owner' })
    const helper = await createVolunteer({ name: 'Hana Helper' })
    const project = await createProject({
      title: 'Shared project',
      assigneeId: owner.id,
      status: 'in_progress',
      autoAcceptTasks: false,
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: helper.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    return { owner, helper, project }
  }
  const personCard = (name: string) =>
    within(screen.getByRole('region', { name: 'People on this project' }))
      .getByText(name)
      .closest('li') as HTMLElement

  it('lets the owner make a helper a deputy and take it back', async () => {
    const { owner, helper, project } = await deputyProject()
    await mount(project.id, owner, '#people')
    await userEvent.click(
      await within(
        await screen.findByRole('region', { name: 'People on this project' }),
      ).findByRole('button', { name: 'Make deputy' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Make Hana Helper a deputy?' })
    expect(within(dialog).getByText(/cannot edit the project/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make deputy' }))
    await screen.findByText('Deputy appointed')
    await waitFor(() => expect(personCard('Hana Helper')).toHaveTextContent('Deputy'))
    expect(await prisma.projectDeputy.count({ where: { volunteerId: helper.id } })).toBe(1)

    await userEvent.click(
      within(personCard('Hana Helper')).getByRole('button', { name: 'Remove deputy' }),
    )
    const removeDialog = await screen.findByRole('dialog', {
      name: 'Remove Hana Helper as a deputy?',
    })
    await userEvent.click(within(removeDialog).getByRole('button', { name: 'Remove deputy' }))
    await screen.findByText('Deputy removed')
    await waitFor(() => expect(personCard('Hana Helper')).toHaveTextContent('Helper'))
  })

  it('shows why a deputy change failed, and lets the owner back out of the dialog', async () => {
    const { owner, helper, project } = await deputyProject()
    await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: helper.id } })
    await mount(project.id, owner, '#people')
    const remove = await within(
      await screen.findByRole('region', { name: 'People on this project' }),
    ).findByRole('button', { name: 'Remove deputy' })
    await userEvent.click(remove)
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    await prisma.projectDeputy.deleteMany({ where: { projectId: project.id } })
    await userEvent.click(remove)
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove deputy' }),
    )
    await screen.findByText('Deputy not found')
  })

  it('gives a deputy the task controls but not the people ones, and lets them step down', async () => {
    const { owner, helper, project } = await deputyProject()
    await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: helper.id } })
    const worker = await createVolunteer()
    await createTask(project.id, { title: 'Open one', sortOrder: 1 })
    const waiting = await createTask(project.id, {
      title: 'Waiting one',
      sortOrder: 2,
      status: 'under_review',
      assigneeId: worker.id,
    })
    await mount(project.id, helper, '#tasks')
    expect(await screen.findByLabelText('Drag to reorder Open one')).toBeInTheDocument()
    expect(screen.getByLabelText('Task actions for Open one')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/tasks/${waiting.id}`,
    )
    expect(screen.getByText('Deputy')).toBeInTheDocument()
    // The Manage panel is the owner's: a deputy has no project-level controls.
    expect(screen.queryByText('Manage')).toBeNull()

    await openTab(/^People/)
    expect(screen.queryByRole('button', { name: 'Make deputy' })).toBeNull()
    expect(screen.queryByText('+ Invite')).toBeNull()
    expect(within(personCard('Hana Helper')).getByText('Deputy')).toBeInTheDocument()
    await userEvent.click(
      within(personCard('Hana Helper')).getByRole('button', { name: 'Step down' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Step down as a deputy?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Step down' }))
    await screen.findByText('You are no longer a deputy')
    expect(await prisma.projectDeputy.count({ where: { projectId: project.id } })).toBe(0)
    expect((await prisma.notification.findMany({ where: { volunteerId: owner.id } })).length).toBe(
      1,
    )
  })
})

describe('project page — invites', () => {
  it('lets an admin add someone straight away, and reports a failed add', async () => {
    const admin = await createAdmin()
    const owner = await createVolunteer()
    const vol = await createVolunteer({ name: 'Addie Added' })
    const gone = await createVolunteer({ name: 'Gina Gone' })
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await mount(project.id, admin, '#people')
    const picker = () => screen.getByRole('button', { name: 'Volunteer to invite' })
    await userEvent.click(await screen.findByRole('button', { name: 'Volunteer to invite' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Addie Added' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add now' }))
    await screen.findByText(/^Added to the project\./)
    await waitFor(async () =>
      expect(
        (await prisma.workItemInterest.findFirstOrThrow({ where: { volunteerId: vol.id } })).status,
      ).toBe('accepted'),
    )
    await userEvent.click(picker())
    await userEvent.click(await screen.findByRole('option', { name: 'Gina Gone' }))
    await prisma.volunteer.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
    await userEvent.click(screen.getByRole('button', { name: 'Add now' }))
    await screen.findByText('Volunteer not found')
  })

  it('shows an invite to the person invited, who accepts or declines it there', async () => {
    const owner = await createVolunteer({ name: 'Ola Owner' })
    const me = await createVolunteer()
    const project = await createProject({
      title: 'Invite project',
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
    })
    await clientAs(owner).projects.invite({
      projectId: project.id,
      volunteerId: me.id,
      message: 'See https://example.org/brief',
    })
    await mount(project.id, me)
    const banner = await screen.findByRole('region', {
      name: 'Ola Owner invited you to help on this project',
    })
    expect(within(banner).getByRole('link', { name: 'https://example.org/brief' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join this project' })).toBeNull()
    await userEvent.click(within(banner).getByRole('button', { name: 'Decline' }))
    await screen.findByText('Invite declined.')
    // Declining leaves the way open to apply.
    await screen.findByRole('button', { name: 'Join this project' })
    expect(screen.queryByRole('region', { name: /invited you/ })).toBeNull()

    await clientAs(owner).projects.invite({ projectId: project.id, volunteerId: me.id })
    cleanup()
    await mount(project.id, me)
    const again = await screen.findByRole('region', {
      name: 'Ola Owner invited you to help on this project',
    })
    await userEvent.click(within(again).getByRole('button', { name: 'Accept' }))
    await screen.findByText("You're on the project. Welcome!")
    await waitFor(async () =>
      expect(
        (await prisma.workItemInterest.findFirstOrThrow({ where: { volunteerId: me.id } })).status,
      ).toBe('accepted'),
    )
  })

  it('reports an invite that has gone, and names the owner when the inviter is unknown', async () => {
    const me = await createVolunteer()
    const project = await createProject({ assigneeId: (await createVolunteer()).id })
    const invite = await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: me.id,
        interestType: 'want_to_contribute',
        status: 'invited',
      },
    })
    await mount(project.id, me)
    const banner = await screen.findByRole('region', {
      name: 'The owner invited you to help on this project',
    })
    await prisma.workItemInterest.update({
      where: { id: invite.id },
      data: { status: 'cancelled' },
    })
    await userEvent.click(within(banner).getByRole('button', { name: 'Accept' }))
    await screen.findByText('No invite found')
  })
})

describe('project page — admin', () => {
  it('reviews a proposal, records an outcome, and manages ownership', async () => {
    const admin = await createAdmin()
    const proposer = await createVolunteer({ name: 'Pat Proposer' })
    const newOwner = await createVolunteer({ name: 'Nina New' })
    const pending = await createProject({
      title: 'Proposal',
      status: 'pending_review',
      creatorId: proposer.id,
    })
    await createTask(pending.id)
    await mount(pending.id, admin)
    await screen.findByRole('heading', { name: 'Proposal' })
    expect(screen.getByText('Pat Proposer')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Ask for changes'))
    await userEvent.type(screen.getByLabelText('Message to Proposer'), 'Tell us more')
    fireEvent.submit(screen.getByLabelText('Message to Proposer').closest('form')!)
    await screen.findByText('Changes requested.')
    await waitFor(async () => expect((await row(pending.id)).status).toBe('needs_discussion'))
    cleanup()
    await mount(pending.id, admin)
    await screen.findByRole('heading', { name: 'Proposal' })
    fireEvent.submit(screen.getByLabelText(/approve/i).closest('form')!)
    await screen.findByText('Project approved!')

    await userEvent.click(await screen.findByLabelText('Ownership actions'))
    await userEvent.click(screen.getByRole('button', { name: 'Transfer to' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Nina New' }))
    await userEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    await userEvent.click(screen.getByLabelText('Ownership actions'))
    await userEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Transfer' }),
    )
    await screen.findByText('Ownership transferred!')
    await waitFor(async () => expect((await row(pending.id)).assigneeId).toBe(newOwner.id))
    await userEvent.click(screen.getByLabelText('Ownership actions'))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove ownership' }),
    )
    await waitFor(async () => expect((await row(pending.id)).assigneeId).toBeNull())

    // Outcome on a completed project (admin-only status pick first).
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Completed' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    await screen.findByText('Status updated!')
    await userEvent.click(await screen.findByRole('button', { name: 'Outcome' }))
    fireEvent.submit(screen.getByLabelText('Outcome Notes').closest('form')!)
    await userEvent.click(screen.getByRole('option', { name: 'Successful' }))
    await userEvent.type(screen.getByLabelText('Outcome Notes'), 'Went well')
    await userEvent.click(screen.getByRole('button', { name: 'Record Outcome' }))
    await screen.findByText('Outcome recorded!')
    await waitFor(() =>
      expect(screen.getByText(/Outcome:/).parentElement).toHaveTextContent('Successful'),
    )
  })

  it('shows org-proposed projects, the other outcome labels, and admin-only status values', async () => {
    const admin = await createAdmin()
    for (const [outcome, label] of [
      ['partial', 'Partial'],
      ['not_completed', 'Not Completed'],
      ['ongoing', 'Ongoing'],
      ['weird', 'weird'],
    ] as const) {
      cleanup()
      const p = await createProject({
        title: `Outcome ${outcome}`,
        status: 'completed',
        outcome,
        isOrgProposed: true,
        creatorId: admin.id,
      })
      await mount(p.id, admin)
      await screen.findByRole('heading', { name: `Outcome ${outcome}` })
      expect(screen.getByText(/Outcome:/).parentElement).toHaveTextContent(label)
      expect(screen.getByText(/Proposer:/)).toHaveTextContent('PauseAI')
    }
    cleanup()
    const archived = await createProject({ title: 'Archived one', status: 'archived' })
    await mount(archived.id, admin)
    await screen.findByRole('heading', { name: 'Archived one' })
    expect(screen.getByRole('button', { name: 'project status' })).toHaveTextContent('Archived')
  })
})

describe('project page — timeline tab', () => {
  async function setupTimeline() {
    const owner = await createVolunteer({ name: 'Tina Timeline' })
    const helper = await createVolunteer({ name: 'Hal Helper' })
    const project = await createProject({
      title: 'Timed project',
      assigneeId: owner.id,
      status: 'in_progress',
      startDate: new Date('2026-06-01T00:00:00Z'),
    })
    const a = await createTask(project.id, {
      title: 'Alpha',
      durationDays: 2,
      startDate: new Date('2026-06-01T00:00:00Z'),
      baselineStartDate: new Date('2026-06-01T00:00:00Z'),
      baselineDurationDays: 2,
      baselineSetAt: new Date('2026-05-01T00:00:00Z'),
    })
    const b = await createTask(project.id, { title: 'Beta', durationDays: 1 })
    const c = await createTask(project.id, { title: 'Gamma' })
    await prisma.workItemDependency.create({ data: { predecessorId: a.id, successorId: b.id } })
    return { owner, helper, project, a, b, c }
  }

  it('opens from the URL hash, switches tabs, and drives the chart and panel', async () => {
    const { owner, helper, project, a, b, c } = await setupTimeline()
    await mount(project.id, owner, '#timeline')
    await screen.findByRole('heading', { name: 'Timed project' })
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByRole('button', { name: /^Alpha:/ })
    expect(screen.getByText('Unscheduled (1)')).toBeInTheDocument()
    expect(screen.getByText(/Original plan set/)).toBeInTheDocument()

    // Tab switching pushes history; the popstate/hashchange listeners read it back.
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(window.location.hash).toBe('')
    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(window.location.hash).toBe('#timeline')
    act(() => {
      window.history.pushState(null, '', `/projects/${project.id}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    // An unknown hash opens the Overview.
    act(() => {
      window.location.hash = '#nonsense'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    act(() => {
      window.location.hash = '#timeline'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await screen.findByRole('button', { name: /^Alpha:/ })

    await userEvent.click(screen.getByLabelText('Add Gamma to the timeline'))
    await waitFor(async () => expect((await row(c.id)).durationDays).toBe(1))
    await waitFor(() => expect(screen.queryByText(/Unscheduled/)).toBeNull())

    // Drag a bar (via the captured DndContext), then link two bars.
    act(() =>
      ganttDrag()({
        active: { data: { current: { kind: 'move', rowId: b.id } } },
        delta: { x: 800, y: 0 },
      } as never),
    )
    await waitFor(async () => expect((await row(b.id)).startDate).not.toBeNull())
    act(() =>
      ganttDrag()({
        active: { data: { current: { kind: 'link', rowId: b.id } } },
        over: { data: { current: { rowId: c.id } } },
        delta: { x: 0, y: 0 },
      } as never),
    )
    await screen.findByText('Dependency added')

    // Select a bar to open the panel; edit dates, anchor, lag, dependencies, assignment.
    await userEvent.click(screen.getByRole('button', { name: /^Beta:/ }))
    const panel = () => screen.getByRole('complementary')
    await within(panel()).findByText('Beta')
    fireEvent.change(within(panel()).getByLabelText('Days'), { target: { value: '4' } })
    fireEvent.submit(within(panel()).getByLabelText('Days').closest('form')!)
    await waitFor(async () => expect((await row(b.id)).durationDays).toBe(4))
    // Timing and effort are not schedule, so they go by the task update rather than the drag path.
    await userEvent.click(within(panel()).getByRole('radio', { name: /On set dates/ }))
    await userEvent.type(within(panel()).getByLabelText('Effort (hours of work)'), '3')
    fireEvent.submit(within(panel()).getByLabelText('Days').closest('form')!)
    await waitFor(async () =>
      expect(await row(b.id)).toMatchObject({ timing: 'fixed', estimatedHours: 3 }),
    )
    await userEvent.click(within(panel()).getByRole('checkbox', { name: /Key date/ }))
    await waitFor(async () => expect((await row(b.id)).isAnchor).toBe(true))
    await screen.findByText('This is now the key date.')
    const lag = within(panel()).getByLabelText(/Lag/, { selector: 'input[id^="panel-lag-"]' })
    fireEvent.change(lag, { target: { value: '2' } })
    fireEvent.blur(lag)
    await waitFor(async () =>
      expect(
        (await prisma.workItemDependency.findFirstOrThrow({ where: { successorId: b.id } }))
          .lagDays,
      ).toBe(2),
    )
    await userEvent.click(within(panel()).getByRole('button', { name: /Remove dependency on/ }))
    await waitFor(async () =>
      expect(await prisma.workItemDependency.count({ where: { successorId: b.id } })).toBe(0),
    )
    await waitFor(() =>
      expect(
        within(within(panel()).getByLabelText('Add a dependency')).getByRole('option', {
          name: 'Alpha',
        }),
      ).toBeInTheDocument(),
    )
    await userEvent.selectOptions(within(panel()).getByLabelText('Add a dependency'), String(a.id))
    await userEvent.click(within(panel()).getByRole('button', { name: 'Add' }))
    await waitFor(async () =>
      expect(await prisma.workItemDependency.count({ where: { successorId: b.id } })).toBe(1),
    )
    await userEvent.click(within(panel()).getByRole('button', { name: 'Assign to me' }))
    await screen.findByText(/Task claimed\. Post an update/)
    await waitFor(async () => expect((await row(b.id)).assigneeId).toBe(owner.id))
    await userEvent.click(await within(panel()).findByRole('button', { name: 'Unassign' }))
    await screen.findByText('Task unassigned!')
    await userEvent.selectOptions(
      await within(panel()).findByLabelText('Assign to a volunteer'),
      String(helper.id),
    )
    await userEvent.click(within(panel()).getByRole('button', { name: 'Assign' }))
    await screen.findByText('Task assigned!')
    await userEvent.click(within(panel()).getByLabelText('Close panel'))
    expect(screen.queryByRole('complementary')).toBeNull()
    // Selecting the same bar twice toggles the panel off.
    await userEvent.click(screen.getByRole('button', { name: /^Beta:/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Beta:/ }))
    expect(screen.queryByRole('complementary')).toBeNull()

    // Remove an arrow from the chart itself (selected row's edges show a ×).
    await userEvent.click(screen.getByRole('button', { name: /^Beta:/ }))
    await userEvent.click(
      await screen.findByRole('button', { name: /Remove dependency Alpha → Beta/ }),
    )
    await waitFor(async () =>
      expect(await prisma.workItemDependency.count({ where: { successorId: b.id } })).toBe(0),
    )

    // The critical path is a planning aid, ringed only when asked for.
    expect(screen.queryByRole('button', { name: /on the critical path/ })).toBeNull()
    await userEvent.click(screen.getByLabelText('Highlight the critical path'))
    expect(screen.getAllByRole('button', { name: /on the critical path/ }).length).toBeGreaterThan(
      0,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Replace original plan' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Replace original plan' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Replace original plan' })[1])
    await screen.findByText('Original plan updated')
    await waitFor(async () => expect((await row(b.id)).baselineDurationDays).toBe(4))
    const startBefore = (await row(b.id)).startDate

    // A drag whose cache entry has been evicted still lands; there is just nothing to patch
    // optimistically. Last, because removing a live query detaches the chart from its refetches.
    queryClient.removeQueries({ queryKey: orpc.projects.listTasks.key() })
    act(() =>
      ganttDrag()({
        active: { data: { current: { kind: 'move', rowId: b.id } } },
        delta: { x: 800, y: 0 },
      } as never),
    )
    await waitFor(async () => expect((await row(b.id)).startDate).not.toEqual(startBefore))
  })

  it('handles the empty timeline, "add all", and failures', async () => {
    const owner = await createVolunteer()
    const project = await createProject({
      title: 'Empty timeline',
      assigneeId: owner.id,
      status: 'in_progress',
    })
    await mount(project.id, owner, '#timeline')
    await screen.findByRole('heading', { name: 'Empty timeline' })
    await screen.findByText(/No tasks/i)
    cleanup()
    const t1 = await createTask(project.id, { title: 'Loose one' })
    const t2 = await createTask(project.id, { title: 'Loose two' })
    await mount(project.id, owner, '#timeline')
    await screen.findByText('Unscheduled (2)')
    expect(screen.getByText(/No tasks have dates yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add all to timeline' }))
    await waitFor(async () => expect((await row(t2.id)).durationDays).toBe(1))
    await screen.findByRole('button', { name: /^Loose one:/ })
    await userEvent.click(screen.getByRole('button', { name: 'Set original plan' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Set original plan' })[1])
    await screen.findByText('Original plan updated')

    // Failures: an anchor change and a reschedule on a task that vanished.
    await userEvent.click(screen.getByRole('button', { name: /^Loose one:/ }))
    await prisma.workItem.delete({ where: { id: t1.id } })
    const panel = screen.getByRole('complementary')
    await userEvent.click(within(panel).getByRole('checkbox'))
    await screen.findByText('Project or task not found')
    await userEvent.selectOptions(within(panel).getByLabelText('Add a dependency'), String(t2.id))
    await userEvent.click(within(panel).getByRole('button', { name: 'Add' }))
    await screen.findByText('One or both items were not found')
    // A failed reschedule is rolled back and the timeline refetched (which drops the panel).
    fireEvent.submit(within(panel).getByLabelText('Days').closest('form')!)
    await screen.findByText('One or more items were not found')
    await userEvent.click(await screen.findByRole('button', { name: 'Replace original plan' }))
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(screen.getAllByRole('button', { name: 'Replace original plan' })[1])
    await screen.findByText('Unauthorized')
  })

  it('shows a read-only timeline to a visitor', async () => {
    const { project } = await setupTimeline()
    const visitor = await createVolunteer()
    await mount(project.id, visitor, '#timeline')
    await screen.findByRole('button', { name: /^Alpha:/ })
    expect(screen.queryByRole('button', { name: 'Add all to timeline' })).toBeNull()
    expect(screen.getByText(/These tasks have no dates yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /baseline/i })).toBeNull()
  })
})

describe('project page — remaining edges', () => {
  it('ignores an empty task title, a same-status pick, declined confirms, and lets an admin approve the contribute radio', async () => {
    const admin = await createAdmin()
    const owner = await createVolunteer({ name: 'Rita Owner' })
    const project = await createProject({
      title: 'Edge project',
      assigneeId: owner.id,
      status: 'in_progress',
      creatorId: owner.id,
    })
    await mount(project.id, admin, '#tasks')
    await screen.findByRole('heading', { name: 'Edge project' })
    await userEvent.click(await screen.findByRole('button', { name: 'Add Task' }))
    fireEvent.submit(screen.getByLabelText('Task title').closest('form')!)
    expect(await prisma.workItem.count({ where: { parentId: project.id } })).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'In Progress' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Archived' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await screen.findByLabelText('Ownership actions'))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect((await row(project.id)).assigneeId).toBe(owner.id)

    cleanup()
    const pending = await createProject({
      title: 'Approve me',
      status: 'pending_review',
      creatorId: owner.id,
    })
    await mount(pending.id, admin)
    await screen.findByRole('heading', { name: 'Approve me' })
    await userEvent.click(screen.getByLabelText('Ask for changes'))
    await userEvent.click(screen.getByLabelText(/approve/i))
    await prisma.workItem.delete({ where: { id: pending.id } })
    fireEvent.submit(screen.getByLabelText(/approve/i).closest('form')!)
    await screen.findByText('Project not found')
  })

  it('shows the owner of a proposal its status without a control until an admin approves it', async () => {
    const owner = await createVolunteer()
    const project = await createProject({
      title: 'Under review',
      status: 'needs_discussion',
      assigneeId: owner.id,
      creatorId: owner.id,
    })
    await mount(project.id, owner)
    await screen.findByRole('heading', { name: 'Under review' })
    expect(screen.getByLabelText('project status')).toHaveTextContent('Needs Changes')
    expect(screen.queryByRole('button', { name: 'project status' })).toBeNull()
  })

  it('a visitor can only ask to help on an owned project, and sees errors for interest, contact and outcome', async () => {
    const me = await createVolunteer()
    const owner = await createVolunteer()
    await connect(me, owner)
    const project = await createProject({
      title: 'Interest edges',
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
    })
    await mount(project.id, me)
    await screen.findByRole('heading', { name: 'Interest edges' })
    await userEvent.click(screen.getByRole('button', { name: 'Join this project' }))
    // It has an owner, so there is no lead to ask to be.
    expect(screen.getByLabelText('Help out on the project')).toBeChecked()
    expect(screen.queryByLabelText('Lead the project')).toBeNull()
    await userEvent.keyboard('{Escape}')
    // Claiming a task that no longer exists, then declining the withdraw confirmation.
    const gone = await createTask(project.id, { title: 'Gone task' })
    cleanup()
    await mount(project.id, me, '#tasks')
    await screen.findByRole('button', { name: 'Join and claim' })
    await prisma.workItem.delete({ where: { id: gone.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Join and claim' }))
    await screen.findByText('Project or task not found')
    await prisma.workItemInterest.create({
      data: { workItemId: project.id, volunteerId: me.id, interestType: 'want_to_contribute' },
    })
    cleanup()
    await mount(project.id, me)
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw request' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(
      (await prisma.workItemInterest.findFirstOrThrow({ where: { volunteerId: me.id } })).status,
    ).toBe('pending')
    await prisma.workItemInterest.deleteMany({ where: { volunteerId: me.id } })
    cleanup()
    await mount(project.id, me)
    await userEvent.click(await screen.findByRole('button', { name: 'Join this project' }))
    await prisma.workItem.update({ where: { id: project.id }, data: { isSeekingHelp: false } })
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await screen.findByText('This project is not currently seeking volunteers')
    await userEvent.click(screen.getByRole('button', { name: 'Message owner' }))
    await userEvent.type(screen.getByLabelText('Subject'), 'Hi')
    await userEvent.type(screen.getByLabelText('Message'), 'There')
    // The connection is gone by the time the message is sent.
    await prisma.contactRequest.deleteMany({ where: { fromVolunteerId: me.id } })
    fireEvent.submit(screen.getByLabelText('Subject').closest('form')!)
    await screen.findByText(/Send them a contact request first/)

    cleanup()
    const admin = await createAdmin()
    const done = await createProject({
      title: 'Outcome edge',
      status: 'completed',
      assigneeId: owner.id,
    })
    await mount(done.id, admin)
    await screen.findByRole('heading', { name: 'Outcome edge' })
    await userEvent.click(screen.getByRole('button', { name: 'Outcome' }))
    await userEvent.click(screen.getByRole('option', { name: 'Ongoing' }))
    await prisma.workItem.delete({ where: { id: done.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Record Outcome' }))
    await screen.findByText('Project not found')
  })

  it('shows direct contact details for the owner and an import through the porting modal', async () => {
    const me = await createVolunteer()
    const owner = await createVolunteer({
      discordHandle: 'own#1',
      signalNumber: '+1',
      whatsappNumber: '+2',
    })
    await connect(me, owner)
    const project = await createProject({
      title: 'Contact edge',
      assigneeId: owner.id,
      status: 'in_progress',
    })
    await mount(project.id, me)
    await screen.findByRole('heading', { name: 'Contact edge' })
    await userEvent.click(screen.getByRole('button', { name: 'Message owner' }))
    await screen.findByText(/own#1/)

    cleanup()
    const { clientAs } = await import('@/test/rpc')
    const file = await clientAs(owner).projects.exportPlan({ projectId: project.id })
    await mount(project.id, owner)
    await screen.findByRole('heading', { name: 'Contact edge' })
    await userEvent.click(screen.getByRole('button', { name: 'Export / Import' }))
    const edited = { ...file, project: { ...file.project, title: 'Imported title' } }
    fireEvent.change(screen.getByLabelText('Paste export JSON'), {
      target: { value: JSON.stringify(edited) },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Preview pasted JSON' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm import' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await screen.findByText(/Imported:/)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Export and import' })).toBeNull(),
    )
  })
})
