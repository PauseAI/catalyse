import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent, cleanup, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEndEvent } from '@dnd-kit/core'
import { prisma } from '@/lib/prisma'
import {
  createLocalGroup,
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
import { diffInDays } from '@/lib/schedule'

const drags = await vi.hoisted(() => import('@/test/dnd').then((m) => m.captureDrags()))
vi.mock('@dnd-kit/core', (importOriginal) => drags.mockDndKit(importOriginal))
// The task list sets its own collision detection; the Gantt chart leaves it to dnd-kit.
const listDrag = () => drags.find((p) => p.collisionDetection !== undefined)
const ganttDrag = () => drags.find((p) => p.collisionDetection === undefined)

const row = (id: number) => prisma.workItem.findUniqueOrThrow({ where: { id } })
const openTab = (name: RegExp) => userEvent.click(screen.getByRole('tab', { name }))
const group = (name: 'Status' | 'Actions') => screen.getByRole('group', { name })
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
      reach: 'REMOTE',
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
    expect(document.title).toBe('Catalyse | Visible project')
    // Overview first: the description, skills and the doc link.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: 'Open project doc →' })).toHaveAttribute(
      'href',
      'https://doc.example',
    )
    expect(screen.getByText('Olive Owner')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Crew' })).toHaveAttribute('href', `/teams/${team.id}`)
    expect(screen.getByText('You match 0 of 1 skill')).toBeInTheDocument()

    await openTab(/^Tasks/)
    expect(window.location.hash).toBe('#tasks')
    // Someone else's late task is theirs and the owner's to act on, so a visitor sees it outlined.
    expect(
      within(screen.getByRole('link', { name: 'Open task' }).closest('li')!).getByText(
        /days late$/,
      ),
    ).toHaveAttribute('data-emphasis', 'outline')
    expect(screen.getByLabelText('1 comment')).toBeInTheDocument()

    // Only people on the project can post, so there is no comment box until the claim.
    await openTab(/^Overview/)
    await screen.findByRole('heading', { name: 'Discussion' })
    expect(screen.queryByLabelText('Add a comment')).toBeNull()
    await openTab(/^Tasks/)
    // A member of the project's team is already on it, so claiming takes the task at once.
    await userEvent.click(await screen.findByRole('button', { name: 'Claim task' }))
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
    // The finished task moves under Done, after the one still under way.
    await waitFor(() => expect(screen.getAllByText('done')).toHaveLength(2))
    expect(taskOrder()).toEqual(['Ongoing task', 'Open task', 'Done task'])
    expect(screen.getByText('Done (2)')).toBeInTheDocument()
    await openTab(/^Overview/)
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
    // A request to help waits among the actions, beside its Withdraw button.
    expect(await within(group('Actions')).findByText('Request sent')).toHaveAttribute(
      'data-emphasis',
      'outline',
    )
    expect(within(group('Status')).queryByLabelText('interest status')).toBeNull()

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
      isSeekingHelp: true,
      collaborationLink: 'javascript:alert(1)',
    })
    await mount(project.id, me)
    await screen.findByRole('heading', { name: 'Ownerless' })
    expect(screen.queryByRole('link', { name: 'Open project doc →' })).toBeNull()
    // Nobody owns it: an empty chip, with Join beside it rather than among the page's actions.
    const person = screen.getByText('Owner', { exact: true }).parentElement!
    expect(person).toHaveTextContent(/^OwnerNo owner yet· No helpers yetJoin this project$/)
    expect(within(person).getByRole('button', { name: 'Join this project' })).toBeInTheDocument()
    expect(within(group('Actions')).queryByRole('button', { name: 'Join this project' })).toBeNull()
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
    // The sender's request to lead takes the Seeking owner flag's place, after the other flags;
    // Withdraw stays among the actions.
    const status = group('Status')
    const waiting = await within(status).findByLabelText('interest status')
    expect(waiting).toHaveTextContent('Request to lead sent')
    expect(waiting).not.toHaveTextContent('Waiting')
    expect(within(status).queryByText('• Seeking owner')).toBeNull()
    expect(within(status).getByText('• Seeking help')).toBeInTheDocument()
    expect(status.lastElementChild).toBe(waiting)
    expect(screen.getAllByLabelText('interest status')).toHaveLength(1)
    expect(
      within(group('Actions')).getByRole('button', { name: 'Withdraw request' }),
    ).toBeInTheDocument()
    // Anyone else still sees that the project wants a lead.
    cleanup()
    queryClient.clear()
    await mount(project.id, await createVolunteer())
    const othersStatus = await screen.findByRole('group', { name: 'Status' })
    expect(within(othersStatus).getByText('• Seeking owner')).toBeInTheDocument()
    expect(screen.queryByLabelText('interest status')).toBeNull()

    await prisma.workItemInterest.update({
      where: { id: interest.id },
      data: { status: 'declined', responseMessage: 'Sorry, no' },
    })
    cleanup()
    queryClient.clear()
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
    // The submitter waits on the owner; the owner, who can accept it, sees it filled.
    expect(screen.getByText('In review')).toHaveAttribute('data-emphasis', 'outline')
    expect(screen.queryByRole('link', { name: 'Review' })).toBeNull()

    cleanup()
    await mount(project.id, owner, '#tasks')
    expect(await screen.findByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/tasks/${waiting.id}`,
    )
    expect(screen.getByText('In review')).toHaveAttribute('data-emphasis', 'filled')
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
    // Beside the owner, a one-line count that matches the People tab's.
    expect(screen.getByRole('link', { name: 'Omar Owner' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '6 helpers' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit project' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Ask to take this' }))
    await screen.findByText(/^Requested\. The task is held for you/)
    await screen.findByText('Held for you: waiting for the owner')
    await screen.findByText('Request sent')
    expect(await row(t.id)).toMatchObject({ requestedById: me.id, assigneeId: null })
    await userEvent.click(screen.getByRole('button', { name: '6 helpers' }))
    expect(screen.getByRole('tab', { name: 'People (7)' })).toHaveAttribute('aria-selected', 'true')
    expect(
      within(screen.getByRole('region', { name: 'People on this project' })).getByText('Helper 6'),
    ).toBeInTheDocument()

    cleanup()
    await mount(project.id, owner, '#tasks')
    await screen.findByText('Requested by Mo Newcomer')
    // The viewer who answers requests counts them in the tab's number and its bubble.
    await screen.findByRole('tab', { name: 'People (8), 1 waiting for an answer' })
    await userEvent.click(screen.getByRole('button', { name: '6 helpers' }))
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

    await userEvent.click(await screen.findByRole('button', { name: 'Add task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }))
    await userEvent.type(screen.getByLabelText('Task title'), 'Third task')
    await userEvent.type(screen.getByLabelText('Description'), 'details')
    await userEvent.type(screen.getByLabelText('Effort: about'), '2')
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '2030-01-01' } })
    fireEvent.change(screen.getByLabelText('Start (optional)'), {
      target: { value: '2029-12-01' },
    })
    // An owner is not told that only the owner can change the dates later.
    expect(screen.queryByText(/Only the project owner can change these dates/)).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: /quick task/i }))
    await userEvent.type(screen.getByLabelText('What to submit (optional)'), 'Where you put it')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ask for a link to the work' }))
    await userEvent.type(screen.getByLabelText('Helpers wanted (optional)'), '4')
    fireEvent.submit(screen.getByLabelText('Task title').closest('form')!)
    await screen.findByText('Task added!')
    // The task list says how many helpers it seeks.
    await screen.findByText('4 helpers wanted')
    const t3 = await prisma.workItem.findFirstOrThrow({ where: { title: 'Third task' } })
    expect(t3).toMatchObject({
      submissionPrompt: 'Where you put it',
      submissionAsksLink: true,
      helpersWanted: 4,
      estimatedHours: 2,
      startDate: new Date('2029-12-01T00:00:00Z'),
      deadline: new Date('2030-01-01T00:00:00Z'),
      durationDays: null,
      featuredAsQuickTask: true,
      timing: 'flexible',
    })

    // Accept one interest, decline the other with a message.
    await openTab(/^People/)
    const interestCard = (name: string) =>
      within(screen.getByRole('region', { name: 'People on this project' }))
        .getByText(name)
        .closest('li') as HTMLElement
    // A request is grouped under Requests and says what it asks; Accept and Decline stand for
    // its status, so it carries no badge.
    expect(screen.getByRole('region', { name: 'Requests' })).toHaveTextContent('Requests (2)')
    expect(interestCard('Hana Helper')).toHaveTextContent('wants to help')
    expect(within(interestCard('Hana Helper')).queryByText(/Request sent|Applied/)).toBeNull()
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

    // Dragging is only in Your order. The drag handle and the task menu say what they are.
    await openTab(/^Tasks/)
    expect(screen.queryByLabelText('Drag to reorder First task')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Your order' }))
    expect(screen.getByRole('button', { name: 'Your order' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
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
    // An accepted helper is removed with the × on their chip, not declined, and the dialog
    // and toast say so.
    await userEvent.click(
      within(interestCard('Hana Helper')).getByRole('button', { name: 'Remove Hana Helper' }),
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
    await userEvent.click(screen.getByRole('option', { name: 'On hold' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'On hold' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Status updated!')
    await waitFor(async () => expect((await row(project.id)).status).toBe('on_hold'))

    // Enter submits the invite form even while its button is disabled.
    await openTab(/^People/)
    const picker = () => screen.getByRole('button', { name: 'Volunteer to invite' })
    fireEvent.submit(picker().closest('form')!)
    // The pick stands until it is cleared or sent.
    await userEvent.click(picker())
    await userEvent.click(await screen.findByRole('option', { name: 'Otto Other' }))
    expect(picker()).toHaveTextContent('Otto Other')
    await userEvent.click(picker())
    await userEvent.click(screen.getByRole('option', { name: 'Search volunteers…' }))
    expect(picker()).toHaveTextContent('Search volunteers…')
    await userEvent.click(picker())
    await userEvent.click(await screen.findByRole('option', { name: 'Otto Other' }))
    await userEvent.type(screen.getByLabelText('Note with the invite (optional)'), 'Leaflets?')
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await screen.findByText('Invite sent')
    // The picker empties, and the person waits under Invited until they answer.
    await waitFor(() => expect(picker()).toHaveTextContent('Search volunteers…'))
    expect(
      screen.getByText('They get an invite and join once they accept.', { exact: false }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add now' })).toBeNull()
    const invited = await screen.findByRole('region', { name: 'Invited' })
    expect(within(invited).getByText('Invited by Owen Owner')).toBeInTheDocument()
    expect(within(invited).getByText('Leaflets?')).toBeInTheDocument()
    // The inviter waits on the invitee, so the badge is outlined.
    expect(within(invited).getByText('Invited', { selector: '.status-badge' })).toHaveAttribute(
      'data-emphasis',
      'outline',
    )
    await userEvent.click(within(invited).getByRole('button', { name: 'Cancel invite' }))
    await screen.findByText('Invite cancelled.')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Invited' })).toBeNull())
    // Everyone who has left sits folded away under Past.
    expect(screen.getByText(/^Past \(/)).toBeInTheDocument()
    expect(interestCard('Otto Other')).toHaveTextContent('Invited, cancelled')

    // Owner tools sit in the bar beside the tabs, with the rarer ones under More.
    const bar = screen.getByRole('toolbar', { name: 'Status and actions' })
    expect(within(bar).getByRole('link', { name: 'Edit project' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/edit`,
    )
    await userEvent.click(within(bar).getByText('More'))
    await userEvent.click(screen.getByRole('button', { name: 'Export / Import' }))
    expect(screen.getByRole('dialog', { name: 'Export and import' })).toBeInTheDocument()
    expect(within(bar).getByText('More').closest('details')).not.toHaveAttribute('open')
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
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(screen.getAllByText('Project not found').length).toBeGreaterThan(1))
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Completed' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.getAllByText('Project not found').length).toBeGreaterThan(2))
    await openTab(/^Tasks/)
    await userEvent.click(screen.getByRole('button', { name: 'Your order' }))
    act(() => listDrag()({ active: { id: t1.id }, over: { id: t1.id + 1 } } as DragEndEvent))
  })
})

