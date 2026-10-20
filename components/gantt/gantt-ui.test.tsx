import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEndEvent } from '@dnd-kit/core'
import type { ScheduledItem } from '@/lib/schedule'
import GanttChart, { inStartOrder, lockYForBarDrags } from './GanttChart'
import GanttLegend, { PlanningTools } from './GanttLegend'
import GanttItemPanel from './GanttItemPanel'
import GanttPlanMenu, { type GanttPlan } from './GanttPlanMenu'
import BaselineDialog from './BaselineDialog'
import GanttDependencyLayer from './GanttDependencyLayer'
import { barTone, barFill } from './palette'
import { deltaToDays, patchFromDrag } from './useGanttDrag'
import type { GanttRow } from './types'

const drags = await vi.hoisted(() => import('@/test/dnd').then((m) => m.captureDrags()))
vi.mock('@dnd-kit/core', (importOriginal) => drags.mockDndKit(importOriginal))

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function placed(
  id: number,
  start: string,
  end: string,
  over: Partial<ScheduledItem> = {},
): ScheduledItem {
  return {
    id,
    start: day(start),
    end: day(end),
    isPinned: false,
    isDerived: false,
    deadline: null,
    daysLate: null,
    breachesDeadline: false,
    pinnedBeforePredecessor: false,
    pinConflictDays: null,
    pinConflictWith: null,
    endsOnDeadline: false,
    isCritical: false,
    isAnchor: false,
    isMilestone: false,
    baseline: null,
    actual: null,
    startVarianceDays: null,
    finishVarianceDays: null,
    ...over,
  }
}

const rows: GanttRow[] = [
  {
    id: 1,
    label: 'Book venue',
    status: 'completed',
    href: '/projects/1/tasks/1',
    placement: placed(1, '2026-06-01', '2026-06-03', {
      isCritical: true,
      isPinned: true,
      baseline: { start: day('2026-05-30'), end: day('2026-06-01') },
      actual: { start: day('2026-06-01'), end: day('2026-06-04') },
      startVarianceDays: 2,
      finishVarianceDays: 2,
    }),
  },
  {
    id: 2,
    label: 'Print flyers',
    status: 'in_progress',
    placement: placed(2, '2026-06-04', '2026-06-06', {
      isCritical: true,
      deadline: day('2026-06-05'),
      daysLate: 1,
      breachesDeadline: true,
      actual: { start: day('2026-06-04'), end: null },
      baseline: { start: day('2026-06-05'), end: day('2026-06-07') },
      startVarianceDays: -1,
      finishVarianceDays: -1,
    }),
  },
  {
    id: 3,
    label: 'Launch',
    status: 'ready',
    placement: placed(3, '2026-06-08', '2026-06-08', {
      isMilestone: true,
      isAnchor: true,
      pinnedBeforePredecessor: true,
      pinConflictDays: 3,
      pinConflictWith: 2,
    }),
  },
  { id: 4, label: 'Wrap up', status: 'on_hold', placement: placed(4, '2026-09-01', '2026-09-02') },
  { id: 5, label: 'Long ago', status: 'ready', placement: placed(5, '2025-01-01', '2025-01-02') },
]
const edges = [
  { id: 10, predecessorId: 1, successorId: 2 },
  { id: 11, predecessorId: 2, successorId: 3 },
  { id: 12, predecessorId: 3, successorId: 1 },
  { predecessorId: 4, successorId: 99 },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(day('2026-06-05'))
})
afterEach(() => vi.useRealTimers())

