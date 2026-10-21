import type { Meta, StoryObj } from '@storybook/react'
import Button from './Button'
import SectionCard from './SectionCard'

const meta: Meta<typeof SectionCard> = {
  title: 'Atoms/SectionCard',
  component: SectionCard,
}

export default meta
type Story = StoryObj<typeof SectionCard>

export const TitleAndDescription: Story = {
  args: {
    title: 'Sessions',
    description: 'Sign out everywhere except this device.',
    children: <Button variant="secondary">Log out of all other sessions</Button>,
  },
}

export const Stacked: Story = {
  render: () => (
    <div className="max-w-4xl flex flex-col gap-6">
      <SectionCard title="Your data" description="Download all your data in JSON format.">
        <Button variant="secondary">Download my data</Button>
      </SectionCard>
      <SectionCard title="Danger zone" description="Permanently delete your account.">
        <Button variant="danger">Delete my account</Button>
      </SectionCard>
    </div>
  ),
}
