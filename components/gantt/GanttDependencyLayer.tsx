'use client'

import { useState } from 'react'
import { markGeometry, ROW_HEIGHT, BAR_HEIGHT } from './geometry'
import type { GanttEdge, GanttRow } from './types'

/** Corner radius on the elbows; small enough that a one-day gap still bends cleanly. */
const R = 4
/** How far a connector steps clear of a bar before it turns. */
const STEP = 12

/**
 * An elbow from the right edge of a predecessor to the left edge of its successor.
 *
 * Forward edges — the common case — step right, drop to the successor's row, then run in.
 * Backward edges (the successor starts at or before the predecessor ends) cannot do that
 * without doubling back through both bars, so they drop into the gap between the two rows
 * first, travel left there, and only then approach the successor from the left.
 */
function elbowPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { d: string; mid: { x: number; y: number } } {
  const down = y2 > y1 ? 1 : -1
  const endX = x2 - 4
  const forward = endX - x1 >= STEP * 2

  if (forward) {
    const turn = endX - STEP
    return {
      d: [
        `M ${x1} ${y1}`,
        `H ${turn - R}`,
        `Q ${turn} ${y1} ${turn} ${y1 + R * down}`,
        `V ${y2 - R * down}`,
        `Q ${turn} ${y2} ${turn + R} ${y2}`,
        `H ${endX}`,
      ].join(' '),
      // The vertical run is the one stretch of a forward elbow that crosses no bar, so it is
      // where a control can sit without covering the work it connects.
      mid: { x: turn, y: (y1 + y2) / 2 },
    }
  }

  // Lane between the two rows, clear of both bars.
  const laneY = y1 + down * (ROW_HEIGHT / 2 + (ROW_HEIGHT - BAR_HEIGHT) / 4)
  const out = x1 + STEP
  const back = endX - STEP
  return {
    d: [
      `M ${x1} ${y1}`,
      `H ${out - R}`,
      `Q ${out} ${y1} ${out} ${y1 + R * down}`,
      `V ${laneY - R * down}`,
      `Q ${out} ${laneY} ${out - R} ${laneY}`,
      `H ${back + R}`,
      `Q ${back} ${laneY} ${back} ${laneY + R * down}`,
      `V ${y2 - R * down}`,
      `Q ${back} ${y2} ${back + R} ${y2}`,
      `H ${endX}`,
    ].join(' '),
    mid: { x: (out + back) / 2, y: laneY },
  }
}

/**
 * A single SVG overlaid on the bar grid. Connectors are drawn faint by default so a dense
 * chart stays readable, and the ones touching the focused row are redrawn on top in full
 * contrast — the arrows answer "what does this task depend on?" rather than competing with
 * the bars for attention.
 */
