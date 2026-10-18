import type { Meta, StoryObj } from '@storybook/react'
import { H1, H2, H3, H4 } from './Heading'

const meta: Meta = {
  title: 'Atoms/Heading',
}

export default meta

export const AllLevels: StoryObj = {
  render: () => (
    <div>
      <H1>Heading level 1</H1>
      <H2>Heading level 2</H2>
      <H3>Heading level 3</H3>
      <H4>Heading level 4</H4>
    </div>
  ),
}

export const ClassNameOverride: StoryObj = {
  render: () => (
    <div>
      <H1 className="mb-0">H1 with margin override</H1>
      <H2 className="text-center">H2 centred</H2>
    </div>
  ),
}
