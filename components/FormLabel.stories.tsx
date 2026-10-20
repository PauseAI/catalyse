import type { Meta, StoryObj } from '@storybook/react'
import FormLabel from './FormLabel'

const meta: Meta<typeof FormLabel> = {
  title: 'Atoms/FormLabel',
  component: FormLabel,
}

export default meta
type Story = StoryObj<typeof FormLabel>

export const Default: Story = {
  render: () => <FormLabel htmlFor="name">Name</FormLabel>,
}

export const Required: Story = {
  render: () => (
    <FormLabel htmlFor="email" required>
      Email
    </FormLabel>
  ),
}
