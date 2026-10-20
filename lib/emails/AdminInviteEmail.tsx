import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

/** "lead" or "deputy" of a named chapter, as the invite email and its subject put it. */
export type ChapterRoleInvite = { role: 'LEAD' | 'DEPUTY'; chapterName: string }

export const roleTitle = ({ role, chapterName }: ChapterRoleInvite) =>
  `${role === 'LEAD' ? 'lead' : 'a deputy lead'} of the ${chapterName} chapter`

export type AdminInviteEmailProps = {
  inviteUrl: string
  invitedBy: string
  invite: ChapterRoleInvite
  appUrl: string
}

export function AdminInviteEmail({ inviteUrl, invitedBy, invite, appUrl }: AdminInviteEmailProps) {
  const title = roleTitle(invite)
  return (
    <EmailLayout>
      <Heading as="h2">You&apos;re invited to run a PauseAI chapter</Heading>
      <Text>Hi there,</Text>
      <Text>
        <strong>{invitedBy}</strong> has invited you to be {title} on Catalyse, the PauseAI
        volunteer coordination platform.
      </Text>
      <ul>
        <li>Approve new volunteers who sign up in your country</li>
        <li>Review and approve projects your members propose, and start your own</li>
        <li>Run your chapter&apos;s teams, local groups and Quick Tasks</li>
        <li>Start projects from templates shared by every chapter</li>
        {invite.role === 'LEAD' && <li>Appoint deputies to help you</li>}
      </ul>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={inviteUrl}>Accept Invitation</EmailButton>
      </Section>
      <Text>
        This invitation expires in <strong>7 days</strong>.
      </Text>
      <Text>
        You&apos;ll need to sign up or log in with this email address to accept. If you belong to
        another chapter, accepting moves you into this one.
      </Text>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Accept Invitation', url: inviteUrl }]} />
    </EmailLayout>
  )
}
