import { describe, it, expect } from 'vitest'
import { screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { queryClient } from '@/lib/query-client'
import { createVolunteer, createAdmin, createProject, createTask } from '@/test/factories'
import { renderApp } from '@/test/render'
import { addDays, startOfUtcDay } from '@/lib/schedule'
import { formatDateShort, toDateInputValue } from '@/lib/format-date'
import { shortDay } from '@/lib/relative-date'
import { initials } from '@/components/WorkItemHeader'
import TaskDetailPage from './page'

const row = (id: number) => prisma.workItem.findUniqueOrThrow({ where: { id } })
const submitBox = () => screen.findByRole('region', { name: 'Submit your work' })
const mount = (
  projectId: number | string,
  taskId: number | string,
  as: Awaited<ReturnType<typeof createVolunteer>>,
) =>
  renderApp(
    <TaskDetailPage params={Promise.resolve({ id: String(projectId), taskId: String(taskId) })} />,
    { as },
  )

describe('task detail page', () => {
  it('lets the assignee start and submit their work from the box on the page', async () => {
    const me = await createVolunteer()
    const someoneElse = await createVolunteer()
    const project = await createProject({ status: 'in_progress' })
    // A task from before the link became optional, which still asks for one.
    const task = await createTask(project.id, {
      title: 'Mine',
      assigneeId: me.id,
      claimedAt: new Date('2030-01-02T00:00:00Z'),
      submissionAsksLink: true,
    })
    await mount(project.id, task.id, someoneElse)
    await screen.findByRole('heading', { name: 'Mine' })
    expect(screen.queryByRole('region', { name: 'Submit your work' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()

    cleanup()
    await mount(project.id, task.id, me)
    await screen.findByText(/claimed on 2 Jan 2030/)
    // Claimed is not started: nothing it waits on, so it reads Ready.
    expect(screen.getByText('Ready')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await screen.findByText('Started. Post updates as you go.')
    await screen.findByText(`started ${shortDay(new Date())}`, { exact: false })
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect((await row(task.id)).status).toBe('in_progress')

    // The box is on the page. A project with no owner to review it takes the work as done.
    const box = await submitBox()
    expect(within(box).getByText(/This marks the task done/)).toBeInTheDocument()
    const why = 'Say what you did or add a link to it.'
    const submit = within(box).getByRole('button', { name: 'Submit and mark done' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAccessibleDescription(why)
    // Enter submits the form even while the button is disabled; nothing is sent.
    fireEvent.submit(submit.closest('form')!)
    expect(within(box).getByRole('alert')).toHaveTextContent(why)
    await userEvent.type(within(box).getByLabelText('Link to your work (optional)'), 'x.org')
    expect(within(box).queryByText(why)).toBeNull()
    expect(submit).toBeEnabled()
    await userEvent.click(submit)
    expect(within(box).getByRole('alert')).toHaveTextContent(
      'A link starts with https:// or http://',
    )
    await userEvent.clear(within(box).getByLabelText('Link to your work (optional)'))
    expect(submit).toBeDisabled()
    await userEvent.type(within(box).getByLabelText('What did you do?'), 'Wrote it up')
    expect(within(box).queryByText(why)).toBeNull()
    await userEvent.click(submit)
    await screen.findByText('Task done. What you did is saved on the task.')
    await waitFor(async () => expect((await row(task.id)).status).toBe('completed'))
    await screen.findByRole('heading', { name: 'Submitted work' })
    expect(screen.getByText('Wrote it up')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Submit your work' })).toBeNull()
  })

  it('asks what the task says to submit, with no link field unless it asks for one', async () => {
    const me = await createVolunteer()
    const project = await createProject({ status: 'in_progress' })
    const task = await createTask(project.id, {
      status: 'in_progress',
      assigneeId: me.id,
      submissionPrompt: 'How many flyers went out, and where?',
    })
    await mount(project.id, task.id, me)
    const box = await submitBox()
    expect(within(box).queryByLabelText('Link to your work (optional)')).toBeNull()
    expect(within(box).queryByLabelText('What did you do?')).toBeNull()
    const submit = within(box).getByRole('button', { name: 'Submit and mark done' })
    expect(submit).toHaveAccessibleDescription('Say what you did.')
    await userEvent.type(
      within(box).getByLabelText('How many flyers went out, and where?'),
      '200 at the station',
    )
    await userEvent.click(submit)
    await screen.findByText('Task done. What you did is saved on the task.')
    await waitFor(async () =>
      expect(await row(task.id)).toMatchObject({
        submissionNote: '200 at the station',
        submissionUrl: null,
      }),
    )
  })

  it('keeps started work In progress when what it waits on is open, with a warning', async () => {
    const me = await createVolunteer()
    const project = await createProject({ status: 'in_progress' })
    const before = await createTask(project.id, { title: 'Emergency thing' })
    const task = await createTask(project.id, {
      title: 'Do the flyering',
      status: 'in_progress',
      assigneeId: me.id,
    })
    await prisma.workItemDependency.create({
      data: { predecessorId: before.id, successorId: task.id },
    })
    await mount(project.id, task.id, me)
    await screen.findByText("Still waiting on 'Emergency thing'.")
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.queryByText('Blocked')).toBeNull()
  })

  it('shows what a task waits on and what it unblocks, as cards under the header', async () => {
    const me = await createVolunteer()
    const sam = await createVolunteer({ name: 'Sam' })
    const project = await createProject({ status: 'in_progress' })
    const kit = await createTask(project.id, {
      title: 'Pack flyering stall kit',
      status: 'completed',
      assigneeId: sam.id,
      completedAt: new Date(),
    })
    const print = await createTask(project.id, {
      title: 'Print flyers',
      status: 'completed',
      completedAt: new Date(),
    })
    const flyering = await createTask(project.id, { title: 'Do the flyering', assigneeId: me.id })
    await prisma.workItemDependency.createMany({
      data: [
        { predecessorId: kit.id, successorId: flyering.id },
        { predecessorId: print.id, successorId: flyering.id },
      ],
    })

    await mount(project.id, flyering.id, me)
    const waitsOn = await screen.findByRole('region', { name: 'Waits on' })
    expect(
      within(waitsOn).getByText('Everything this waits on is done. You can start.'),
    ).toBeInTheDocument()
    expect(within(waitsOn).getAllByText('Done')).toHaveLength(2)
    // Everything done, each card is one compact line: no assignee, just when it finished.
    expect(within(waitsOn).queryByText('Sam')).toBeNull()
    expect(
      within(waitsOn).getByRole('link', { name: 'Pack flyering stall kit' }).parentElement,
    ).toHaveTextContent(/^Pack flyering stall kitDoneDone /)
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Unblocks' })).toBeNull()

    cleanup()
    await prisma.workItem.update({
      where: { id: print.id },
      data: { status: 'not_started', completedAt: null },
    })
    await mount(project.id, flyering.id, me)
    await screen.findByText('Waiting on 1 of 2.')
    const open = screen.getByRole('region', { name: 'Waits on' })
    expect(within(open).getByText('Sam')).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()

    // Started early, then all done: no "You can start".
    cleanup()
    await prisma.workItem.update({
      where: { id: print.id },
      data: { status: 'completed', completedAt: new Date() },
    })
    await prisma.workItem.update({ where: { id: flyering.id }, data: { status: 'in_progress' } })
    await mount(project.id, flyering.id, me)
    await screen.findByText('Everything this waits on is done.')

    cleanup()
    await mount(project.id, kit.id, me)
    const unblocks = await screen.findByRole('region', { name: 'Unblocks' })
    expect(
      within(unblocks).getByRole('link', { name: 'Do the flyering' }).parentElement,
    ).toHaveTextContent(/^Do the flyeringIn progress/)
    expect(screen.queryByRole('region', { name: 'Waits on' })).toBeNull()
    // A done task says nothing about starting; its cards stay, read-only.
    expect(screen.queryByText(/You can start|Waiting on/)).toBeNull()
  })

  it('queues work for the owner, who accepts it or asks for changes', async () => {
    const owner = await createVolunteer({ name: 'Ola Owner' })
    const me = await createVolunteer({ name: 'Hal Helper' })
    const project = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      autoAcceptTasks: false,
    })
    const task = await createTask(project.id, {
      title: 'Leaflet',
      status: 'in_progress',
      assigneeId: me.id,
      submissionAsksLink: true,
    })

    await mount(project.id, task.id, me)
    const box = await submitBox()
    expect(within(box).getByText(/The project owner will look at it/)).toBeInTheDocument()
    await userEvent.type(
      within(box).getByLabelText('Link to your work (optional)'),
      'https://example.org/leaflet',
    )
    await userEvent.click(within(box).getByRole('button', { name: 'Submit for review' }))
    await screen.findByText(/Submitted. The project owner will review it/)
    await screen.findByRole('link', { name: 'https://example.org/leaflet' })
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()

    cleanup()
    await mount(project.id, task.id, owner)
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for changes' }))
    const ask = await screen.findByRole('dialog', { name: 'Ask for changes' })
    expect(within(ask).getByText(/goes back to Hal Helper/)).toBeInTheDocument()
    // Enter can submit the form while Send back is disabled; nothing is sent.
    fireEvent.submit(within(ask).getByLabelText('What needs changing?').closest('form')!)
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ask for changes' }))
    const ask2 = await screen.findByRole('dialog', { name: 'Ask for changes' })
    await userEvent.type(within(ask2).getByLabelText('What needs changing?'), 'Add the date')
    await userEvent.click(within(ask2).getByRole('button', { name: 'Send back' }))
    await screen.findByText('Sent back to Hal Helper with your message.')
    await waitFor(async () =>
      expect(await row(task.id)).toMatchObject({
        status: 'in_progress',
        changesRequestedNote: 'Add the date',
      }),
    )

    cleanup()
    await mount(project.id, task.id, me)
    await screen.findByRole('heading', { name: 'Changes requested by Ola Owner' })
    expect(screen.getByText('Add the date')).toBeInTheDocument()
    const resubmit = await submitBox()
    await userEvent.type(within(resubmit).getByLabelText('What did you do?'), 'Dated it')
    await userEvent.click(within(resubmit).getByRole('button', { name: 'Submit for review' }))
    await screen.findByText(/Submitted. The project owner will review it/)
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Changes requested/ })).toBeNull(),
    )

    cleanup()
    await mount(project.id, task.id, owner)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await screen.findByText('Accepted. The task is done.')
    await waitFor(async () => expect((await row(task.id)).status).toBe('completed'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull())
  })

  it('reports submit and review failures', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const project = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      autoAcceptTasks: false,
    })
    const task = await createTask(project.id, { assigneeId: me.id })
    await mount(project.id, task.id, me)
    await screen.findByRole('button', { name: 'Start' })
    await prisma.workItem.update({ where: { id: task.id }, data: { status: 'in_progress' } })
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await screen.findByText('This task has already started')
    const box = await submitBox()
    await userEvent.type(within(box).getByLabelText('What did you do?'), 'Done')
    await prisma.workItem.update({ where: { id: task.id }, data: { status: 'completed' } })
    await userEvent.click(within(box).getByRole('button', { name: 'Submit for review' }))
    await screen.findByText('This task has already been submitted')

    cleanup()
    await prisma.workItem.update({ where: { id: task.id }, data: { status: 'under_review' } })
    await mount(project.id, task.id, owner)
    await screen.findByRole('button', { name: 'Accept' })
    await prisma.workItem.update({ where: { id: task.id }, data: { status: 'in_progress' } })
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await screen.findByText('This task is not waiting for review')
    await userEvent.click(screen.getByRole('button', { name: 'Ask for changes' }))
    const ask = await screen.findByRole('dialog', { name: 'Ask for changes' })
    await userEvent.type(within(ask).getByLabelText('What needs changing?'), 'x')
    await userEvent.click(within(ask).getByRole('button', { name: 'Send back' }))
    await waitFor(() =>
      expect(screen.getAllByText('This task is not waiting for review')).toHaveLength(2),
    )
  })

  it('shows a task, lets a volunteer claim it, and the owner edit it and manage dependencies', async () => {
    const owner = await createVolunteer({ name: 'Ola Owner' })
    const me = await createVolunteer()
    const project = await createProject({
      title: 'Parent',
      assigneeId: owner.id,
      status: 'in_progress',
    })
    const pred = await createTask(project.id, { title: 'Predecessor', sortOrder: 1 })
    const other = await createTask(project.id, { title: 'Other', sortOrder: 2 })
    const task = await createTask(project.id, {
      title: 'The task',
      description: 'Details',
      estimatedHours: 2,
      deadline: new Date('2030-01-01T00:00:00Z'),
      startDate: new Date('2029-12-01T00:00:00Z'),
      sortOrder: 3,
    })
    await prisma.workItemDependency.create({
      data: { predecessorId: pred.id, successorId: task.id, lagDays: 1 },
    })
    // Someone not on the project asks for a task: it is held for them, not given.
    const newcomer = await createVolunteer({ name: 'Nia Newcomer' })
    await mount(project.id, other.id, newcomer)
    await userEvent.click(await screen.findByRole('button', { name: 'Ask to take this' }))
    const askDialog = await screen.findByRole('dialog', { name: "Ask to take 'Other'?" })
    await userEvent.click(within(askDialog).getByRole('button', { name: 'Ask to take this' }))
    await screen.findByText(/^Requested\. The task is held for you/)
    await screen.findByText('Held for you until the owner accepts you onto the project.')
    expect(screen.queryByRole('button', { name: 'Ask to take this' })).toBeNull()
    cleanup()
    await mount(project.id, other.id, owner)
    await screen.findByText('Requested by Nia Newcomer, waiting for the owner.')
    cleanup()

    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: me.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await mount(project.id, task.id, me)
    await screen.findByRole('heading', { name: 'The task' })
    expect(screen.getByRole('link', { name: '← Back to Parent' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    )
    // Due, how far away and from when; the effort; who it is assigned to, top right.
    expect(screen.getByRole('group', { name: 'When it is due' })).toHaveTextContent(
      /^Due 1 Jan 2030 · in \d+ days \(from 1 Dec 2029\)Effort: about 2 hours$/,
    )
    // Nobody holds it: an empty chip, with Claim beside it rather than among the page's actions.
    const person = screen.getByText('Assigned to').parentElement!
    expect(person).toHaveTextContent(/^Assigned toUnclaimedClaim task$/)
    expect(within(person).getByRole('button', { name: 'Claim task' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'Actions' })).queryByRole('button', {
        name: 'Claim task',
      }),
    ).toBeNull()
    expect(screen.queryByText(/^(When|Who|Owner)$/)).toBeNull()
    // Its predecessor is not done, so it is Blocked, and says by what.
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText('Blocked by').parentElement).toHaveTextContent(
      "Blocked by 'Predecessor'",
    )
    // What it depends on is a work item card: its own status, who has it, when it is due.
    expect(screen.getByRole('link', { name: 'Predecessor' }).parentElement).toHaveTextContent(
      /^PredecessorReadyUnclaimedNo deadline$/,
    )
    // A link's lag still counts in the schedule, but the task page never shows or edits it.
    expect(screen.queryByText(/lag/i)).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    const rule =
      "Post an update within 14 days. With no update we'll remind you at 14 days, warn you at 21, and release the task at 28."
    // The inactivity rule isn't shown until the viewer claims; it lives in the confirm dialog.
    expect(screen.queryByText(rule)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Claim task' }))
    const dialog = await screen.findByRole('dialog', { name: "Claim 'The task'?" })
    expect(within(dialog).getByText(rule)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Claim task' }))
    await screen.findByText(
      'Task claimed. Post an update within 14 days; after 28 days with none, the task is released.',
    )
    // The assignee keeps the rule in view above the submit box, now that they can start the task.
    await submitBox()
    expect(screen.getByText(rule)).toBeInTheDocument()
    await waitFor(async () => expect((await row(task.id)).assigneeId).toBe(me.id))
    await waitFor(() =>
      expect(screen.getByText('Assigned to').parentElement).toHaveTextContent(
        `Assigned to${initials(me.name)}${me.name}· claimed on ${shortDay(new Date())}`,
      ),
    )
    // Claiming does not start it: still Blocked, with Start offered for prep.
    expect((await row(task.id)).status).toBe('not_started')
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()

    cleanup()
    await mount(project.id, task.id, owner)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const title = screen.getByLabelText('Task title')
    await userEvent.clear(title)
    // Enter submits the form even though Save is disabled; a blank title must not be sent.
    fireEvent.submit(title.closest('form')!)
    await userEvent.type(title, 'Renamed task')
    await userEvent.clear(screen.getByLabelText('Description'))
    await userEvent.clear(screen.getByLabelText('Effort: about'))
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Start (optional)'), { target: { value: '' } })
    expect(screen.getByText(/Starts when “Predecessor” is done/)).toBeInTheDocument()
    expect(screen.queryByText(/follow|lag|milestone/i)).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: /exact dates/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /quick task/i }))
    await userEvent.type(screen.getByLabelText('What to submit (optional)'), 'Photos of the stall')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ask for a link to the work' }))
    await userEvent.type(screen.getByLabelText('Helpers wanted (optional)'), '3')
    fireEvent.submit(title.closest('form')!)
    await screen.findByText('Task updated!')
    expect(await row(task.id)).toMatchObject({
      submissionPrompt: 'Photos of the stall',
      submissionAsksLink: true,
      helpersWanted: 3,
      title: 'Renamed task',
      description: null,
      estimatedHours: null,
      deadline: null,
      startDate: null,
      durationDays: null,
      featuredAsQuickTask: true,
      timing: 'fixed',
    })
    await screen.findByRole('heading', { name: 'Renamed task' })

    // The key date is set on the timeline; even its owner only sees it stated here.
    expect(screen.queryByRole('button', { name: /key date/ })).toBeNull()
    expect(screen.queryByText(/key date/i)).toBeNull()
    await prisma.workItem.update({ where: { id: task.id }, data: { isAnchor: true } })
    cleanup()
    await mount(project.id, task.id, owner)
    await screen.findByText('★ Key date: the date this project is planned around')
    expect(screen.queryByRole('button', { name: /key date/ })).toBeNull()

    // What it waits on is shown, not edited: links are changed on the timeline.
    expect(screen.getByRole('link', { name: 'Predecessor' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByLabelText('Add a dependency')).toBeNull()
    expect(screen.getByRole('link', { name: 'project timeline' })).toHaveAttribute(
      'href',
      `/projects/${project.id}#timeline`,
    )
  })

  it('leaves the task unclaimed when the claim confirm dialog is cancelled', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const task = await createTask(project.id, { title: 'Weed the beds' })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: me.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await mount(project.id, task.id, me)
    await userEvent.click(await screen.findByRole('button', { name: 'Claim task' }))
    const dialog = await screen.findByRole('dialog', { name: "Claim 'Weed the beds'?" })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Claim task' })).toBeInTheDocument()
    expect((await row(task.id)).assigneeId).toBeNull()
  })

  it('handles missing tasks and failures', async () => {
    const admin = await createAdmin()
    const project = await createProject({ title: 'Solo' })
    const only = await createTask(project.id, { title: 'Only task' })
    await mount(project.id, only.id, admin)
    await screen.findByRole('heading', { name: 'Only task' })
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await prisma.workItem.delete({ where: { id: only.id } })
    fireEvent.submit(screen.getByLabelText('Task title').closest('form')!)
    await screen.findByText('Project or task not found')
    cleanup()
    const done = await createTask(project.id, {
      title: 'Done one',
      status: 'completed',
      completedAt: new Date('2026-02-02T00:00:00Z'),
      startedAt: new Date('2026-02-01T00:00:00Z'),
    })
    await mount(project.id, done.id, admin)
    await waitFor(() =>
      expect(screen.getByText('Assigned to').parentElement).toHaveTextContent(
        /^Assigned toNo one· finished 2 Feb/,
      ),
    )
    cleanup()
    await mount(project.id, 999999, admin)
    await screen.findByRole('link', { name: 'Back to Project' })
    cleanup()
    await mount('x', 'y', admin)
    await screen.findByRole('link', { name: 'Back to Project' })
  })

  it('shows the shared not-found card for a task that is gone', async () => {
    const project = await createProject()
    await mount(project.id, 999_999, await createAdmin())
    await screen.findByRole('heading', { name: 'Task not found' })
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    expect(screen.getByRole('link', { name: 'Back to Project' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    )
  })
})

describe('task detail page — messaging the assignee', () => {
  it('offers Message to people on the project, not to outsiders or yourself', async () => {
    const owner = await createVolunteer()
    const assignee = await createVolunteer({ name: 'Ann' })
    const outsider = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const task = await createTask(project.id, { assigneeId: assignee.id, status: 'in_progress' })
    await mount(project.id, task.id, owner)
    await userEvent.click(await screen.findByRole('button', { name: 'Message Ann' }))
    const dialog = await screen.findByRole('dialog', { name: 'Message Ann' })
    await userEvent.type(within(dialog).getByLabelText('Subject'), 'Progress')
    await userEvent.type(within(dialog).getByLabelText('Message'), 'How is it going?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send Message' }))
    await screen.findByText(/Message sent/)
    expect(
      await prisma.message.findFirst({
        where: { fromVolunteerId: owner.id, toVolunteerId: assignee.id },
      }),
    ).toMatchObject({ subject: 'Progress', relatedWorkItemId: project.id })
    cleanup()

    // Not to yourself, and not from someone who does not work on the project.
    await mount(project.id, task.id, assignee)
    await screen.findByText(/^Ann\b/)
    expect(screen.queryByRole('button', { name: /^Message/ })).toBeNull()
    cleanup()
    await mount(project.id, task.id, outsider)
    await screen.findByText(/^Ann\b/)
    // The remount first shows the previous viewer's cached answer.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Message/ })).toBeNull())
  })
})