describe('palette / drag maths', () => {
  it('locks bar drags to the horizontal axis but leaves link drags free', () => {
    const transform = { x: 10, y: 20, scaleX: 1, scaleY: 1 }
    const modifier = (kind?: string) =>
      lockYForBarDrags({
        transform,
        active: kind ? ({ data: { current: { kind } } } as never) : null,
      } as never)
    expect(modifier('move')).toEqual({ ...transform, y: 0 })
    expect(modifier('resize-end')).toEqual({ ...transform, y: 0 })
    expect(modifier('link')).toEqual(transform)
    expect(modifier()).toEqual(transform)
  })

  it('maps statuses to tones and drags to patches', () => {
    expect(barTone('completed')).toBe('done')
    expect(barTone('under_review')).toBe('progress')
    expect(barTone('archived')).toBe('hold')
    expect(barTone('ready')).toBe('todo')
    expect(barTone('blocked')).toBe('todo')
    expect(barFill('ready')).toBe('var(--gantt-bar-todo)')
    expect(deltaToDays(70, 30)).toBe(2)
    expect(patchFromDrag(rows[0], { kind: 'move', rowId: 1 }, 5, 30)).toBeNull()
    expect(patchFromDrag(rows[0], { kind: 'move', rowId: 1 }, 60, 30)).toEqual({
      id: 1,
      startDate: day('2026-06-03'),
    })
    expect(patchFromDrag(rows[0], { kind: 'resize-end', rowId: 1 }, 60, 30)).toEqual({
      id: 1,
      startDate: day('2026-06-01'),
      durationDays: 5,
    })
    expect(patchFromDrag(rows[1], { kind: 'resize-end', rowId: 2 }, -60, 30)).toEqual({
      id: 2,
      startDate: null,
      durationDays: 1,
    })
    expect(patchFromDrag(rows[1], { kind: 'resize-end', rowId: 2 }, -300, 30)).toEqual({
      id: 2,
      startDate: null,
      durationDays: 1,
    })
    expect(
      patchFromDrag(
        { ...rows[1], placement: placed(2, '2026-06-04', '2026-06-04') },
        { kind: 'resize-end', rowId: 2 },
        -60,
        30,
      ),
    ).toBeNull()
    expect(patchFromDrag(rows[0], { kind: 'link', rowId: 1 }, 60, 30)).toBeNull()
  })

  it("moves a task's deadline with its bar, and resizing sets the deadline", () => {
    const task = (over: Partial<ScheduledItem>): GanttRow => ({
      ...rows[1],
      placement: placed(2, '2026-06-04', '2026-06-06', { endsOnDeadline: true, ...over }),
    })
    const withDeadline = task({ isPinned: true, deadline: day('2026-06-06') })
    expect(patchFromDrag(withDeadline, { kind: 'move', rowId: 2 }, 60, 30)).toEqual({
      id: 2,
      startDate: day('2026-06-06'),
      deadline: day('2026-06-08'),
    })
    expect(patchFromDrag(withDeadline, { kind: 'resize-end', rowId: 2 }, 30, 30)).toEqual({
      id: 2,
      startDate: day('2026-06-04'),
      deadline: day('2026-06-07'),
    })
    // With no deadline yet a move only pins the start; a resize gives it one.
    const open = task({})
    expect(patchFromDrag(open, { kind: 'move', rowId: 2 }, 30, 30)).toEqual({
      id: 2,
      startDate: day('2026-06-05'),
    })
    expect(patchFromDrag(open, { kind: 'resize-end', rowId: 2 }, -300, 30)).toEqual({
      id: 2,
      startDate: null,
      deadline: day('2026-06-04'),
    })
  })
})

