import type { Meta, StoryObj } from '@storybook/react'
import { Badge, StatusFlag, type BadgeVariant } from './Badge'

const VARIANTS: BadgeVariant[] = ['neutral', 'info', 'attention', 'danger', 'success']

const meta: Meta<typeof Badge> = {
  title: 'Atoms/Badge',
  component: Badge,
  args: { children: 'Label' },
}

export default meta
type Story = StoryObj<typeof Badge>

export const Filled: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      {VARIANTS.map((variant) => (
        <Badge key={variant} {...args} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
}

export const Outline: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      {VARIANTS.map((variant) => (
        <Badge key={variant} {...args} variant={variant} outline>
          {variant}
        </Badge>
      ))}
    </div>
  ),
}

/** `StatusFlag` is not a badge: a quiet "• fact" beside one, such as "Seeking help". */
export const Flag: StoryObj<typeof StatusFlag> = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge variant="info">In progress</Badge>
      <StatusFlag>Seeking help</StatusFlag>
    </div>
  ),
}
