import type { Meta, StoryObj } from '@storybook/react'
import Button from './Button'

const meta: Meta<typeof Button> = {
  title: 'Atoms/Button',
  component: Button,
}

export default meta
type Story = StoryObj<typeof Button>

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="warning">Warning</Button>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}

export const Disabled: Story = {
  render: () => <Button disabled>Save changes</Button>,
}

/** `href` renders a `next/link` styled as a button, instead of a `<button>`. */
export const AsLink: Story = {
  render: () => <Button href="/projects">View details</Button>,
}

export const IconOnly: Story = {
  render: () => (
    <Button icon aria-label="Close" variant="ghost">
      ×
    </Button>
  ),
}
