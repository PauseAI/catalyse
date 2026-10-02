import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent, cleanup, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createQuickTask,
  createSkill,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import QuickTasksPage from './page'

const row = (id: number) => prisma.workItem.findUniqueOrThrow({ where: { id } })

describe('quick tasks — volunteer view', () => {
  it('lists my tasks and the open pool, claims and submits', async () => {
    const me = await createVolunteer()
    const skill = await createSkill()
    const project = await createProject({ title: 'Host project' })
    const mine = await createQuickTask({
      title: 'Mine in progress',
      description: 'Post drafts at https://example.org/drafts.',
      assigneeId: me.id,
      status: 'in_progress',
      skillId: skill.id,
      estimatedHours: 2,
      contextProjectId: project.id,
      changesRequestedNote: 'Add a photo',
      deadline: new Date('2020-01-02T00:00:00Z'),
    })
    await createQuickTask({
      title: 'Mine done',
      assigneeId: me.id,
      status: 'completed',
      description: null,
      deadline: new Date('2020-01-02T00:00:00Z'),
    })
    const open = await createQuickTask({
      title: 'Open quick',
      skillId: skill.id,
      estimatedHours: 1,
      deadline: new Date('2099-03-04T00:00:00Z'),
    })
    const featured = await createTask(project.id, {
      title: 'Featured task',
      featuredAsQuickTask: true,
      estimatedHours: 3,
      deadline: new Date('2099-05-06T00:00:00Z'),
    })
    await renderApp(<QuickTasksPage />, { as: me })
    const myList = (await screen.findByRole('heading', { name: 'My Quick Tasks' })).closest(
      'section',
    )!
    await within(myList).findByText('Mine in progress')
    expect(within(myList).getByText('Related: Host project')).toBeInTheDocument()
    expect(within(myList).getByText('~2h')).toBeInTheDocument()
    // The shared vocabulary, on every screen that shows one of these.
    const myCard = (title: string) =>
      within(within(myList).getByText(title).closest('[role=article]')!)
    expect(myCard('Mine in progress').getByRole('status')).toHaveTextContent('In progress')
    expect(myCard('Mine done').getByRole('status')).toHaveTextContent('Done')
    // Overdue only while the work is not done.
    expect(myCard('Mine in progress').getByText('Overdue')).toBeInTheDocument()
    expect(myCard('Mine done').getByText('Deadline 2 Jan 2020')).toBeInTheDocument()
    expect(myCard('Mine done').queryByText('Overdue')).toBeNull()
    // Opens on my own tasks; the open pool is the other tab.
    expect(screen.getByRole('tab', { name: 'Mine (2)' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('Browse Quick Tasks')).toBeNull()
    await userEvent.click(await screen.findByRole('tab', { name: 'Open (2)' }))
    const browse = screen.getByText('Browse Quick Tasks').closest('section')!
    await within(browse).findByText('Open quick')
    expect(within(browse).getByText('Deadline 4 Mar 2099')).toBeInTheDocument()
    expect(within(browse).getByText('Deadline 6 May 2099')).toBeInTheDocument()
    expect(
      within(within(browse).getByText('Open quick').closest('[role=article]')!).getByRole('status'),
    ).toHaveTextContent('Open')
    expect(
      within(within(browse).getByText('Featured task').closest('[role=article]')!).getByRole(
        'status',
      ),
    ).toHaveTextContent('Not started')
    expect(within(browse).getByRole('link', { name: 'Host project' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /^Mine/ }))
    const mineAgain = (await screen.findByRole('heading', { name: 'My Quick Tasks' })).closest(
      'section',
    )!
    const myCard2 = (title: string) =>
      within(within(mineAgain).getByText(title).closest('[role=article]')!)

    expect(
      myCard2('Mine in progress').getByRole('link', { name: 'https://example.org/drafts' }),
    ).toHaveAttribute('target', '_blank')
    expect(myCard2('Mine in progress').getByText('Add a photo')).toBeInTheDocument()
    await userEvent.click(within(mineAgain).getByRole('button', { name: 'Submit work' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your work' })
    expect(within(dialog).getByText(/An admin will look at it/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('What did you do?'), 'Took the photo')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit work' }))
    await screen.findByText(/Submitted\. An admin will review it/)
    await waitFor(async () =>
      expect(await row(mine.id)).toMatchObject({
        status: 'under_review',
        submissionNote: 'Took the photo',
        changesRequestedNote: null,
      }),
    )

    const openTab = () => screen.getByRole('tab', { name: /^Open/ })
    await userEvent.click(openTab())
    const cardFor = (title: string) =>
      within(screen.getByText('Browse Quick Tasks').closest('section')!)
        .getByText(title)
        .closest('[role=article]') as HTMLElement
    await userEvent.click(within(cardFor('Open quick')).getByRole('button', { name: 'Claim' }))
    await screen.findByText(/Task claimed\. Submit it for review/)
    await waitFor(async () => expect((await row(open.id)).assigneeId).toBe(me.id))
    // A claim shows the task in my list.
    expect(screen.getByRole('tab', { name: /^Mine/ })).toHaveAttribute('aria-selected', 'true')
    await screen.findByRole('heading', { name: 'My Quick Tasks' })
    await userEvent.click(openTab())
    await userEvent.click(within(cardFor('Featured task')).getByRole('button', { name: 'Claim' }))
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(`/projects/${project.id}/tasks/${featured.id}`),
    )
    // Not on the project yet, so the task is held for me until the owner accepts me.
    await screen.findByText(/^Requested\. The task is held for you/)
    expect(await row(featured.id)).toMatchObject({ assigneeId: null, requestedById: me.id })
  })

  it('shows empty states and reports failures', async () => {
    const me = await createVolunteer()
    await renderApp(<QuickTasksPage />, { as: me })
    await screen.findByText('No open Quick Tasks right now')
    await userEvent.click(screen.getByRole('tab', { name: 'Mine' }))
    await screen.findByText('No tasks assigned yet')
    await userEvent.click(screen.getByRole('button', { name: 'See open tasks' }))
    await screen.findByText('No open Quick Tasks right now')
    cleanup()
    const mine = await createQuickTask({
      title: 'Fragile',
      assigneeId: me.id,
      status: 'in_progress',
    })
    const open = await createQuickTask({ title: 'Taken', description: null })
    const project = await createProject()
    const featured = await createTask(project.id, { title: 'Gone', featuredAsQuickTask: true })
    await renderApp(<QuickTasksPage />, { as: me })
    await userEvent.click(await screen.findByRole('tab', { name: /^Open \(/ }))
    await screen.findByText('Taken')
    const rival = await createVolunteer()
    await prisma.workItem.update({
      where: { id: open.id },
      data: { assigneeId: rival.id, status: 'in_progress' },
    })
    const browse = screen.getByText('Browse Quick Tasks').closest('section')!
    const cardFor = (title: string) =>
      within(browse).getByText(title).closest('[role=article]') as HTMLElement
    await userEvent.click(within(cardFor('Taken')).getByRole('button', { name: 'Claim' }))
    await screen.findByText('This task has already been claimed')
    await prisma.workItem.delete({ where: { id: featured.id } })
    await userEvent.click(within(cardFor('Gone')).getByRole('button', { name: 'Claim' }))
    await screen.findByText('Project or task not found')
    await prisma.workItem.delete({ where: { id: mine.id } })
    await userEvent.click(screen.getByRole('tab', { name: /^Mine/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Submit work' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your work' })
    await userEvent.type(within(dialog).getByLabelText('What did you do?'), 'Done')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit work' }))
    await screen.findByText('Task not found or not assigned to you')
    // The dialog stays open, so what was typed is not lost.
    expect(screen.getByRole('dialog', { name: 'Submit your work' })).toBeInTheDocument()
  })
})

describe('quick tasks — admin view', () => {
  it('creates, edits, assigns, unassigns, reviews and deletes quick tasks', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer({ name: 'Zara Volunteer' })
    const skill = await createSkill()
    const underReview = await createQuickTask({
      title: 'Under review',
      assigneeId: vol.id,
      status: 'under_review',
      creatorId: admin.id,
      reviewNotes: 'old notes',
      submissionUrl: 'https://example.org/work',
      submittedAt: new Date(),
    })
    const sendBack = await createQuickTask({
      title: 'Send back',
      assigneeId: vol.id,
      status: 'under_review',
      submissionNote: 'First draft',
      submittedAt: new Date(),
    })
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
    await renderApp(<QuickTasksPage />, { as: admin, url: `/quick-tasks#task-${underReview.id}` })
    await screen.findByText('Under review')
    // Deep links scroll to the card; other hashes are ignored.
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    act(() => {
      window.location.hash = `#task-${underReview.id}`
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(scroll).toHaveBeenCalled()
    act(() => {
      window.location.hash = '#other'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    await userEvent.click(screen.getByRole('button', { name: 'Create Task' }))
    await userEvent.type(screen.getByLabelText('Title'), 'Fresh task')
    await userEvent.type(screen.getByLabelText('Description'), 'Do the thing')
    await userEvent.click(screen.getByRole('button', { name: 'Skill Being Tested' }))
    await userEvent.click(screen.getByRole('option', { name: new RegExp(skill.name) }))
    await userEvent.type(screen.getByLabelText('Estimated Hours'), '1.5')
    fireEvent.change(screen.getByLabelText('Deadline (optional)'), {
      target: { value: '2020-01-02' },
    })
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!)
    await screen.findByText('Task created!')
    const fresh = await prisma.workItem.findFirstOrThrow({ where: { title: 'Fresh task' } })
    expect(fresh).toMatchObject({
      skillId: skill.id,
      estimatedHours: 1.5,
      deadline: new Date('2020-01-02T00:00:00Z'),
    })
    const freshCard = () => screen.getByText('Fresh task').closest('[role=article]') as HTMLElement
    // A deadline that has passed on an open task flags it Overdue.
    await screen.findByText('Fresh task')
    expect(within(freshCard()).getByText('Deadline 2 Jan 2020')).toBeInTheDocument()
    expect(within(freshCard()).getByText('Overdue')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Submitted (needs review)' }))
    await waitFor(() => expect(screen.queryByText('Fresh task')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Status' }))
    await userEvent.click(screen.getByRole('option', { name: 'All' }))
    await screen.findByText('Fresh task')

    await userEvent.click(within(freshCard()).getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(freshCard()).getByRole('button', { name: 'Edit' }))
    const editTitle = screen.getByLabelText('Title')
    await userEvent.clear(editTitle)
    await userEvent.type(editTitle, 'Edited task')
    await userEvent.type(screen.getByLabelText('Description'), ' more')
    await userEvent.click(screen.getByRole('button', { name: 'Skill Being Tested' }))
    await userEvent.click(screen.getByRole('option', { name: 'None specific' }))
    await userEvent.clear(screen.getByLabelText('Estimated Hours'))
    expect(screen.getByLabelText('Deadline (optional)')).toHaveValue('2020-01-02')
    fireEvent.change(screen.getByLabelText('Deadline (optional)'), { target: { value: '' } })
    fireEvent.submit(editTitle.closest('form')!)
    await screen.findByText('Task updated!')
    expect(await row(fresh.id)).toMatchObject({
      title: 'Edited task',
      skillId: null,
      estimatedHours: null,
      deadline: null,
    })
    await screen.findByText('Edited task')
    const editedCard = () =>
      screen.getByText('Edited task').closest('[role=article]') as HTMLElement

    await userEvent.click(within(editedCard()).getByRole('button', { name: 'Copy share link' }))
    await screen.findByText('Link copied!')

    expect(within(editedCard()).getByRole('button', { name: 'Assign' })).toBeDisabled()
    await userEvent.click(
      within(editedCard()).getByRole('button', { name: 'Assign volunteer to Edited task' }),
    )
    await userEvent.click(await screen.findByRole('option', { name: 'Zara Volunteer' }))
    await userEvent.click(within(editedCard()).getByRole('button', { name: 'Assign' }))
    await screen.findByText('Task assigned!')
    await waitFor(async () => expect((await row(fresh.id)).assigneeId).toBe(vol.id))
    await userEvent.click(await within(editedCard()).findByRole('button', { name: 'Unassign' }))
    await screen.findByText('Assignee removed')
    await waitFor(async () => expect((await row(fresh.id)).assigneeId).toBeNull())

    const backCard = () => screen.getByText('Send back').closest('[role=article]') as HTMLElement
    expect(within(backCard()).getByText('First draft')).toBeInTheDocument()
    await userEvent.click(within(backCard()).getByRole('button', { name: 'Ask for changes' }))
    const ask = await screen.findByRole('dialog', { name: 'Ask for changes' })
    await userEvent.type(within(ask).getByLabelText('What needs changing?'), 'Needs sources')
    await userEvent.click(within(ask).getByRole('button', { name: 'Send back' }))
    await screen.findByText('Sent back to Zara Volunteer with your message.')
    await within(backCard()).findByRole('heading', { name: `Changes requested by ${admin.name}` })
    expect((await row(sendBack.id)).status).toBe('in_progress')

    const reviewCard = screen.getByText('Under review').closest('[role=article]') as HTMLElement
    expect(within(reviewCard).getByText('Notes: old notes')).toBeInTheDocument()
    expect(
      within(reviewCard).getByRole('link', { name: 'https://example.org/work' }),
    ).toBeInTheDocument()
    await userEvent.click(within(reviewCard).getByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(reviewCard).getByRole('button', { name: 'Review' }))
    expect(screen.getByText('Submitted by: Zara Volunteer')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/Excellent/))
    await userEvent.type(screen.getByLabelText('Internal Notes (admin only)'), 'solid')
    await userEvent.type(screen.getByLabelText(/Feedback to Volunteer/), 'Great job')
    fireEvent.submit(screen.getByLabelText('Internal Notes (admin only)').closest('form')!)
    await screen.findByText('Accepted. The task is done.')

    await userEvent.click(within(editedCard()).getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(await prisma.workItem.count({ where: { id: fresh.id } })).toBe(1)
    await userEvent.click(within(editedCard()).getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete task' }),
    )
    await screen.findByText('Task deleted')
    expect(await prisma.workItem.count({ where: { id: fresh.id } })).toBe(0)
  })

  it('manages featured project tasks, closes modals from the backdrop, and reports failures', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer({ name: 'Yusuf Helper' })
    const project = await createProject({ title: 'Featured host' })
    const task = await createTask(project.id, {
      title: 'Featured one',
      featuredAsQuickTask: true,
      estimatedHours: 2,
      deadline: new Date('2099-05-06T00:00:00Z'),
    })
    await renderApp(<QuickTasksPage />, { as: admin })
    const card = () => screen.getByText('Featured one').closest('[role=article]') as HTMLElement
    await screen.findByText('Featured one')
    expect(within(card()).getByText('Deadline 6 May 2099')).toBeInTheDocument()
    await userEvent.click(
      within(card()).getByRole('button', { name: 'Assign volunteer to Featured one' }),
    )
    await userEvent.click(await screen.findByRole('option', { name: 'Yusuf Helper' }))
    await userEvent.click(within(card()).getByRole('button', { name: 'Assign' }))
    await screen.findByText('Task assigned!')
    await waitFor(async () => expect((await row(task.id)).assigneeId).toBe(vol.id))
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('no')
        }),
      },
    })
    await userEvent.click(within(card()).getByRole('button', { name: 'Copy share link' }))
    await screen.findByText('Could not copy the link')
    await userEvent.click(await within(card()).findByRole('button', { name: 'Unassign' }))
    await waitFor(async () =>
      expect(await row(task.id)).toMatchObject({ assigneeId: null, status: 'open' }),
    )

    // Backdrop / cancel closes each modal.
    await userEvent.click(screen.getByRole('button', { name: 'Create Task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create Task' }))
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()

    // Failures: the project vanishes underneath the featured task controls.
    await prisma.workItem.delete({ where: { id: project.id } })
    await userEvent.click(
      within(card()).getByRole('button', { name: 'Assign volunteer to Featured one' }),
    )
    await userEvent.click(await screen.findByRole('option', { name: 'Yusuf Helper' }))
    await userEvent.click(within(card()).getByRole('button', { name: 'Assign' }))
    await screen.findByText('Project or task not found')
    // Unassign fails the same way once the project is gone.
    cleanup()
    const project2 = await createProject({ title: 'Second host' })
    await createTask(project2.id, {
      title: 'Featured two',
      featuredAsQuickTask: true,
      assigneeId: vol.id,
      status: 'in_progress',
    })
    await renderApp(<QuickTasksPage />, { as: admin })
    const card2 = (await screen.findByText('Featured two')).closest('[role=article]') as HTMLElement
    await prisma.workItem.delete({ where: { id: project2.id } })
    await userEvent.click(within(card2).getByRole('button', { name: 'Unassign' }))
    await screen.findByText('Project or task not found')
  })

  it('reports failures on quick-task mutations', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer({ name: 'Xena Helper' })
    const qt = await createQuickTask({
      title: 'Doomed',
      assigneeId: vol.id,
      status: 'under_review',
    })
    const openQt = await createQuickTask({ title: 'Unassignable' })
    await renderApp(<QuickTasksPage />, { as: admin })
    const card = () => screen.getByText('Doomed').closest('[role=article]') as HTMLElement
    const openCard = () => screen.getByText('Unassignable').closest('[role=article]') as HTMLElement
    await screen.findByText('Doomed')
    await userEvent.click(
      within(openCard()).getByRole('button', { name: 'Assign volunteer to Unassignable' }),
    )
    await userEvent.click(await screen.findByRole('option', { name: 'Xena Helper' }))
    await prisma.workItem.delete({ where: { id: openQt.id } })
    // Each failure is dismissed once seen, so the next step waits for a toast of its own;
    // counting toasts instead races their auto-dismiss when the suite runs slowly.
    const expectNotFound = async () => {
      const toast = (await screen.findByText('Task not found', {}, { timeout: 5000 })).closest(
        '[role=alert]',
      ) as HTMLElement
      await userEvent.click(within(toast).getByLabelText('Dismiss'))
      await waitFor(() => expect(screen.queryByText('Task not found')).toBeNull())
    }
    await userEvent.click(within(openCard()).getByRole('button', { name: 'Assign' }))
    await expectNotFound()
    await userEvent.click(within(card()).getByRole('button', { name: 'Edit' }))
    await prisma.workItem.delete({ where: { id: qt.id } })
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!)
    await expectNotFound()
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    await userEvent.click(within(card()).getByRole('button', { name: 'Unassign' }))
    await expectNotFound()
    await userEvent.click(within(card()).getByRole('button', { name: 'Review' }))
    fireEvent.submit(screen.getByLabelText('Internal Notes (admin only)').closest('form')!)
    await expectNotFound()
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    await userEvent.click(within(card()).getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete task' }),
    )
    await expectNotFound()
    await userEvent.click(screen.getByRole('button', { name: 'Create Task' }))
    localStorage.setItem('authToken', 'stale')
    await userEvent.type(screen.getByLabelText('Title'), 'x')
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!)
    await screen.findByText('Unauthorized')
  })
})