describe('GanttChart', () => {
  it('renders bars, header, summary and legend; zoom and range controls change the axis', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const onSelect = vi.fn()
    render(
      <GanttChart
        rows={rows}
        edges={edges}
        rangeStart={day('2025-01-01')}
        rangeEnd={day('2026-09-02')}
        selectedId={1}
        onSelect={onSelect}
        editable
      />,
    )
    expect(screen.getByText('Starts').nextSibling).toHaveTextContent('1 Jan 2025')
    expect(screen.getByText('Remaining').nextSibling).toHaveTextContent('89 days')
    expect(screen.getByRole('link', { name: 'Book venue' })).toHaveAttribute(
      'href',
      '/projects/1/tasks/1',
    )
    expect(
      screen.getByRole('button', {
        name: /Book venue: 1 June 2026 – 3 June 2026, 2 days later than the original plan, on the critical path/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Launch: milestone on 8 June 2026, key date/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Print flyers.*1 day earlier than the original plan/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Too many days to label/)).toBeInTheDocument()
    expect(screen.getByTitle('1 day late (Deadline 5 Jun 2026)')).toHaveTextContent('+1d')
    await user.click(
      screen.getByRole('button', {
        name: 'Print flyers: 4 June 2026 – 6 June 2026, deadline 5 Jun, today, planned to finish 1 day late, 1 day earlier than the original plan, on the critical path, in progress',
      }),
    )
    expect(onSelect).toHaveBeenCalledWith(2)
    // A short bar is mostly grip, so a click there selects too.
    await user.click(screen.getByRole('button', { name: /^Resize Book venue/ }))
    expect(onSelect).toHaveBeenLastCalledWith(1)

    await user.click(screen.getByRole('button', { name: 'Day' }))
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/Too many days/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'This week' }))
    expect(
      screen.getByRole('button', { name: /Long ago.*outside the visible range/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Wrap up.*outside the visible range/ }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Week' }))
    await user.click(screen.getByRole('button', { name: 'Month' }))
    await user.click(screen.getByRole('button', { name: '90 days' }))
    expect(screen.getByTitle('Today')).toBeInTheDocument()
  })

  it('shows what a bar is at once, on hover and on keyboard focus, with no native title', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    render(
      <GanttChart
        rows={[
          {
            id: 1,
            label: 'Book venue',
            status: 'in_progress',
            assigneeName: 'Sam Organiser',
            placement: placed(1, '2026-06-02', '2026-06-04', {
              deadline: day('2026-06-09'),
              daysLate: -5,
            }),
          },
          {
            id: 3,
            label: 'Launch',
            status: 'blocked',
            blockedBy: [{ id: 1, title: 'Book venue' }],
            assigneeName: null,
            timing: 'fixed',
            placement: placed(3, '2026-06-08', '2026-06-08', {
              isMilestone: true,
              isAnchor: true,
              isCritical: true,
              pinnedBeforePredecessor: true,
              pinConflictDays: 3,
              pinConflictWith: 1,
            }),
          },
        ]}
        edges={[]}
        rangeStart={day('2026-06-01')}
        rangeEnd={day('2026-06-10')}
        editable
      />,
    )
    const venue = screen.getByRole('button', { name: /^Book venue:/ })
    expect(venue).not.toHaveAttribute('title')
    expect(screen.queryByRole('tooltip')).toBeNull()

    await user.hover(venue)
    const tip = screen.getByRole('tooltip')
    for (const line of [
      'Book venue',
      'In progress',
      'Assigned to Sam Organiser',
      '2 – 4 Jun',
      'Deadline 9 Jun, in 4 days',
    ]) {
      expect(within(tip).getByText(line)).toBeInTheDocument()
    }
    expect(within(tip).queryByText('★ Key date')).toBeNull()
    await user.unhover(venue)
    expect(screen.queryByRole('tooltip')).toBeNull()

    // The keyboard gets the same tip as the pointer, and Escape puts it away.
    const launch = screen.getByRole('button', { name: /^Launch:/ })
    act(() => launch.focus())
    const focused = screen.getByRole('tooltip')
    for (const line of [
      "Blocked by 'Book venue'",
      'Unclaimed',
      'Milestone, 8 Jun',
      'A moment, not a stretch of work',
      '★ Key date',
      'On the critical path',
      '“Book venue” finishes 2 days after the key date.',
    ]) {
      expect(within(focused).getByText(line)).toBeInTheDocument()
    }
    // The aria-label carries the same facts for a screen reader.
    expect(launch).toHaveAccessibleName(
      "Launch: milestone on 8 June 2026, a moment, not a stretch of work, key date, on the critical path, blocked by 'Book venue', unclaimed, “Book venue” finishes 2 days after the key date.",
    )
    fireEvent.keyDown(launch, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => launch.blur())
  })

  it('draws a flexible window faint with its hours, and set dates solid with an edge', () => {
    render(
      <GanttChart
        rows={[
          {
            id: 7,
            label: 'Print flyers',
            status: 'ready',
            timing: 'flexible',
            effortHours: 6,
            placement: placed(7, '2026-06-01', '2026-06-07'),
          },
          {
            id: 8,
            label: 'Staff the stall',
            status: 'ready',
            timing: 'fixed',
            effortHours: null,
            placement: placed(8, '2026-06-08', '2026-06-08'),
          },
        ]}
        edges={[]}
        rangeStart={day('2026-06-01')}
        rangeEnd={day('2026-06-08')}
        editable
      />,
    )
    const flexible = screen.getByRole('button', {
      name: /^Print flyers: .*any time in this window, about 6 hours of work/,
    })
    expect(flexible).toHaveTextContent('6h')
    expect(flexible.style.background).toContain('color-mix')
    const fixed = screen.getByRole('button', { name: /^Staff the stall: .*on this day/ })
    expect(fixed.style.boxShadow).toContain('var(--gantt-finish)')
  })

  it('highlights related rows on hover and syncs the header scroll', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const { container } = render(
      <GanttChart
        rows={rows}
        edges={edges}
        rangeStart={day('2026-06-01')}
        rangeEnd={day('2026-09-02')}
      />,
    )
    const name = screen.getByTitle('Wrap up')
    await user.hover(name)
    expect(screen.getByTitle('Book venue')).toHaveStyle({ opacity: '0.45' })
    await user.unhover(name)
    expect(screen.getByTitle('Book venue')).toHaveStyle({ opacity: '1' })
    await user.hover(screen.getByRole('button', { name: /^Book venue/ }))
    expect(screen.getByTitle('Wrap up')).toHaveStyle({ opacity: '0.45' })
    await user.unhover(screen.getByRole('button', { name: /^Book venue/ }))
    const scroller = container.querySelector('.overflow-auto') as HTMLElement
    scroller.scrollLeft = 40
    fireEvent.scroll(scroller)
    // A shrinking summary when the plan overran.
    render(
      <GanttChart
        rows={rows}
        edges={[]}
        rangeStart={day('2026-05-01')}
        rangeEnd={day('2026-06-04')}
        deadline={day('2026-06-01')}
      />,
    )
    expect(screen.getByText('Overran by').nextSibling).toHaveTextContent('1 day')
    expect(screen.getByText('Deadline').nextSibling).toHaveTextContent('1 Jun 2026')
    expect(screen.getByText('Against the deadline').nextSibling).toHaveTextContent('3 days late')
  })

  it('translates drag gestures into reschedules and links when editable', () => {
    const onReschedule = vi.fn()
    const onLink = vi.fn()
    const onUnlink = vi.fn()
    render(
      <GanttChart
        rows={rows}
        edges={edges}
        rangeStart={day('2026-06-01')}
        rangeEnd={day('2026-06-08')}
        editable
        selectedId={1}
        onReschedule={onReschedule}
        onLink={onLink}
        onUnlink={onUnlink}
      />,
    )
    const end = (e: Partial<DragEndEvent>) => act(() => drags.latest()(e as DragEndEvent))
    end({ active: { data: { current: undefined } } as never, delta: { x: 0, y: 0 } })
    end({
      active: { data: { current: { kind: 'move', rowId: 999 } } } as never,
      delta: { x: 500, y: 0 },
    })
    expect(onReschedule).not.toHaveBeenCalled()
    end({
      active: { data: { current: { kind: 'move', rowId: 1 } } } as never,
      delta: { x: 500, y: 0 },
    })
    expect(onReschedule).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    end({
      active: { data: { current: { kind: 'move', rowId: 1 } } } as never,
      delta: { x: 1, y: 0 },
    })
    expect(onReschedule).toHaveBeenCalledTimes(1)
    end({
      active: { data: { current: { kind: 'link', rowId: 1 } } } as never,
      over: { data: { current: { rowId: 2 } } } as never,
      delta: { x: 0, y: 0 },
    })
    expect(onLink).toHaveBeenCalledWith(1, 2)
    end({
      active: { data: { current: { kind: 'link', rowId: 1 } } } as never,
      over: { data: { current: { rowId: 1 } } } as never,
      delta: { x: 0, y: 0 },
    })
    end({
      active: { data: { current: { kind: 'link', rowId: 1 } } } as never,
      over: null,
      delta: { x: 0, y: 0 },
    })
    expect(onLink).toHaveBeenCalledTimes(1)
    // Editable rows expose resize and link handles, and the selected row's arrows can be removed.
    expect(
      screen.getByRole('button', {
        name: 'Resize Book venue — currently 1 June 2026 – 3 June 2026',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Draw a dependency from Launch' }),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove dependency Book venue → Print flyers' }),
    )
    expect(onUnlink).toHaveBeenCalledWith(10)
    // The how-to lives in Planning tools, not under the chart.
    expect(screen.queryByText(/Drag a bar to move it/)).toBeNull()
  })

  it('orders rows by planned start, then planned end, then the order given', () => {
    const row = (id: number, label: string, start: string, end: string): GanttRow => ({
      id,
      label,
      status: 'ready',
      placement: placed(id, start, end),
    })
    const ordered = inStartOrder([
      row(1, 'Pack flyering stall kit', '2026-06-04', '2026-06-04'),
      row(2, 'Get table from Reuben', '2026-06-02', '2026-06-03'),
      row(3, 'Print flyers', '2026-06-02', '2026-06-02'),
      row(4, 'Book stall', '2026-06-02', '2026-06-02'),
    ])
    expect(ordered.map((r) => r.label)).toEqual([
      'Print flyers',
      'Book stall',
      'Get table from Reuben',
      'Pack flyering stall kit',
    ])
  })

  it('lists undated items as rows under the bars, with the add action only for a manager', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const onAddToTimeline = vi.fn()
    const undated = [
      { id: 20, label: 'Write press release', href: '/projects/1/tasks/20' },
      { id: 21, label: 'Thank volunteers' },
    ]
    const { rerender } = render(
      <GanttChart
        rows={rows}
        undated={undated}
        onAddToTimeline={onAddToTimeline}
        edges={[]}
        rangeStart={day('2026-06-01')}
        rangeEnd={day('2026-06-08')}
        editable
      />,
    )
    const group = screen.getByRole('group', { name: 'Tasks with no dates' })
    expect(within(group).getByText('No dates (2)')).toBeInTheDocument()
    expect(within(group).getByRole('link', { name: 'Write press release' })).toHaveAttribute(
      'href',
      '/projects/1/tasks/20',
    )
    expect(within(group).getByTitle('Thank volunteers')).toHaveTextContent(/^Thank volunteers$/)
    expect(within(group).getAllByText(/No dates ·/)).toHaveLength(2)
    await user.click(
      within(group).getByRole('button', { name: 'Add Thank volunteers to the timeline' }),
    )
    expect(onAddToTimeline).toHaveBeenLastCalledWith([21])
    await user.click(within(group).getByRole('button', { name: 'Add all to timeline' }))
    expect(onAddToTimeline).toHaveBeenLastCalledWith([20, 21])

    // Busy while a write is in flight.
    rerender(
      <GanttChart
        rows={rows}
        undated={undated}
        onAddToTimeline={onAddToTimeline}
        edges={[]}
        rangeStart={day('2026-06-01')}
        rangeEnd={day('2026-06-08')}
        editable
        busy
      />,
    )
    expect(screen.getByRole('button', { name: 'Add all to timeline' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Add Write press release to the timeline' }),
    ).toBeDisabled()

    // A viewer sees the rows but no way to place them.
    rerender(
      <GanttChart
        rows={rows}
        undated={undated}
        edges={[]}
        rangeStart={day('2026-06-01')}
        rangeEnd={day('2026-06-08')}
      />,
    )
    expect(screen.getAllByText('No dates yet')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /to the timeline/ })).toBeNull()
  })

  it('measures its container with ResizeObserver', () => {
    let callback: ResizeObserverCallback | undefined
    class RO {
      constructor(cb: ResizeObserverCallback) {
        callback = cb
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    window.ResizeObserver = RO as never
    render(
      <GanttChart
        rows={rows}
        edges={[]}
        rangeStart={day('2026-06-01')}
        rangeEnd={day('2026-06-08')}
      />,
    )
    act(() =>
      callback!([{ contentRect: { width: 1240 } } as ResizeObserverEntry], {} as ResizeObserver),
    )
    act(() =>
      callback!([{ contentRect: { width: 100 } } as ResizeObserverEntry], {} as ResizeObserver),
    )
    expect(screen.getByRole('button', { name: /^Book venue/ })).toBeInTheDocument()
    // @ts-expect-error — jsdom has no ResizeObserver by default; restore that state.
    delete window.ResizeObserver
  })
})

