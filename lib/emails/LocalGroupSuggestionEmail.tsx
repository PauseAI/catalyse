import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

const LOCAL_GROUP_SUGGESTION_MESSAGES: Record<string, (groupName: string) => string> = {
  accepted: (g) =>
    `Great news! Your suggestion <strong>"${g}"</strong> has been added as a new local group on Catalyse.`,
  merge: (g) =>
    `Your suggestion <strong>"${g}"</strong> has been merged with an existing local group.`,
  on_hold: (g) =>
    `Your local group suggestion <strong>"${g}"</strong> is currently under review. We'll be in touch if we need more information.`,
  declined: (g) =>
    `Thanks for your suggestion of <strong>"${g}"</strong>. After review, we've decided not to add it as a separate local group at this time.`,
}

export type LocalGroupSuggestionEmailProps = {
  name: string
  action: string
  groupName: string
  appUrl: string
  adminNotes?: string | null
}

export function LocalGroupSuggestionEmail({
  name,
  action,
  groupName,
  appUrl,
  adminNotes,
}: LocalGroupSuggestionEmailProps) {
  const getMessage = LOCAL_GROUP_SUGGESTION_MESSAGES[action]
  const message = getMessage
    ? getMessage(groupName)
    : `Your local group suggestion "${groupName}" has been reviewed.`
  return (
    <EmailLayout>
      <Heading as="h2">Local Group Suggestion Update</Heading>
      <Text>{`Hi ${name},`}</Text>
      <p dangerouslySetInnerHTML={{ __html: message }} />
      {adminNotes && (
        <Text>
          <em>{adminNotes}</em>
        </Text>
      )}
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={appUrl}>Visit Catalyse</EmailButton>
      </Section>
      <EmailFooter appUrl={appUrl} />
    </EmailLayout>
  )
}
