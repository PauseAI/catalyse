import type { Meta, StoryObj } from '@storybook/react'
import Input from './Input'

const meta: Meta<typeof Input> = {
  title: 'Atoms/Input',
  component: Input,
}

export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: { placeholder: 'Jane Doe' },
}

export const Invalid: Story = {
  args: { placeholder: 'Jane Doe', 'aria-invalid': true, defaultValue: '' },
}

export const Disabled: Story = {
  args: { placeholder: 'Jane Doe', disabled: true },
}
