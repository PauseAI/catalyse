import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type TaskSurrenderedAssigneeEmailProps = {
  name: string
  taskTitle: string
  projectTitle: string
  projectId: number
  appUrl: string
}

export function TaskSurrenderedAssigneeEmail({
  name,
  taskTitle,
  projectTitle,
  projectId,
  appUrl,
}: TaskSurrenderedAssigneeEmailProps) {
  const projectUrl = `${appUrl}/projects/${projectId}`
  return (
    <EmailLayout>
      <Heading as="h2">Task now open to other contributors</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>
        Because we haven&apos;t received updates from you on the task <strong>{taskTitle}</strong>{' '}
        in <strong>{projectTitle}</strong> for four weeks, we&apos;ve opened the task to other
        contributors and removed you from it.
      </Text>
      <Text>
        We hope things are going well, if you&apos;d still like to contribute, you&apos;re always
        welcome to claim the task again or pick up something else on the project.
      </Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={projectUrl}>View Project</EmailButton>
      </Section>
      <Text>If you need support, please contact your project owner or a platform admin.</Text>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'View Project', url: projectUrl }]} />
    </EmailLayout>
  )
}
