import { describe, it, expect } from 'vitest'
import { screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createQuickTask,
  createSkill,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { clientAs } from '@/test/rpc'
import QuickTaskDetailPage from './quick-tasks/[id]/page'
import BugReportDetailPage from './bugs/[id]/page'

const row = (id: number) => prisma.workItem.findUniqueOrThrow({ where: { id } })

describe('quick task detail', () => {
  it('walks a task from open through claim, submit and review', async () => {
    const me = await createVolunteer()
    const skill = await createSkill()
    const project = await createProject({ title: 'Ctx project' })
    const task = await createQuickTask({
      title: 'Detail task',
      skillId: skill.id,
      estimatedHours: 2,
      contextProjectId: project.id,
      deadline: new Date('2099-03-04T00:00:00Z'),
    })
    const page = () =>
      renderApp(<QuickTaskDetailPage params={Promise.resolve({ id: String(task.id) })} />, {
        as: me,
      })
    await page()
    await screen.findByRole('heading', { name: 'Detail task' })
    expect(screen.getByText(skill.name)).toBeInTheDocument()
    expect(screen.getByText('~2h estimated')).toBeInTheDocument()
    expect(screen.getByText('Deadline 4 Mar 2099')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Related project: Ctx project' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    )
    expect(screen.getByRole('link', { name: '← Back to Quick Tasks' })).toHaveAttribute(
      'href',
      '/quick-tasks#browse-quick-tasks',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }))
    await screen.findByText(/Task claimed\. Submit it for review/)
    expect(await screen.findByRole('link', { name: '← Back to My Quick Tasks' })).toHaveAttribute(
      'href',
      '/quick-tasks',
    )
    // Submitting asks what was done, and backing out leaves the task in progress.
    await userEvent.click(await screen.findByRole('button', { name: 'Submit work' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your work' })
    expect(dialog).toHaveTextContent('An admin will look at it, then accept it or ask for changes.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await row(task.id)).status).toBe('in_progress')
    await userEvent.click(screen.getByRole('button', { name: 'Submit work' }))
    const again = await screen.findByRole('dialog', { name: 'Submit your work' })
    await userEvent.type(
      within(again).getByLabelText('Link to your work (optional)'),
      'https://example.org/mine',
    )
    await userEvent.click(within(again).getByRole('button', { name: 'Submit work' }))
    await screen.findByText(/Submitted\. An admin will review it/)
    await waitFor(async () => expect((await row(task.id)).status).toBe('under_review'))
    await screen.findByText('Your submission is awaiting review.')
    expect(screen.getByRole('link', { name: 'https://example.org/mine' })).toBeInTheDocument()

    // An admin sends it back; the volunteer sees why and submits again.
    const admin = await createAdmin({ name: 'Ada Admin' })
    const asAdmin = () =>
      renderApp(<QuickTaskDetailPage params={Promise.resolve({ id: String(task.id) })} />, {
        as: admin,
      })
    cleanup()
    await asAdmin()
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for changes' }))
    const ask = await screen.findByRole('dialog', { name: 'Ask for changes' })
    await userEvent.type(within(ask).getByLabelText('What needs changing?'), 'Add a caption')
    await userEvent.click(within(ask).getByRole('button', { name: 'Send back' }))
    await screen.findByText('Sent back to the assignee with your message.')
    cleanup()
    await page()
    await screen.findByRole('heading', { name: 'Changes requested by Ada Admin' })
    expect(screen.getByText('Add a caption')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Submit work' }))
    const third = await screen.findByRole('dialog', { name: 'Submit your work' })
    await userEvent.type(within(third).getByLabelText('What did you do?'), 'Captioned')
    await userEvent.click(within(third).getByRole('button', { name: 'Submit work' }))
    await screen.findByText(/Submitted\. An admin will review it/)

    cleanup()
    await asAdmin()
    await userEvent.click(await screen.findByRole('button', { name: 'Accept…' }))
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Review Task' })).getByRole('button', {
        name: 'Cancel',
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Accept…' }))
    const review = screen.getByRole('dialog', { name: 'Review Task' })
    await userEvent.click(within(review).getByLabelText(/Excellent/))
    await userEvent.click(within(review).getByRole('button', { name: 'Accept' }))
    await screen.findByText('Accepted. The task is done.')
    await waitFor(async () => expect((await row(task.id)).status).toBe('completed'))
    cleanup()
    await page()
    await screen.findByText('Excellent')
  })

  it('reports claim/submit failures and unknown tasks', async () => {
    const me = await createVolunteer()
    const rival = await createVolunteer()
    const task = await createQuickTask({ title: 'Contested', description: null })
    await renderApp(<QuickTaskDetailPage params={Promise.resolve({ id: String(task.id) })} />, {
      as: me,
    })
    await screen.findByRole('button', { name: 'Claim' })
    await prisma.workItem.update({
      where: { id: task.id },
      data: { assigneeId: rival.id, status: 'in_progress' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }))
    await screen.findByText('This task has already been claimed')
    cleanup()
    const mine = await createQuickTask({ title: 'Mine', assigneeId: me.id, status: 'in_progress' })
    await renderApp(<QuickTaskDetailPage params={Promise.resolve({ id: String(mine.id) })} />, {
      as: me,
    })
    await screen.findByRole('button', { name: 'Submit work' })
    await prisma.workItem.update({ where: { id: mine.id }, data: { assigneeId: rival.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Submit work' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your work' })
    await userEvent.type(within(dialog).getByLabelText('What did you do?'), 'Done')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit work' }))
    await screen.findByText('Task not found or not assigned to you')
    cleanup()
    // An admin looking at someone else's task has nothing to submit and no "your" wording.
    const admin = await createAdmin()
    await renderApp(<QuickTaskDetailPage params={Promise.resolve({ id: String(mine.id) })} />, {
      as: admin,
    })
    await screen.findByRole('link', { name: '← Back to Quick Tasks' })
    expect(screen.queryByRole('button', { name: 'Submit work' })).toBeNull()
    cleanup()
    await prisma.workItem.update({ where: { id: mine.id }, data: { status: 'under_review' } })
    await renderApp(<QuickTaskDetailPage params={Promise.resolve({ id: String(mine.id) })} />, {
      as: admin,
    })
    await screen.findByRole('link', { name: '← Back to Quick Tasks' })
    expect(screen.queryByText('Your submission is awaiting review.')).toBeNull()
    cleanup()
    await renderApp(<QuickTaskDetailPage params={Promise.resolve({ id: '999999' })} />, { as: me })
    await screen.findByRole('link', { name: 'Back to Quick Tasks' })
    cleanup()
    await renderApp(<QuickTaskDetailPage params={Promise.resolve({ id: 'nope' })} />, { as: me })
    await screen.findByRole('link', { name: 'Back to Quick Tasks' })
  })
})

describe('bug report detail', () => {
  it('shows a report to its reporter, and lets an admin update it', async () => {
    const reporter = await createVolunteer()
    const admin = await createAdmin({ name: 'Fixer' })
    const { id } = await clientAs(reporter).bugReports.create({
      title: 'Broken button',
      description: 'It does nothing at all',
      pageUrl: 'https://evil.example/projects/3?x=1',
      category: 'ux',
      severity: 'high',
    })
    await prisma.bugReport.update({
      where: { id },
      data: { assigneeId: admin.id, resolutionNotes: 'Looking into it' },
    })
    await renderApp(<BugReportDetailPage params={Promise.resolve({ id: String(id) })} />, {
      as: reporter,
    })
    await screen.findByRole('heading', { name: 'Broken button' })
    expect(screen.getByRole('link', { name: '/projects/3?x=1' })).toHaveAttribute(
      'href',
      '/projects/3?x=1',
    )
    expect(screen.getByText('Resolution: Looking into it')).toBeInTheDocument()
    expect(screen.queryByText(/Assigned to/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()

    cleanup()
    await renderApp(<BugReportDetailPage params={Promise.resolve({ id: String(id) })} />, {
      as: admin,
    })
    await screen.findByText('· Assigned to: Fixer')
    expect(screen.getByRole('link', { name: '← Back to Bug Reports' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Status' }))
    await userEvent.click(screen.getByRole('option', { name: 'Resolved' }))
    await userEvent.clear(screen.getByLabelText('Resolution Notes'))
    await userEvent.type(screen.getByLabelText('Resolution Notes'), 'Fixed in #12')
    await userEvent.click(screen.getByRole('button', { name: 'Update' }))
    await screen.findByText('Report updated!')
    await waitFor(async () =>
      expect(await prisma.bugReport.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'resolved',
        resolutionNotes: 'Fixed in #12',
      }),
    )
    await prisma.bugReport.delete({ where: { id } })
    await userEvent.click(screen.getByRole('button', { name: 'Update' }))
    await screen.findByText('Bug report not found')
  })

  it('renders unlinkable page URLs as text, and a not-found state', async () => {
    const admin = await createAdmin()
    const report = await prisma.bugReport.create({
      data: {
        title: 'Odd URL',
        description: 'Ten characters at least',
        pageUrl: 'mailto:x@y.z',
        category: null,
        severity: null,
      },
    })
    await renderApp(<BugReportDetailPage params={Promise.resolve({ id: String(report.id) })} />, {
      as: admin,
    })
    await screen.findByText(/mailto:x@y\.z/)
    expect(screen.queryByRole('link', { name: /mailto/ })).toBeNull()
    cleanup()
    await renderApp(<BugReportDetailPage params={Promise.resolve({ id: '999999' })} />, {
      as: admin,
    })
    await screen.findByRole('heading', { name: 'Report not found' })
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
  })
})
