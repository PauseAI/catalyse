import type { Meta, StoryObj } from '@storybook/react'
import Radio from './Radio'

const meta: Meta<typeof Radio> = {
  title: 'Atoms/Radio',
  component: Radio,
}

export default meta
type Story = StoryObj<typeof Radio>

export const Group: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Radio name="outcome" value="successful" defaultChecked>
        Successful
      </Radio>
      <Radio name="outcome" value="partial">
        Partial
      </Radio>
      <Radio name="outcome" value="not_completed">
        Not completed
      </Radio>
    </div>
  ),
}
