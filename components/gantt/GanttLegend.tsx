import Tooltip from '@/components/Tooltip'
import { TASK_STATUS_LABELS } from '@/lib/status-labels'
import { barTone, statusLabel, toneFill, type BarTone } from './palette'

const TONES: BarTone[] = ['todo', 'progress', 'done', 'hold']
/** A task's statuses in the order work moves through them; any other status follows. */
const STATUS_ORDER = Object.keys(TASK_STATUS_LABELS)
const DEFAULT_STATUSES = ['blocked', 'ready', 'in_progress', 'completed']

function Swatch({
  children,
  label,
  hint,
}: {
  children: React.ReactNode
  label: string
  /** Shown on hover, for marks whose name does not explain them. */
  hint?: string
}) {
  const text = (
    <span
      className={
        hint ? 'decoration-dotted underline-offset-2 [text-decoration-line:underline]' : undefined
      }
    >
      {label}
    </span>
  )
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex h-3 w-6 shrink-0 items-center justify-center">{children}</span>
      {hint ? <Tooltip content={hint}>{text}</Tooltip> : text}
    </span>
  )
}

/** The two markings that need more than a name to be understood. */
export const ANCHOR_HINT =
  'A fixed point the plan is built around — an event date, a launch, a deadline. The critical path is measured towards the key dates, so work that only follows one is correctly shown as having slack.'
export const CRITICAL_HINT =
  'Zero slack: this runs right up against the next thing, so a one-day delay here delays the key date by a day. Work with a gap before its successor is not on the path — it can slip by that much and change nothing.'

/** Each colour the chart uses, named by the statuses drawn in it: "Blocked / Ready". */
function toneKey(statuses: string[]): { tone: BarTone; label: string }[] {
  const rank = (s: string) => {
    const i = STATUS_ORDER.indexOf(s)
    return i === -1 ? STATUS_ORDER.length : i
  }
  const sorted = [...new Set(statuses)].sort((a, b) => rank(a) - rank(b))
  return TONES.flatMap((tone) => {
    const labels = [...new Set(sorted.filter((s) => barTone(s) === tone).map(statusLabel))]
    return labels.length > 0 ? [{ tone, label: labels.join(' / ') }] : []
  })
}

/**
 * One line under the chart: the status colours it draws, today, deadlines and the key date. The
 * planning marks are explained in Planning tools instead.
 */
export default function GanttLegend({ statuses = DEFAULT_STATUSES }: { statuses?: string[] }) {
  return (
    <div className="text-text-light mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {toneKey(statuses).map(({ tone, label }) => (
        <Swatch key={tone} label={label}>
          <span
            className="block h-3 w-6 rounded-sm"
            style={{ background: toneFill(tone) }}
            aria-hidden="true"
          />
        </Swatch>
      ))}
      <Swatch label="Today">
        <span
          className="block h-3 w-0.5"
          style={{ background: 'var(--gantt-today)' }}
          aria-hidden="true"
        />
      </Swatch>
      <Swatch label="Deadline (red once it is missed)">
        <span aria-hidden="true" style={{ color: 'var(--gantt-today)' }}>
          ▲
        </span>
      </Swatch>
      <Swatch label="Key date" hint={ANCHOR_HINT}>
        <span aria-hidden="true" style={{ color: 'var(--gantt-anchor)' }}>
          ★
        </span>
      </Swatch>
    </div>
  )
}

/** A mark and its name, for the list in Planning tools. */
function Mark({ children, name }: { children: React.ReactNode; name: string }) {
  return (
    <dt className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="flex h-3 w-6 shrink-0 items-center justify-center" aria-hidden="true">
        {children}
      </span>
      {name}
    </dt>
  )
}

/**
 * The planner's corner of the timeline, folded away so a newcomer reading the chart meets none
 * of it: how to drag and link, what every planning mark means, and whatever controls the page
 * adds (the original plan, the critical-path highlight).
 */
export function PlanningTools({ children }: { children?: React.ReactNode }) {
  return (
    <details className="border-brand-border mt-3 rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Planning tools</summary>
      <div className="mt-3 flex flex-col gap-3">
        {children}
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-xs font-semibold">What the marks mean</h3>
          <dl className="text-text-light m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <Mark name="Key date">
              <span style={{ color: 'var(--gantt-anchor)' }}>★</span>
            </Mark>
            <dd className="m-0">
              The fixed point the plan is built around — the event date itself. Set it from a bar’s
              Plan menu. With none set, the last item to finish stands in for one.
            </dd>
            <Mark name="Critical path">
              <span
                className="block h-3 w-6 rounded-sm"
                style={{ boxShadow: 'inset 0 0 0 2px var(--gantt-critical)' }}
              />
            </Mark>
            <dd className="m-0">
              Zero slack: a one-day delay here delays the key date by a day. Work that finishes with
              a gap before whatever follows it has that many days spare, so it is not on the path.
            </dd>
            <Mark name="Original plan">
              <span
                className="block h-1 w-6 rounded-full"
                style={{ background: 'var(--gantt-baseline)' }}
              />
            </Mark>
            <dd className="m-0">A thin rule above the bar: where it sat when the plan was set.</dd>
            <Mark name="Actual">
              <span
                className="block h-1 w-6 rounded-full"
                style={{ background: 'var(--gantt-actual)' }}
              />
            </Mark>
            <dd className="m-0">
              A thin rule below the bar: when the work really started and finished.
            </dd>
            <Mark name="Starts too early">
              <span
                className="block h-2.5 w-2.5 rounded-full"
                style={{
                  background: 'var(--gantt-today)',
                  boxShadow: '0 0 0 1.5px var(--color-surface)',
                }}
              />
            </Mark>
            <dd className="m-0">Its start is set before the work it waits on can finish.</dd>
            <Mark name="Any time in the window">
              <span
                className="block h-3 w-6 rounded-sm"
                style={{
                  background: 'color-mix(in srgb, var(--gantt-bar-todo) 40%, transparent)',
                }}
              />
            </Mark>
            <dd className="m-0">A faint bar, with the hours of work it needs written on it.</dd>
            <Mark name="On exact dates">
              <span
                className="block h-3 w-6 rounded-sm"
                style={{
                  background: 'var(--gantt-bar-todo)',
                  boxShadow: 'inset 0 0 0 2px var(--gantt-finish)',
                }}
              />
            </Mark>
            <dd className="m-0">A shift or an event: it happens on these days and no others.</dd>
            <Mark name="Milestone">
              <span
                className="block h-2.5 w-2.5"
                style={{
                  background: 'var(--gantt-bar-todo)',
                  borderRadius: 1,
                  transform: 'rotate(45deg)',
                }}
              />
            </Mark>
            <dd className="m-0">On exact dates, and only one day long.</dd>
            <Mark name="Project end">
              <span
                className="block h-3"
                style={{ borderLeft: '2px dashed var(--gantt-finish)' }}
              />
            </Mark>
            <dd className="m-0">The day the last item on the plan finishes.</dd>
          </dl>
        </section>
        <p className="text-text-light m-0 text-xs">
          Drag a bar to move it, its right edge to change duration, or the circle at its end onto
          another row to link them. Click a bar to select it — a × appears on each of its dependency
          arrows, and removes that link.
        </p>
      </div>
    </details>
  )
}
