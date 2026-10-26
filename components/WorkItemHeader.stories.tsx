import type { Meta, StoryObj } from '@storybook/react'
import Button from './Button'
import { StatusFlag } from './Badge'
import { LatenessBadge, ProjectStatusBadge, WorkStatusBadge } from './StatusBadges'
import { EmptyPersonChip, PersonChip } from './ui/PersonChip'
import Tabs from './Tabs'
import WorkItemHeader, { WorkItemPerson } from './WorkItemHeader'

const meta: Meta<typeof WorkItemHeader> = {
  title: 'WorkItem comparison/WorkItemHeader (Task vs Project detail)',
  component: WorkItemHeader,
}

export default meta
type Story = StoryObj<typeof WorkItemHeader>

const TASK_VIEWER = { isAssignee: false, canReview: true }

/**
 * Rebuilt from the task detail page's own `WorkItemHeader` call
 * (app/projects/[id]/tasks/[taskId]/page.tsx) with static data, to show the real composition
 * without pulling in that page's data fetching. No `tabs`, no `subtitle`; status includes a
 * `LatenessBadge`.
 */
export const TaskDetailHeader: Story = {
  render: () => (
    <WorkItemHeader
      title="Draft the newsletter"
      person={
        <WorkItemPerson
          label="Lead"
          actions={
            <Button size="sm" variant="secondary">
              Message
            </Button>
          }
        >
          <PersonChip name="Sam Okafor" id={1} />
        </WorkItemPerson>
      }
      status={
        <>
          <WorkStatusBadge status="in_progress" viewer={TASK_VIEWER} />
          <LatenessBadge lateness={{ kind: 'due_soon', days: 2 }} viewer={TASK_VIEWER} />
        </>
      }
      actions={
        <Button variant="secondary" size="sm">
          Edit
        </Button>
      }
    />
  ),
}

/**
 * Rebuilt from the project detail page's own `WorkItemHeader` call (app/projects/[id]/page.tsx),
 * to the same shape. Note the two divergences from the task header above, both real findings
 * (see `components/COMPONENT-AUDIT.md`): it has `tabs` and a `subtitle` the task header never
 * uses, and its status group has **no `LatenessBadge`** — even though `ProjectCard` (the same
 * project, shown on the projects list) does show one for this project. An owner or admin also
 * sees a status-change control here (`StatusSplitButton`), left out of this reconstruction for
 * simplicity.
 */
export const ProjectDetailHeader: Story = {
  render: () => (
    <WorkItemHeader
      title="Translate the site into French"
      subtitle="France · Translation team"
      tabs={
        <Tabs
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'tasks', label: 'Tasks' },
            { key: 'timeline', label: 'Timeline' },
            { key: 'people', label: 'People' },
          ]}
          activeTab="overview"
          onChange={() => {}}
        />
      }
      person={
        <WorkItemPerson
          label="Owner"
          actions={
            <Button size="sm" variant="secondary">
              Message
            </Button>
          }
        >
          <PersonChip name="Priya Natarajan" id={2} />
        </WorkItemPerson>
      }
      status={
        <>
          <ProjectStatusBadge status="in_progress" viewerIsAdmin={false} />
          <StatusFlag>Seeking help</StatusFlag>
        </>
      }
      actions={
        <Button variant="secondary" size="sm">
          Edit
        </Button>
      }
    />
  ),
}

/** The project header without an owner yet — the other side of the Task page's "Unclaimed". */
export const ProjectDetailHeaderSeekingOwner: Story = {
  render: () => (
    <WorkItemHeader
      title="Organise the London meetup"
      subtitle="UK · Local group"
      person={
        <WorkItemPerson label="Owner">
          <EmptyPersonChip label="Seeking owner" />
        </WorkItemPerson>
      }
      status={<ProjectStatusBadge status="ready" viewerIsAdmin={false} />}
    />
  ),
}
