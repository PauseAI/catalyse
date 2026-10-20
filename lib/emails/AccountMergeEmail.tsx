import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type AccountMergeEmailProps = {
  confirmUrl: string
  name: string
  appUrl: string
}

/**
 * Sent to the address of the account being merged in, so a merge happens only once whoever
 * asked for it from the other account also holds this one's mailbox.
 */
export function AccountMergeEmail({ confirmUrl, name, appUrl }: AccountMergeEmailProps) {
  return (
    <EmailLayout>
      <Heading as="h2">Merge your Catalyse accounts</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>
        Someone signed in to another Catalyse account asked to merge it with the account for this
        address. Your projects, tasks, teams and messages would all move to one account, and you
        would choose which of the two addresses to sign in with.
      </Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={confirmUrl}>Review the merge</EmailButton>
      </Section>
      <Text>
        This link will expire in <strong>24 hours</strong>.
      </Text>
      <Text>If you didn&apos;t ask for this, ignore this email and nothing will change.</Text>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Review the merge', url: confirmUrl }]} />
    </EmailLayout>
  )
}
