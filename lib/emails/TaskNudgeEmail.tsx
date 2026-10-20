import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type TaskNudgeEmailProps = {
  name: string
  taskTitle: string
  projectTitle: string
  projectId: number
  taskId: number
  daysInactive: number
  activityPhrase: string
  lastActivityDate: string
  appUrl: string
}

export function TaskNudgeEmail({
  name,
  taskTitle,
  projectTitle,
  projectId,
  taskId,
  daysInactive,
  activityPhrase,
  lastActivityDate,
  appUrl,
}: TaskNudgeEmailProps) {
  const taskUrl = `${appUrl}/projects/${projectId}#task-${taskId}`
  return (
    <EmailLayout>
      <Heading as="h2">How&apos;s it going?</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>
        It&apos;s been {daysInactive} days since {activityPhrase} <strong>{taskTitle}</strong> in
        the project <strong>{projectTitle}</strong> (on {lastActivityDate}).
      </Text>
      <Text>
        Could you leave a quick comment with a progress update? Even a brief note, like
        &quot;ticking along, awaiting XYZ, will post another update in 2 weeks&quot;, is really
        helpful so the project team knows things are in good hands.
      </Text>
      <Text>
        If you don&apos;t have capacity for the task right now, it&apos;s much better to update the
        project page with an ETA than for the team not to know what&apos;s happening.
      </Text>
      <Text>
        We&apos;ll send another reminder in a week if we haven&apos;t heard from you, it&apos;s
        important that things move along smoothly so everyone can make progress.
      </Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={taskUrl}>Leave an update</EmailButton>
      </Section>
      <Text>
        If you can no longer work on this task, please release it so someone else can pick it up.
      </Text>
      <Text>If you need support, please contact your project owner or admin.</Text>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Leave an update', url: taskUrl }]} />
    </EmailLayout>
  )
}
