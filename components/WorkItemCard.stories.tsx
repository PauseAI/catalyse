import type { Meta, StoryObj } from '@storybook/react'
import { WorkItemType } from '@/generated/prisma/enums'
import type { WorkItemSummary } from '@/lib/work-item-summary'
import WorkItemCard from './WorkItemCard'

const VIEWER = { isAssignee: false, canReview: true }

const TASK: WorkItemSummary = {
  id: 1,
  projectId: 10,
  title: 'Draft the newsletter',
  type: WorkItemType.TASK,
  displayStatus: 'in_progress',
  assigneeId: null,
  assigneeName: 'Sam Okafor',
  helperCount: 1,
  helpersWanted: 2,
  deadline: new Date('2026-06-20'),
  completedAt: null,
  href: '/projects/10/tasks/1',
  viewer: VIEWER,
}

const QUICK_TASK: WorkItemSummary = {
  ...TASK,
  id: 2,
  projectId: null,
  title: 'Share the volunteer form',
  type: WorkItemType.QUICK_TASK,
  displayStatus: 'open',
  assigneeId: null,
  assigneeName: null,
  helperCount: 0,
  helpersWanted: null,
  href: '/quick-tasks/2',
}

const meta: Meta<typeof WorkItemCard> = {
  title: 'WorkItem comparison/WorkItemCard (Task row)',
  component: WorkItemCard,
}

export default meta
type Story = StoryObj<typeof WorkItemCard>

/**
 * `WorkItemCard` renders one row for either a Task or a Quick Task from the same
 * `WorkItemSummary` shape — the one place a task and a quick task already share a component.
 * Compare with `WorkItem comparison/ProjectCard`, which is a *second*, separate card component
 * for the third kind of work item (a Project), with its own markup rather than reusing this one.
 */
export const AsTask: Story = { args: { item: TASK } }

export const AsQuickTask: Story = { args: { item: QUICK_TASK } }

export const Compact: Story = { args: { item: TASK, variant: 'compact' } }

export const Completed: Story = {
  args: { item: { ...TASK, displayStatus: 'completed', completedAt: new Date('2026-06-18') } },
}

/** Both rows together, so the shared shape and the status-vocabulary split are visible at once. */
export const TaskAndQuickTaskSideBySide: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <WorkItemCard item={TASK} />
      <WorkItemCard item={QUICK_TASK} />
    </div>
  ),
}