describe('GanttDependencyLayer', () => {
  it('draws forward and backward elbows, marks removal only for the selected row', () => {
    const onRemove = vi.fn()
    const flat: GanttRow[] = [
      { id: 1, label: 'A', status: 'ready', placement: placed(1, '2026-06-01', '2026-06-02') },
      { id: 2, label: 'B', status: 'ready', placement: placed(2, '2026-06-10', '2026-06-11') },
    ]
    const { container, rerender } = render(
      <GanttDependencyLayer
        rows={rows}
        edges={edges}
        origin={day('2026-06-01')}
        pxPerDay={30}
        width={900}
        height={220}
        focusedId={2}
        selectedId={2}
        busy
        onRemove={onRemove}
      />,
    )
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(3)
    expect(
      screen.getByRole('button', { name: 'Remove dependency Print flyers → Launch' }),
    ).toBeDisabled()
    // A self-edge (bad data) is drawn backwards rather than crashing.
    rerender(
      <GanttDependencyLayer
        rows={flat}
        edges={[
          { id: 5, predecessorId: 1, successorId: 2 },
          { predecessorId: 1, successorId: 1 },
        ]}
        origin={day('2026-06-01')}
        pxPerDay={30}
        width={900}
        height={100}
        selectedId={1}
        onRemove={onRemove}
      />,
    )
    const remove = screen.getByRole('button', { name: 'Remove dependency A → B' })
    fireEvent.mouseEnter(remove)
    expect(remove.style.borderColor).toBe('var(--gantt-today)')
    fireEvent.mouseLeave(remove)
    expect(remove.style.borderColor).toBe('var(--gantt-link-active)')
    fireEvent.click(remove)
    expect(onRemove).toHaveBeenCalledWith(5)
    // Read-only, and with an off-window endpoint, nothing is removable or drawn.
    rerender(
      <GanttDependencyLayer
        rows={rows}
        edges={[{ predecessorId: 5, successorId: 1 }]}
        origin={day('2026-06-01')}
        pxPerDay={30}
        width={900}
        height={100}
      />,
    )
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(0)
  })
})

