import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type WelcomeAndConfirmEmailProps = {
  name: string
  confirmUrl: string
  appUrl: string
}

export function WelcomeAndConfirmEmail({ name, confirmUrl, appUrl }: WelcomeAndConfirmEmailProps) {
  return (
    <EmailLayout>
      <Heading as="h2">Welcome to Catalyse!</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>
        Thanks for joining the PauseAI volunteer community! We&apos;re excited to have you.
      </Text>
      <ul>
        <li>
          <strong>Browse projects</strong> - Find opportunities that match your skills
        </li>
        <li>
          <strong>Complete your profile</strong> - Help project owners find you
        </li>
        <li>
          <strong>Express interest</strong> - Let project owners know you want to help
        </li>
      </ul>
      <Text>Please confirm your email address to continue.</Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={confirmUrl}>Confirm Email</EmailButton>
      </Section>
      <Text>
        This link will expire in <strong>24 hours</strong>.
      </Text>
      <Text>If you didn&apos;t sign up for Catalyse, you can safely ignore this email.</Text>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Confirm Email', url: confirmUrl }]} />
    </EmailLayout>
  )
}
