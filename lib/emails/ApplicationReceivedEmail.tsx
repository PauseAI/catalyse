import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailFooter } from './components/Footer'

export type ApplicationReceivedEmailProps = {
  name: string
  appUrl: string
}

export function ApplicationReceivedEmail({ name, appUrl }: ApplicationReceivedEmailProps) {
  return (
    <EmailLayout>
      <Heading as="h2">Application Received</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>
        Thanks for applying to join Catalyse, the PauseAI volunteer platform. We&apos;ve received
        your application and will review it shortly.
      </Text>
      <Text>You&apos;ll receive an email as soon as we&apos;ve reviewed your request to join.</Text>
      <EmailFooter appUrl={appUrl} />
    </EmailLayout>
  )
}
