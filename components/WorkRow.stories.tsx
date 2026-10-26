import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from './Badge'
import { PersonChip } from './ui/PersonChip'
import WorkRow, { PersonAvatar } from './WorkRow'

const meta: Meta<typeof WorkRow> = {
  title: 'Volunteer previews/WorkRow (PersonAvatar)',
  component: WorkRow,
}

export default meta
type Story = StoryObj<typeof WorkRow>

/**
 * A dense task-list row names its holder with `PersonAvatar` (initials only, a tooltip for the
 * name) rather than `PersonChip` (initials + visible name) — a deliberate space trade-off for a
 * list of many rows, not a duplicate to merge. Compare with `Volunteer previews/PersonChip`.
 */
export const AssignedRow: Story = {
  render: () => (
    <ul className="m-0 list-none p-0">
      <WorkRow
        status={<Badge variant="info">In progress</Badge>}
        title={
          <span className="font-medium text-primary-text underline">Draft the newsletter</span>
        }
        below={<span className="text-text-light text-sm">Due in 2 days</span>}
        person={<PersonAvatar name="Sam Okafor" />}
      />
    </ul>
  ),
}

export const UnassignedRow: Story = {
  render: () => (
    <ul className="m-0 list-none p-0">
      <WorkRow
        status={<Badge variant="neutral">To do</Badge>}
        title={<span className="font-medium text-primary-text underline">Translate the FAQ</span>}
        below={<span className="text-text-light text-sm">No deadline</span>}
        person={<PersonAvatar name={null} />}
      />
    </ul>
  ),
}

/** The same volunteer, side by side: the row's compact avatar versus the full chip elsewhere. */
export const AvatarVsChip: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col items-center gap-2 text-xs text-text-light">
        <PersonAvatar name="Sam Okafor" />
        WorkRow&apos;s PersonAvatar
      </div>
      <div className="flex flex-col items-center gap-2 text-xs text-text-light">
        <PersonChip name="Sam Okafor" id={1} />
        PersonChip
      </div>
    </div>
  ),
}
