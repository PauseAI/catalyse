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
      <h3>{title}</h3>
      {body && <p className="text-text-light">{body}</p>}
      {action}
    </div>
  )
}