describe('project page — task list order', () => {
  /** Each task row's own title, top to bottom, leaving out the cards inside the rows. */
  const rowTitles = () =>
    [...document.querySelectorAll('li > div.flex-1 > a')].map((a) => a.textContent)
  const rowOf = (title: string) =>
    screen.getByRole('link', { name: title }).closest('li') as HTMLElement

  async function flyering() {
    const owner = await createVolunteer()
    const worker = await createVolunteer()
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: worker.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    const task = (title: string, sortOrder: number, rest: object = {}) =>
      createTask(project.id, { title, sortOrder, ...rest })
    const handOut = await task('Hand out flyers', 1)
    const print = await task('Print flyers', 2, {
      status: 'in_progress',
      assigneeId: worker.id,
      deadline: new Date('2030-01-10'),
    })
    const book = await task('Book the pitch', 3, { deadline: new Date('2030-01-20') })
    await task('Design the flyer', 4, { status: 'under_review', assigneeId: worker.id })
    await task('Pick a spot', 5, { assigneeId: worker.id })
    const count = await task('Count volunteers', 6, { deadline: new Date('2030-01-05') })
    await task('Thank-you post', 7)
    await task('Pack the stall kit', 8, { status: 'completed', completedAt: new Date() })
    await prisma.workItemDependency.createMany({
      data: [
        { predecessorId: book.id, successorId: handOut.id },
        { predecessorId: print.id, successorId: handOut.id },
      ],
    })
    return { owner, worker, project, handOut, count }
  }

  it('puts ready work first and names what a blocked task waits for', async () => {
    const { owner, project } = await flyering()
    await mount(project.id, owner, '#tasks')
    await screen.findByText('Hand out flyers')
    expect(rowTitles()).toEqual([
      'Count volunteers',
      'Book the pitch',
      'Thank-you post',
      'Pick a spot',
      'Print flyers',
      'Design the flyer',
      'Hand out flyers',
      'Pack the stall kit',
    ])
    // The blocked row names its first blocker in the manual order, as a card, and counts the rest.
    const blocked = rowOf('Hand out flyers')
    expect(within(blocked).getAllByText('To do')[0]).toHaveClass('status-badge')
    expect(within(blocked).getByText('Blocked by')).toBeInTheDocument()
    expect(within(blocked).getByRole('link', { name: 'Print flyers' })).toBeInTheDocument()
    expect(within(blocked).getByText('+ 1 more')).toBeInTheDocument()
    expect(within(rowOf('Count volunteers')).queryByText('Blocked by')).toBeNull()
    // Done work is folded away.
    expect(screen.getByText('Done (1)').closest('details')).not.toHaveAttribute('open')
    expect(screen.queryByTitle('Drag to reorder')).toBeNull()
  })

  it('switches to Your order for dragging, and back', async () => {
    const { owner, project, handOut, count } = await flyering()
    await mount(project.id, owner, '#tasks')
    await screen.findByText('Hand out flyers')
    await userEvent.click(screen.getByRole('button', { name: 'Your order' }))
    expect(rowTitles()).toEqual([
      'Hand out flyers',
      'Print flyers',
      'Book the pitch',
      'Design the flyer',
      'Pick a spot',
      'Count volunteers',
      'Thank-you post',
      'Pack the stall kit',
    ])
    expect(screen.queryByText(/^Done \(/)).toBeNull()
    act(() => listDrag()({ active: { id: count.id }, over: { id: handOut.id } } as DragEndEvent))
    expect(rowTitles().slice(0, 2)).toEqual(['Count volunteers', 'Hand out flyers'])
    await waitFor(async () => expect((await row(count.id)).sortOrder).toBe(1))
    await userEvent.click(screen.getByRole('button', { name: 'Your order' }))
    expect(screen.getByRole('button', { name: 'Your order' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(rowTitles()[0]).toBe('Count volunteers')
    expect(screen.getByText('Done (1)')).toBeInTheDocument()
  })

  it('gives a helper the grouped list and no Your order', async () => {
    const { worker, project } = await flyering()
    await mount(project.id, worker, '#tasks')
    await screen.findByText('Hand out flyers')
    expect(rowTitles()[0]).toBe('Count volunteers')
    expect(screen.queryByRole('button', { name: 'Your order' })).toBeNull()
  })
})

describe('project page — Overview status bar and Discussion', () => {
  const DAY = 86_400_000
  const rowTitles = () =>
    [...document.querySelectorAll('li > div.flex-1 > a')].map((a) => a.textContent)
  const bar = () => screen.getByRole('navigation', { name: 'Task summary' })
  // pushState, so jsdom does not queue a hashchange of its own after this one.
  const goToHash = (hash: string) =>
    act(() => {
      window.history.pushState(null, '', hash)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

  async function mixed() {
    const owner = await createVolunteer()
    const worker = await createVolunteer()
    const project = await createProject({
      status: 'in_progress',
      assigneeId: owner.id,
      description: 'What we are doing',
      deadline: new Date(Date.now() + 10 * DAY),
    })
    const late = await createTask(project.id, {
      title: 'Late task',
      deadline: new Date('2020-01-01'),
      sortOrder: 1,
    })
    const waiting = await createTask(project.id, { title: 'Waiting task', sortOrder: 2 })
    await createTask(project.id, {
      title: 'Doing task',
      status: 'in_progress',
      assigneeId: worker.id,
      sortOrder: 3,
    })
    await createTask(project.id, {
      title: 'Finished task',
      status: 'completed',
      completedAt: new Date(),
      sortOrder: 4,
    })
    await prisma.workItemDependency.create({
      data: { predecessorId: late.id, successorId: waiting.id },
    })
    return { owner, project }
  }

  it('has four tabs, and the Overview reads description, status bar, then Discussion', async () => {
    const { owner, project } = await mixed()
    await mount(project.id, owner)
    const discussion = await screen.findByRole('heading', { name: 'Discussion' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent!.replace(/ \(\d+\)$/, ''))).toEqual([
      'Overview',
      'Tasks',
      'Timeline',
      'People',
    ])
    expect(
      within(bar())
        .getAllByRole('link')
        .map((l) => [l.textContent, l.getAttribute('href')]),
    ).toEqual([
      ['4 tasks', '#tasks'],
      ['1 done', '#tasks=done'],
      ['1 overdue', '#tasks=overdue'],
      ['1 blocked', '#tasks=blocked'],
      ['2 unclaimed', '#tasks=unclaimed'],
    ])
    // Without a key date, the bar counts down to the project deadline.
    expect(within(bar()).getByText(/^Deadline .+ · in 10 days$/)).toBeInTheDocument()
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(screen.getByText('What we are doing'), bar())).toBe(true)
    expect(follows(bar(), discussion)).toBe(true)
  })

  it("shows the project's own deadline lateness in its status bar", async () => {
    const owner = await createVolunteer()
    const project = await createProject({
      status: 'in_progress',
      assigneeId: owner.id,
      deadline: new Date(Date.now() - 2 * DAY),
    })
    await mount(project.id, owner)
    await screen.findByRole('heading', { name: project.title })
    const bar = screen.getByRole('toolbar', { name: 'Status and actions' })
    expect(within(bar).getByText(/days late$/)).toBeInTheDocument()
  })

  it("shows a project's changes in the Discussion among its comments, to a helper too", async () => {
    const owner = await createVolunteer({ name: 'Olive' })
    const helper = await createVolunteer({ name: 'Hal' })
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: helper.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await clientAs(helper).workItemComments.add({ workItemId: project.id, content: 'Ready?' })
    await prisma.workItemComment.updateMany({
      where: { workItemId: project.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    })
    await clientAs(owner).projects.update({ id: project.id, status: 'on_hold' })
    await mount(project.id, helper)
    const line = await screen.findByText(/^Olive moved this to On hold · /)
    expect(
      line.compareDocumentPosition(screen.getByText('Ready?')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('opens the Tasks tab under the filter a count links to, and the list matches it', async () => {
    const { owner, project } = await mixed()
    await mount(project.id, owner)
    await screen.findByRole('heading', { name: 'Discussion' })
    await userEvent.click(within(bar()).getByRole('link', { name: '1 overdue' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^Tasks/ })).toHaveAttribute('aria-selected', 'true'),
    )
    expect(screen.getByRole('button', { name: 'Overdue' })).toHaveAttribute('aria-pressed', 'true')
    expect(rowTitles()).toEqual(['Late task'])

    const pick = async (name: string) => userEvent.click(screen.getByRole('button', { name }))
    await pick('Blocked')
    expect(window.location.hash).toBe('#tasks=blocked')
    expect(rowTitles()).toEqual(['Waiting task'])
    await pick('Unclaimed')
    expect(rowTitles()).toEqual(['Late task', 'Waiting task'])
    // Done tasks are listed open under their filter, not folded away.
    await pick('Done')
    expect(rowTitles()).toEqual(['Finished task'])
    expect(screen.queryByText(/^Done \(/)).toBeNull()
    await pick('All')
    expect(window.location.hash).toBe('#tasks')
    expect(rowTitles()).toHaveLength(4)
    expect(screen.getByText('Done (1)')).toBeInTheDocument()

    // Your order is the whole list: it drops the filter, and a filter link leaves it.
    await pick('Blocked')
    await pick('Your order')
    expect(window.location.hash).toBe('#tasks')
    expect(screen.queryByRole('group', { name: 'Filter tasks' })).toBeNull()
    expect(rowTitles()).toHaveLength(4)
    goToHash('#tasks=done')
    expect(screen.getByRole('button', { name: 'Your order' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(rowTitles()).toEqual(['Finished task'])
    // Leaving the tab drops the filter; an unknown one shows everything.
    await openTab(/^Timeline/)
    await openTab(/^Tasks/)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    goToHash('#tasks=nonsense')
    expect(rowTitles()).toHaveLength(4)
  })

  it('lands a #discussion link on the Discussion in the Overview', async () => {
    const { owner, project } = await mixed()
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    await mount(project.id, owner, '#discussion')
    await screen.findByRole('heading', { name: 'Discussion' })
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    const target = document.getElementById('discussion')
    await waitFor(() => expect(scroll.mock.contexts).toEqual([target]))
    // From another tab it switches back first; on the Overview it scrolls straight there.
    await openTab(/^Tasks/)
    goToHash('#discussion')
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    goToHash('#discussion')
    expect(scroll).toHaveBeenCalledTimes(3)
    expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById('discussion'))
    scroll.mockRestore()
  })

  it('hides counts at zero except tasks and done, and counts down to the key date', async () => {
    const owner = await createVolunteer()
    const project = await createProject({
      status: 'in_progress',
      assigneeId: owner.id,
      deadline: new Date(Date.now() + 20 * DAY),
    })
    await createTask(project.id, {
      title: 'Rally',
      isAnchor: true,
      assigneeId: owner.id,
      startDate: new Date(Date.now() + 5 * DAY),
    })
    await createTask(project.id, {
      title: 'Vigil',
      isAnchor: true,
      assigneeId: owner.id,
      startDate: new Date(Date.now() + 12 * DAY),
    })
    await mount(project.id, owner)
    await screen.findByRole('heading', { name: 'Discussion' })
    expect(
      within(bar())
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['2 tasks', '0 done'])
    // The soonest key date wins over a later one and over the project deadline.
    expect(within(bar()).getByText(/^Key date .+ · in 5 days$/)).toBeInTheDocument()
    await userEvent.click(within(bar()).getByRole('link', { name: '0 done' }))
    expect(await screen.findByText('No done tasks.')).toBeInTheDocument()
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
    await screen.findByText('8 days late')
    await openTab(/^Timeline/)
    await userEvent.click(await screen.findByRole('button', { name: /^Behind:/ }))
    const panel = screen.getByRole('complementary')
    expect(within(panel).getByText('8 days late')).toHaveAttribute('data-emphasis', 'filled')
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
    expect(screen.queryByText(/past plan|days late/)).toBeNull()
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
    await userEvent.click(await screen.findByRole('button', { name: 'Your order' }))
    expect(await screen.findByLabelText('Drag to reorder Open one')).toBeInTheDocument()
    expect(screen.getByLabelText('Task actions for Open one')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/tasks/${waiting.id}`,
    )
    expect(screen.getByText('Deputy')).toBeInTheDocument()
    // Edit project and More are the owner's: a deputy sees the status and nothing to change it.
    const bar = screen.getByRole('toolbar', { name: 'Status and actions' })
    expect(within(bar).getByLabelText('project status')).toBeInTheDocument()
    expect(within(bar).queryByRole('link', { name: 'Edit project' })).toBeNull()
    expect(within(bar).queryByText('More')).toBeNull()

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

describe('project page — people tab', () => {
  const people = () => screen.findByRole('region', { name: 'People on this project' })

  it('names the proposer, linked to their profile, beside the owner', async () => {
    const proposer = await createVolunteer({ name: 'Pia Proposer' })
    const owner = await createVolunteer({ name: 'Oren Owner' })
    const viewer = await createVolunteer()
    const project = await createProject({
      status: 'in_progress',
      creatorId: proposer.id,
      assigneeId: owner.id,
    })
    await mount(project.id, viewer, '#people')
    const tab = await people()
    expect(within(tab).getByText('Proposed by')).toBeInTheDocument()
    expect(within(tab).getByRole('link', { name: 'Pia Proposer' })).toHaveAttribute(
      'href',
      `/volunteers/${proposer.id}`,
    )
    expect(within(tab).getByRole('link', { name: 'Oren Owner' })).toHaveAttribute(
      'href',
      `/volunteers/${owner.id}`,
    )
  })

  it('names an org proposer without a link, and leaves the line out with no proposer', async () => {
    const admin = await createAdmin()
    const viewer = await createVolunteer()
    const byOrg = await createProject({
      status: 'in_progress',
      isOrgProposed: true,
      creatorId: admin.id,
    })
    await mount(byOrg.id, viewer, '#people')
    const tab = await people()
    // Plain text: no chip's initials circle, no link.
    expect(within(tab).getByText('Proposed by').parentElement).toHaveTextContent(
      /^Proposed byPauseAI$/,
    )
    expect(within(tab).queryByRole('link')).toBeNull()
    expect(within(tab).getByText('No owner yet')).toBeInTheDocument()

    cleanup()
    queryClient.clear()
    const unattributed = await createProject({ status: 'in_progress' })
    await mount(unattributed.id, viewer, '#people')
    expect(within(await people()).queryByText('Proposed by')).toBeNull()
  })

  it('names an owner who proposed their own project once, as its owner', async () => {
    const owner = await createVolunteer({ name: 'Oona Owner' })
    const project = await createProject({
      status: 'in_progress',
      creatorId: owner.id,
      assigneeId: owner.id,
    })
    await mount(project.id, await createVolunteer(), '#people')
    const tab = await people()
    expect(within(tab).getByRole('link', { name: 'Oona Owner' })).toBeInTheDocument()
    expect(within(tab).queryByText('Proposed by')).toBeNull()
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
    // One muted line in the header above the bar holding Accept / Decline; no banner.
    const line = await screen.findByText(/invited you to help/)
    expect(line).toHaveTextContent('Ola Owner invited you to help: “See https://example.org/brief”')
    expect(within(line).getByRole('link', { name: 'https://example.org/brief' })).toBeTruthy()
    const actions = screen.getByRole('group', { name: 'Actions' })
    expect(actions).not.toContainElement(line)
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Accept' }))
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Decline' }))
    expect(screen.queryByRole('region', { name: /invited you/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Join this project' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await screen.findByText('Invite declined.')
    // Declining leaves the way open to apply.
    await screen.findByRole('button', { name: 'Join this project' })
    expect(screen.queryByText(/invited you/)).toBeNull()

    await clientAs(owner).projects.invite({ projectId: project.id, volunteerId: me.id })
    cleanup()
    await mount(project.id, me)
    await screen.findByText('Ola Owner invited you to help on this project')
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
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
    await screen.findByText('The owner invited you to help on this project')
    await prisma.workItemInterest.update({
      where: { id: invite.id },
      data: { status: 'cancelled' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await screen.findByText('No invite found')
  })

  it('an invitee claims a task outright, which accepts the invite', async () => {
    const me = await createVolunteer()
    const project = await createProject({ assigneeId: (await createVolunteer()).id })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: me.id,
        interestType: 'want_to_contribute',
        status: 'invited',
      },
    })
    const task = await createTask(project.id, { title: 'Invited task' })
    await mount(project.id, me, '#tasks')
    await userEvent.click(await screen.findByRole('button', { name: 'Claim task' }))
    await screen.findByText(/Task claimed\. Post an update/)
    await waitFor(async () => expect((await row(task.id)).assigneeId).toBe(me.id))
  })
})

describe('project page — admin', () => {
  it('reviews a proposal, records an outcome, and manages ownership', async () => {
    const admin = await createAdmin()
    const proposer = await createVolunteer({ name: 'Pat Proposer' })
    const newOwner = await createVolunteer({
      name: 'Nina New',
      localGroupId: (await createLocalGroup({ name: 'Oslo', country: 'Norway' })).id,
      country: 'Norway',
    })
    const otherOwner = await createVolunteer({ name: 'Oli Other' })
    const pending = await createProject({
      title: 'Proposal',
      status: 'pending_review',
      creatorId: proposer.id,
    })
    await createTask(pending.id)
    await mount(pending.id, admin)
    await screen.findByRole('heading', { name: 'Proposal' })
    // The proposer is named on the People tab, not in the header's Owner slot.
    expect(screen.queryByText('Pat Proposer')).toBeNull()
    expect(screen.getByText('No owner yet')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Ask for changes'))
    await userEvent.type(screen.getByLabelText('Message to proposer'), 'Tell us more')
    fireEvent.submit(screen.getByLabelText('Message to proposer').closest('form')!)
    await screen.findByText('Changes requested.')
    await waitFor(async () => expect((await row(pending.id)).status).toBe('needs_discussion'))
    cleanup()
    await mount(pending.id, admin)
    await screen.findByRole('heading', { name: 'Proposal' })
    fireEvent.submit(screen.getByLabelText(/approve/i).closest('form')!)
    await screen.findByText('Project approved!')

    // The pencil beside the Owner chip opens a search of the directory, ready to type into.
    const ownerSearch = () => screen.queryByRole('searchbox', { name: 'New owner' })
    const assign = screen.getByRole('button', { name: 'Assign owner' })
    expect(ownerSearch()).toBeNull()
    await userEvent.click(assign)
    expect(ownerSearch()).toHaveFocus()
    expect(assign).toHaveAttribute('aria-expanded', 'true')
    // The pencil closes it again, and so do Escape, a click outside and a change of tab.
    await userEvent.click(assign)
    expect(ownerSearch()).toBeNull()
    await userEvent.click(assign)
    await userEvent.keyboard('{Escape}')
    expect(ownerSearch()).toBeNull()
    expect(assign).toHaveFocus()
    await userEvent.click(assign)
    fireEvent.mouseDown(document.body)
    expect(ownerSearch()).toBeNull()
    await userEvent.click(assign)
    await openTab(/^People/)
    expect(ownerSearch()).toBeNull()
    await openTab(/^Overview/)
    // An ownerless project takes the pick without asking. Each match says where they are.
    await userEvent.click(assign)
    await userEvent.keyboard('Nina')
    const nina = await screen.findByRole('option', { name: 'Nina New' })
    expect(nina).toHaveTextContent('Oslo, Norway')
    await userEvent.click(nina)
    await screen.findByText('Ownership transferred!')
    await waitFor(async () => expect((await row(pending.id)).assigneeId).toBe(newOwner.id))
    const header = screen.getByRole('heading', { name: 'Proposal' }).closest('header')!
    await within(header).findByRole('link', { name: 'Nina New' })
    expect(ownerSearch()).toBeNull()

    // Replacing an owner asks first, and the current owner is not offered.
    await userEvent.click(screen.getByRole('button', { name: 'Change owner' }))
    const oli = await screen.findByRole('option', { name: 'Oli Other' })
    expect(screen.queryByRole('option', { name: 'Nina New' })).toBeNull()
    await userEvent.click(oli)
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect((await row(pending.id)).assigneeId).toBe(newOwner.id)
    await userEvent.click(screen.getByRole('button', { name: 'Change owner' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Oli Other' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Transfer' }),
    )
    await waitFor(async () => expect((await row(pending.id)).assigneeId).toBe(otherOwner.id))
    await within(header).findByRole('link', { name: 'Oli Other' })

    // Ownership is removed from the same popover that changes the owner.
    await userEvent.click(screen.getByRole('button', { name: 'Change owner' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove ownership' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove ownership' }),
    )
    await waitFor(async () => expect((await row(pending.id)).assigneeId).toBeNull())

    // Outcome on a completed project (admin-only status pick first). The status control stays
    // disabled until the removal's response lands, after the row is written.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'project status' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Completed' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    await screen.findByText('Status updated!')
    await userEvent.click(await screen.findByRole('button', { name: 'Outcome' }))
    fireEvent.submit(screen.getByLabelText('Outcome notes').closest('form')!)
    await userEvent.click(screen.getByRole('option', { name: 'Successful' }))
    await userEvent.type(screen.getByLabelText('Outcome notes'), 'Went well')
    await userEvent.click(screen.getByRole('button', { name: 'Record outcome' }))
    await screen.findByText('Outcome recorded!')
    await waitFor(() =>
      expect(screen.getByText(/Outcome:/).parentElement).toHaveTextContent('Successful'),
    )
  })

  it('gives only an admin the pencil to change the owner', async () => {
    const owner = await createVolunteer({ name: 'Owen Owner' })
    const visitor = await createVolunteer()
    const owned = await createProject({ title: 'Owned one', assigneeId: owner.id })
    const ownerless = await createProject({ title: 'Ownerless one' })
    for (const [project, viewer, title] of [
      [owned, owner, 'Owned one'],
      [owned, visitor, 'Owned one'],
      [ownerless, visitor, 'Ownerless one'],
    ] as const) {
      cleanup()
      queryClient.clear()
      await mount(project.id, viewer)
      await screen.findByRole('heading', { name: title })
      expect(screen.queryByRole('button', { name: /^(Change|Assign) owner$/ })).toBeNull()
    }
  })

  it('shows org-proposed projects, the other outcome labels, and admin-only status values', async () => {
    const admin = await createAdmin()
    for (const [outcome, label] of [
      ['partial', 'Partial'],
      ['not_completed', 'Not completed'],
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
      // Who proposed it is on the People tab; the header's Owner slot stays empty.
      expect(screen.queryByText(/Proposer:/)).toBeNull()
      expect(screen.getByText('No owner yet')).toBeInTheDocument()
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
      startDate: new Date('2026-06-01T00:00:00Z'),
      deadline: new Date('2026-06-02T00:00:00Z'),
      baselineStartDate: new Date('2026-06-01T00:00:00Z'),
      baselineDurationDays: 2,
      baselineSetAt: new Date('2026-05-01T00:00:00Z'),
    })
    const b = await createTask(project.id, { title: 'Beta' })
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
    expect(screen.getByText('No dates (1)')).toBeInTheDocument()
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
    await waitFor(async () => expect((await row(c.id)).startDate).not.toBeNull())
    expect((await row(c.id)).deadline).toBeNull()
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Tasks with no dates' })).toBeNull(),
    )

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

    // Select a bar to open the panel; edit dates, anchor, dependencies, assignment.
    await userEvent.click(screen.getByRole('button', { name: /^Beta:/ }))
    const panel = () => screen.getByRole('complementary')
    await within(panel()).findByText('Beta')
    // The Dates block opens from Edit dates, and folds away again on Save.
    const editDates = async () => {
      // The panel's controls stay disabled until a save's response lands, after the row is written.
      const edit = within(panel()).getByRole('button', { name: 'Edit dates' })
      await waitFor(() => expect(edit).toBeEnabled())
      await userEvent.click(edit)
      return within(panel()).getByLabelText('Deadline').closest('form')!
    }
    const deadlineForm = await editDates()
    fireEvent.change(within(panel()).getByLabelText('Deadline'), {
      target: { value: '2027-06-30' },
    })
    fireEvent.submit(deadlineForm)
    expect(within(panel()).queryByLabelText('Deadline')).toBeNull()
    await waitFor(async () =>
      expect((await row(b.id)).deadline).toEqual(new Date('2027-06-30T00:00:00Z')),
    )
    // Timing and effort are not schedule, so they go by the task update rather than the drag path.
    const datesForm = await editDates()
    await userEvent.click(within(panel()).getByRole('checkbox', { name: /exact dates/ }))
    await userEvent.type(within(panel()).getByLabelText('Effort: about'), '3')
    fireEvent.submit(datesForm)
    await waitFor(async () =>
      expect(await row(b.id)).toMatchObject({ timing: 'fixed', estimatedHours: 3 }),
    )
    // Links and the key date are edited from the Plan menu only.
    expect(within(panel()).queryByRole('checkbox', { name: /Key date/ })).toBeNull()
    expect(within(panel()).queryByLabelText('Add a dependency')).toBeNull()
    expect(within(panel()).getByRole('link', { name: 'Alpha' })).toBeInTheDocument()
    // Beta was linked to Gamma above, so Gamma is what it unblocks.
    expect(within(panel()).getByRole('link', { name: 'Gamma' })).toBeInTheDocument()
    await userEvent.click(within(panel()).getByRole('button', { name: 'Plan “Beta”' }))
    const plan = await screen.findByRole('dialog', { name: 'Plan “Beta”' })
    const makeKey = within(plan).getByRole('button', { name: 'Make this the key date' })
    await waitFor(() => expect(makeKey).toBeEnabled())
    await userEvent.click(makeKey)
    await waitFor(async () => expect((await row(b.id)).isAnchor).toBe(true))
    await screen.findByText('This is now the key date.')
    await within(plan).findByRole('button', { name: 'Stop using as key date' })

    const stopWaiting = within(plan).getByRole('button', { name: 'Stop waiting on Alpha' })
    await waitFor(() => expect(stopWaiting).toBeEnabled())
    await userEvent.click(stopWaiting)
    await waitFor(async () =>
      expect(await prisma.workItemDependency.count({ where: { successorId: b.id } })).toBe(0),
    )
    await waitFor(() =>
      expect(
        within(within(plan).getByLabelText('Waits on…')).getByRole('option', { name: 'Alpha' }),
      ).toBeInTheDocument(),
    )
    await userEvent.selectOptions(within(plan).getByLabelText('Waits on…'), String(a.id))
    await userEvent.click(within(plan).getByRole('button', { name: 'Add' }))
    await waitFor(async () =>
      expect(
        await prisma.workItemDependency.count({
          where: { predecessorId: a.id, successorId: b.id },
        }),
      ).toBe(1),
    )
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Plan “Beta”' })).toBeNull()
    await userEvent.click(within(panel()).getByRole('button', { name: 'Claim task' }))
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
    // The original plan records the days from the start through the deadline.
    await waitFor(async () => {
      const beta = await row(b.id)
      expect(beta.baselineDurationDays).toBe(diffInDays(beta.startDate!, beta.deadline!) + 1)
    })
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
    await screen.findByText('No dates (2)')
    expect(screen.getByText(/No tasks have dates yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add all to timeline' }))
    await waitFor(async () => expect((await row(t2.id)).startDate).not.toBeNull())
    await screen.findByRole('button', { name: /^Loose one:/ })
    await userEvent.click(screen.getByRole('button', { name: 'Set original plan' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Set original plan' })[1])
    await screen.findByText('Original plan updated')
    // The toast comes before the timeline's refetch; one landing after the delete below would
    // drop the task, and its panel with it.
    await screen.findByRole('button', { name: 'Replace original plan' })

    // Failures: an anchor change and a reschedule on a task that vanished.
    await userEvent.click(screen.getByRole('button', { name: /^Loose one:/ }))
    await prisma.workItem.delete({ where: { id: t1.id } })
    const panel = screen.getByRole('complementary')
    await userEvent.click(within(panel).getByRole('button', { name: 'Plan “Loose one”' }))
    const plan = await screen.findByRole('dialog', { name: 'Plan “Loose one”' })
    await userEvent.click(within(plan).getByRole('button', { name: 'Make this the key date' }))
    await screen.findByText('Project or task not found')
    await userEvent.selectOptions(within(plan).getByLabelText('Waits on…'), String(t2.id))
    await userEvent.click(within(plan).getByRole('button', { name: 'Add' }))
    await screen.findByText('One or both items were not found')
    await userEvent.keyboard('{Escape}')
    // A failed reschedule is rolled back and the timeline refetched (which drops the panel).
    await userEvent.click(within(panel).getByRole('button', { name: 'Edit dates' }))
    fireEvent.submit(within(panel).getByLabelText('Deadline').closest('form')!)
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
    expect(screen.getByText('No dates yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /baseline/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Alpha:/ }))
    await screen.findByRole('complementary')
    expect(screen.queryByRole('button', { name: /^Plan “/ })).toBeNull()
  })

  it('lets a deputy edit links but not the key date, and locks a done task', async () => {
    const { helper, project, a, b } = await setupTimeline()
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: helper.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: helper.id } })
    await mount(project.id, helper, '#timeline')
    await userEvent.click(await screen.findByRole('button', { name: /^Beta:/ }))
    // One menu beside the selected bar, one in the panel header.
    expect(screen.getAllByRole('button', { name: 'Plan “Beta”' })).toHaveLength(2)
    await userEvent.click(screen.getAllByRole('button', { name: 'Plan “Beta”' })[0])
    const plan = await screen.findByRole('dialog', { name: 'Plan “Beta”' })
    expect(within(plan).getByRole('button', { name: 'Stop waiting on Alpha' })).toBeInTheDocument()
    expect(within(plan).queryByRole('button', { name: /key date/ })).toBeNull()

    cleanup()
    await prisma.workItem.update({ where: { id: a.id }, data: { status: 'completed' } })
    await prisma.workItem.update({
      where: { id: b.id },
      data: { status: 'completed', startDate: new Date('2026-06-03T00:00:00Z') },
    })
    queryClient.clear()
    await mount(project.id, helper, '#timeline')
    await userEvent.click(await screen.findByRole('button', { name: /^Beta:/ }))
    await screen.findByRole('complementary')
    expect(screen.queryByRole('button', { name: /^Plan “/ })).toBeNull()
  })

  it('orders rows by start, whatever the task list order, with undated tasks last', async () => {
    const owner = await createVolunteer()
    const project = await createProject({
      title: 'Flyering',
      assigneeId: owner.id,
      status: 'in_progress',
      startDate: new Date('2026-06-01T00:00:00Z'),
    })
    await createTask(project.id, { title: 'Hand out leaflets' })
    await createTask(project.id, {
      title: 'Pack flyering stall kit',
      startDate: new Date('2026-06-05T00:00:00Z'),
      deadline: new Date('2026-06-05T00:00:00Z'),
    })
    await createTask(project.id, {
      title: 'Get table from Reuben',
      startDate: new Date('2026-06-02T00:00:00Z'),
      deadline: new Date('2026-06-03T00:00:00Z'),
    })
    await mount(project.id, owner, '#timeline')
    await screen.findByRole('button', { name: /^Get table from Reuben:/ })
    expect(
      screen
        .getAllByTitle(/^(Hand out leaflets|Pack flyering stall kit|Get table from Reuben)$/)
        .map((el) => el.title),
    ).toEqual(['Get table from Reuben', 'Pack flyering stall kit', 'Hand out leaflets'])

    // With nothing dated, a visitor still sees the undated rows, and no instructions to place them.
    cleanup()
    const bare = await createProject({ title: 'Bare', status: 'in_progress' })
    await createTask(bare.id, { title: 'Undated only' })
    await mount(bare.id, await createVolunteer(), '#timeline')
    await screen.findByText('No dates (1)')
    expect(screen.getByText('No tasks have dates yet.')).toBeInTheDocument()
    expect(screen.getByText('No dates yet')).toBeInTheDocument()
  })

  it('widens the page for the Timeline tab only', async () => {
    const { owner, project } = await setupTimeline()
    await mount(project.id, owner, '#timeline')
    await screen.findByRole('button', { name: /^Alpha:/ })
    expect(screen.getByRole('main')).toHaveClass('container-wide')
    expect(screen.getByRole('main')).not.toHaveClass('container')

    await openTab(/^Overview/)
    expect(screen.getByRole('main')).toHaveClass('container')
    expect(screen.getByRole('main')).not.toHaveClass('container-wide')
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
    await userEvent.click(await screen.findByRole('button', { name: 'Add task' }))
    fireEvent.submit(screen.getByLabelText('Task title').closest('form')!)
    expect(await prisma.workItem.count({ where: { parentId: project.id } })).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'In progress' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'project status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Archived' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Change owner' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove ownership' }))
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
    expect(screen.getByLabelText('project status')).toHaveTextContent('Needs changes')
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
    // It has an owner, so there is no lead to ask to be — no radio, just a single confirm.
    expect(screen.getByText('Join to help?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Help out on the project')).toBeNull()
    expect(screen.queryByLabelText('Lead the project')).toBeNull()
    await userEvent.keyboard('{Escape}')
    // Claiming a task that no longer exists, then declining the withdraw confirmation.
    const gone = await createTask(project.id, { title: 'Gone task' })
    cleanup()
    await mount(project.id, me, '#tasks')
    await screen.findByRole('button', { name: 'Ask to take this' })
    await prisma.workItem.delete({ where: { id: gone.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Ask to take this' }))
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
    // Withdrawing a request is not leaving: the viewer was never on the project.
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw request' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw' }),
    )
    await screen.findByText('Request withdrawn. You can ask again at any time.')
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
    await userEvent.click(screen.getByRole('button', { name: 'Record outcome' }))
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

describe('project page — reopening a done task', () => {
  const reopenDialog = (title: string) =>
    screen.findByRole('dialog', { name: `Reopen '${title}'?` })

  it('reopens from the task menu, for a deputy too', async () => {
    const owner = await createVolunteer()
    const deputy = await createVolunteer({ name: 'Dee Deputy' })
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: deputy.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: deputy.id } })
    const done = await createTask(project.id, {
      title: 'Finished bit',
      status: 'completed',
      completedAt: new Date(),
    })
    await createTask(project.id, { title: 'Open bit' })
    await mount(project.id, deputy, '#tasks')

    await userEvent.click(await screen.findByLabelText('Task actions for Open bit'))
    expect(screen.queryByRole('menuitem', { name: 'Reopen task' })).toBeNull()
    await userEvent.click(screen.getByLabelText('Task actions for Open bit'))

    await userEvent.click(screen.getByLabelText('Task actions for Finished bit'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reopen task' }))
    await userEvent.click(
      within(await reopenDialog('Finished bit')).getByRole('button', { name: 'Cancel' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByLabelText('Task actions for Finished bit'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reopen task' }))
    await userEvent.click(
      within(await reopenDialog('Finished bit')).getByRole('button', { name: 'Reopen' }),
    )
    await screen.findByText('Reopened. It can be edited again.')
    expect(await row(done.id)).toMatchObject({ status: 'not_started', completedAt: null })
  })

  it('reopens a done bar from the timeline panel, which is otherwise read-only', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const done = await createTask(project.id, {
      title: 'Built stage',
      status: 'completed',
      completedAt: new Date(),
      startDate: new Date('2026-10-01T00:00:00Z'),
      deadline: new Date('2026-10-02T00:00:00Z'),
    })
    await mount(project.id, owner, '#timeline')
    await userEvent.click(await screen.findByRole('button', { name: /^Built stage:/ }))
    const panel = () => screen.getByRole('complementary')
    expect(within(panel()).queryByRole('button', { name: 'Edit dates' })).toBeNull()

    await userEvent.click(within(panel()).getByRole('button', { name: 'Reopen' }))
    await userEvent.click(
      within(await reopenDialog('Built stage')).getByRole('button', { name: 'Cancel' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(within(panel()).getByRole('button', { name: 'Reopen' }))
    await userEvent.click(
      within(await reopenDialog('Built stage')).getByRole('button', { name: 'Reopen' }),
    )
    await screen.findByText('Reopened. It can be edited again.')
    expect(await row(done.id)).toMatchObject({ status: 'not_started', completedAt: null })
    await within(panel()).findByRole('button', { name: 'Edit dates' })
  })
})

describe('project page — a completed project', () => {
  /** A completed project with a helper holding a task, a deputy, and someone waiting. */
  async function completedProject() {
    const owner = await createVolunteer({ name: 'Olive Owner' })
    const helper = await createVolunteer({ name: 'Hal Helper' })
    const deputy = await createVolunteer({ name: 'Dee Deputy' })
    const applicant = await createVolunteer({ name: 'Ann Applicant' })
    const project = await createProject({
      title: 'Finished campaign',
      assigneeId: owner.id,
      status: 'completed',
      completedAt: new Date('2026-09-30T12:00:00Z'),
    })
    for (const [volunteer, status] of [
      [helper, 'accepted'],
      [deputy, 'accepted'],
      [applicant, 'pending'],
    ] as const) {
      await prisma.workItemInterest.create({
        data: {
          workItemId: project.id,
          volunteerId: volunteer.id,
          interestType: 'want_to_contribute',
          status,
        },
      })
    }
    await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: deputy.id } })
    await createTask(project.id, { title: 'Open bit' })
    await createTask(project.id, {
      title: 'Hal’s bit',
      assigneeId: helper.id,
      status: 'in_progress',
    })
    return { owner, helper, deputy, project }
  }
  const banner = () => screen.findByText('Completed on 30 September 2026. Read-only.')

  it('is read-only for the owner until they reopen it', async () => {
    const { owner, project } = await completedProject()
    await mount(project.id, owner, '#tasks')
    await banner()
    await screen.findByText('Open bit')
    expect(screen.queryByRole('link', { name: 'Edit project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
    expect(screen.queryByLabelText('Task actions for Open bit')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Claim task' })).toBeNull()
    // Nothing can be dragged, so there is no Your order to drag in.
    expect(screen.queryByRole('button', { name: 'Your order' })).toBeNull()
    await openTab(/People/)
    await screen.findByText('Ann Applicant')
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reopen project' }))
    const ask = () => screen.findByRole('dialog', { name: "Reopen 'Finished campaign'?" })
    expect(
      within(await ask()).getByText(
        'It goes back to In progress, and everyone on it can change it again.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(within(await ask()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Reopen project' }))
    await userEvent.click(within(await ask()).getByRole('button', { name: 'Reopen' }))
    await screen.findByText('Reopened. The project can be changed again.')
    expect(await row(project.id)).toMatchObject({ status: 'in_progress', completedAt: null })
    await screen.findByRole('link', { name: 'Edit project' })
    expect(screen.queryByText(/Read-only/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reopen project' })).toBeNull()
    await screen.findByRole('button', { name: 'Accept' })
  })

  it('a helper cannot leave, claim or submit, and sees no Reopen', async () => {
    const { helper, project } = await completedProject()
    await mount(project.id, helper, '#tasks')
    await banner()
    await screen.findByText('Open bit')
    expect(screen.queryByRole('button', { name: 'Leave project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Claim task' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reopen project' })).toBeNull()
  })

  it('a deputy cannot reopen it or run its tasks', async () => {
    const { deputy, project } = await completedProject()
    await mount(project.id, deputy, '#people')
    await banner()
    await screen.findByText('Hal Helper')
    expect(screen.queryByRole('button', { name: 'Step down' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reopen project' })).toBeNull()
    expect(screen.queryByLabelText('Task actions for Open bit')).toBeNull()
  })

  it('an admin reopens it, and sees why a reopen failed', async () => {
    const { project } = await completedProject()
    const admin = await createAdmin()
    await mount(project.id, admin)
    await banner()
    // A locked project offers no way to change or remove its owner.
    await userEvent.click(
      within(screen.getByRole('toolbar', { name: 'Status and actions' })).getByText('More'),
    )
    expect(screen.queryByRole('button', { name: 'Change owner' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove ownership' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Reopen project' }))
    const ask = await screen.findByRole('dialog', { name: "Reopen 'Finished campaign'?" })
    // Taken off the admin list in the meantime.
    await prisma.volunteer.update({
      where: { id: admin.id },
      data: { email: 'former-admin@example.com' },
    })
    await userEvent.click(within(ask).getByRole('button', { name: 'Reopen' }))
    await screen.findByText('Not authorized to edit this project')
    expect(await row(project.id)).toMatchObject({ status: 'completed' })
  })

  it('says when an archived or undated project was finished', async () => {
    const owner = await createVolunteer()
    const archived = await createProject({ assigneeId: owner.id, status: 'archived' })
    await mount(archived.id, owner)
    await screen.findByText('Archived. Read-only.')
    cleanup()
    const undated = await createProject({ assigneeId: owner.id, status: 'completed' })
    await mount(undated.id, owner)
    await screen.findByText('Completed. Read-only.')
  })
})

describe('project page — every task done', () => {
  /** A running project whose tasks, the key date among them, are all done. */
  async function allDone(tasks = 2) {
    const owner = await createVolunteer({ name: 'Olive Owner' })
    const helper = await createVolunteer({ name: 'Hal Helper' })
    const project = await createProject({
      title: 'Wrapped up',
      assigneeId: owner.id,
      status: 'in_progress',
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: helper.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    for (let i = 0; i < tasks; i++) {
      await createTask(project.id, {
        title: `Bit ${i}`,
        status: 'completed',
        completedAt: new Date(`2026-09-0${i + 1}T12:00:00Z`),
        isAnchor: i === 0 && tasks > 1,
      })
    }
    return { owner, helper, project }
  }
  const ask = 'All 2 tasks are done, including the key date. Ready to complete the project?'

  it('asks the owner to complete it, saying completing locks it', async () => {
    const { owner, project } = await allDone()
    await mount(project.id, owner)
    await screen.findByText(ask)
    await userEvent.click(screen.getByRole('button', { name: 'Complete project' }))
    const dialog = () => screen.findByRole('dialog', { name: "Complete 'Wrapped up'?" })
    expect(within(await dialog()).getByText(/Completing it locks the project/)).toBeInTheDocument()
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await row(project.id)).status).toBe('in_progress')

    await userEvent.click(screen.getByRole('button', { name: 'Complete project' }))
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Complete project' }))
    await screen.findByText(/Read-only\./)
    expect(screen.queryByText(ask)).toBeNull()
    expect(await row(project.id)).toMatchObject({ status: 'completed' })
  })

  it('"Not yet" sets it aside until a task is done again', async () => {
    const { owner, project } = await allDone(1)
    await mount(project.id, owner)
    const one = 'The only task is done. Ready to complete the project?'
    await screen.findByText(one)
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }))
    expect(screen.queryByText(one)).toBeNull()

    cleanup()
    await mount(project.id, owner)
    await screen.findByRole('heading', { name: 'Wrapped up' })
    expect(screen.queryByText(one)).toBeNull()

    // Reopened and done again: asked again.
    cleanup()
    await prisma.workItem.updateMany({
      where: { parentId: project.id },
      data: { completedAt: new Date('2026-10-01T12:00:00Z') },
    })
    await mount(project.id, owner)
    await screen.findByText(one)
  })

  it('still asks, and "Not yet" still hides it, when the browser refuses storage', async () => {
    const { owner, project } = await allDone()
    // Only this banner's keys are refused; the session token still reads.
    const { getItem, setItem } = Storage.prototype
    const refuseOurs = <A extends unknown[], R>(
      real: (this: Storage, key: string, ...rest: A) => R,
    ) =>
      function (this: Storage, key: string, ...rest: A): R {
        if (key.startsWith('ready-to-complete')) throw new Error('Storage disabled')
        return real.call(this, key, ...rest)
      }
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuseOurs(getItem))
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuseOurs(setItem))
    try {
      await mount(project.id, owner)
      await screen.findByText(ask)
      await userEvent.click(screen.getByRole('button', { name: 'Not yet' }))
      expect(screen.queryByText(ask)).toBeNull()
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })

  it('an admin is asked too; a helper is not', async () => {
    const { helper, project } = await allDone()
    await mount(project.id, helper)
    await screen.findByRole('heading', { name: 'Wrapped up' })
    expect(screen.queryByText(ask)).toBeNull()
    cleanup()
    await mount(project.id, await createAdmin())
    await screen.findByText(ask)
  })
})
