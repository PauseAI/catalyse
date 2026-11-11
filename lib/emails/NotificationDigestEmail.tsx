import { Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailFooter } from './components/Footer'
import type { DigestSection } from '../notification-digest'

export type NotificationDigestEmailProps = {
  name: string
  sections: DigestSection[]
  appUrl: string
}

export function NotificationDigestEmail({ name, sections, appUrl }: NotificationDigestEmailProps) {
  return (
    <EmailLayout>
      <Text>{`Hi ${name},`}</Text>
      <Text>Here are the notifications you asked to get in one daily email.</Text>
      {sections.map((s) => (
        <div key={s.category}>
          <h3 style={{ margin: '24px 0 8px' }}>{s.heading}</h3>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {s.items.map((item, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                <a href={`${appUrl}${item.href}`}>{item.title}</a>
                {item.body && <div style={{ color: '#4a5568', fontSize: 14 }}>{item.body}</div>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Text style={{ fontSize: 13, color: '#718096', marginTop: 24 }}>
        Everything here is also in your <a href={`${appUrl}/inbox`}>Inbox</a>. Choose what comes by
        email in <a href={`${appUrl}/settings?tab=notifications`}>Settings</a>.
      </Text>
      <EmailFooter appUrl={appUrl} />
    </EmailLayout>
  )
}
