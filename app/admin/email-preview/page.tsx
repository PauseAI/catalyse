'use client'

import { useRef, useState } from 'react'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { useQueries } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

type Param = string | number | boolean

const EMAIL_TYPES: { value: string; label: string; params: Record<string, Param> }[] = [
  {
    value: 'welcome-and-confirm',
    label: 'Welcome and Confirm Email',
    params: { name: 'Alex', confirm_token: 'sample-token-abc123' },
  },
  {
    value: 'application-received',
    label: 'Application Received',
    params: { name: 'Alex' },
  },
  {
    value: 'application-approved',
    label: 'Application Approved',
    params: { name: 'Alex' },
  },
  {
    value: 'application-rejected',
    label: 'Application Rejected',
    params: { name: 'Alex' },
  },
  {
    value: 'pending-applications-summary',
    label: 'Pending Applications Summary',
    params: { count: 3 },
  },
  {
    value: 'password-reset',
    label: 'Password Reset',
    params: { name: 'Alex', reset_token: 'sample-token-abc123' },
  },
  {
    value: 'admin-invite',
    label: 'Admin Invite',
    params: { invited_by: 'Jamie Smith', invite_token: 'sample-token-abc123' },
  },
  {
    value: 'welcome-google',
    label: 'Welcome (Google Sign-up)',
    params: { name: 'Alex' },
  },
  {
    value: 'project-notification',
    label: 'Project Notification',
    params: {
      name: 'Alex',
      subject: 'Your project has been approved',
      message:
        'Great news: your project AI Safety Explainer Series has been reviewed and approved.',
      project_id: 1,
    },
  },
  {
    value: 'local-group-suggestion-accepted',
    label: 'Local Group Suggestion (Accepted)',
    params: { name: 'Alex', action: 'accepted', groupName: 'London' },
  },
  {
    value: 'local-group-suggestion-merge',
    label: 'Local Group Suggestion (Merge)',
    params: {
      name: 'Alex',
      action: 'merge',
      groupName: 'London',
      adminNotes: 'Merged with existing South London group.',
    },
  },
  {
    value: 'local-group-suggestion-on-hold',
    label: 'Local Group Suggestion (On Hold)',
    params: {
      name: 'Alex',
      action: 'on_hold',
      groupName: 'London',
      adminNotes: 'We need a bit more time to assess this one.',
    },
  },
  {
    value: 'local-group-suggestion-declined',
    label: 'Local Group Suggestion (Declined)',
    params: {
      name: 'Alex',
      action: 'declined',
      groupName: 'London',
      adminNotes: 'We already have good coverage in this area.',
    },
  },
  {
    value: 'relay-message',
    label: 'Relay Message',
    params: {
      to_name: 'Alex',
      from_name: 'Jamie Smith',
      subject: 'Collaboration on AI Safety Explainer Series',
      project_title: 'AI Safety Explainer Series',
    },
  },
  {
    value: 'digest-match',
    label: 'Digest (Skill Match)',
    params: { name: 'Alex', is_match: true, projects: '3 sample projects' },
  },
  {
    value: 'digest-general',
    label: 'Digest (General)',
    params: { name: 'Alex', is_match: false, projects: '3 sample projects' },
  },
  {
    value: 'task-nudge',
    label: 'Task Nudge',
    params: {
      name: 'Alex',
      task_title: 'Write fundraising copy',
      project_title: 'Climate Action Newsletter',
      days_inactive: 14,
      activity_phrase: 'you were assigned this task',
      last_activity_date: '16 April 2026',
    },
  },
  {
    value: 'task-final-warning',
    label: 'Task Final Warning',
    params: {
      name: 'Alex',
      task_title: 'Write fundraising copy',
      project_title: 'Climate Action Newsletter',
      days_inactive: 21,
      activity_phrase: 'you last updated this task',
      last_activity_date: '9 April 2026',
      surrender_date: '7 May 2026',
    },
  },
  {
    value: 'task-surrendered-owner',
    label: 'Task Surrendered (Owner)',
    params: {
      owner_name: 'Jordan',
      volunteer_name: 'Alex Johnson',
      task_title: 'Write fundraising copy',
      project_title: 'Climate Action Newsletter',
    },
  },
  {
    value: 'daily-summary',
    label: 'Daily Summary',
    params: { name: 'Alex' },
  },
  {
    value: 'task-surrendered-assignee',
    label: 'Task Surrendered (Assignee)',
    params: {
      name: 'Alex',
      task_title: 'Write fundraising copy',
      project_title: 'Climate Action Newsletter',
    },
  },
]

function AutoIframe({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(400)

  function resize() {
    const doc = ref.current?.contentDocument
    if (doc?.body) setHeight(doc.body.scrollHeight + 32)
  }

  return (
    <iframe
      ref={ref}
      srcDoc={html}
      onLoad={resize}
      style={{ width: '100%', height, border: 'none', display: 'block' }}
      title="Email preview"
    />
  )
}

function EmailRow({
  type,
  preview,
}: {
  type: (typeof EMAIL_TYPES)[number]
  preview: { subject: string; html: string } | undefined
}) {
  const openInNewTab = () => {
    const blob = new Blob([preview?.html ?? ''], { type: 'text/html' })
    window.open(URL.createObjectURL(blob), '_blank')
  }

  return (
    <section className="border-b border-brand-border py-8">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="m-0 text-lg text-brand-text">{type.label}</h2>
        <button
          onClick={openInNewTab}
          className="bg-transparent border-none text-primary cursor-pointer text-[13px] p-0"
        >
          Open in new tab ↗
        </button>
      </div>
      <div className="grid grid-cols-[300px_1fr] gap-8 items-start max-[700px]:grid-cols-1">
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.05em] mb-2">
            Parameters
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                {Object.entries(type.params).map(([key, val]) => (
                  <tr key={key}>
                    <td className="py-1 pr-2 pl-0 text-gray-500 whitespace-nowrap align-top">
                      {key}
                    </td>
                    <td className="py-1 text-brand-text break-words">
                      {typeof val === 'boolean' ? (val ? 'true' : 'false') : String(val)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          {preview?.subject && (
            <p className="text-[13px] text-gray-500 mb-2 italic">
              Subject: <strong className="text-brand-text">{preview.subject}</strong>
            </p>
          )}
          <div className="border border-brand-border rounded-lg overflow-hidden bg-white">
            {preview?.html ? (
              <AutoIframe html={preview.html} />
            ) : (
              <p className="p-4 text-gray-500 m-0">Loading…</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function EmailPreviewPage() {
  const { user, loading } = useRequireAdmin()

  const results = useQueries({
    queries: EMAIL_TYPES.map((t) => ({
      ...orpc.admin.emailPreview.preview.queryOptions({ input: { type: t.value } }),
      enabled: !!user?.isAdmin,
    })),
  })

  if (loading || !user?.isAdmin) return null

  return (
    <>
      <main className="container pt-8 pb-16">
        <h1 className="mb-1">Email Previews</h1>
        <p className="text-gray-500 mb-0">All transactional emails rendered with sample data.</p>
        {EMAIL_TYPES.map((t, i) => (
          <EmailRow key={t.value} type={t} preview={results[i].data} />
        ))}
      </main>
    </>
  )
}
