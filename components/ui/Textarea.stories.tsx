import type { Meta, StoryObj } from '@storybook/react'
import Textarea from './Textarea'

const meta: Meta<typeof Textarea> = {
  title: 'Atoms/Textarea',
  component: Textarea,
}

export default meta
type Story = StoryObj<typeof Textarea>

export const Default: Story = {
  args: { placeholder: 'Tell us about yourself' },
}

export const Invalid: Story = {
  args: { placeholder: 'Tell us about yourself', 'aria-invalid': true },
}
