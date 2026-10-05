import Linkify from '@/components/Linkify'
import { formatDate } from '@/lib/format-date'

export interface Submission {
  note: string | null
  url: string | null
  submittedAt: Date
}

/**
 * What the assignee handed in, and the reviewer's latest request for changes while the
 * task is back with them.
 */
export default function SubmittedWork({
  submission,
  changesRequested,
}: {
  submission: Submission | null
  changesRequested: { message: string; byName: string | null } | null
}) {
  return (
    <>
      {changesRequested && (
        <section className="mt-4 rounded-lg p-4 border-l-4 border-warning bg-brand-bg">
          <h2 className="text-base m-0 mb-1">
            Changes requested{changesRequested.byName ? ` by ${changesRequested.byName}` : ''}
          </h2>
          <p className="m-0 whitespace-pre-wrap">
            <Linkify text={changesRequested.message} />
          </p>
        </section>
      )}
      {submission && (
        <section className="mt-4 rounded-lg p-4 bg-brand-bg">
          <h2 className="text-base m-0 mb-1">Submitted work</h2>
          {submission.note && (
            <p className="m-0 mb-2 whitespace-pre-wrap">
              <Linkify text={submission.note} />
            </p>
          )}
          {submission.url && (
            <p className="m-0 mb-2 break-all">
              <a href={submission.url} target="_blank" rel="noopener noreferrer">
                {submission.url}
              </a>
            </p>
          )}
          <p className="text-xs text-text-light m-0">
            Submitted {formatDate(submission.submittedAt)}
          </p>
        </section>
      )}
    </>
  )
}
