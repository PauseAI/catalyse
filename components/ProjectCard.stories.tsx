import type { Meta, StoryObj } from '@storybook/react'
import { ProjectCard, ProjectList, type Project } from './ProjectCard'
import WorkItemCard from './WorkItemCard'
import { WorkItemType } from '@/generated/prisma/enums'
import type { WorkItemSummary } from '@/lib/work-item-summary'

const PROJECT: Project = {
  id: 10,
  title: 'Translate the site into French',
  status: 'in_progress',
  description:
    'Translate every page of pauseai.info into French, keeping the tone and the technical terms consistent.',
  owner: { name: 'Priya Natarajan' },
  reach: 'COUNTRY_WIDE',
  localGroup: null,
  chapterName: 'France',
  team: { id: 1, name: 'Translation team' },
  projectType: 'sprint',
  timeCommitmentHoursPerWeek: 3,
  urgency: 'high',
  skills: [
    { id: 1, name: 'French', isRequired: true },
    { id: 2, name: 'Editing', isRequired: false },
  ],
}

const TASK_ROW: WorkItemSummary = {
  id: 1,
  projectId: 10,
  title: 'Draft the newsletter',
  type: WorkItemType.TASK,
  displayStatus: 'in_progress',
  assigneeName: 'Sam Okafor',
  helperCount: 1,
  helpersWanted: 2,
  deadline: new Date('2026-06-20'),
  completedAt: null,
  href: '/projects/10/tasks/1',
  viewer: { isAssignee: false, canReview: true },
}

const meta: Meta<typeof ProjectCard> = {
  title: 'WorkItem comparison/ProjectCard',
  component: ProjectCard,
  args: { project: PROJECT },
}

export default meta
type Story = StoryObj<typeof ProjectCard>

export const Default: Story = {}

export const SeekingOwner: Story = {
  args: { project: { ...PROJECT, owner: null, isSeekingOwner: true } },
}

export const SeekingHelpAndLate: Story = {
  args: { project: { ...PROJECT, isSeekingHelp: true, daysLate: 3, viewerLeads: true } },
}

export const Grid: Story = {
  render: () => (
    <ProjectList
      projects={[
        PROJECT,
        {
          ...PROJECT,
          id: 11,
          title: 'Organise the London meetup',
          owner: null,
          isSeekingOwner: true,
        },
      ]}
    />
  ),
}

/**
 * `ProjectCard` is a second, separate card for a project's "one row of work" summary, built from
 * its own `Project` type rather than sharing `WorkItemSummary` with `WorkItemCard` (the Task/Quick
 * Task card). Both show a title, a status badge and a lateness badge, but `ProjectCard` additionally
 * shows owner, location, team, skills and a match grade that `WorkItemCard` has no equivalent for —
 * see `components/COMPONENT-AUDIT.md` for whether that divergence is structural or just
 * never-unified. `WorkItemCard`'s detail page also hand-rolls a near-identical header
 * (`WorkItem comparison/WorkItemHeader`) rather than reusing either card.
 */
export const ProjectCardAndWorkItemCardSideBySide: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-6">
      <div className="w-80">
        <ProjectCard project={PROJECT} />
      </div>
      <div className="w-80 rounded-xl border border-dashed border-brand-border p-4">
        <WorkItemCard item={TASK_ROW} />
      </div>
    </div>
  ),
}
