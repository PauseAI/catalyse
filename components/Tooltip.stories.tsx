import type { Meta, StoryObj } from '@storybook/react'
import Tooltip from './Tooltip'

const meta: Meta<typeof Tooltip> = {
  title: 'Atoms/Tooltip',
  component: Tooltip,
}

export default meta
type Story = StoryObj<typeof Tooltip>

export const Top: Story = {
  render: () => (
    <div className="p-16 text-center">
      <Tooltip content="Sam Okafor">
        <span className="inline-block rounded-full bg-secondary px-3 py-1 text-sm text-white">
          Hover or focus me
        </span>
      </Tooltip>
    </div>
  ),
}

export const RightSide: Story = {
  render: () => (
    <div className="p-16">
      <Tooltip content="Sam Okafor" side="right">
        <span className="inline-block rounded-full bg-secondary px-3 py-1 text-sm text-white">
          Hover or focus me
        </span>
      </Tooltip>
    </div>
  ),
}
