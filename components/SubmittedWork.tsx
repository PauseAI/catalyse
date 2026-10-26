import Linkify from '@/components/Linkify'
import { H2 } from '@/components/Heading'
import { P } from '@/components/Text'
import TextLink from '@/components/TextLink'
import { formatDate } from '@/lib/format-date'
import PersonName from '@/components/PersonName'

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
  changesRequested: { message: string; byId: number | null; byName: string | null } | null
}) {
  return (
    <>
      {changesRequested && (
        <section className="mt-4 rounded-lg p-4 border-l-4 border-warning bg-brand-bg">
          <H2 className="text-base m-0 mb-1">
            Changes requested
            {changesRequested.byName && (
              <>
                {' by '}
                <PersonName id={changesRequested.byId} name={changesRequested.byName} />
              </>
            )}
          </H2>
          <P className="m-0 whitespace-pre-wrap">
            <Linkify text={changesRequested.message} />
          </P>
        </section>
      )}
      {submission && (
        <section className="mt-4 rounded-lg p-4 bg-brand-bg">
          <H2 className="text-base m-0 mb-1">Submitted work</H2>
          {submission.note && (
            <P className="m-0 mb-2 whitespace-pre-wrap">
              <Linkify text={submission.note} />
            </P>
          )}
          {submission.url && (
            <P className="m-0 mb-2 break-all">
              <TextLink href={submission.url} target="_blank" rel="noopener noreferrer">
                {submission.url}
              </TextLink>
            </P>
          )}
          <P className="text-xs text-text-light m-0">
            Submitted {formatDate(submission.submittedAt)}
          </P>
        </section>
      )}
    </>
  )
}
