import type { Meta, StoryObj } from '@storybook/react'
import MemberPicker from './MemberPicker'

const CANDIDATES = [
  { id: 1, name: 'Sam Okafor', description: 'UK · London' },
  { id: 2, name: 'Priya Natarajan', description: 'UK · Remote' },
  { id: 3, name: 'Jordan Lee', description: 'Germany · Berlin' },
]

const meta: Meta<typeof MemberPicker> = {
  title: 'Volunteer previews/Picker (MemberPicker)',
  component: MemberPicker,
  args: {
    id: 'demo-member-picker',
    label: 'Add a member',
    ariaLabel: 'Add a member',
    candidates: CANDIDATES,
    onAdd: () => {},
  },
}

export default meta
type Story = StoryObj<typeof MemberPicker>

/**
 * `MemberPicker` filters a `candidates` list the caller already has — no network call, so it
 * renders fully in the viewer. Compare with `VolunteerSelect` below, which does its own
 * server-side search and needs a backend to show real results.
 */
export const Closed: Story = {}

export const Open: Story = { args: { autoFocus: true } }
