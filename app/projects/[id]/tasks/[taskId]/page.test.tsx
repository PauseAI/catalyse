import { describe, it, expect } from 'vitest'
import { screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createAdmin, createProject, createTask } from '@/test/factories'
import { renderApp } from '@/test/render'
import { addDays, startOfUtcDay } from '@/lib/schedule'
import { toDateInputValue } from '@/lib/format-date'
import TaskDetailPage from './page'

const row = (id: number) => prisma.workItem.findUniqueOrThrow({ where: { id } })
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
  it('lets the assignee submit their work, and reads Claimed on until they post an update', async () => {
    const me = await createVolunteer()
    const someoneElse = await createVolunteer()
    const project = await createProject({ status: 'in_progress' })
    const task = await createTask(project.id, {
      title: 'Mine',
      status: 'in_progress',
      assigneeId: me.id,
      startedAt: new Date('2030-01-02T00:00:00Z'),
    })
    await mount(project.id, task.id, someoneElse)
    await screen.findByRole('heading', { name: 'Mine' })
    expect(screen.queryByRole('button', { name: 'Submit work' })).toBeNull()

    cleanup()
    await mount(project.id, task.id, me)
    await screen.findByText(/claimed on 2 Jan 2030/)
    await prisma.workItemComment.create({
      data: { workItemId: task.id, authorId: me.id, content: 'Going well' },
    })
    cleanup()
    await mount(project.id, task.id, me)
    await screen.findByText(/started 2 Jan 2030/)

    // A project with no owner to review it takes the work as done.
    await userEvent.click(screen.getByRole('button', { name: 'Submit work' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your work' })
    expect(within(dialog).getByText(/This marks the task done/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit work' }))
    const again = await screen.findByRole('dialog', { name: 'Submit your work' })
    await userEvent.click(within(again).getByRole('button', { name: 'Submit work' }))
    expect(within(again).getByText('Say what you did or add a link to it.')).toBeInTheDocument()
    await userEvent.type(within(again).getByLabelText('Link to your work (optional)'), 'x.org')
    expect(within(again).queryByText('Say what you did or add a link to it.')).toBeNull()
    await userEvent.click(within(again).getByRole('button', { name: 'Submit work' }))
    expect(within(again).getByText('A link starts with https:// or http://')).toBeInTheDocument()
    await userEvent.clear(within(again).getByLabelText('Link to your work (optional)'))
    await userEvent.type(within(again).getByLabelText('What did you do?'), 'Wrote it up')
    expect(within(again).queryByText('Say what you did or add a link to it.')).toBeNull()
    await userEvent.click(within(again).getByRole('button', { name: 'Submit work' }))
    await screen.findByText('Task done. What you did is saved on the task.')
    await waitFor(async () => expect((await row(task.id)).status).toBe('completed'))
    await screen.findByRole('heading', { name: 'Submitted work' })
    expect(screen.getByText('Wrote it up')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit work' })).toBeNull()
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
    })

    await mount(project.id, task.id, me)
    await userEvent.click(await screen.findByRole('button', { name: 'Submit work' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your work' })
    expect(within(dialog).getByText(/The project owner will look at it/)).toBeInTheDocument()
    await userEvent.type(
      within(dialog).getByLabelText('Link to your work (optional)'),
      'https://example.org/leaflet',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit work' }))
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
    await userEvent.click(await screen.findByRole('button', { name: 'Submit work' }))
    const resubmit = await screen.findByRole('dialog', { name: 'Submit your work' })
    await userEvent.type(within(resubmit).getByLabelText('What did you do?'), 'Dated it')
    await userEvent.click(within(resubmit).getByRole('button', { name: 'Submit work' }))
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
    const task = await createTask(project.id, { status: 'in_progress', assigneeId: me.id })
    await mount(project.id, task.id, me)
    await userEvent.click(await screen.findByRole('button', { name: 'Submit work' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your work' })
    await userEvent.type(within(dialog).getByLabelText('What did you do?'), 'Done')
    await prisma.workItem.update({ where: { id: task.id }, data: { status: 'open' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit work' }))
    await screen.findByText('Only a task in progress can be submitted')

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
      durationDays: 1,
      sortOrder: 3,
    })
    await prisma.workItemDependency.create({
      data: { predecessorId: pred.id, successorId: task.id, lagDays: 1 },
    })
    // Someone not on the project asks for a task: it is held for them, not given.
    const newcomer = await createVolunteer({ name: 'Nia Newcomer' })
    await mount(project.id, other.id, newcomer)
    await userEvent.click(await screen.findByRole('button', { name: 'Claim' }))
    await screen.findByText(/^Requested\. The task is held for you/)
    await screen.findByText('Held for you until the owner accepts you onto the project.')
    expect(screen.queryByRole('button', { name: 'Claim' })).toBeNull()
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
    // When, Deadline and Who, in the words the Dates block uses.
    expect(screen.getByText('When').nextSibling).toHaveTextContent(
      '1 Dec 2029Any time that day, about 2 hours of work',
    )
    expect(screen.getByText('Deadline').nextSibling).toHaveTextContent(
      '1 Jan 2030 · 31 days to spare',
    )
    expect(screen.getByText('Who').nextSibling).toHaveTextContent('Nobody yet')
    expect(screen.getByRole('link', { name: 'Predecessor' })).toBeInTheDocument()
    const depRow = (name: string) => screen.getByRole('link', { name }).closest('li') as HTMLElement
    expect(within(depRow('Predecessor')).getByRole('spinbutton')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    const rule =
      "Post an update within 14 days. With no update we'll remind you at 14 days, warn you at 21, and release the task at 28."
    expect(screen.getByText(rule)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }))
    await screen.findByText(
      'Task claimed. Post an update within 14 days; after 28 days with none, the task is released.',
    )
    // The assignee keeps the rule in view beside Submit work.
    await screen.findByRole('button', { name: 'Submit work' })
    expect(screen.getByText(rule)).toBeInTheDocument()
    await waitFor(async () => expect((await row(task.id)).assigneeId).toBe(me.id))
    await screen.findByText(`${me.name}, claimed on`, { exact: false })

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
    await userEvent.clear(screen.getByLabelText('Effort (hours of work)'))
    fireEvent.change(screen.getByLabelText('Deadline (optional)'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } })
    expect(screen.getByText(/Starts when “Predecessor” finishes/)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Days'))
    // On set dates there is no deadline to set: the dates are the commitment.
    await userEvent.click(screen.getByRole('radio', { name: /On set dates/ }))
    expect(screen.queryByLabelText('Deadline (optional)')).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: /quick task/i }))
    fireEvent.submit(title.closest('form')!)
    await screen.findByText('Task updated!')
    expect(await row(task.id)).toMatchObject({
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

    // The owner can make a task the key date, and everyone then sees it marked.
    await userEvent.click(screen.getByRole('button', { name: 'Make this the key date' }))
    await screen.findByText('★ Key date: the date this project is planned around')
    expect((await row(task.id)).isAnchor).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Stop using this as the key date' }))
    await screen.findByRole('button', { name: 'Make this the key date' })
    expect((await row(task.id)).isAnchor).toBe(false)

    // Lag edits write only on change; dependencies can be removed and added.
    const lag = within(depRow('Predecessor')).getByRole('spinbutton')
    fireEvent.change(lag, { target: { value: '1' } })
    fireEvent.blur(lag)
    fireEvent.change(lag, { target: { value: '' } })
    fireEvent.blur(lag)
    await waitFor(async () =>
      expect(
        (await prisma.workItemDependency.findFirstOrThrow({ where: { successorId: task.id } }))
          .lagDays,
      ).toBe(0),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await screen.findByText('Dependency removed')
    fireEvent.submit(screen.getByLabelText('Lag (days)').closest('form')!)
    await userEvent.selectOptions(
      await screen.findByLabelText('Add a dependency'),
      String(other.id),
    )
    await userEvent.type(screen.getByLabelText('Lag (days)'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await screen.findByText('Dependency added')
    expect(
      await prisma.workItemDependency.findFirst({
        where: { predecessorId: other.id, successorId: task.id },
      }),
    ).toMatchObject({ lagDays: 2 })
  })

  it('handles missing tasks, the no-sibling case, and failures', async () => {
    const admin = await createAdmin()
    const project = await createProject({ title: 'Solo' })
    const only = await createTask(project.id, { title: 'Only task' })
    await mount(project.id, only.id, admin)
    await screen.findByRole('heading', { name: 'Only task' })
    expect(screen.getByText(/no other tasks/i)).toBeInTheDocument()
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
    await screen.findByText('Finished 2 Feb 2026')
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

  it('reports dependency failures', async () => {
    const admin = await createAdmin()
    const project = await createProject({ title: 'Deps' })
    const a = await createTask(project.id, { title: 'A' })
    const b = await createTask(project.id, { title: 'B' })
    const dep = await prisma.workItemDependency.create({
      data: { predecessorId: a.id, successorId: b.id },
    })
    await mount(project.id, b.id, admin)
    await screen.findByRole('heading', { name: 'B' })
    await prisma.workItemDependency.delete({ where: { id: dep.id } })
    const lag = within(
      screen.getByRole('link', { name: 'A' }).closest('li') as HTMLElement,
    ).getByRole('spinbutton')
    fireEvent.change(lag, { target: { value: '3' } })
    fireEvent.blur(lag)
    await screen.findByText('Dependency not found')
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.getAllByText('Dependency not found')).toHaveLength(2))
    // The task still lists A as a predecessor (stale), so add a fresh sibling and loop through it.
    const c = await createTask(project.id, { title: 'C' })
    await prisma.workItemDependency.create({ data: { predecessorId: b.id, successorId: c.id } })
    cleanup()
    await mount(project.id, b.id, admin)
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Add a dependency')).getByRole('option', { name: 'C' }),
      ).toBeInTheDocument(),
    )
    await userEvent.selectOptions(screen.getByLabelText('Add a dependency'), String(c.id))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await screen.findByText(/would create a loop/)
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
      durationDays: 5,
      deadline: addDays(today, -1),
    })
    const next = await createTask(project.id, { title: 'Print flyers', durationDays: 2 })
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
    expect(within(dialog).getByText(/after the task’s deadline/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '+1 week' }))
    expect(within(dialog).getByLabelText('New planned end')).toHaveValue(
      toDateInputValue(addDays(today, 7)),
    )
    // Before the task starts: refused, and nothing to save.
    fireEvent.change(within(dialog).getByLabelText('New planned end'), {
      target: { value: toDateInputValue(addDays(today, -30)) },
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('That is before the task starts.')
    expect(within(dialog).getByRole('button', { name: 'Replan' })).toBeDisabled()
    fireEvent.submit(within(dialog).getByLabelText('New planned end').closest('form')!)
    await userEvent.click(within(dialog).getByRole('button', { name: '+3 days' }))
    expect(within(dialog).getByText(/‘Set up stall’ is set to start \d+ days? too early/))
    expect(within(dialog).getByText(/prep for key date ‘Protest’ would finish \d+ days? after it/))
    await userEvent.type(within(dialog).getByLabelText('Why is the plan changing?'), 'venue')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replan' }))
    await screen.findByText(/^Replanned\. 'Book venue' now finishes/)
    await waitFor(async () => expect((await row(late.id)).durationDays).toBe(11))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Past plan' })).toBeNull())
  })

  it('lets the owner reassign or release it, and cancel a replan', async () => {
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
    await screen.findByText('Cannot assign a completed task')
    await prisma.workItem.update({ where: { id: late.id }, data: { status: 'in_progress' } })

    // Released, the task is nobody's to be late with, so there is no decision left to make.
    await userEvent.click(await within(box).findByRole('button', { name: 'Release' }))
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