describe('GanttLegend / BaselineDialog', () => {
  const legendEntries = (container: HTMLElement) =>
    Array.from(container.firstElementChild!.children).map((entry) => entry.textContent)

  it('is one short line: status colours, today, the deadline and the key date', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const { container } = render(<GanttLegend />)
    expect(legendEntries(container)).toEqual([
      'To do',
      'In progress',
      'Done',
      'Today',
      '▲Deadline (red once it is missed)',
      '★Key date',
    ])
    await user.hover(screen.getByText('Key date'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('built around')
    for (const mark of ['Original plan', 'Actual', 'Critical path', 'Project end', 'Milestone']) {
      expect(screen.queryByText(mark)).toBeNull()
    }
  })

  it('names each colour by the statuses the chart draws in it', () => {
    const { container } = render(
      <GanttLegend statuses={['completed', 'on_hold', 'ready', 'under_review', 'ready']} />,
    )
    expect(legendEntries(container).slice(0, 3)).toEqual(['To do', 'In review', 'Done'])
    expect(legendEntries(container)).toContain('On hold')
  })

  it('folds the planner’s help and every planning mark into Planning tools', async () => {
    render(
      <PlanningTools>
        <button type="button">Extra control</button>
      </PlanningTools>,
    )
    expect(screen.getByText('Planning tools')).toBeInTheDocument()
    expect(screen.getByText(/Drag a bar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Extra control' })).toBeInTheDocument()
    expect(screen.getByText('What the marks mean')).toBeInTheDocument()
    for (const mark of [
      'Key date',
      'Critical path',
      'Original plan',
      'Actual',
      'Starts too early',
      'Any time in the window',
      'On exact dates',
      'Milestone',
      'Project end',
    ]) {
      expect(screen.getByText(mark, { selector: 'dt' })).toBeInTheDocument()
    }
  })

  it('explains first-time versus replacement baselines', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <BaselineDialog
        isOpen
        existingSetAt={null}
        taskCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )
    expect(screen.getByText('Set the original plan')).toBeInTheDocument()
    expect(screen.getByText(/1 dated task,/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set original plan' }))
    expect(onConfirm).toHaveBeenCalled()
    rerender(
      <BaselineDialog
        isOpen
        existingSetAt={day('2026-05-01')}
        taskCount={3}
        busy
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )
    expect(screen.getByText('Replace the original plan?')).toBeInTheDocument()
    expect(screen.getByText('1 May 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace original plan' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('GanttItemPanel', () => {
  const baseProps = {
    row: rows[1],
    dates: {
      timing: 'flexible' as const,
      startDate: '2026-06-04',
      deadline: '2026-06-05',
      estimatedHours: '1',
    },
    description: 'Print them',
    assigneeName: null,
    predecessors: [
      {
        dependencyId: 10,
        predecessorId: 1,
        predecessorTitle: 'Book venue',
        item: {
          id: 1,
          projectId: 1,
          title: 'Book venue',
          type: 'TASK' as const,
          displayStatus: 'completed',
          assigneeName: 'Ann',
          helperCount: 0,
          helpersWanted: null,
          deadline: day('2026-06-03'),
          completedAt: day('2026-06-03'),
          href: '/projects/1/tasks/1',
          viewer: { isAssignee: false, canReview: false },
        },
      },
    ],
    onClose: vi.fn(),
    onSaveDates: vi.fn(),
  }

  it('gives a viewer the facts in order, with no form controls', () => {
    const successor = {
      ...baseProps.predecessors[0].item,
      id: 3,
      title: 'Launch',
      displayStatus: 'blocked',
      completedAt: null,
      href: '/projects/1/tasks/3',
    }
    const { container } = render(
      <GanttItemPanel
        {...baseProps}
        canManage={false}
        successors={[successor]}
        helpers="2 helpers wanted"
      />,
    )
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Unclaimed')).toBeInTheDocument()
    expect(screen.getByText('· 2 helpers wanted')).toBeInTheDocument()
    expect(screen.getByText('Print them')).toBeInTheDocument()
    // When, what it waits on, what waits on it: in that order, with nothing to edit.
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'When',
      'Waits on',
      'Unblocks',
    ])
    const when = screen.getByRole('group', { name: 'When it is due' })
    expect(when).toHaveTextContent('Due 5 Jun · today')
    expect(when).toHaveTextContent('Planned to finish 1 day late')
    expect(when).toHaveTextContent('Effort: about 1 hour')
    expect(screen.getByRole('link', { name: 'Book venue' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Launch' })).toHaveAttribute(
      'href',
      '/projects/1/tasks/3',
    )
    // Planning aids, the Dates block and staffing are for those who can change them.
    expect(screen.queryByText('Planning tools')).toBeNull()
    expect(screen.queryByText('Critical path')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit dates' })).toBeNull()
    expect(screen.queryByText('Assigned to')).toBeNull()
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0)
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Close panel',
    ])
    fireEvent.click(screen.getByLabelText('Close panel'))
    expect(baseProps.onClose).toHaveBeenCalled()
  })

  it('shows milestone and anchor states with a link, and leaves a conflict to the planner', () => {
    const props = {
      ...baseProps,
      row: { ...rows[2], href: '/t/3' },
      dates: { timing: 'fixed' as const, startDate: '', deadline: '', estimatedHours: '2' },
      description: null,
      assigneeName: 'Ann',
      predecessors: [],
      assignment: {
        canAssign: false,
        canClaim: false,
        claimViewer: { onProject: false, invited: false },
        options: [],
        onAssign: vi.fn(),
        onClaim: vi.fn(),
        onUnassign: vi.fn(),
      },
    }
    const { rerender } = render(<GanttItemPanel {...props} canManage={false} />)
    expect(screen.getByText('Milestone')).toBeInTheDocument()
    // Everyone sees the key date; only the critical path is a manager's aid.
    expect(screen.getByText('★ Key date')).toBeInTheDocument()
    expect(screen.getByText('Effort: about 2 hours')).toBeInTheDocument()
    expect(screen.queryByText('Unblocks')).toBeNull()
    expect(screen.queryByText(/No original plan saved/)).toBeNull()
    expect(screen.queryByText(/after the key date/)).toBeNull()
    expect(screen.getByText('Nothing — can start whenever.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open task →' })).toHaveAttribute('href', '/t/3')
    expect(screen.getByText('Ann')).toBeInTheDocument()

    rerender(<GanttItemPanel {...props} canManage />)
    expect(
      screen.getByText('No original plan saved yet, so nothing to compare.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The work before it finishes 2 days after the key date.'),
    ).toBeInTheDocument()
  })

  it('lets a manager edit dates behind Edit dates, and assignment, with the Plan menu in the footer', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const assignment = {
      canAssign: true,
      canClaim: true,
      claimViewer: { onProject: true, invited: false },
      options: [
        { value: '', label: 'Pick', header: true },
        { value: '7', label: 'Zed' },
      ],
      onAssign: vi.fn(),
      onClaim: vi.fn(),
      onUnassign: vi.fn(),
    }
    const late = {
      ...rows[0],
      status: 'in_progress',
      placement: {
        ...rows[0].placement,
        finishVarianceDays: 1,
        pinnedBeforePredecessor: true,
        pinConflictDays: 2,
        pinConflictWith: 1,
      },
    }
    const { rerender } = render(
      <GanttItemPanel
        {...baseProps}
        row={late}
        canManage
        assignment={assignment}
        planMenu={<button type="button">Plan stub</button>}
      />,
    )
    // The Plan menu sits beside Open task, after everything the panel shows.
    const footer = screen.getByRole('button', { name: 'Plan stub' }).closest('div')!.parentElement!
    expect(footer).toBe(screen.getByRole('complementary').lastElementChild)
    // Original plan, actual, critical path and the conflict sit in the folded Planning tools,
    // whose summary still says when the bar starts too early.
    expect(screen.getByText('Planning tools').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('· starts too early')).toBeInTheDocument()
    expect(screen.getByText('Critical path')).toBeInTheDocument()
    expect(screen.getByText('Moved').nextSibling).toHaveTextContent('1 day later')
    expect(screen.getByText('Original plan')).toBeInTheDocument()
    expect(screen.getByText('Actual').nextSibling).toHaveTextContent('1 Jun 2026 – 4 Jun 2026')
    expect(
      screen.getByText(
        'Starts 2 days too early for “Book venue”. Move it, or let it start when “Book venue” is done.',
      ),
    ).toBeInTheDocument()

    // The Dates block is folded until asked for; Cancel puts back what was stored.
    expect(screen.queryByLabelText('Deadline')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit dates' }))
    expect(
      screen.getByText(/Starts on this date even if “Book venue” runs late/),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '2026-06-20' } })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Deadline')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit dates' }))
    expect(screen.getByLabelText('Deadline')).toHaveValue('2026-06-05')

    fireEvent.change(screen.getByLabelText('Start (optional)'), {
      target: { value: '2026-06-02' },
    })
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '2026-06-09' } })
    fireEvent.submit(screen.getByLabelText('Deadline').closest('form')!)
    expect(baseProps.onSaveDates).toHaveBeenCalledWith({
      timing: 'flexible',
      startDate: day('2026-06-02'),
      durationDays: null,
      estimatedHours: 1,
      deadline: day('2026-06-09'),
    })
    // Saving folds the block away again.
    expect(screen.queryByLabelText('Deadline')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit dates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start when “Book venue” is done' }))
    expect(baseProps.onSaveDates).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: null, deadline: day('2026-06-09') }),
    )
    await user.click(screen.getByRole('button', { name: 'Edit dates' }))
    expect(screen.getByText(/Starts when “Book venue” is done/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '' } })
    fireEvent.submit(screen.getByLabelText('Deadline').closest('form')!)
    expect(baseProps.onSaveDates).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: null, deadline: null }),
    )
    // Links and the key date are the Plan menu's; the panel only shows what it waits on.
    expect(screen.queryByRole('checkbox', { name: /Key date/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.queryByLabelText('Add a dependency')).toBeNull()
    expect(screen.getByRole('link', { name: 'Book venue' })).toHaveAttribute(
      'href',
      '/projects/1/tasks/1',
    )

    await user.click(screen.getByRole('button', { name: 'Claim task' }))
    expect(assignment.onClaim).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Assign to a volunteer'), '7')
    await user.click(screen.getByRole('button', { name: 'Assign' }))
    expect(assignment.onAssign).toHaveBeenCalledWith(7)

    rerender(
      <GanttItemPanel
        {...baseProps}
        row={late}
        dates={{ ...baseProps.dates, startDate: '', deadline: '' }}
        assigneeName="Zed"
        canManage
        assignment={assignment}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Unassign' }))
    expect(assignment.onUnassign).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Claim task' })).toBeNull()

    // Someone not on the project asks for the task instead of taking it.
    rerender(
      <GanttItemPanel
        {...baseProps}
        row={late}
        canManage={false}
        assignment={{ ...assignment, claimViewer: { onProject: false, invited: false } }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Ask to take this' })).toBeInTheDocument()
  })

  it('keeps a done task read-only, with Reopen for a manager', async () => {
    const user = userEvent.setup()
    const onReopen = vi.fn()
    const done = { ...rows[1], status: 'completed' }
    const assignment = {
      canAssign: true,
      canClaim: true,
      claimViewer: { onProject: true, invited: false },
      options: [{ value: '7', label: 'Sam' }],
      onAssign: vi.fn(),
      onClaim: vi.fn(),
      onUnassign: vi.fn(),
    }
    const { rerender } = render(
      <GanttItemPanel
        {...baseProps}
        row={done}
        assigneeName="Sam"
        canManage
        assignment={assignment}
        onReopen={onReopen}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Edit dates' })).toBeNull()
    expect(screen.queryByText('Assigned to')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unassign' })).toBeNull()
    // What it waited on stays listed.
    expect(screen.getByRole('link', { name: 'Book venue' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(onReopen).toHaveBeenCalled()

    rerender(<GanttItemPanel {...baseProps} row={done} canManage={false} />)
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })
})

describe('GanttPlanMenu', () => {
  const plan = (over: Partial<GanttPlan> = {}): GanttPlan => ({
    taskId: 2,
    taskTitle: 'Print flyers',
    tasks: [
      { id: 1, title: 'Book venue' },
      { id: 2, title: 'Print flyers' },
      { id: 3, title: 'Launch' },
    ],
    links: [{ dependencyId: 10, predecessorId: 1, predecessorTitle: 'Book venue' }],
    isAnchor: false,
    onAddDependency: vi.fn(),
    onRemoveDependency: vi.fn(),
    onSetAnchor: vi.fn(),
    ...over,
  })
  const trigger = () => screen.getByRole('button', { name: 'Plan “Print flyers”' })
  const dialog = () => screen.getByRole('dialog', { name: 'Plan “Print flyers”' })

  it('adds and removes links', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const p = plan()
    render(<GanttPlanMenu plan={p} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')

    // Neither the task itself nor what it already waits on is offered.
    const picker = within(dialog()).getByLabelText('Waits on…')
    expect(within(picker).queryByRole('option', { name: 'Print flyers' })).toBeNull()
    expect(within(picker).queryByRole('option', { name: 'Book venue' })).toBeNull()
    fireEvent.submit(picker.closest('form')!)
    expect(p.onAddDependency).not.toHaveBeenCalled()
    await user.selectOptions(picker, '3')
    await user.click(within(dialog()).getByRole('button', { name: 'Add' }))
    expect(p.onAddDependency).toHaveBeenCalledWith(3)
    expect(picker).toHaveValue('')

    await user.click(within(dialog()).getByRole('button', { name: 'Stop waiting on Book venue' }))
    expect(p.onRemoveDependency).toHaveBeenCalledWith(10)
    expect(within(dialog()).queryByRole('spinbutton')).toBeNull()
  })

  it('sets and clears the key date, and only for whoever may', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const p = plan()
    const { rerender } = render(<GanttPlanMenu plan={p} />)
    await user.click(trigger())
    await user.click(within(dialog()).getByRole('button', { name: 'Make this the key date' }))
    expect(p.onSetAnchor).toHaveBeenCalledWith(true)
    await user.hover(within(dialog()).getByText('A fixed point the plan is built around'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('measured towards the key dates')

    rerender(<GanttPlanMenu plan={{ ...p, isAnchor: true }} />)
    await user.click(within(dialog()).getByRole('button', { name: 'Stop using as key date' }))
    expect(p.onSetAnchor).toHaveBeenLastCalledWith(false)

    // A deputy plans links but not the key date.
    rerender(<GanttPlanMenu plan={{ ...p, onSetAnchor: undefined }} />)
    expect(within(dialog()).queryByRole('button', { name: /key date/ })).toBeNull()

    // With nothing linked and nothing left to link, it says so and offers no picker.
    rerender(
      <GanttPlanMenu plan={{ ...p, links: [], tasks: [{ id: 2, title: 'Print flyers' }] }} />,
    )
    expect(within(dialog()).getByText('Nothing — can start whenever.')).toBeInTheDocument()
    expect(within(dialog()).queryByLabelText('Waits on…')).toBeNull()
  })

  it('closes on its button, Escape, or a click elsewhere, but not a click inside', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    render(
      <>
        <GanttPlanMenu plan={plan()} />
        <p>Elsewhere</p>
      </>,
    )
    await user.click(trigger())
    await user.click(trigger())
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(trigger())
    await user.click(within(dialog()).getByText('Waits on'))
    expect(dialog()).toBeInTheDocument()
    await user.keyboard('{Shift}')
    expect(dialog()).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger()).toHaveFocus()

    await user.click(trigger())
    await user.click(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sits beside the selected bar only', () => {
    render(
      <GanttChart
        rows={rows}
        edges={edges}
        rangeStart={day('2026-06-01')}
        rangeEnd={day('2026-06-08')}
        editable
        selectedId={2}
        selectedMenu={<button type="button">Plan stub</button>}
      />,
    )
    expect(screen.getAllByRole('button', { name: 'Plan stub' })).toHaveLength(1)
  })
})
