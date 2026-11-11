import { Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailFooter } from './components/Footer'
import { LinkList } from './components/LinkList'
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
          <LinkList
            appUrl={appUrl}
            items={s.items.map((i) => ({ text: i.title, href: i.href, detail: i.body }))}
          />
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
