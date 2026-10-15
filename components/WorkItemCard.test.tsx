import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkItemCard from './WorkItemCard'
import type { WorkItemSummary } from '@/lib/work-item-summary'

const today = new Date('2026-10-11T15:00:00Z')

const task = (overrides: Partial<WorkItemSummary> = {}): WorkItemSummary => ({
  id: 7,
  projectId: 3,
  title: 'Book the venue',
  type: 'TASK',
  displayStatus: 'ready',
  assigneeName: null,
  helperCount: 0,
  helpersWanted: null,
  deadline: null,
  completedAt: null,
  href: '/projects/3/tasks/7',
  viewer: { isAssignee: false, canReview: false },
  ...overrides,
})

const card = (item: WorkItemSummary, props: Partial<Parameters<typeof WorkItemCard>[0]> = {}) =>
  render(<WorkItemCard item={item} today={today} {...props} />).container

describe('WorkItemCard', () => {
  it('shows an unclaimed task with no deadline', () => {
    card(task())
    expect(screen.getByRole('link', { name: 'Book the venue' })).toHaveAttribute(
      'href',
      '/projects/3/tasks/7',
    )
    expect(screen.getByText('To do')).toHaveClass('status-badge')
    expect(screen.getByText('Unclaimed')).toBeInTheDocument()
    expect(screen.getByText('No deadline')).toBeInTheDocument()
  })

  it('shows who has a task and how soon it is due', () => {
    card(
      task({
        displayStatus: 'in_progress',
        assigneeName: 'Sam',
        deadline: new Date('2026-10-14T00:00:00Z'),
      }),
    )
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.getByText('Due in 3 days')).toHaveAttribute('data-emphasis', 'outline')
    expect(screen.queryByText('Due 14 Oct')).not.toBeInTheDocument()
  })

  it('gives the day of a deadline further off than Due soon', () => {
    card(task({ deadline: new Date('2026-10-20T00:00:00Z') }))
    expect(screen.getByText('Due 20 Oct')).toBeInTheDocument()
  })

  it('shows the lead and helpers of a task that has or seeks them', () => {
    card(task({ assigneeName: 'Sam', helperCount: 3, helpersWanted: 5 }))
    expect(screen.getByText('Lead: Sam · 3 helpers (2 more wanted)')).toBeInTheDocument()
  })

  it('says how many helpers an unclaimed task seeks', () => {
    card(task({ helpersWanted: 2 }))
    expect(screen.getByText('Unclaimed · 2 helpers wanted')).toBeInTheDocument()
  })

  it('shows a blocked task as To do', () => {
    card(task({ displayStatus: 'blocked', assigneeName: 'Sam' }))
    expect(screen.getByText('To do')).toBeInTheDocument()
  })

  it('marks a late task, filled for its assignee', () => {
    card(
      task({
        deadline: new Date('2026-10-09T00:00:00Z'),
        viewer: { isAssignee: true, canReview: false },
      }),
    )
    expect(screen.getByText('2 days late')).toHaveAttribute('data-emphasis', 'filled')
    expect(screen.queryByText('Due 9 Oct')).not.toBeInTheDocument()
  })

  it('counts days past plan towards Late', () => {
    card(task({ displayStatus: 'in_progress' }), { pastPlanDays: 4 })
    expect(screen.getByText('4 days late')).toBeInTheDocument()
  })

  it('shows when a done task finished instead of when it was due', () => {
    card(
      task({
        displayStatus: 'completed',
        assigneeName: 'Sam',
        deadline: new Date('2026-10-01T00:00:00Z'),
        completedAt: new Date('2026-10-09T12:00:00Z'),
      }),
    )
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Done 9 Oct')).not.toHaveClass('text-error')
  })

  it('shows no date for a done task with no finish recorded', () => {
    card(task({ displayStatus: 'completed', deadline: new Date('2026-10-01T00:00:00Z') }))
    expect(screen.queryByText(/Oct/)).not.toBeInTheDocument()
  })

  it('keeps the due date, without a badge, while work waits for review', () => {
    card(task({ displayStatus: 'under_review', deadline: new Date('2026-10-01T00:00:00Z') }))
    expect(screen.getByText('In review')).toHaveAttribute('data-emphasis', 'outline')
    expect(screen.getByText('Due 1 Oct')).toBeInTheDocument()
    expect(screen.queryByText(/late/)).not.toBeInTheDocument()
  })

  it('fills work in review for whoever can accept it', () => {
    card(task({ displayStatus: 'under_review', viewer: { isAssignee: false, canReview: true } }))
    expect(screen.getByText('In review')).toHaveAttribute('data-emphasis', 'filled')
  })

  it('draws a Quick Task with its own status words', () => {
    card(
      task({ type: 'QUICK_TASK', projectId: null, displayStatus: 'open', href: '/quick-tasks/7' }),
    )
    expect(screen.getByText('To do')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book the venue' })).toHaveAttribute(
      'href',
      '/quick-tasks/7',
    )
  })

  it('leaves out the assignee when compact, and shows what the caller adds', () => {
    card(task({ assigneeName: 'Sam' }), { variant: 'compact', extra: <span>Lag 2 days</span> })
    expect(screen.queryByText('Sam')).not.toBeInTheDocument()
    expect(screen.getByText('Lag 2 days')).toBeInTheDocument()
  })

  it('is reached by keyboard through its link', async () => {
    card(task())
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Book the venue' })).toHaveFocus()
  })

  it('counts from now when no day is given', () => {
    render(<WorkItemCard item={task({ deadline: new Date('2000-01-01T00:00:00Z') })} />)
    expect(screen.getByText(/days late$/)).toBeInTheDocument()
  })
})
