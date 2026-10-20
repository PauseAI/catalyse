import { Hr, Link, Text } from '@react-email/components'

export type FooterButton = { label: string; url: string }

/**
 * Matches the old `footer()` helper: a fallback link under each button, in case the button
 * itself doesn't render, plus the notification-preferences link every email carries.
 */
export function EmailFooter({
  appUrl,
  buttons = [],
}: {
  appUrl: string
  buttons?: FooterButton[]
}) {
  return (
    <>
      <Hr style={{ marginTop: 32, borderColor: '#e2e8f0' }} />
      <Text style={{ fontSize: 13, color: '#718096' }}>
        Catalyse - PauseAI Volunteer Platform - This is an automated email
      </Text>
      {buttons.map((b) => (
        <Text key={b.url} style={{ fontSize: 12, color: '#718096' }}>
          If the &quot;{b.label}&quot; button doesn&apos;t work, copy this link:{' '}
          <Link href={b.url} style={{ color: '#718096', wordBreak: 'break-all' as const }}>
            {b.url}
          </Link>
        </Text>
      ))}
      <Text style={{ fontSize: 12, color: '#718096' }}>
        <Link href={`${appUrl}/profile`}>Manage notification preferences</Link>
      </Text>
    </>
  )
}
