import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type ApplicationApprovedEmailProps = {
  name: string
  appUrl: string
}

export function ApplicationApprovedEmail({ name, appUrl }: ApplicationApprovedEmailProps) {
  const loginUrl = `${appUrl}/login`
  return (
    <EmailLayout>
      <Heading as="h2">Welcome to Catalyse!</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>Thank you for applying to join Catalyse PauseAI. Welcome to the community!</Text>
      <Text>Your account has been approved and you can now sign in.</Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={loginUrl}>Sign In</EmailButton>
      </Section>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Sign In', url: loginUrl }]} />
    </EmailLayout>
  )
}
