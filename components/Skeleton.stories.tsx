import type { Meta, StoryObj } from '@storybook/react'
import Skeleton from './Skeleton'

const meta: Meta<typeof Skeleton> = {
  title: 'Atoms/Skeleton',
  component: Skeleton,
  args: { label: 'Loading projects…' },
}

export default meta
type Story = StoryObj<typeof Skeleton>

export const Cards: Story = { args: { variant: 'card', count: 3 } }
export const Rows: Story = { args: { variant: 'row', count: 5 } }
