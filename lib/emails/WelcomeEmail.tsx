import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type WelcomeEmailProps = {
  name: string
  appUrl: string
}

export function WelcomeEmail({ name, appUrl }: WelcomeEmailProps) {
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
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={appUrl}>Explore Projects</EmailButton>
      </Section>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Explore Projects', url: appUrl }]} />
    </EmailLayout>
  )
}
