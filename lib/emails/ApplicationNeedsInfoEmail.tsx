import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type ApplicationNeedsInfoEmailProps = {
  name: string
  loginUrl: string
  appUrl: string
  applicantNotes?: string
}

export function ApplicationNeedsInfoEmail({
  name,
  loginUrl,
  appUrl,
  applicantNotes,
}: ApplicationNeedsInfoEmailProps) {
  return (
    <EmailLayout>
      <Heading as="h2">We need a bit more information</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>
        Thanks for applying to join Catalyse PauseAI. Before we can finish reviewing your
        application, we need some more information from you:
      </Text>
      {applicantNotes && (
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
      )}
      <Text>Log in to your account to update your application and resubmit it for review.</Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={loginUrl}>Log In</EmailButton>
      </Section>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Log In', url: loginUrl }]} />
    </EmailLayout>
  )
}
