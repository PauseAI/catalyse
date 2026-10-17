import type { Meta, StoryObj } from '@storybook/react'
import Checkbox from './Checkbox'

const meta: Meta<typeof Checkbox> = {
  title: 'Atoms/Checkbox',
  component: Checkbox,
}

export default meta
type Story = StoryObj<typeof Checkbox>

export const Unchecked: Story = {
  render: () => <Checkbox>Add this task to the quick tasks page</Checkbox>,
}

export const Checked: Story = {
  render: () => <Checkbox defaultChecked>Add this task to the quick tasks page</Checkbox>,
}

export const Disabled: Story = {
  render: () => (
    <Checkbox disabled defaultChecked>
      Add this task to the quick tasks page
    </Checkbox>
  ),
}
