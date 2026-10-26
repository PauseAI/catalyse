import type { Meta, StoryObj } from '@storybook/react'
import { EmptyPersonChip, PersonChip } from './PersonChip'

const meta: Meta<typeof PersonChip> = {
  title: 'Volunteer previews/PersonChip',
  component: PersonChip,
}

export default meta
type Story = StoryObj<typeof PersonChip>

/**
 * `PersonChip` is the one genuinely reusable "a volunteer, named" component — see
 * `components/COMPONENT-AUDIT.md` for where it's used (task assignee, project owner, project
 * helper/interest rows) and where a volunteer is instead drawn by ad hoc JSX that doesn't use it.
 */
export const Plain: Story = { args: { id: null, name: 'Sam Okafor' } }

export const Linked: Story = { args: { name: 'Sam Okafor', id: 1 } }

export const Viewer: Story = { args: { name: 'Sam Okafor', id: 1, isViewer: true } }

export const Removable: Story = {
  args: {
    name: 'Sam Okafor',
    id: 1,
    onRemove: () => {},
    removeLabel: 'Remove Sam Okafor',
  },
}

export const Empty: StoryObj<typeof EmptyPersonChip> = {
  render: () => <EmptyPersonChip label="Unclaimed" />,
}
