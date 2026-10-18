import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailFooter } from './components/Footer'

export type ApplicationRejectedEmailProps = {
  name: string
  appUrl: string
  applicantNotes?: string
}

export function ApplicationRejectedEmail({
  name,
  appUrl,
  applicantNotes,
}: ApplicationRejectedEmailProps) {
  return (
    <EmailLayout>
      <Heading as="h2">Update on your Catalyse application</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>
        Thank you for applying to join Catalyse PauseAI. Unfortunately we&apos;re unable to approve
        your application at this time.
      </Text>
      {applicantNotes && (
        <>
          <Text>
            <strong>Feedback from the team:</strong>
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
            {applicantNotes}
          </div>
        </>
      )}
      <Text>
        You can contact <a href="mailto:uk@pauseai.info">uk@pauseai.info</a> if you have any
        queries.
      </Text>
      <EmailFooter appUrl={appUrl} />
    </EmailLayout>
  )
}
