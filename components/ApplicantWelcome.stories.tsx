import type { Meta, StoryObj } from '@storybook/react'
import ApplicantWelcome from './ApplicantWelcome'

const meta: Meta<typeof ApplicantWelcome> = {
  title: 'Home/ApplicantWelcome',
  component: ApplicantWelcome,
  args: {
    name: 'Ann Applicant',
    chapterName: 'PauseAI UK',
    waiting: { projects: 12, matching: 3, quickTasks: 5 },
    hasSkills: true,
  },
}

export default meta
type Story = StoryObj<typeof ApplicantWelcome>

export const WorkWaiting: Story = {}

export const NoSkillsYet: Story = {
  args: { waiting: { projects: 4, matching: 0, quickTasks: 0 }, hasSkills: false },
}

export const NothingOpen: Story = {
  args: { chapterName: null, waiting: { projects: 0, matching: 0, quickTasks: 0 } },
}
