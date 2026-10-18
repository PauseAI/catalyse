import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type TaskSurrenderedOwnerEmailProps = {
  ownerName: string
  volunteerName: string
  taskTitle: string
  projectTitle: string
  projectId: number
  appUrl: string
}

export function TaskSurrenderedOwnerEmail({
  ownerName,
  volunteerName,
  taskTitle,
  projectTitle,
  projectId,
  appUrl,
}: TaskSurrenderedOwnerEmailProps) {
  const projectUrl = `${appUrl}/projects/${projectId}`
  return (
    <EmailLayout>
      <Heading as="h2">Task unassigned due to inactivity</Heading>
      <Text>{`Hi ${ownerName},`}</Text>
      <Text>
        <strong>{volunteerName}</strong> has been removed from the task <strong>{taskTitle}</strong>{' '}
        in your project <strong>{projectTitle}</strong> after four weeks without an update, despite
        reminders.
      </Text>
      <Text>The task is now open and can be claimed by another contributor.</Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={projectUrl}>View Project</EmailButton>
      </Section>
      <Text>If you need support, please contact your project owner or a platform admin.</Text>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'View Project', url: projectUrl }]} />
    </EmailLayout>
  )
}
