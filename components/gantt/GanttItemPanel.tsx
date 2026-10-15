'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/Badge'
import { LatenessBadge } from '@/components/StatusBadges'
import Button from '@/components/Button'
import Linkify from '@/components/Linkify'
import Tooltip from '@/components/Tooltip'
import { formatDateShort } from '@/lib/format-date'
import DatesBlock from '@/components/DatesBlock'
import TaskDatesSummary from '@/components/TaskDatesSummary'
import WorkItemCard from '@/components/WorkItemCard'
import type { WorkItemSummary } from '@/lib/work-item-summary'
import { handedIn } from '@/lib/overdue'
import { daysPastPlan } from '@/lib/replan'
import { lateness } from '@/lib/lateness'
import { ASSIGN_PICKED, UNASSIGN, claimLabel, type ClaimViewer } from '@/lib/action-labels'
import { UNCLAIMED_LABEL } from '@/lib/status-labels'
import { datesPayload, type DatesPayload, type DatesValue } from '@/lib/task-dates'
import { movedText, pinConflictSlip } from '@/lib/slip'
import { ANCHOR_HINT, CRITICAL_HINT } from './GanttLegend'
import { rowStatusBadge } from './palette'
import type { GanttRow } from './types'

/**
 * What the viewer may do about who is working on this task. `canAssign` is the manager's
 * power to hand it to anyone; `canClaim` is any eligible volunteer's power to take it
 * themselves. They are separate permissions and a viewer can hold either, both or neither.
 */
export type PanelAssignment = {
  canAssign: boolean
  canClaim: boolean
  claimViewer: ClaimViewer
  /** Volunteers the manager may pick from, already grouped and labelled by the caller. */
  options: { value: string; label: string; header?: boolean }[]
  onAssign: (volunteerId: number) => void
  onClaim: () => void
  onUnassign: () => void
}

export type PanelPredecessor = {
  dependencyId: number
  predecessorId: number
  predecessorTitle: string
  item: WorkItemSummary
}

/** One label/value line in the summary. Values wrap under themselves rather than into the label. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-light">{label}</dt>
      <dd className="text-brand-text m-0">{children}</dd>
    </>
  )
}

/** A section heading with a rule above it, so the panel reads as distinct blocks. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-brand-border mt-3 border-t pt-3">
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      {children}
    </section>
  )
}

/** Tasks as compact cards, one per line. */
function CardList({ items }: { items: WorkItemSummary[] }) {
  return (
    <ul className="m-0 list-none space-y-2 p-0">
      {items.map((item) => (
        <li key={item.id}>
          <WorkItemCard item={item} variant="compact" />
        </li>
      ))}
    </ul>
  )
}

/**
 * The click-a-bar side panel — and the keyboard/screen-reader-complete way to do everything the
 * drag gestures do: set or clear the pinned start and change the duration here, and links and
 * the key date through `planMenu`. Read-only facts come first; a control appears only for a
 * viewer who can use it, and the Dates block only once Edit dates is pressed.
 */
