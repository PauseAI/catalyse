import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type PasswordResetEmailProps = {
  resetUrl: string
  name: string
  appUrl: string
}

export function PasswordResetEmail({ resetUrl, name, appUrl }: PasswordResetEmailProps) {
  return (
    <EmailLayout>
      <Heading as="h2">Reset Your Password</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>
        We received a request to reset your password for your Catalyse account. Click the button
        below to choose a new password:
      </Text>
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={resetUrl}>Reset Password</EmailButton>
      </Section>
      <Text>
        This link will expire in <strong>1 hour</strong>.
      </Text>
      <Text>
        If you didn&apos;t request this, you can safely ignore this email. Your password won&apos;t
        be changed.
      </Text>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Reset Password', url: resetUrl }]} />
    </EmailLayout>
  )
}