describe('task detail page — past plan', () => {
  const today = startOfUtcDay(new Date())

  /** Names carry `tag`, as the volunteers of every test in this file share one database. */
  async function lateTask(tag: string) {
    const owner = await createVolunteer({ name: `Olive Owner ${tag}` })
    const sam = await createVolunteer({ name: `Sam Slow ${tag}` })
    const pat = await createVolunteer({ name: `Pat Next ${tag}` })
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    const late = await createTask(project.id, {
      title: 'Book venue',
      status: 'in_progress',
      assigneeId: sam.id,
      startDate: addDays(today, -7),
      deadline: addDays(today, -3),
    })
    const next = await createTask(project.id, { title: 'Print flyers' })
    // Pinned to today, so a later end leaves it starting too early.
    const pinned = await createTask(project.id, { title: 'Set up stall', startDate: today })
    // The event, pinned tomorrow: a later end runs the prep past it.
    const event = await createTask(project.id, {
      title: 'Protest',
      startDate: addDays(today, 1),
      durationDays: 0,
      isAnchor: true,
    })
    await prisma.workItemDependency.createMany({
      data: [
        { predecessorId: late.id, successorId: next.id },
        { predecessorId: late.id, successorId: pinned.id },
        { predecessorId: late.id, successorId: event.id },
      ],
    })
    return { owner, sam, pat, project, late, next }
  }

  it('tells the assignee the owner knows, and gives the owner the decision', async () => {
    const { owner, sam, project, late } = await lateTask('A')
    await mount(project.id, late.id, sam)
    await screen.findByText(/3 days past plan\./)
    expect(screen.getByText(/The owner has been told/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Replan' })).toBeNull()
    cleanup()

    await mount(project.id, late.id, owner)
    const box = await screen.findByRole('region', { name: 'Past plan' })
    expect(box).toHaveTextContent('Sam Slow A has it.')
    await userEvent.click(within(box).getByRole('button', { name: 'Replan' }))
    const dialog = await screen.findByRole('dialog')
    // The default is a day from today; the preview names what moves with it.
    await within(dialog).findByText(/‘Print flyers’ moves \d+ days? later/)
    await userEvent.click(within(dialog).getByRole('button', { name: '+1 week' }))
    expect(within(dialog).getByLabelText('New deadline')).toHaveValue(
      toDateInputValue(addDays(today, 7)),
    )
    // The bar keeps its length and moves; a blank length disables the save.
    expect(within(dialog).getByLabelText('Days')).toHaveValue(5)
    fireEvent.change(within(dialog).getByLabelText('Days'), { target: { value: '' } })
    expect(within(dialog).getByRole('button', { name: 'Replan' })).toBeDisabled()
    fireEvent.submit(within(dialog).getByLabelText('Days').closest('form')!)
    fireEvent.change(within(dialog).getByLabelText('Days'), { target: { value: '5' } })
    // A date typed by hand moves the start with it.
    fireEvent.change(within(dialog).getByLabelText('New deadline'), {
      target: { value: toDateInputValue(addDays(today, 10)) },
    })
    expect(within(dialog).getByText(/so it starts/)).toHaveTextContent(
      formatDateShort(addDays(today, 6)),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: '+3 days' }))
    expect(within(dialog).getByText(/so it starts/)).toHaveTextContent(
      formatDateShort(addDays(today, -1)),
    )
    expect(within(dialog).getByText(/‘Set up stall’ is set to start \d+ days? too early/))
    expect(within(dialog).getByText(/prep for key date ‘Protest’ would finish \d+ days? after it/))
    await userEvent.type(within(dialog).getByLabelText('Why is the plan changing?'), 'venue')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replan' }))
    await screen.findByText(/^Replanned\. 'Book venue' now finishes/)
    // The Discussion shows the replan as a line, reason and all.
    await screen.findByText(/^Olive Owner.* replanned this to finish .*: venue · /)
    await waitFor(async () =>
      expect(await row(late.id)).toMatchObject({
        startDate: addDays(today, -1),
        deadline: addDays(today, 3),
        durationDays: null,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Past plan' })).toBeNull())
  })

  it('lets the owner reassign or unassign it, and cancel a replan', async () => {
    const { owner, pat, project, late } = await lateTask('B')
    await mount(project.id, late.id, owner)
    const box = await screen.findByRole('region', { name: 'Past plan' })
    await userEvent.click(within(box).getByRole('button', { name: 'Replan' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(within(box).getByRole('button', { name: 'Reassign to' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Pat Next B' }))
    await userEvent.click(within(box).getByRole('button', { name: 'Reassign' }))
    await screen.findByText('Reassigned. The previous assignee has been told.')
    await waitFor(async () => expect((await row(late.id)).assigneeId).toBe(pat.id))

    // A failed reassignment says why.
    await userEvent.click(within(box).getByRole('button', { name: 'Reassign to' }))
    await userEvent.click((await screen.findAllByRole('option', { name: 'Pat Next B' }))[0])
    await prisma.workItem.update({ where: { id: late.id }, data: { status: 'completed' } })
    await userEvent.click(within(box).getByRole('button', { name: 'Reassign' }))
    await screen.findByText('Reopen the task to change it')
    await prisma.workItem.update({ where: { id: late.id }, data: { status: 'in_progress' } })

    // Unassigned, the task is nobody's to be late with, so there is no decision left to make.
    await userEvent.click(await within(box).findByRole('button', { name: 'Unassign' }))
    await waitFor(async () => expect((await row(late.id)).assigneeId).toBeNull())
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Past plan' })).toBeNull())

    // A replan that fails says why.
    await prisma.workItem.update({
      where: { id: late.id },
      data: { status: 'in_progress', assigneeId: pat.id },
    })
    cleanup()
    await mount(project.id, late.id, owner)
    const again = await screen.findByRole('region', { name: 'Past plan' })
    await userEvent.click(within(again).getByRole('button', { name: 'Replan' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/moves \d+ days? later/)
    await userEvent.type(within(dialog).getByLabelText('Why is the plan changing?'), 'x')
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replan' }))
    await screen.findByText('Unauthorized')
  })
})

describe('task detail page — a done task', () => {
  it('is read-only, keeps what it waited on, and the owner reopens it', async () => {
    const owner = await createVolunteer({ name: 'Olive' })
    const sam = await createVolunteer({ name: 'Sam' })
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const before = await createTask(project.id, { title: 'Book hall', status: 'completed' })
    const task = await createTask(project.id, {
      title: 'Print flyers',
      status: 'completed',
      assigneeId: sam.id,
      completedAt: new Date(),
    })
    await prisma.workItemDependency.create({
      data: { predecessorId: before.id, successorId: task.id },
    })

    await mount(project.id, task.id, sam)
    await screen.findByRole('heading', { name: 'Print flyers' })
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()

    cleanup()
    await mount(project.id, task.id, owner)
    const reopen = await screen.findByRole('button', { name: 'Reopen' })
    expect(screen.getByRole('link', { name: /Book hall/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'project timeline' })).toBeNull()

    await userEvent.click(reopen)
    const dialog = await screen.findByRole('dialog', { name: "Reopen 'Print flyers'?" })
    expect(
      within(dialog).getByText('It goes back to In progress for Sam and can be edited again.'),
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    const confirm = await screen.findByRole('dialog', { name: "Reopen 'Print flyers'?" })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Reopen' }))
    await screen.findByText('Reopened. It can be edited again.')
    expect(await row(task.id)).toMatchObject({ status: 'in_progress', completedAt: null })
    await screen.findByRole('link', { name: 'project timeline' })
    const bar = screen.getByRole('toolbar', { name: 'Status and actions' })
    expect(within(bar).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(within(bar).queryByRole('button', { name: 'Reopen' })).toBeNull()
    await screen.findByText(/^Olive reopened this · /)
  })

  it('says when a task nobody holds goes back, and reports a failed reopen', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const task = await createTask(project.id, { title: 'Sweep up', status: 'completed' })
    await mount(project.id, task.id, owner)
    await userEvent.click(await screen.findByRole('button', { name: 'Reopen' }))
    const dialog = await screen.findByRole('dialog', { name: "Reopen 'Sweep up'?" })
    expect(
      within(dialog).getByText('It goes back to Not started and can be edited again.'),
    ).toBeInTheDocument()
    // Someone else reopened it first.
    await prisma.workItem.update({ where: { id: task.id }, data: { status: 'not_started' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen' }))
    await screen.findByText('This task is not done')
  })
})

describe('task detail page — a completed project', () => {
  it('is read-only for its assignee, and the owner reopens the project from here', async () => {
    const owner = await createVolunteer({ name: 'Olive' })
    const sam = await createVolunteer({ name: 'Sam' })
    const project = await createProject({
      title: 'Finished campaign',
      assigneeId: owner.id,
      status: 'completed',
      completedAt: new Date('2026-09-30T12:00:00Z'),
    })
    const task = await createTask(project.id, {
      title: 'Print flyers',
      status: 'not_started',
      assigneeId: sam.id,
    })

    await mount(project.id, task.id, sam)
    await screen.findByText('Completed on 30 September 2026. Read-only.')
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Submit your work' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reopen project' })).toBeNull()

    cleanup()
    await mount(project.id, task.id, owner)
    await screen.findByText('Completed on 30 September 2026. Read-only.')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Reopen project' }))
    const ask = await screen.findByRole('dialog', { name: "Reopen 'Finished campaign'?" })
    await userEvent.click(within(ask).getByRole('button', { name: 'Reopen' }))
    await screen.findByText('Reopened. The project can be changed again.')
    expect(await row(project.id)).toMatchObject({ status: 'in_progress' })
    await screen.findByRole('button', { name: 'Edit' })
    expect(screen.queryByText(/Read-only/)).toBeNull()
  })

  it('offers an admin Reopen, but not a deputy', async () => {
    const owner = await createVolunteer()
    const deputy = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'archived' })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: deputy.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: deputy.id } })
    const task = await createTask(project.id, { title: 'Sweep up' })

    await mount(project.id, task.id, deputy)
    await screen.findByText('Archived. Read-only.')
    expect(screen.queryByRole('button', { name: 'Reopen project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Claim task' })).toBeNull()

    cleanup()
    await mount(project.id, task.id, await createAdmin())
    await screen.findByText('Archived. Read-only.')
    await screen.findByRole('button', { name: 'Reopen project' })
  })

  it('lets members join as helpers beside the lead, leave, and be removed', async () => {
    const owner = await createVolunteer({ name: 'Olive Owner' })
    const lead = await createVolunteer({ name: 'Lee Lead' })
    const ann = await createVolunteer({ name: 'Ann Helper' })
    const bob = await createVolunteer({ name: 'Bob Late' })
    const project = await createProject({ status: 'in_progress', assigneeId: owner.id })
    for (const m of [lead, ann, bob]) {
      await prisma.workItemInterest.create({
        data: {
          workItemId: project.id,
          volunteerId: m.id,
          interestType: 'want_to_contribute',
          status: 'accepted',
        },
      })
    }
    const task = await createTask(project.id, {
      title: 'Flyering',
      assigneeId: lead.id,
      helpersWanted: 2,
    })
    const helpers = () => screen.getByRole('region', { name: 'Helpers' })

    await mount(project.id, task.id, ann)
    await screen.findByRole('heading', { name: 'Flyering' })
    // A task worked by several people names its lead.
    expect(screen.getByText('Lead').parentElement).toHaveTextContent('Lee Lead')
    expect(screen.getByRole('link', { name: 'Lee Lead' })).toHaveAttribute(
      'href',
      `/volunteers/${lead.id}`,
    )
    expect(within(helpers()).getByText('2 helpers wanted')).toBeInTheDocument()
    // Join as helper sits on the line under the lead, with how many helpers it wants; not among
    // the page's actions, nor in the Helpers box.
    const person = screen.getByText('Lead').parentElement!.parentElement!
    expect(within(person).getByText('2 helpers wanted')).toBeInTheDocument()
    expect(within(person).getByRole('button', { name: 'Join as helper' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'Actions' })).queryByRole('button', {
        name: 'Join as helper',
      }),
    ).toBeNull()
    expect(within(helpers()).queryByRole('button', { name: 'Join as helper' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Join as helper' }))
    await screen.findByText("You're helping on this task")
    await within(helpers()).findByText('1 helper (1 more wanted)')
    expect(within(helpers()).getByText('Ann Helper')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join as helper' })).toBeNull()
    // Withdrawing is the `×` on the helper's own chip, not a button among the page's actions.
    expect(
      within(screen.getByRole('group', { name: 'Actions' })).queryByRole('button', {
        name: /Withdraw|Stop helping/,
      }),
    ).toBeNull()
    const ownChip = within(helpers()).getByText('Ann Helper').closest('li')!
    await userEvent.click(within(ownChip).getByRole('button', { name: 'Withdraw from helping' }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Withdraw from this task?' })).getByRole(
        'button',
        { name: 'Withdraw' },
      ),
    )
    await screen.findByText('You are no longer helping on this task')
    await waitFor(async () =>
      expect(
        (
          await prisma.workItemInterest.findUniqueOrThrow({
            where: { volunteerId_workItemId: { volunteerId: ann.id, workItemId: task.id } },
          })
        ).status,
      ).toBe('withdrawn'),
    )
    await screen.findByRole('button', { name: 'Join as helper' })

    // The last place goes while Bob has the page open.
    await prisma.workItem.update({ where: { id: task.id }, data: { helpersWanted: 1 } })
    cleanup()
    await mount(project.id, task.id, bob)
    const joinButton = await screen.findByRole('button', { name: 'Join as helper' })
    await clientJoin(ann.id, task.id)
    await userEvent.click(joinButton)
    await screen.findByText('This task has all the helpers it wants')

    // The lead takes a helper off, after saying so.
    cleanup()
    await mount(project.id, task.id, lead)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Ann Helper' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove Ann Helper?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ann Helper' }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Remove Ann Helper?' })).getByRole(
        'button',
        { name: 'Remove' },
      ),
    )
    await screen.findByText('Helper removed')
    await within(helpers()).findByText('1 helper wanted')

    // The owner adds Bob directly, with no apply-and-accept step.
    cleanup()
    queryClient.clear()
    await mount(project.id, task.id, owner)
    await screen.findByRole('heading', { name: 'Flyering' })
    await userEvent.click(
      within(helpers()).getByRole('button', { name: 'Add a member as a helper' }),
    )
    await userEvent.type(screen.getByRole('searchbox', { name: 'Add a member as a helper' }), 'Bob')
    await userEvent.click(screen.getByRole('option', { name: 'Bob Late' }))
    await within(helpers()).findByText('1 helper')
    expect(within(helpers()).getByText('Bob Late')).toBeInTheDocument()
    expect(within(helpers()).queryByLabelText('Add a member as a helper')).toBeNull()
  })

  it('shows the server error when withdrawing from helping fails', async () => {
    const lead = await createVolunteer({ name: 'Lee Lead' })
    const ann = await createVolunteer({ name: 'Ann Helper' })
    const project = await createProject({ status: 'in_progress' })
    for (const m of [lead, ann]) {
      await prisma.workItemInterest.create({
        data: {
          workItemId: project.id,
          volunteerId: m.id,
          interestType: 'want_to_contribute',
          status: 'accepted',
        },
      })
    }
    const task = await createTask(project.id, {
      title: 'Flyering',
      assigneeId: lead.id,
      helpersWanted: 1,
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: task.id,
        volunteerId: ann.id,
        interestType: 'want_to_help_task',
        status: 'accepted',
      },
    })

    await mount(project.id, task.id, ann)
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw from helping' }))
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw from this task?' })
    // Already gone by the time it's confirmed — the server rejects it as NOT_FOUND.
    await prisma.workItemInterest.delete({
      where: { volunteerId_workItemId: { volunteerId: ann.id, workItemId: task.id } },
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }))
    await screen.findByText('You are not helping on this task')
  })
})

/** Puts someone on a task's helpers directly, as another tab would. */
const clientJoin = (volunteerId: number, workItemId: number) =>
  prisma.workItemInterest.update({
    where: { volunteerId_workItemId: { volunteerId, workItemId } },
    data: { status: 'accepted' },
  })
