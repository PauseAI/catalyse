import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type OutreachLoginEmailProps = {
  loginUrl: string
  appUrl: string
}

export function OutreachLoginEmail({ loginUrl, appUrl }: OutreachLoginEmailProps) {
  return (
    <EmailLayout>
      <Heading as="h2">Your journalist outreach link</Heading>
      <Text>Hi there,</Text>
      <Text>
        Thanks for helping with People for a Pause journalist outreach. Click the button below to
        start:
      </Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={loginUrl}>Start outreach</EmailButton>
      </Section>
      <Text>
        This link will expire in <strong>1 hour</strong> and can be used once.
      </Text>
      <Text>If you didn&apos;t request this, you can safely ignore this email.</Text>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Start outreach', url: loginUrl }]} />
    </EmailLayout>
  )
}
