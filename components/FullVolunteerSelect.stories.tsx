import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import FullVolunteerSelect from './FullVolunteerSelect'

const meta: Meta<typeof FullVolunteerSelect> = {
  title: 'Volunteer previews/Picker (FullVolunteerSelect)',
  component: FullVolunteerSelect,
}

export default meta
type Story = StoryObj<typeof FullVolunteerSelect>

/**
 * `FullVolunteerSelect` searches the server itself (`orpc.volunteers.list`) rather than filtering a
 * list the caller passes in, so with no backend behind this viewer its dropdown opens empty —
 * that's expected here, not a bug. It does the same job as `LocalVolunteerSelect` (ui/LocalVolunteerSelect.tsx)
 * for a different caller (task reassignment, adding a team member) and is the second of two
 * "pick a volunteer" implementations; see `components/COMPONENT-AUDIT.md`.
 */
export const Default: Story = {
  render: () => {
    function Demo() {
      const [value, setValue] = useState('')
      return (
        <FullVolunteerSelect
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
