import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type AdminAlertEmailProps = {
  name: string
  subject: string
  /** Already-escaped HTML, built by the caller with the `html` tagged template. */
  message: string
  ctaLabel: string
  ctaUrl: string
  appUrl: string
}

export function AdminAlertEmail({
  name,
  subject,
  message,
  ctaLabel,
  ctaUrl,
  appUrl,
}: AdminAlertEmailProps) {
  return (
    <EmailLayout>
      <Heading as="h2">{subject}</Heading>
      <Text>{`Hi ${name},`}</Text>
      <p dangerouslySetInnerHTML={{ __html: message }} />
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={ctaUrl}>{ctaLabel}</EmailButton>
      </Section>
      <EmailFooter appUrl={appUrl} buttons={[{ label: ctaLabel, url: ctaUrl }]} />
    </EmailLayout>
  )
}
