import type { Meta, StoryObj } from '@storybook/react'
import Toggle from './Toggle'

const meta: Meta<typeof Toggle> = {
  title: 'Atoms/Toggle',
  component: Toggle,
}

export default meta
type Story = StoryObj<typeof Toggle>

export const Off: Story = { render: () => <Toggle>Email digest</Toggle> }
export const On: Story = { render: () => <Toggle defaultChecked>Email digest</Toggle> }
export const Disabled: Story = {
  render: () => (
    <Toggle disabled defaultChecked>
      Email digest
    </Toggle>
  ),
}
