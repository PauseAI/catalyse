import { H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import { SECTION_CARD } from '@/lib/ui-classes'

/** An empty list, saying what to do next: `action` is a link or button to the next step. */
export default function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word text-center`}>
      <H3>{title}</H3>
      {body && <P className="text-text-light">{body}</P>}
      {action}
    </div>
  )
}
