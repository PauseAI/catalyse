import type { Meta, StoryObj } from '@storybook/react'
import { DueChip, LatenessBadge, ProjectStatusBadge, WorkStatusBadge } from './StatusBadges'
import type { WorkViewer } from '@/lib/status-emphasis'

const VIEWER_MINE: WorkViewer = { isAssignee: true, canReview: false }
const VIEWER_OTHER: WorkViewer = { isAssignee: false, canReview: false }

const meta: Meta = {
  title: 'Atoms/StatusBadges',
}

export default meta

/**
 * The same four work statuses, as a task (left) and a Quick Task (right) — their stored status
 * strings and labels differ (`not_started`/"To do" vs `open`/"To do", `completed`/"Done" for
 * both), which is why `WorkStatusBadge` takes a `quick` flag rather than reading one status map.
 */
export const WorkStatus: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['not_started', 'in_progress', 'under_review', 'completed'] as const).map((status) => (
        <div key={status} className="flex items-center gap-3">
          <code className="w-28 text-xs text-text-light">{status}</code>
          <WorkStatusBadge status={status} viewer={VIEWER_MINE} />
          <WorkStatusBadge
            status={status === 'not_started' ? 'open' : status}
            quick
            viewer={VIEWER_MINE}
          />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <code className="w-28 text-xs text-text-light">changes requested</code>
        <WorkStatusBadge status="in_progress" changesRequested viewer={VIEWER_OTHER} />
      </div>
    </div>
  ),
}

export const ProjectStatus: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(
        [
          'draft',
          'pending_review',
          'needs_discussion',
          'ready',
          'in_progress',
          'on_hold',
          'completed',
          'archived',
        ] as const
      ).map((status) => (
        <ProjectStatusBadge key={status} status={status} viewerIsAdmin={false} />
      ))}
    </div>
  ),
}

export const Lateness: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <LatenessBadge lateness={{ kind: 'late', days: 3 }} viewer={VIEWER_MINE} />
      <LatenessBadge lateness={{ kind: 'due_soon', days: 0 }} viewer={VIEWER_MINE} />
      <LatenessBadge lateness={{ kind: 'due_soon', days: 1 }} viewer={VIEWER_OTHER} />
      <LatenessBadge lateness={null} viewer={VIEWER_MINE} />
    </div>
  ),
}

/** Late/Due soon take over from the plain date; with no deadline it falls back to `noDeadline`. */
export const DueDate: StoryObj = {
  render: () => {
    const today = new Date('2026-06-15')
    return (
      <div className="flex flex-col gap-2 text-sm">
        <DueChip
          deadline={new Date('2026-06-10')}
          done={false}
          viewer={VIEWER_MINE}
          today={today}
        />
        <DueChip
          deadline={new Date('2026-06-25')}
          done={false}
          viewer={VIEWER_MINE}
          today={today}
        />
        <DueChip
          deadline={null}
          done={false}
          viewer={VIEWER_MINE}
          noDeadline="No deadline"
          today={today}
        />
      </div>
    )
  },
}
