import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import VolunteerSelect from './VolunteerSelect'

const meta: Meta<typeof VolunteerSelect> = {
  title: 'Volunteer previews/Picker (VolunteerSelect)',
  component: VolunteerSelect,
}

export default meta
type Story = StoryObj<typeof VolunteerSelect>

/**
 * `VolunteerSelect` searches the server itself (`orpc.volunteers.list`) rather than filtering a
 * list the caller passes in, so with no backend behind this viewer its dropdown opens empty —
 * that's expected here, not a bug. It does the same job as `MemberPicker` (ui/MemberPicker.tsx)
 * for a different caller (task reassignment, adding a team member) and is the second of two
 * "pick a volunteer" implementations; see `components/COMPONENT-AUDIT.md`.
 */
export const Default: Story = {
  render: () => {
    function Demo() {
      const [value, setValue] = useState('')
      return (
        <VolunteerSelect
          id="demo-volunteer-select"
          label="Reassign to"
          ariaLabel="Reassign to"
          value={value}
          onChange={setValue}
        />
      )
    }
    return <Demo />
  },
}
