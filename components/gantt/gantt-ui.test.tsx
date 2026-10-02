import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEndEvent } from '@dnd-kit/core'
import type { ScheduledItem } from '@/lib/schedule'
import GanttChart, { lockYForBarDrags } from './GanttChart'
import GanttLegend, { PlanningTools } from './GanttLegend'
import GanttItemPanel from './GanttItemPanel'
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
    status: 'open',
    placement: placed(3, '2026-06-08', '2026-06-08', {
      isMilestone: true,
      isAnchor: true,
      pinnedBeforePredecessor: true,
      pinConflictDays: 3,
      pinConflictWith: 2,
    }),
  },
  { id: 4, label: 'Wrap up', status: 'on_hold', placement: placed(4, '2026-09-01', '2026-09-02') },
  { id: 5, label: 'Long ago', status: 'open', placement: placed(5, '2025-01-01', '2025-01-02') },
]
const edges = [
  { id: 10, predecessorId: 1, successorId: 2, lagDays: 0 },
  { id: 11, predecessorId: 2, successorId: 3, lagDays: 0 },
  { id: 12, predecessorId: 3, successorId: 1, lagDays: 0 },
  { predecessorId: 4, successorId: 99, lagDays: 0 },
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
    expect(barTone('open')).toBe('todo')
    expect(barFill('open')).toBe('var(--gantt-bar-todo)')
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
    expect(
      screen.getByTitle('“Print flyers” finishes 2 days after the key date.'),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'Print flyers: 4 June 2026 – 6 June 2026, deadline 5 June 2026, 1 day late, 1 day earlier than the original plan, on the critical path',
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

  it('draws a flexible window faint with its hours, and set dates solid with an edge', () => {
    render(
      <GanttChart
        rows={[
          {
            id: 7,
            label: 'Print flyers',
            status: 'open',
            timing: 'flexible',
            effortHours: 6,
            placement: placed(7, '2026-06-01', '2026-06-07'),
          },
          {
            id: 8,
            label: 'Staff the stall',
            status: 'open',
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
      { id: 1, label: 'A', status: 'open', placement: placed(1, '2026-06-01', '2026-06-02') },
      { id: 2, label: 'B', status: 'open', placement: placed(2, '2026-06-10', '2026-06-11') },
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
          { id: 5, predecessorId: 1, successorId: 2, lagDays: 0 },
          { predecessorId: 1, successorId: 1, lagDays: 0 },
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
        edges={[{ predecessorId: 5, successorId: 1, lagDays: 0 }]}
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
  it('lists every mark, with hover hints, and the critical path only while highlighted', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const { rerender } = render(<GanttLegend editable />)
    await user.hover(screen.getByText('Key date', { selector: 'span span' }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(screen.getByText('Critical path', { selector: 'span span' })).toBeInTheDocument()
    rerender(<GanttLegend editable highlightCritical={false} />)
    expect(screen.queryByText('Critical path', { selector: 'span span' })).toBeNull()
  })

  it('folds the planner’s help into Planning tools', async () => {
    render(
      <PlanningTools>
        <button type="button">Extra control</button>
      </PlanningTools>,
    )
    expect(screen.getByText('Planning tools')).toBeInTheDocument()
    expect(screen.getByText(/Drag a bar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Extra control' })).toBeInTheDocument()
  })

  it('leaves the planning marks out of a read-only legend, but not the key date', () => {
    render(<GanttLegend editable={false} />)
    for (const mark of ['Original plan', 'Critical path']) {
      expect(screen.queryByText(mark, { selector: 'span span' })).toBeNull()
    }
    expect(screen.getByText('Key date', { selector: 'span span' })).toBeInTheDocument()
    expect(screen.queryByText(/Drag a bar/)).toBeNull()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText(/^Deadline/)).toBeInTheDocument()
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
      durationDays: '3',
      estimatedHours: '1',
      deadline: '2026-06-05',
    },
    description: 'Print them',
    assigneeName: null,
    siblings: [
      { id: 1, title: 'Book venue' },
      { id: 2, title: 'Print flyers' },
      { id: 3, title: 'Launch' },
    ],
    predecessors: [
      { dependencyId: 10, predecessorId: 1, predecessorTitle: 'Book venue', lagDays: 0 },
    ],
    onClose: vi.fn(),
    onSaveDates: vi.fn(),
    onAddDependency: vi.fn(),
    onRemoveDependency: vi.fn(),
    onUpdateLag: vi.fn(),
    onSetAnchor: vi.fn(),
  }

  it('shows the facts and chips read-only for a viewer', () => {
    render(<GanttItemPanel {...baseProps} canManage={false} />)
    expect(screen.getByText('In progress')).toBeInTheDocument()
    // Planning aids are for those who can change the plan.
    expect(screen.queryByText('Critical path')).toBeNull()
    expect(screen.getByText('1 day late')).toBeInTheDocument()
    expect(screen.getByText('Print them')).toBeInTheDocument()
    expect(screen.getByText('Deadline').nextSibling).toHaveTextContent('5 Jun 2026 · 1 day late')
    expect(screen.getByText('Effort').nextSibling).toHaveTextContent('1 hour of work')
    expect(screen.getByText('Moved').nextSibling).toHaveTextContent(
      '1 day earlier (7 Jun 2026 → 6 Jun 2026)',
    )
    expect(screen.getByText('Actual').nextSibling).toHaveTextContent('in progress')
    expect(screen.queryByText('Dates')).toBeNull()
    expect(screen.getByLabelText(/Lag/)).toBeDisabled()
    expect(screen.getByText('Nobody yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    fireEvent.click(screen.getByLabelText('Close panel'))
    expect(baseProps.onClose).toHaveBeenCalled()
  })

  it('shows milestone, anchor, no-baseline and pin-conflict states with a link', () => {
    render(
      <GanttItemPanel
        {...baseProps}
        row={{ ...rows[2], href: '/t/3' }}
        dates={{
          timing: 'fixed',
          startDate: '',
          durationDays: '0',
          estimatedHours: '2',
          deadline: '',
        }}
        description={null}
        assigneeName="Ann"
        predecessors={[]}
        canManage={false}
        assignment={{
          canAssign: false,
          canClaim: false,
          options: [],
          onAssign: vi.fn(),
          onClaim: vi.fn(),
          onUnassign: vi.fn(),
        }}
      />,
    )
    expect(screen.getByText('Milestone')).toBeInTheDocument()
    // Everyone sees the key date; only the critical path is a manager's aid.
    expect(screen.getByText('★ Key date')).toBeInTheDocument()
    expect(screen.getByText('2 hours of work')).toBeInTheDocument()
    expect(screen.queryByText(/No original plan saved/)).toBeNull()
    expect(
      screen.getByText('The work before it finishes 2 days after the key date.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Nothing — can start whenever.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open task →' })).toHaveAttribute('href', '/t/3')
    expect(screen.getByText('Ann')).toBeInTheDocument()
  })

  it('lets a manager edit dates, anchor, dependencies and assignment', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const assignment = {
      canAssign: true,
      canClaim: true,
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
      placement: {
        ...rows[0].placement,
        finishVarianceDays: 1,
        pinnedBeforePredecessor: true,
        pinConflictDays: 2,
        pinConflictWith: 1,
      },
    }
    const { rerender } = render(
      <GanttItemPanel {...baseProps} row={late} canManage assignment={assignment} />,
    )
    expect(screen.getByText('Moved').nextSibling).toHaveTextContent('1 day later')
    expect(
      screen.getByText(
        'Starts 2 days too early for “Book venue”. Move it, or clear its start date to follow it.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Starts on this date even if “Book venue” runs late/),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-09' } })
    fireEvent.change(screen.getByLabelText('Days'), { target: { value: '5' } })
    fireEvent.submit(screen.getByLabelText('Days').closest('form')!)
    expect(baseProps.onSaveDates).toHaveBeenCalledWith({
      timing: 'flexible',
      startDate: day('2026-06-09'),
      durationDays: 5,
      estimatedHours: 1,
      deadline: day('2026-06-05'),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Follow “Book venue” instead' }))
    expect(baseProps.onSaveDates).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: null, durationDays: 5 }),
    )
    expect(screen.getByText(/Starts when “Book venue” finishes/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Days'), { target: { value: '' } })
    fireEvent.submit(screen.getByLabelText('Days').closest('form')!)
    expect(baseProps.onSaveDates).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: null, durationDays: null }),
    )
    await user.click(screen.getByRole('checkbox'))
    expect(baseProps.onSetAnchor).toHaveBeenCalledWith(true)

    const lag = screen.getByLabelText(/Lag/, { selector: '#panel-lag-10' })
    fireEvent.change(lag, { target: { value: '2' } })
    fireEvent.blur(lag)
    expect(baseProps.onUpdateLag).toHaveBeenCalledWith(10, 2)
    // Blank reads as 0, which equals the stored lag — no write.
    fireEvent.change(lag, { target: { value: '' } })
    fireEvent.blur(lag)
    expect(baseProps.onUpdateLag).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remove dependency on Book venue' }))
    expect(baseProps.onRemoveDependency).toHaveBeenCalledWith(10)

    const select = screen.getByLabelText('Add a dependency')
    fireEvent.submit(select.closest('form')!)
    expect(baseProps.onAddDependency).not.toHaveBeenCalled()
    await user.selectOptions(select, '3')
    fireEvent.change(screen.getByLabelText(/Lag/, { selector: '#panel-add-lag' }), {
      target: { value: '4' },
    })
    fireEvent.submit(select.closest('form')!)
    expect(baseProps.onAddDependency).toHaveBeenCalledWith(3, 4)
    await user.selectOptions(screen.getByLabelText('Add a dependency'), '3')
    fireEvent.submit(select.closest('form')!)
    expect(baseProps.onAddDependency).toHaveBeenLastCalledWith(3, 0)

    await user.click(screen.getByRole('button', { name: 'Assign to me' }))
    expect(assignment.onClaim).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Assign to a volunteer'), '7')
    await user.click(screen.getByRole('button', { name: 'Assign' }))
    expect(assignment.onAssign).toHaveBeenCalledWith(7)

    rerender(
      <GanttItemPanel
        {...baseProps}
        row={late}
        dates={{ ...baseProps.dates, startDate: '', durationDays: '' }}
        assigneeName="Zed"
        canManage
        assignment={assignment}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Unassign' }))
    expect(assignment.onUnassign).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()
  })
})
