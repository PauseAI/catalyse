import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import Tabs, { type TabItem } from './Tabs'

const meta: Meta<typeof Tabs> = {
  title: 'Atoms/Tabs',
  component: Tabs,
}

export default meta
type Story = StoryObj<typeof Tabs>

const PROJECT_TABS: TabItem<'overview' | 'tasks' | 'timeline' | 'people'>[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'people', label: 'People' },
]

export const ProjectDetailTabs: Story = {
  render: () => {
    function Demo() {
      const [active, setActive] = useState<(typeof PROJECT_TABS)[number]['key']>('tasks')
      return <Tabs tabs={PROJECT_TABS} activeTab={active} onChange={setActive} />
    }
    return <Demo />
  },
}
