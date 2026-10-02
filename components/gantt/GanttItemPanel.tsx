'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/Button'
import Linkify from '@/components/Linkify'
import Tooltip from '@/components/Tooltip'
import { formatDateShort } from '@/lib/format-date'
import DatesBlock from '@/components/DatesBlock'
import { daysPastPlan } from '@/lib/replan'
import { plural } from '@/lib/plural'
import { datesPayload, windowText, type DatesPayload, type DatesValue } from '@/lib/task-dates'
import { deadlineStanding, movedText, pinConflictSlip } from '@/lib/slip'
import { barFill, barTone, TONE_LABELS } from './palette'
import { ANCHOR_HINT, CRITICAL_HINT } from './GanttLegend'
import type { GanttRow } from './types'

/**
 * What the viewer may do about who is working on this task. `canAssign` is the manager's
 * power to hand it to anyone; `canClaim` is any eligible volunteer's power to take it
 * themselves. They are separate permissions and a viewer can hold either, both or neither.
 */
export type PanelAssignment = {
  canAssign: boolean
  canClaim: boolean
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
  lagDays: number
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
    <section className="border-brand-border mt-4 border-t pt-4">
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      {children}
    </section>
  )
}

/**
 * The click-a-bar side panel — and the keyboard/screen-reader-complete way to do everything the
 * drag gestures do: set or clear the pinned start, change the duration, and manage links.
 */
