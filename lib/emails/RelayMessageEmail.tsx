import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailFooter } from './components/Footer'

export type RelayMessageEmailProps = {
  toName: string
  fromName: string
  subject: string
  message: string
  projectTitle?: string
  threadUrl: string
  repliesByEmail: boolean
  appUrl: string
}

/**
 * A message relayed from one volunteer to another. `threadUrl` is where to reply on Catalyse;
 * `repliesByEmail` says whether the sender shared their address as the reply-to.
 */
export function RelayMessageEmail({
  toName,
  fromName,
  subject,
  message,
  projectTitle,
  threadUrl,
  repliesByEmail,
  appUrl,
}: RelayMessageEmailProps) {
  return (
    <EmailLayout>
      <Heading as="h2">Message from {fromName}</Heading>
      <Text>{`Hi ${toName},`}</Text>
      <Text>
        <strong>{fromName}</strong> has sent you a message via Catalyse
        {projectTitle && (
          <>
            {' '}
            about the project <strong>{projectTitle}</strong>
          </>
        )}
        :
      </Text>
      <div
        style={{
          background: '#f7fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: 16,
          margin: '16px 0',
          whiteSpace: 'pre-wrap',
        }}
      >
        <p style={{ fontWeight: 500, marginBottom: 8 }}>{subject}</p>
        <p>{message}</p>
      </div>
      <p>
        <a href={threadUrl}>Reply on Catalyse</a>
      </p>
      {repliesByEmail && (
        <Text>You can also reply to this email to write to {fromName} directly.</Text>
      )}
      <EmailFooter appUrl={appUrl} />
    </EmailLayout>
  )
}