export default function GanttDependencyLayer({
  rows,
  edges,
  origin,
  pxPerDay,
  width,
  height,
  focusedId,
  selectedId,
  busy,
  onRemove,
}: {
  rows: GanttRow[]
  edges: GanttEdge[]
  origin: Date
  pxPerDay: number
  width: number
  height: number
  /** The selected or hovered row, if any. Its edges are drawn highlighted. */
  focusedId?: number | null
  /** The clicked row. Only its edges get remove controls — see `removable` below. */
  selectedId?: number | null
  busy?: boolean
  /** Omit to make the arrows read-only. Only edges that carry a row id can be removed. */
  onRemove?: (dependencyId: number) => void
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const indexById = new Map(rows.map((r, i) => [r.id, i]))
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const focus = focusedId ?? null

  const paths = edges.flatMap((edge) => {
    const fromRow = rowById.get(edge.predecessorId)
    const toRow = rowById.get(edge.successorId)
    const fromIndex = indexById.get(edge.predecessorId)
    const toIndex = indexById.get(edge.successorId)
    if (!fromRow || !toRow || fromIndex === undefined || toIndex === undefined) return []

    const barMidY = (i: number) => i * ROW_HEIGHT + ROW_HEIGHT / 2

    // Anchored on the drawn mark, not on the date span, so an arrow meets a milestone diamond
    // at its point rather than at the edge of the day column it sits in.
    const from = markGeometry(
      fromRow.placement.start,
      fromRow.placement.end,
      fromRow.placement.isMilestone,
      origin,
      pxPerDay,
      width,
    )
    const to = markGeometry(
      toRow.placement.start,
      toRow.placement.end,
      toRow.placement.isMilestone,
      origin,
      pxPerDay,
      width,
    )
    // An arrow to or from something outside the window would be drawn to a stub standing in
    // for a date that is not on the axis, which says nothing true about the dependency.
    if (!from.visible || !to.visible) return []

    const x1 = from.left + from.width
    const x2 = to.left

    const { d, mid } = elbowPath(x1, barMidY(fromIndex), x2, barMidY(toIndex))

    return [
      {
        key: `${edge.predecessorId}-${edge.successorId}`,
        dependencyId: edge.id,
        predecessorId: edge.predecessorId,
        successorId: edge.successorId,
        label: `${fromRow.label} → ${toRow.label}`,
        d,
        mid,
        active: focus !== null && (focus === edge.predecessorId || focus === edge.successorId),
        critical: fromRow.placement.isCritical && toRow.placement.isCritical,
      },
    ]
  })

  // Active edges last so they paint over their neighbours.
  const ordered = [...paths].sort((a, b) => Number(a.active) - Number(b.active))
  const anyFocus = focus !== null

  /**
   * Remove controls hang off the arrows of the *selected* row, not the hovered one. Hover is no
   * good here: the control sits on the arrow, over some other row, so reaching for it changes
   * which row is hovered and the control vanishes under the pointer. A click to select is
   * stable, survives the pointer travelling anywhere, and puts the buttons in the DOM where a
   * keyboard can reach them — the arrows themselves are decoration no tab stop can land on.
   */
  const removable = onRemove
    ? ordered.filter(
        (p) =>
          p.dependencyId !== undefined &&
          selectedId !== null &&
          selectedId !== undefined &&
          (p.predecessorId === selectedId || p.successorId === selectedId),
      )
    : []

  return (
    <>
      <svg
        width={width}
        height={height}
        className="pointer-events-none absolute left-0 top-0"
        aria-hidden="true"
      >
        <defs>
          <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-gantt-link)" />
          </marker>
          <marker
            id="gantt-arrow-critical"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-gantt-critical)" />
          </marker>
          <marker
            id="gantt-arrow-active"
            markerWidth="7"
            markerHeight="7"
            refX="5.5"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--color-gantt-link-active)" />
          </marker>
        </defs>
        {ordered.map((p) => {
          const stroke = p.active
            ? 'var(--color-gantt-link-active)'
            : p.critical
              ? 'var(--color-gantt-critical)'
              : 'var(--color-gantt-link)'
          const marker = p.active
            ? 'gantt-arrow-active'
            : p.critical
              ? 'gantt-arrow-critical'
              : 'gantt-arrow'
          const hovered = hoveredKey === p.key
          return (
            <g key={p.key}>
              <path
                d={p.d}
                fill="none"
                stroke={stroke}
                strokeWidth={p.active || hovered ? 2 : 1.25}
                strokeLinecap="round"
                opacity={anyFocus && !p.active && !hovered ? 0.35 : p.critical ? 0.9 : 0.7}
                markerEnd={`url(#${marker})`}
              />
            </g>
          )
        })}
      </svg>

      {removable.map((p) => (
        <button
          key={`remove-${p.key}`}
          type="button"
          disabled={busy}
          onClick={() => onRemove?.(p.dependencyId!)}
          onMouseEnter={() => setHoveredKey(p.key)}
          onMouseLeave={() => setHoveredKey((cur) => (cur === p.key ? null : cur))}
          aria-label={`Remove dependency ${p.label}`}
          title={`Remove dependency: ${p.label}`}
          className="absolute flex items-center justify-center rounded-full border-2 text-xs leading-none"
          style={{
            left: p.mid.x - 10,
            top: p.mid.y - 10,
            width: 20,
            height: 20,
            // Above the row layer, which tiles the whole chart and would otherwise take the click.
            zIndex: 30,
            background: 'var(--color-surface)',
            borderColor:
              hoveredKey === p.key ? 'var(--color-gantt-today)' : 'var(--color-gantt-link-active)',
            color: 'var(--color-gantt-today)',
            cursor: busy ? 'progress' : 'pointer',
          }}
        >
          ×
        </button>
      ))}
    </>
  )
}