export default function GanttItemPanel({
  row,
  dates,
  description,
  assigneeName,
  canManage,
  siblings,
  predecessors,
  busy,
  onClose,
  onSaveDates,
  onAddDependency,
  onRemoveDependency,
  onUpdateLag,
  onSetAnchor,
  onReplan,
  assignment,
}: {
  row: GanttRow
  /** The stored dates, timing, effort and deadline, as the Dates block edits them. */
  dates: DatesValue
  description?: string | null
  assigneeName?: string | null
  canManage: boolean
  siblings: { id: number; title: string }[]
  predecessors: PanelPredecessor[]
  busy?: boolean
  onClose: () => void
  onSaveDates: (patch: DatesPayload) => void
  onAddDependency: (predecessorId: number, lagDays: number) => void
  onRemoveDependency: (dependencyId: number) => void
  onUpdateLag: (dependencyId: number, lagDays: number) => void
  onSetAnchor?: (isAnchor: boolean) => void
  /** Opens the replan dialog for a task that has run past its plan; omit where it cannot. */
  onReplan?: () => void
  /** Omit to leave the panel read-only about who is doing the work. */
  assignment?: PanelAssignment
}) {
  const [draft, setDraft] = useState(dates)
  const [newPred, setNewPred] = useState('')
  const [newLag, setNewLag] = useState('')
  const [pickedAssignee, setPickedAssignee] = useState('')

  useEffect(() => {
    // Re-seed the inputs when a different bar is selected or its stored dates change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(dates)
    // Keyed on the values, not the object, which callers rebuild on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    row.id,
    dates.timing,
    dates.startDate,
    dates.durationDays,
    dates.estimatedHours,
    dates.deadline,
  ])

  const p = row.placement
  const estimatedHours = dates.estimatedHours ? parseFloat(dates.estimatedHours) : null
  const pastPlan = daysPastPlan(p.end, {
    done: row.status === 'completed',
    assigned: !!assigneeName,
  })
  const standing = deadlineStanding(p, row.status === 'completed')
  const conflict = pinConflictSlip(
    p,
    predecessors.find((d) => d.predecessorId === p.pinConflictWith)?.predecessorTitle,
  )

  const span = windowText(p.start, p.end)

  const taken = new Set(predecessors.map((d) => d.predecessorId))
  const addable = siblings.filter((s) => !taken.has(s.id) && s.id !== row.id)

  return (
    <aside className="border-brand-border bg-surface rounded-lg border p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="m-0 text-base leading-snug">{row.label}</h3>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
          ×
        </Button>
      </div>

      {/* Chips carry the facts that are true of the whole item, so the table below stays dates. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span
          className="rounded-full px-2 py-0.5"
          style={{ background: barFill(row.status), color: 'var(--gantt-bar-text)' }}
        >
          {TONE_LABELS[barTone(row.status)]}
        </span>
        {p.isMilestone && (
          <span className="border-brand-border text-text-light rounded-full border px-2 py-0.5">
            Milestone
          </span>
        )}
        {p.isAnchor && (
          <Tooltip content={ANCHOR_HINT}>
            <span
              className="rounded-full px-2 py-0.5"
              style={{ background: 'var(--gantt-anchor)', color: 'var(--gantt-bar-text)' }}
            >
              ★ Key date
            </span>
          </Tooltip>
        )}
        {canManage && p.isCritical && (
          <Tooltip content={CRITICAL_HINT}>
            <span
              className="rounded-full px-2 py-0.5"
              style={{ background: 'var(--gantt-critical)', color: 'var(--gantt-bar-text)' }}
            >
              Critical path
            </span>
          </Tooltip>
        )}
        {pastPlan !== null && (
          <span className="border-warning-text text-warning-text rounded-full border px-2 py-0.5">
            {plural(pastPlan, 'day')} past plan
          </span>
        )}
        {pastPlan !== null && onReplan && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onReplan}>
            Replan
          </Button>
        )}
        {standing?.late && (
          <span
            className="rounded-full px-2 py-0.5"
            style={{ background: 'var(--gantt-today)', color: 'var(--gantt-bar-text)' }}
          >
            {standing.text}
          </span>
        )}
      </div>

      {description && (
        <p className="mb-3 text-sm whitespace-pre-wrap">
          <Linkify text={description} />
        </p>
      )}

      {/* Derived facts only. Anything editable is stated once, by its own control below — the
          panel should never print a value and then offer the field for it half a screen away. */}
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <Fact label="Planned">{span}</Fact>
        {p.deadline && standing && (
          <Fact label="Deadline">
            {formatDateShort(p.deadline)}{' '}
            <span className={standing.late ? 'text-error' : 'text-text-light'}>
              · {standing.text}
            </span>
          </Fact>
        )}
        {estimatedHours !== null && (
          <Fact label="Effort">
            {estimatedHours} hour{estimatedHours === 1 ? '' : 's'} of work
          </Fact>
        )}
        {p.baseline && (
          <Fact label="Original plan">
            {formatDateShort(p.baseline.start)} – {formatDateShort(p.baseline.end)}
          </Fact>
        )}
        {/* Days moved only mean something against a saved original plan. With none there is
            nothing to compare to, so the row is absent rather than reading a misleading
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

      {canManage && !p.baseline && (
        <p className="text-text-light mt-2 mb-0 text-xs">
          No original plan saved yet, so nothing to compare.
        </p>
      )}

      {conflict && <p className="text-error mt-2 mb-0 text-sm">{conflict}</p>}

      {canManage && (
        <Section title="Dates">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSaveDates(datesPayload(draft))
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

            {/* The key date belongs with the dates it governs, not in a section of its own. */}
            {onSetAnchor && (
              <label className="mb-3 flex items-center gap-2 font-normal">
                <input
                  type="checkbox"
                  className="w-auto"
                  checked={p.isAnchor}
                  disabled={busy}
                  onChange={(e) => onSetAnchor(e.target.checked)}
                />
                <Tooltip content={ANCHOR_HINT}>
                  <span className="text-sm decoration-dotted underline-offset-2 [text-decoration-line:underline]">
                    Key date — a fixed point the plan is built around
                  </span>
                </Tooltip>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                Save
              </Button>
              {draft.startDate && predecessors.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  title="Clear the start date so it begins when the work before it finishes"
                  onClick={() => {
                    const next = { ...draft, startDate: '' }
                    setDraft(next)
                    onSaveDates(datesPayload(next))
                  }}
                >
                  Follow “{predecessors[0].predecessorTitle}” instead
                </Button>
              )}
            </div>
          </form>
        </Section>
      )}

      <Section title="Depends on">
        {predecessors.length === 0 ? (
          <p className="text-text-light m-0 text-sm">Nothing — can start whenever.</p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0 text-sm">
            {predecessors.map((d) => (
              <li key={d.dependencyId} className="border-brand-border rounded-md border px-3 py-2">
                <p className="m-0 leading-snug">{d.predecessorTitle}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  {/* Lag is nearly always 0, so it gets a two-character box on one line. */}
                  <label
                    htmlFor={`panel-lag-${d.dependencyId}`}
                    className="text-text-light m-0 flex items-center gap-1.5 text-xs font-normal"
                  >
                    Lag
                    <input
                      id={`panel-lag-${d.dependencyId}`}
                      type="number"
                      step="1"
                      defaultValue={d.lagDays}
                      disabled={!canManage || busy}
                      className="w-14 !px-2 !py-1"
                      onBlur={(e) => {
                        const next = e.target.value ? parseInt(e.target.value, 10) : 0
                        if (next !== d.lagDays) onUpdateLag(d.dependencyId, next)
                      }}
                    />
                    days
                  </label>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRemoveDependency(d.dependencyId)}
                      aria-label={`Remove dependency on ${d.predecessorTitle}`}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage && addable.length > 0 && (
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!newPred) return
              onAddDependency(parseInt(newPred, 10), newLag ? parseInt(newLag, 10) : 0)
              setNewPred('')
              setNewLag('')
            }}
          >
            <label htmlFor="panel-add-pred">Add a dependency</label>
            <select
              id="panel-add-pred"
              value={newPred}
              onChange={(e) => setNewPred(e.target.value)}
            >
              <option value="">Select…</option>
              {addable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <div className="mt-2 flex items-center gap-2">
              <label
                htmlFor="panel-add-lag"
                className="text-text-light m-0 flex items-center gap-1.5 text-xs font-normal"
              >
                Lag
                <input
                  id="panel-add-lag"
                  type="number"
                  step="1"
                  value={newLag}
                  onChange={(e) => setNewLag(e.target.value)}
                  placeholder="0"
                  className="w-14 !px-2 !py-1"
                />
                days
              </label>
              <Button type="submit" size="sm" disabled={!newPred || busy}>
                Add
              </Button>
            </div>
          </form>
        )}
      </Section>

      {/* Who does the work comes after when it happens: this is the timeline's panel, and the
          task's own page is where staffing is really managed. */}
      <Section title="Assigned to">
        <p className="m-0 text-sm">{assigneeName || 'Nobody yet'}</p>

        {assignment && (assignment.canAssign || assignment.canClaim) && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {assignment.canClaim && !assigneeName && (
              <Button size="sm" disabled={busy} onClick={assignment.onClaim}>
                Assign to me
              </Button>
            )}
            {assigneeName && assignment.canAssign && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={assignment.onUnassign}>
                Unassign
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
                  Assign
                </Button>
              </>
            )}
          </div>
        )}
      </Section>

      {/* Navigation last, where it does not interrupt the editing controls. */}
      {row.href && (
        <p className="mt-4 mb-0 text-sm">
          <Link href={row.href} className="text-primary-text underline">
            Open task →
          </Link>
        </p>
      )}
    </aside>
  )
}
