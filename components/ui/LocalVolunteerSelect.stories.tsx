import type { Meta, StoryObj } from '@storybook/react'
import LocalVolunteerSelect from './LocalVolunteerSelect'

const CANDIDATES = [
  { id: 1, name: 'Sam Okafor', description: 'UK · London' },
  { id: 2, name: 'Priya Natarajan', description: 'UK · Remote' },
  { id: 3, name: 'Jordan Lee', description: 'Germany · Berlin' },
]

const meta: Meta<typeof LocalVolunteerSelect> = {
  title: 'Volunteer previews/Picker (LocalVolunteerSelect)',
  component: LocalVolunteerSelect,
  args: {
    id: 'demo-local-volunteer-select',
    label: 'Add a member',
    ariaLabel: 'Add a member',
    candidates: CANDIDATES,
    onAdd: () => {},
  },
}

export default meta
type Story = StoryObj<typeof LocalVolunteerSelect>

/**
 * `LocalVolunteerSelect` filters a `candidates` list the caller already has — no network call, so it
 * renders fully in the viewer. Compare with `FullVolunteerSelect` below, which does its own
 * server-side search and needs a backend to show real results.
 */
export const Closed: Story = {}

export const Open: Story = { args: { autoFocus: true } }