export default function GanttItemPanel({
  row,
  dates,
  description,
  assigneeName,
  helpers,
  canManage,
  predecessors,
  successors = [],
  busy,
  onClose,
  onSaveDates,
  planMenu,
  onReplan,
  onReopen,
  assignment,
  viewerIsAssignee = false,
}: {
  row: GanttRow
  /** The stored dates, timing, effort and deadline, as the Dates block edits them. */
  dates: DatesValue
  description?: string | null
  assigneeName?: string | null
  /** Its helpers in a few words (helperSummary); omit for none. */
  helpers?: string | null
  canManage: boolean
  predecessors: PanelPredecessor[]
  /** The tasks that wait on this one. */
  successors?: WorkItemSummary[]
  busy?: boolean
  onClose: () => void
  onSaveDates: (patch: DatesPayload) => void
  /** The Plan menu (GanttPlanMenu); omit for a viewer who cannot change the plan. */
  planMenu?: ReactNode
  /** Opens the replan dialog for a task that has run past its plan; omit where it cannot. */
  onReplan?: () => void
  /** Asks to reopen a done task; omit for a viewer who cannot. */
  onReopen?: () => void
  /** Omit to leave the panel read-only about who is doing the work. */
  assignment?: PanelAssignment
  /** The viewer holds this task: its lateness is theirs to act on, as it is a manager's. */
  viewerIsAssignee?: boolean
}) {
  const [draft, setDraft] = useState(dates)
  // Keyed on the row, so selecting another bar closes the Dates block.
  const [editingId, setEditingId] = useState<number | null>(null)
  const [pickedAssignee, setPickedAssignee] = useState('')

  useEffect(() => {
    // Re-seed the inputs when a different bar is selected or its stored dates change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(dates)
    // Keyed on the values, not the object, which callers rebuild on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, dates.timing, dates.startDate, dates.estimatedHours, dates.deadline])

  const p = row.placement
  const done = row.status === 'completed'
  // A done task is read-only until it is reopened (lib/work-item-lock.ts).
  const canEdit = canManage && !done
  const editing = canEdit && editingId === row.id
  const estimatedHours = dates.estimatedHours ? parseFloat(dates.estimatedHours) : null
  const pastPlan = daysPastPlan(p.end, { done, assigned: !!assigneeName })
  const late = lateness({
    deadline: p.deadline,
    pastPlanDays: pastPlan,
    done: handedIn(row.status),
  })
  const rowBadge = rowStatusBadge(row.status)
  const conflict = pinConflictSlip(
    p,
    predecessors.find((d) => d.predecessorId === p.pinConflictWith)?.predecessorTitle,
  )
  const canStaff = !!assignment && !done && (assignment.canAssign || assignment.canClaim)

  function save(next: DatesValue) {
    setDraft(next)
    onSaveDates(datesPayload(next))
    setEditingId(null)
  }

  return (
    <aside className="border-brand-border bg-surface rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="m-0 text-base leading-snug">{row.label}</h3>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
          ×
        </Button>
      </div>

      {/* The work item card's status and assignee, with the marks true of the whole item. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Badge variant={rowBadge.variant}>{rowBadge.label}</Badge>
        <span className="text-text-light">{assigneeName || UNCLAIMED_LABEL}</span>
        {helpers && <span className="text-text-light">· {helpers}</span>}
        {p.isMilestone && (
          <span className="border-brand-border text-text-light rounded-full border px-2 py-0.5 text-xs">
            Milestone
          </span>
        )}
        {p.isAnchor && (
          <Tooltip content={ANCHOR_HINT}>
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ background: 'var(--gantt-anchor)', color: 'var(--gantt-bar-text)' }}
            >
              ★ Key date
            </span>
          </Tooltip>
        )}
        {done && onReopen && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onReopen}>
            Reopen
          </Button>
        )}
      </div>

      {description && (
        <p className="mt-2 mb-0 text-sm whitespace-pre-wrap">
          <Linkify text={description} />
        </p>
      )}

      <Section title="When">
        <TaskDatesSummary
          className="mb-0"
          estimatedHours={estimatedHours}
          deadline={p.deadline}
          openStart={!dates.startDate && predecessors.length === 0}
          placement={p}
          handedIn={handedIn(row.status)}
        />

        {late && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <LatenessBadge
              lateness={late}
              viewer={{ isAssignee: viewerIsAssignee, canReview: canManage }}
            />
            {pastPlan !== null && onReplan && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={onReplan}>
                Replan
              </Button>
            )}
          </div>
        )}

        {/* The planner's view of this bar, folded away like the timeline's own Planning tools. */}
        {canManage && (
          <details className="border-brand-border mt-2 rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              Planning tools
              {conflict && <span className="text-error"> · starts too early</span>}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {p.isCritical && (
                <Tooltip content={CRITICAL_HINT}>
                  <span
                    className="self-start rounded-full px-2 py-0.5 text-xs"
                    style={{ background: 'var(--gantt-critical)', color: 'var(--gantt-bar-text)' }}
                  >
                    Critical path
                  </span>
                </Tooltip>
              )}
              <dl className="m-0 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
                {p.baseline && (
                  <Fact label="Original plan">
                    {formatDateShort(p.baseline.start)} – {formatDateShort(p.baseline.end)}
                  </Fact>
                )}
                {/* Days moved only mean something against a saved original plan. With none there
                    is nothing to compare to, so the row is absent rather than reading a misleading
                    "On plan". */}
                {p.baseline && (
                  <Fact label="Moved">
                    <span className={p.finishVarianceDays ? 'text-warning-text' : undefined}>
                      {p.finishVarianceDays
                        ? `${movedText(p.finishVarianceDays)} (${formatDateShort(p.baseline.end)} → ${formatDateShort(p.end)})`
                        : 'On plan'}
                    </span>
                  </Fact>
                )}
                {p.actual && (
                  <Fact label="Actual">
                    {formatDateShort(p.actual.start)}
                    {p.actual.end ? ` – ${formatDateShort(p.actual.end)}` : ' – in progress'}
                  </Fact>
                )}
              </dl>
              {!p.baseline && (
                <p className="text-text-light m-0 text-xs">
                  No original plan saved yet, so nothing to compare.
                </p>
              )}
              {conflict && <p className="text-error m-0">{conflict}</p>}
            </div>
          </details>
        )}

        {canEdit && !editing && (
          <Button
            className="mt-2"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setEditingId(row.id)}
          >
            Edit dates
          </Button>
        )}

        {editing && (
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault()
              save(draft)
            }}
          >
            <DatesBlock
              id="panel"
              value={draft}
              onChange={setDraft}
              followsTitle={predecessors[0]?.predecessorTitle ?? null}
              derivedStart={draft.startDate ? null : p.start}
              disabled={busy}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDraft(dates)
                  setEditingId(null)
                }}
              >
                Cancel
              </Button>
              {draft.startDate && predecessors.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  title="Clear the start date so it begins when the work before it finishes"
                  onClick={() => save({ ...draft, startDate: '' })}
                >
                  Start when “{predecessors[0].predecessorTitle}” is done
                </Button>
              )}
            </div>
          </form>
        )}
      </Section>

      <Section title="Waits on">
        {predecessors.length === 0 ? (
          <p className="text-text-light m-0 text-sm">Nothing — can start whenever.</p>
        ) : (
          <CardList items={predecessors.map((d) => d.item)} />
        )}
      </Section>

      {successors.length > 0 && (
        <Section title="Unblocks">
          <CardList items={successors} />
        </Section>
      )}

      {assignment && canStaff && (
        <Section title="Assigned to">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{assigneeName || UNCLAIMED_LABEL}</span>
            {assignment.canClaim && !assigneeName && (
              <Button size="sm" disabled={busy} onClick={assignment.onClaim}>
                {claimLabel(assignment.claimViewer)}
              </Button>
            )}
            {assigneeName && assignment.canAssign && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={assignment.onUnassign}>
                {UNASSIGN}
              </Button>
            )}
            {assignment.canAssign && (
              <>
                <div className="min-w-40 flex-1">
                  <label htmlFor="panel-assignee" className="sr-only">
                    Assign to a volunteer
                  </label>
                  <select
                    id="panel-assignee"
                    value={pickedAssignee}
                    disabled={busy}
                    onChange={(e) => setPickedAssignee(e.target.value)}
                  >
                    {assignment.options.map((o) => (
                      <option key={o.value} value={o.value} disabled={o.header}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !pickedAssignee}
                  onClick={() => {
                    assignment.onAssign(parseInt(pickedAssignee, 10))
                    setPickedAssignee('')
                  }}
                >
                  {ASSIGN_PICKED}
                </Button>
              </>
            )}
          </div>
        </Section>
      )}

      {(row.href || planMenu) && (
        <div className="border-brand-border mt-3 flex items-center justify-between gap-2 border-t pt-3 text-sm">
          {row.href && (
            <Link href={row.href} className="text-primary-text underline">
              Open task →
            </Link>
          )}
          <div className="ml-auto">{planMenu}</div>
        </div>
      )}
    </aside>
  )
}
