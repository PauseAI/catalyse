import type { Meta, StoryObj } from '@storybook/react'
import Link from 'next/link'
import Button from './Button'
import EmptyState from './EmptyState'

const meta: Meta<typeof EmptyState> = {
  title: 'Atoms/EmptyState',
  component: EmptyState,
}

export default meta
type Story = StoryObj<typeof EmptyState>

export const TitleOnly: Story = { args: { title: 'No tasks yet.' } }

export const WithBodyAndAction: Story = {
  args: {
    title: 'No projects match your filters.',
    body: 'Try widening your search, or clear the filters to see everything.',
    action: (
      <Link href="/projects">
        <Button variant="secondary" size="sm">
          Clear filters
        </Button>
      </Link>
    ),
  },
}
