import { Badge } from '@/components/Badge'
import { LATENESS_VARIANTS, latenessLabel, lateness, type Lateness } from '@/lib/lateness'
import {
  projectStatusLabel,
  projectStatusOutline,
  projectStatusVariant,
} from '@/lib/project-status'
import { shortDay } from '@/lib/relative-date'
import { latenessOutline, statusOutline, type WorkViewer } from '@/lib/status-emphasis'
import { workStatusBadge } from '@/lib/status-labels'

/** A task or Quick Task's status badge (`workStatusBadge`), emphasised for `viewer`. */
export function WorkStatusBadge({
  status,
  viewer,
  quick = false,
  changesRequested = false,
  role,
  className,
}: {
  status: string
  viewer: WorkViewer
  quick?: boolean
  changesRequested?: boolean
  role?: string
  className?: string
}) {
  const { label, variant } = workStatusBadge(status, quick, changesRequested)
  return (
    <Badge
      variant={variant}
      outline={statusOutline(status, changesRequested, viewer)}
      role={role}
      className={className}
    >
      {label}
    </Badge>
  )
}

/** A project's lifecycle status. A proposal in review is filled only for an admin. */
export function ProjectStatusBadge({
  status,
  viewerIsAdmin,
  'aria-label': ariaLabel,
}: {
  status: string
  viewerIsAdmin: boolean
  'aria-label'?: string
}) {
  return (
    <Badge
      variant={projectStatusVariant(status)}
      outline={projectStatusOutline(status, viewerIsAdmin)}
      aria-label={ariaLabel}
    >
      {projectStatusLabel(status)}
    </Badge>
  )
}

/** "3 days late" or "Due in 2 days", from `lateness`; nothing for work with time to spare. */
export function LatenessBadge({
  lateness,
  viewer,
}: {
  lateness: Lateness | null
  viewer: WorkViewer
}) {
  if (!lateness) return null
  return (
    <Badge variant={LATENESS_VARIANTS[lateness.kind]} outline={latenessOutline(viewer)}>
      {latenessLabel(lateness)}
    </Badge>
  )
}

/**
 * When work is due, said once: its Late or Due soon badge when it has one, otherwise
 * "Due 14 Oct". Without a deadline it shows `noDeadline`, or nothing.
 */
export function DueChip({
  deadline,
  done,
  viewer,
  pastPlanDays = null,
  noDeadline,
  className = '',
  today = new Date(),
}: {
  deadline: Date | string | null | undefined
  /** Done or handed in (`handedIn`): it can no longer be late. */
  done: boolean
  viewer: WorkViewer
  pastPlanDays?: number | null
  noDeadline?: string
  /** For the plain date: its size, where the surrounding text does not set one. */
  className?: string
  today?: Date
}) {
  const late = lateness({ deadline: deadline ?? null, pastPlanDays, done }, today)
  if (late) return <LatenessBadge lateness={late} viewer={viewer} />
  const plain = `text-text-light whitespace-nowrap ${className}`.trim()
  if (!deadline) return noDeadline ? <span className={plain}>{noDeadline}</span> : null
  return <span className={plain}>Due {shortDay(deadline, today)}</span>
}
