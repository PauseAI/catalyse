import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type PendingApplicationsSummaryEmailProps = {
  count: number
  appUrl: string
}

export function PendingApplicationsSummaryEmail({
  count,
  appUrl,
}: PendingApplicationsSummaryEmailProps) {
  const plural = count === 1 ? 'application' : 'applications'
  const applicationsUrl = `${appUrl}/admin/applications`
  return (
    <EmailLayout>
      <Heading as="h2">Pending Applications</Heading>
      <Text>
        There {count === 1 ? 'is' : 'are'} <strong>{count}</strong> pending {plural} waiting for
        review on Catalyse.
      </Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={applicationsUrl}>Review Applications</EmailButton>
      </Section>
      <EmailFooter
        appUrl={appUrl}
        buttons={[{ label: 'Review Applications', url: applicationsUrl }]}
      />
    </EmailLayout>
  )
}
