import { Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailFooter } from './components/Footer'
import { LinkList } from './components/LinkList'

export type SummaryEmailSection = {
  heading: string
  lines: { text: string; href: string }[]
  project?: true
}

export type DailySummaryEmailProps = {
  name: string
  sections: SummaryEmailSection[]
  appUrl: string
}

/** The projects a person leads sit together under one heading, each named beneath it. */
export function DailySummaryEmail({ name, sections, appUrl }: DailySummaryEmailProps) {
  return (
    <EmailLayout>
      <Text>{`Hi ${name},`}</Text>
      <Text>Here is what needs you today.</Text>
      {sections.map((s, i) => {
        const lead = s.project && !sections[i - 1]?.project
        return (
          <div key={i}>
            {lead && <h3 style={{ margin: '24px 0 8px' }}>Projects you lead</h3>}
            {s.project ? (
              <h4 style={{ margin: '16px 0 6px' }}>{s.heading}</h4>
            ) : (
              <h3 style={{ margin: '24px 0 8px' }}>{s.heading}</h3>
            )}
            <LinkList appUrl={appUrl} items={s.lines} />
          </div>
        )
      })}
      <Text style={{ fontSize: 13, color: '#718096', marginTop: 24 }}>
        You get this at most once a day, and only when there is something to report. Change it in{' '}
        <a href={`${appUrl}/settings`}>Settings</a>.
      </Text>
      <EmailFooter appUrl={appUrl} />
    </EmailLayout>
  )
}
