'use client'

import { useDraggable, useDroppable } from '@dnd-kit/core'
import { formatDate } from '@/lib/format-date'
import { deadlineSlip, deadlineStanding, movedSlip, movedText, pinConflictSlip } from '@/lib/slip'
import { windowReading } from '@/lib/task-dates'
import { diffInDays } from '@/lib/schedule'
import { barFill } from './palette'
import {
  dateToX,
  markGeometry,
  ROW_HEIGHT,
  BAR_HEIGHT,
  MILESTONE_SIZE,
  RULE_HEIGHT,
} from './geometry'
import type { GanttRow as GanttRowData } from './types'

/** Smallest bar we will draw, so a one-day item at a coarse scale is still clickable. */
const MIN_BAR_WIDTH = 8
/** Width of the stub that stands in for an item sitting outside the visible range. */
const OFF_WINDOW_WIDTH = 10

export default function GanttRow({
  row,
  origin,
  pxPerDay,
  windowWidth,
  editable,
  selected,
  highlighted,
  dimmed,
  onSelect,
  onHover,
  pinConflictLabel,
  highlightCritical = true,
}: {
  row: GanttRowData
  origin: Date
  pxPerDay: number
  /** Width of the visible window in px; every mark is clamped to it. */
  windowWidth: number
  editable: boolean
  selected: boolean
  /** This row is the focus of the current hover/selection, or is linked to it. */
  highlighted: boolean
  /** Something else is focused and this row is unrelated to it. */
  dimmed: boolean
  onSelect?: (id: number) => void
  onHover?: (id: number | null) => void
  /** Name of the predecessor a conflicting pin starts too early for. */
  pinConflictLabel?: string
  /** Ring the critical path; a planning aid, so only for those who can change the plan. */
  highlightCritical?: boolean
}) {
  const { placement } = row
  const milestone = placement.isMilestone
  const midY = ROW_HEIGHT / 2

  const mark = markGeometry(
    placement.start,
    placement.end,
    milestone,
    origin,
    pxPerDay,
    windowWidth,
  )
  const baselineMark = placement.baseline
    ? markGeometry(
        placement.baseline.start,
        placement.baseline.end,
        false,
        origin,
        pxPerDay,
        windowWidth,
      )
    : null
  const actualMark = placement.actual
    ? markGeometry(
        placement.actual.start,
        placement.actual.end ?? new Date(),
        false,
        origin,
        pxPerDay,
        windowWidth,
      )
    : null

  // Off-window rows keep a row and a clickable stub at the edge they ran off, rather than
  // vanishing — the name column still lists them, so a blank row would just look broken.
  const offWindow = !mark.visible
  const offAfter = dateToX(placement.start, origin, pxPerDay) >= windowWidth
  const draggable = editable && !offWindow

  const {
    setNodeRef: moveRef,
    listeners: moveListeners,
    attributes: moveAttrs,
    transform: moveTransform,
  } = useDraggable({ id: `move-${row.id}`, data: { kind: 'move', rowId: row.id } })
  const {
    setNodeRef: resizeRef,
    listeners: resizeListeners,
    attributes: resizeAttrs,
    transform: resizeTransform,
  } = useDraggable({ id: `resize-${row.id}`, data: { kind: 'resize-end', rowId: row.id } })
  const {
    setNodeRef: linkRef,
    listeners: linkListeners,
    attributes: linkAttrs,
    isDragging: linking,
  } = useDraggable({ id: `link-${row.id}`, data: { kind: 'link', rowId: row.id } })
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `drop-${row.id}`,
    data: { rowId: row.id },
  })

  const rangeLabel = milestone
    ? formatDate(placement.start)
    : `${formatDate(placement.start)} – ${formatDate(placement.end)}`
  const variance = placement.finishVarianceDays
    ? `${movedText(placement.finishVarianceDays)} than the original plan`
    : null
  const late = deadlineSlip(placement, row.status === 'completed')
  // A flexible window with less work in it than it spans is drawn faint, with the hours on it,
  // so it reads as "some time in here"; a fixed one is drawn solid with an edge.
  const fixedTiming = row.timing === 'fixed'
  const effort = row.effortHours ?? null
  const faint = row.timing === 'flexible' && effort !== null && !milestone
  const reading = row.timing
    ? windowReading(
        row.timing,
        milestone ? 0 : diffInDays(placement.start, placement.end) + 1,
        effort,
      )
    : null
  const standing = deadlineStanding(placement, row.status === 'completed')
  const lateAria =
    placement.deadline && standing
      ? `deadline ${formatDate(placement.deadline)}, ${standing.text}`
      : null
  const conflict = pinConflictSlip(placement, pinConflictLabel)

  const deadlineCentre = placement.deadline
    ? dateToX(placement.deadline, origin, pxPerDay) + pxPerDay / 2
    : null
  const deadlineX =
    deadlineCentre !== null && deadlineCentre >= 0 && deadlineCentre <= windowWidth
      ? deadlineCentre
      : null

  const moveOffset = draggable ? (moveTransform?.x ?? 0) : 0
  // A milestone has no duration to stretch, so only bars take the resize offset.
  const resizeOffset = draggable && !milestone ? (resizeTransform?.x ?? 0) : 0

  const barHeight = milestone && !offWindow ? MILESTONE_SIZE : BAR_HEIGHT
  const barWidth = offWindow
    ? OFF_WINDOW_WIDTH
    : milestone
      ? MILESTONE_SIZE
      : Math.max(mark.width + resizeOffset, MIN_BAR_WIDTH)
  const barLeft = offWindow
    ? offAfter
      ? windowWidth - OFF_WINDOW_WIDTH - 2
      : 2
    : mark.left + moveOffset
  const barTop = midY - barHeight / 2

  // Selection wins over the critical-path ring so the ring never hides which bar you picked.
  // The key date is for everyone; the critical path and the original plan are planning aids,
  // shown only to those who can change the plan.
  const isAnchor = placement.isAnchor
  const isCritical = editable && highlightCritical && placement.isCritical
  const ring = selected
    ? '0 0 0 2px var(--color-brand-text)'
    : isCritical
      ? 'inset 0 0 0 2px var(--gantt-critical)'
      : fixedTiming
        ? 'inset 0 0 0 2px var(--gantt-finish)'
        : undefined

  // A cut end is squared off, so a bar running past the window does not read as finishing there.
  const corner = (clipped: boolean) => (clipped ? 0 : 6)
  const barRadius = milestone
    ? 0
    : `${corner(mark.clippedStart)}px ${corner(mark.clippedEnd)}px ${corner(mark.clippedEnd)}px ${corner(mark.clippedStart)}px`

  return (
    <div
      ref={dropRef}
      className="group/row relative"
      style={{
        height: ROW_HEIGHT,
        background: isOver ? 'var(--gantt-row-hover)' : undefined,
        opacity: dimmed ? 0.35 : 1,
        transition: 'opacity 120ms ease-out',
      }}
      onMouseEnter={onHover ? () => onHover(row.id) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      {/* Planned baseline — a thin rule above the bar, so the plan reads as a reference rather
          than as work. */}
      {editable && placement.baseline && baselineMark?.visible && (
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            left: baselineMark.left,
            width: Math.max(baselineMark.width, MIN_BAR_WIDTH),
            top: midY - BAR_HEIGHT / 2 - RULE_HEIGHT - 2,
            height: RULE_HEIGHT,
            background: 'var(--gantt-baseline)',
          }}
          title={`Original plan ${formatDate(placement.baseline.start)} – ${formatDate(placement.baseline.end)}`}
        />
      )}

      {/* Current schedule — the interactive bar, or a diamond when the item is a milestone.
          The diamond is a rotated inner square rather than a rotated button, so the markers
          hung off the button stay upright. */}
      <button
        ref={moveRef}
        type="button"
        {...(draggable ? moveListeners : {})}
        {...(draggable ? moveAttrs : {})}
        onClick={onSelect ? () => onSelect(row.id) : undefined}
        aria-label={`${row.label}: ${milestone ? `milestone on ${rangeLabel}` : rangeLabel}${reading ? `, ${reading.toLowerCase()}` : ''}${lateAria ? `, ${lateAria}` : ''}${variance ? `, ${variance}` : ''}${isAnchor ? ', key date' : ''}${isCritical ? ', on the critical path' : ''}${offWindow ? ', outside the visible range' : ''}`}
        aria-pressed={selected}
        title={[
          row.label,
          milestone ? `Milestone — ${rangeLabel}` : rangeLabel,
          reading,
          late,
          movedSlip(placement),
          conflict,
          isAnchor && '★ Key date — the plan is built around this date',
          isCritical &&
            'Critical path — zero slack, so a day late here is a day late for the key date',
          offWindow && 'Outside the visible range',
        ]
          .filter(Boolean)
          .join('\n')}
        className="absolute border-0 p-0 text-left focus:outline-2 focus:outline-offset-2"
        style={{
          left: barLeft,
          width: barWidth,
          top: barTop,
          height: barHeight,
          borderRadius: barRadius,
          background:
            milestone && !offWindow
              ? 'transparent'
              : faint
                ? `color-mix(in srgb, ${barFill(row.status)} 40%, transparent)`
                : barFill(row.status),
          opacity: offWindow ? 0.4 : 1,
          cursor: draggable ? 'grab' : 'pointer',
          boxShadow: milestone && !offWindow ? undefined : ring,
          outlineColor: 'var(--color-brand-text)',
          filter: highlighted ? 'brightness(1.12)' : undefined,
          touchAction: 'none',
        }}
      >
        {faint && !offWindow && barWidth >= 28 && (
          <span
            aria-hidden="true"
            className="text-brand-text pointer-events-none flex h-full items-center px-1.5 text-[10px] leading-none font-semibold"
          >
            {effort}h
          </span>
        )}
        {milestone && !offWindow && (
          <span
            aria-hidden="true"
            className="block h-full w-full"
            style={{
              background: barFill(row.status),
              boxShadow: ring,
              borderRadius: 2,
              transform: 'rotate(45deg)',
            }}
          />
        )}
        {isAnchor && !offWindow && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute leading-none"
            style={{
              left: '50%',
              top: -13,
              transform: 'translateX(-50%)',
              color: 'var(--gantt-anchor)',
              fontSize: 12,
            }}
          >
            ★
          </span>
        )}
        {placement.pinnedBeforePredecessor && !offWindow && (
          <span
            className="absolute -right-1 -top-1 block h-2.5 w-2.5 rounded-full"
            style={{
              background: 'var(--gantt-today)',
              boxShadow: '0 0 0 1.5px var(--color-surface)',
            }}
            title={conflict ?? undefined}
          />
        )}
      </button>

      {draggable && (
        <>
          {/* Resize grip at the bar's right edge — invisible until the row is hovered, so a
              read-through of the chart is not littered with handles. A milestone has no
              duration, so it gets no grip, and neither does a bar cut off by the window. */}
          {!milestone && !mark.clippedEnd && (
            <span
              ref={resizeRef}
              {...resizeListeners}
              {...resizeAttrs}
              role="button"
              aria-label={`Resize ${row.label} — currently ${rangeLabel}`}
              tabIndex={0}
              // The grip covers most of a short bar, so a plain click on it selects the row
              // as a click on the bar would; only a drag resizes.
              onClick={onSelect ? () => onSelect(row.id) : undefined}
              className="absolute flex items-center justify-end opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
              style={{
                left: barLeft + barWidth - 6,
                top: barTop,
                width: 10,
                height: barHeight,
                cursor: 'ew-resize',
                touchAction: 'none',
              }}
            >
              <span
                aria-hidden="true"
                className="mr-1 block rounded-full"
                style={{
                  width: 2,
                  height: BAR_HEIGHT - 8,
                  background: 'var(--gantt-bar-text)',
                  opacity: 0.7,
                }}
              />
            </span>
          )}
          {/* Link handle just past the bar's end, likewise revealed on hover. */}
          <span
            ref={linkRef}
            {...linkListeners}
            {...linkAttrs}
            role="button"
            aria-label={`Draw a dependency from ${row.label}`}
            tabIndex={0}
            className={`absolute block h-3 w-3 rounded-full border-2 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 ${
              linking ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              left: barLeft + barWidth + 5,
              top: midY - 6,
              background: 'var(--color-surface)',
              borderColor: 'var(--gantt-link-active)',
              cursor: 'crosshair',
              touchAction: 'none',
            }}
          />
        </>
      )}

      {/* Actual — a thin rule below the bar; runs to today while still open. */}
      {placement.actual && actualMark?.visible && (
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            left: actualMark.left,
            width: Math.max(actualMark.width, MIN_BAR_WIDTH),
            top: midY + BAR_HEIGHT / 2 + 2,
            height: RULE_HEIGHT,
            background: 'var(--gantt-actual)',
            opacity: placement.actual.end ? 1 : 0.7,
          }}
          title={
            placement.actual.end
              ? `Actual ${formatDate(placement.actual.start)} – ${formatDate(placement.actual.end)}`
              : `Started ${formatDate(placement.actual.start)}, still open`
          }
        />
      )}

      {/* Deadline marker, on the deadline day itself; red with the day count once the plan
          runs past it. */}
      {deadlineX !== null && (
        <div
          className="pointer-events-none absolute flex items-center gap-0.5 whitespace-nowrap"
          style={{
            left: deadlineX - 5,
            top: midY + BAR_HEIGHT / 2 - 4,
            color: standing?.late ? 'var(--gantt-today)' : 'var(--color-text-light)',
            fontSize: 10,
            lineHeight: 1,
            fontWeight: 600,
          }}
          title={late ?? undefined}
        >
          <span aria-hidden="true">▲</span>
          {standing?.late && <span>+{standing.days}d</span>}
        </div>
      )}
    </div>
  )
}
