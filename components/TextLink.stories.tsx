import type { Meta, StoryObj } from '@storybook/react'
import TextLink from './TextLink'

const meta: Meta<typeof TextLink> = {
  title: 'Atoms/TextLink',
  component: TextLink,
}

export default meta
type Story = StoryObj<typeof TextLink>

export const Default: Story = {
  render: () => <TextLink href="https://example.com">Read the full report</TextLink>,
}
