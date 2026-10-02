'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import { addDays, diffInDays, startOfUtcDay } from '@/lib/schedule'
import Button from '@/components/Button'
import GanttRow from './GanttRow'
import GanttDependencyLayer from './GanttDependencyLayer'
import GanttLegend from './GanttLegend'
import {
  dateToX,
  headerBands,
  headerTicks,
  fitAxisDays,
  isWeekend,
  pxPerDayFor,
  tickScale,
  weekdayInitial,
  weekendBands,
  rangeWidth,
  HEADER_HEIGHT,
  HEADER_BAND_HEIGHT,
  HEADER_TICK_HEIGHT,
  ROW_HEIGHT,
  type ZoomLevel,
} from './geometry'
import { RANGES, windowDays, windowFor, type RangeKey } from './range'
import { formatDateShort } from '@/lib/format-date'
import { plural } from '@/lib/plural'
import { lateText } from '@/lib/slip'
import { patchFromDrag, type DragData, type ReschedulePatch } from './useGanttDrag'
import type { GanttEdge, GanttRow as GanttRowData } from './types'

const ZOOMS: { key: ZoomLevel; label: string }[] = [
  { key: 'fit', label: 'Fit' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]

const NAME_COL_WIDTH = 240
/** Fallback timeline width for the first paint, before the container has been measured. */
const ASSUMED_VIEWPORT = 900
/**
 * A long backlog would otherwise push the legend and the detail panel off the bottom of the
 * page. Capping the bars and scrolling them inside the chart keeps the whole control surface
 * — header, legend, panel — reachable without hunting. Short charts are shorter than this and
 * are unaffected.
 */
const MAX_BODY_HEIGHT = '65vh'

/** Move and resize run along the timeline only — never up or down between rows. */
export const lockYForBarDrags: Modifier = ({ transform, active }) => {
  const kind = (active?.data.current as DragData | undefined)?.kind
  if (kind === 'move' || kind === 'resize-end') return { ...transform, y: 0 }
  return transform
}

export default function GanttChart({
  rows,
  edges,
  rangeStart,
  rangeEnd,
  editable = false,
  selectedId,
  onSelect,
  onReschedule,
  onLink,
  onUnlink,
  busy,
  deadline,
  highlightCritical = true,
}: {
  rows: GanttRowData[]
  edges: GanttEdge[]
  rangeStart: Date
  rangeEnd: Date
  editable?: boolean
  selectedId?: number | null
  onSelect?: (id: number) => void
  onReschedule?: (patch: ReschedulePatch) => void
  onLink?: (predecessorId: number, successorId: number) => void
  /** Omit to leave the arrows read-only; only edges carrying a row id can be removed. */
  onUnlink?: (dependencyId: number) => void
  busy?: boolean
  /** The scope's own deadline (a project's), measured against where the plan ends. */
  deadline?: Date | null
  highlightCritical?: boolean
}) {
  const [zoom, setZoom] = useState<ZoomLevel>('fit')
  const [range, setRange] = useState<RangeKey>('all')
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [viewport, setViewport] = useState(ASSUMED_VIEWPORT)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const headerScrollRef = useRef<HTMLDivElement | null>(null)

  // "Fit" needs to know how much room the timeline column actually has, which only the browser
  // can say, and which changes with the window, the sidebar and the name column.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      // The observed box spans both columns, so the timeline gets what is left after the names.
      const next = entry.contentRect.width - NAME_COL_WIDTH
      if (next > 0) setViewport(next)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  // The scope runs to the last deadline as well as the last bar, so a marker for a date the
  // plan has not reached yet is drawn rather than left off the right-hand edge.
  const scopeEnd = useMemo(() => {
    const ends = [
      rangeEnd,
      ...(deadline ? [deadline] : []),
      ...rows.flatMap((r) => r.placement.deadline ?? []),
    ]
    return ends.reduce((a, b) => (b.getTime() > a.getTime() ? b : a))
  }, [rangeEnd, deadline, rows])
  const visible = useMemo(
    () => windowFor(range, rangeStart, scopeEnd, new Date()),
    [range, rangeStart, scopeEnd],
  )
  const origin = startOfUtcDay(visible.start)
  // Leave a sliver spare so "Fit" never rounds up into a horizontal scrollbar.
  const available = viewport - 2

  // Fit fills the width: up to a week of empty calendar past the last item, then stretching.
  const scopedDays = diffInDays(origin, visible.end) + 1
  const totalDays = zoom === 'fit' ? fitAxisDays(scopedDays, available) : scopedDays
  const axisEnd = addDays(origin, totalDays - 1)

  const pxPerDay = pxPerDayFor(zoom, totalDays, available)
  const scale = tickScale(pxPerDay)

  const width = Math.max(rangeWidth(origin, axisEnd, pxPerDay), 240)
  const bodyHeight = Math.max(rows.length * ROW_HEIGHT, ROW_HEIGHT)
  const ticks = headerTicks(origin, axisEnd, pxPerDay)
  const bands = headerBands(origin, axisEnd, pxPerDay)
  const weekends = weekendBands(origin, axisEnd, pxPerDay)
  const todayX = dateToX(new Date(), origin, pxPerDay)
  const todayVisible = todayX >= 0 && todayX <= width

  // The finish line sits at the far edge of the last scheduled day, not at its start.
  const finishX = dateToX(rangeEnd, origin, pxPerDay) + pxPerDay
  const finishVisible = finishX >= 0 && finishX <= width
  const scopeDays = windowDays(startOfUtcDay(rangeStart), startOfUtcDay(rangeEnd))
  const daysToFinish = diffInDays(new Date(), rangeEnd)
  const daysLate = deadline ? diffInDays(deadline, rangeEnd) : null
  const labelById = useMemo(() => new Map(rows.map((r) => [r.id, r.label])), [rows])

  /** Hover wins over selection so pointing at a row always previews its links. */
  const focusedId = hoveredId ?? selectedId ?? null

  /** The focused row plus everything one dependency hop away from it. */
  const relatedIds = useMemo(() => {
    if (focusedId === null) return null
    const ids = new Set<number>([focusedId])
    for (const e of edges) {
      if (e.predecessorId === focusedId) ids.add(e.successorId)
      if (e.successorId === focusedId) ids.add(e.predecessorId)
    }
    return ids
  }, [edges, focusedId])

  function handleDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as DragData | undefined
    if (!data) return
    const row = rows.find((r) => r.id === data.rowId)
    if (!row) return

    if (data.kind === 'link') {
      const targetId = (event.over?.data.current as { rowId?: number } | undefined)?.rowId
      if (targetId && targetId !== row.id) onLink?.(row.id, targetId)
      return
    }
    const patch = patchFromDrag(row, data, event.delta.x, pxPerDay)
    if (patch) onReschedule?.(patch)
  }

  const dateHeader = (
    <div className="border-brand-border relative" style={{ height: HEADER_HEIGHT, width }}>
      {bands.map((b) => (
        <div
          key={`${b.label}-${b.x}`}
          className="text-brand-text absolute top-0 flex items-center overflow-hidden px-2 text-xs font-semibold whitespace-nowrap"
          style={{
            left: b.x,
            width: b.width,
            height: HEADER_BAND_HEIGHT,
            borderLeft: '1px solid var(--gantt-grid-strong)',
            borderBottom: '1px solid var(--gantt-grid)',
          }}
        >
          {b.label}
        </div>
      ))}
      {ticks.map((t, i) => {
        const day = addDays(origin, Math.round(t.x / pxPerDay))
        const daily = scale === 'day'
        const weekend = daily && isWeekend(day)
        return (
          <div
            key={i}
            className={`absolute flex flex-col items-center justify-center overflow-hidden text-[10px] leading-tight whitespace-nowrap ${
              weekend ? 'text-text-light' : t.major ? 'text-brand-text font-semibold' : ''
            }`}
            style={{
              top: HEADER_BAND_HEIGHT,
              left: t.x,
              height: HEADER_TICK_HEIGHT,
              width: daily ? pxPerDay : undefined,
              paddingLeft: daily ? 0 : 4,
              borderLeft: `1px solid ${t.major ? 'var(--gantt-grid-strong)' : 'var(--gantt-grid)'}`,
              background: weekend ? 'var(--gantt-weekend)' : undefined,
            }}
          >
            {daily && pxPerDay >= 24 && (
              <span className="text-text-light block text-[9px]">{weekdayInitial(day)}</span>
            )}
            <span>{t.label}</span>
          </div>
        )
      })}
    </div>
  )

  const body = (
    <div className="border-brand-border bg-surface overflow-hidden rounded-lg border">
      {/* The date header sits outside the vertical scroller so it stays put on a tall chart —
          you cannot read a bar without knowing which day it is over. Its horizontal offset is
          driven by the body's scroll below. */}
      <div className="border-brand-border flex border-b">
        <div
          className="border-brand-border text-text-light flex shrink-0 items-end border-r px-3 pb-1.5 text-xs font-semibold tracking-wide uppercase"
          style={{ width: NAME_COL_WIDTH, height: HEADER_HEIGHT }}
        >
          Task
        </div>
        <div ref={headerScrollRef} className="min-w-0 flex-1 overflow-hidden">
          {dateHeader}
        </div>
      </div>

      {/* One scroll container for both axes. Giving the timeline its own `overflow-x` would
          silently make it a vertical scroller too (CSS computes the other axis to `auto`), and
          the names would drift out of step with their bars. The name column is pinned with
          `sticky left-0` instead, so the two can never disagree. */}
      <div
        ref={scrollRef}
        className="overflow-auto"
        style={{ maxHeight: MAX_BODY_HEIGHT }}
        onScroll={(e) => {
          // Keep the detached date header aligned with the bars beneath it.
          const header = headerScrollRef.current
          if (header) header.scrollLeft = e.currentTarget.scrollLeft
        }}
      >
        <div className="flex" style={{ width: NAME_COL_WIDTH + width }}>
          {/* Name column, pinned while the timeline scrolls sideways. */}
          <div
            className="border-brand-border bg-surface sticky left-0 z-40 shrink-0 border-r"
            style={{ width: NAME_COL_WIDTH }}
          >
            {rows.map((r, i) => {
              const related = relatedIds?.has(r.id) ?? true
              return (
                <div
                  key={r.id}
                  className="flex items-center px-3 text-sm"
                  style={{
                    height: ROW_HEIGHT,
                    borderBottom: '1px solid var(--gantt-grid)',
                    background:
                      focusedId === r.id
                        ? 'var(--gantt-row-hover)'
                        : i % 2 === 1
                          ? 'var(--gantt-row-alt)'
                          : undefined,
                    opacity: related ? 1 : 0.45,
                    transition: 'opacity 120ms ease-out',
                  }}
                  title={r.label}
                  onMouseEnter={() => setHoveredId(r.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span className="line-clamp-2 leading-tight">
                    {r.href ? (
                      <Link href={r.href} className="text-primary-text hover:underline">
                        {r.label}
                      </Link>
                    ) : (
                      r.label
                    )}
                  </span>
                </div>
              )
            })}
          </div>

          {/* The bars. No overflow of its own — the container above scrolls both axes. */}
          <div className="shrink-0" style={{ width }}>
            <div className="relative" style={{ height: bodyHeight }}>
              {/* Weekend shading, behind everything. */}
              {weekends.map((b) => (
                <div
                  key={`weekend-${b.x}`}
                  className="pointer-events-none absolute top-0"
                  style={{
                    left: b.x,
                    width: b.width,
                    height: bodyHeight,
                    background: 'var(--gantt-weekend)',
                  }}
                />
              ))}

              {/* Vertical grid, at every zoom — month starts read stronger than day columns. */}
              {ticks.map((t, i) => (
                <div
                  key={`grid-${i}`}
                  className="pointer-events-none absolute top-0 h-full"
                  style={{
                    left: t.x,
                    borderLeft: `1px solid ${
                      t.major ? 'var(--gantt-grid-strong)' : 'var(--gantt-grid)'
                    }`,
                  }}
                />
              ))}

              {/* Row banding and separators, so a bar can be traced back to its name. */}
              {rows.map((r, i) => (
                <div
                  key={`band-${r.id}`}
                  className="pointer-events-none absolute left-0 w-full"
                  style={{
                    top: i * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                    borderBottom: '1px solid var(--gantt-grid)',
                    background:
                      focusedId === r.id
                        ? 'var(--gantt-row-hover)'
                        : i % 2 === 1
                          ? 'var(--gantt-row-alt)'
                          : undefined,
                  }}
                />
              ))}

              <GanttDependencyLayer
                rows={rows}
                edges={edges}
                origin={origin}
                pxPerDay={pxPerDay}
                width={width}
                height={bodyHeight}
                focusedId={focusedId}
                selectedId={selectedId}
                busy={busy}
                onRemove={editable ? onUnlink : undefined}
              />

              {rows.map((r, i) => (
                <div
                  key={r.id}
                  className="absolute left-0 w-full"
                  style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  <GanttRow
                    row={r}
                    origin={origin}
                    pxPerDay={pxPerDay}
                    windowWidth={width}
                    editable={editable}
                    selected={selectedId === r.id}
                    highlighted={focusedId === r.id}
                    dimmed={relatedIds !== null && !relatedIds.has(r.id)}
                    onSelect={onSelect}
                    onHover={setHoveredId}
                    highlightCritical={highlightCritical}
                    pinConflictLabel={
                      r.placement.pinConflictWith === null
                        ? undefined
                        : labelById.get(r.placement.pinConflictWith)
                    }
                  />
                </div>
              ))}

              {/* Finish line — where the last scheduled day ends. */}
              {finishVisible && (
                <div
                  className="pointer-events-none absolute top-0"
                  style={{
                    left: finishX,
                    height: bodyHeight,
                    borderLeft: '2px dashed var(--gantt-finish)',
                    opacity: 0.7,
                  }}
                  title={`Ends ${formatDateShort(rangeEnd)}`}
                />
              )}

              {todayVisible && (
                <div
                  className="pointer-events-none absolute top-0"
                  style={{
                    left: todayX,
                    height: bodyHeight,
                    borderLeft: '2px solid var(--gantt-today)',
                  }}
                  title="Today"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div>
      {/* The span of the whole plan, which stays visible whatever window is on screen. */}
      <dl className="border-brand-border bg-surface mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg border px-3 py-2 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="text-text-light">Starts</dt>
          <dd className="m-0 font-medium">{formatDateShort(rangeStart)}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-text-light">Ends</dt>
          <dd className="m-0 font-medium">{formatDateShort(rangeEnd)}</dd>
        </div>
        {deadline && daysLate !== null && (
          <>
            <div className="flex items-baseline gap-2">
              <dt className="text-text-light">Deadline</dt>
              <dd className="m-0 font-medium">{formatDateShort(deadline)}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="sr-only">Against the deadline</dt>
              <dd className={`m-0 ${daysLate > 0 ? 'text-error font-medium' : ''}`}>
                {lateText(daysLate)}
              </dd>
            </div>
          </>
        )}
        <div className="flex items-baseline gap-2">
          <dt className="text-text-light">Span</dt>
          <dd className="m-0">{plural(scopeDays, 'day')}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-text-light">{daysToFinish >= 0 ? 'Remaining' : 'Overran by'}</dt>
          <dd className="m-0">{plural(Math.abs(daysToFinish), 'day')}</dd>
        </div>
      </dl>

      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-light text-sm">Zoom</span>
          {ZOOMS.map((z) => (
            <Button
              key={z.key}
              size="sm"
              variant={zoom === z.key ? 'primary' : 'secondary'}
              onClick={() => setZoom(z.key)}
              aria-pressed={zoom === z.key}
              title={z.key === 'fit' ? 'Scale the timeline to fill the width' : undefined}
            >
              {z.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-light text-sm">Range</span>
          {RANGES.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={range === r.key ? 'primary' : 'secondary'}
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
            >
              {r.label}
            </Button>
          ))}
        </div>

        {scale === 'month' && (
          <span className="text-text-light text-xs">
            Too many days to label individually — narrow the range for day detail.
          </span>
        )}
      </div>

      {/* The context is always present so GanttRow's drag hooks resolve; sensors are only
          wired when the chart is editable, so a read-only chart never starts a drag. */}
      <DndContext
        sensors={editable ? sensors : undefined}
        modifiers={[lockYForBarDrags]}
        onDragEnd={editable ? handleDragEnd : undefined}
      >
        {body}
      </DndContext>

      <GanttLegend editable={editable} highlightCritical={highlightCritical} />
    </div>
  )
}
