import type { Meta, StoryObj } from '@storybook/react'
import { P } from './Text'

const meta: Meta<typeof P> = {
  title: 'Atoms/Text',
  component: P,
}

export default meta
type Story = StoryObj<typeof P>

export const Default: Story = {
  render: () => (
    <div>
      <P>First paragraph, with the usual bottom margin.</P>
      <P>Second paragraph, right below it.</P>
    </div>
  ),
}
