import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type TaskFinalWarningEmailProps = {
  name: string
  taskTitle: string
  projectTitle: string
  projectId: number
  taskId: number
  daysInactive: number
  activityPhrase: string
  lastActivityDate: string
  surrenderDate: string
  appUrl: string
}

export function TaskFinalWarningEmail({
  name,
  taskTitle,
  projectTitle,
  projectId,
  taskId,
  daysInactive,
  activityPhrase,
  lastActivityDate,
  surrenderDate,
  appUrl,
}: TaskFinalWarningEmailProps) {
  const taskUrl = `${appUrl}/projects/${projectId}#task-${taskId}`
  return (
    <EmailLayout>
      <Heading as="h2">One more nudge</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>
        It&apos;s now been {daysInactive} days since {activityPhrase} <strong>{taskTitle}</strong>{' '}
        in <strong>{projectTitle}</strong> (on {lastActivityDate}).
      </Text>
      <div
        style={{
          background: '#FFF3CD',
          borderLeft: '4px solid #FF9416',
          padding: '12px 16px',
          borderRadius: 4,
          margin: '16px 0',
        }}
      >
        <strong>
          If there is no update by {surrenderDate}, we&apos;ll open the task to other contributors
        </strong>{' '}
        so the project can keep moving forward.
      </div>
      <Text>
        Even a quick note is fine: anything to let the project team know you&apos;re still on it. If
        life has got busy, no worries at all, but it would really help to either leave an update or
        release the task so someone else can step in.
      </Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={taskUrl}>Leave an update</EmailButton>
      </Section>
      <Text>If you need support, please contact your project owner or a platform admin.</Text>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Leave an update', url: taskUrl }]} />
    </EmailLayout>
  )
}
