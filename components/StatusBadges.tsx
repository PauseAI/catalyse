import { Badge } from '@/components/Badge'
import { LATENESS_VARIANTS, latenessLabel, type Lateness } from '@/lib/lateness'
import { workStatusBadge } from '@/lib/status-labels'

/** A task or Quick Task's status badge (`workStatusBadge`). */
export function WorkStatusBadge({
  status,
  quick = false,
  changesRequested = false,
  outline = false,
}: {
  status: string
  quick?: boolean
  changesRequested?: boolean
  outline?: boolean
}) {
  const { label, variant } = workStatusBadge(status, quick, changesRequested)
  return (
    <Badge variant={variant} outline={outline}>
      {label}
    </Badge>
  )
}

/** "3 days late" or "Due in 2 days", from `lateness`; nothing for work with time to spare. */
export function LatenessBadge({
  lateness,
  outline = false,
}: {
  lateness: Lateness | null
  outline?: boolean
}) {
  if (!lateness) return null
  return (
    <Badge variant={LATENESS_VARIANTS[lateness.kind]} outline={outline}>
      {latenessLabel(lateness)}
    </Badge>
  )
}
