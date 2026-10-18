import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type ProjectNotificationEmailProps = {
  name: string
  subject: string
  /** Already-escaped HTML, built by the caller with the `html` tagged template. */
  message: string
  projectId: number
  appUrl: string
  /** Already-escaped HTML, built by the caller with the `html` tagged template. */
  extraHtml?: string
}

export function ProjectNotificationEmail({
  name,
  subject,
  message,
  projectId,
  appUrl,
  extraHtml = '',
}: ProjectNotificationEmailProps) {
  const projectUrl = `${appUrl}/projects/${projectId}`
  return (
    <EmailLayout>
      <Heading as="h2">{subject}</Heading>
      <Text>{`Hi ${name},`}</Text>
      <p dangerouslySetInnerHTML={{ __html: message }} />
      {extraHtml && <div dangerouslySetInnerHTML={{ __html: extraHtml }} />}
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={projectUrl}>View Project</EmailButton>
      </Section>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'View Project', url: projectUrl }]} />
    </EmailLayout>
  )
}
