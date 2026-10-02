import Tooltip from '@/components/Tooltip'
import { TONE_LABELS, toneFill, type BarTone } from './palette'

const TONES: BarTone[] = ['todo', 'progress', 'done', 'hold']

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

/**
 * A compact key for the chart. Every mark the timeline can draw appears here once, so the
 * chart itself needs no inline text to explain a colour.
 */
export default function GanttLegend({
  editable,
  highlightCritical = true,
}: {
  editable: boolean
  highlightCritical?: boolean
}) {
  return (
    <div className="text-text-light mt-3 flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {TONES.map((tone) => (
          <Swatch key={tone} label={TONE_LABELS[tone]}>
            <span
              className="block h-3 w-6 rounded-sm"
              style={{ background: toneFill(tone) }}
              aria-hidden="true"
            />
          </Swatch>
        ))}
        <Swatch label="Any time in the window (hours of work shown)">
          <span
            className="block h-3 w-6 rounded-sm"
            style={{
              background: 'color-mix(in srgb, var(--gantt-bar-todo) 40%, transparent)',
            }}
            aria-hidden="true"
          />
        </Swatch>
        <Swatch label="On set dates">
          <span
            className="block h-3 w-6 rounded-sm"
            style={{
              background: 'var(--gantt-bar-todo)',
              boxShadow: 'inset 0 0 0 2px var(--gantt-finish)',
            }}
            aria-hidden="true"
          />
        </Swatch>
        <Swatch label="Milestone (no duration)">
          <span
            className="block h-2.5 w-2.5"
            style={{
              background: 'var(--gantt-bar-todo)',
              borderRadius: 1,
              transform: 'rotate(45deg)',
            }}
            aria-hidden="true"
          />
        </Swatch>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* The original plan and the critical path are planning aids, drawn only for those who
            can change the plan (see GanttRow). */}
        {editable && (
          <Swatch label="Original plan">
            <span
              className="block h-1 w-6 rounded-full"
              style={{ background: 'var(--gantt-baseline)' }}
              aria-hidden="true"
            />
          </Swatch>
        )}
        <Swatch label="Actual">
          <span
            className="block h-1 w-6 rounded-full"
            style={{ background: 'var(--gantt-actual)' }}
            aria-hidden="true"
          />
        </Swatch>
        <Swatch label="Key date" hint={ANCHOR_HINT}>
          <span aria-hidden="true" style={{ color: 'var(--gantt-anchor)' }}>
            ★
          </span>
        </Swatch>
        {editable && highlightCritical && (
          <Swatch label="Critical path" hint={CRITICAL_HINT}>
            <span
              className="block h-3 w-6 rounded-sm"
              style={{
                background: 'transparent',
                boxShadow: 'inset 0 0 0 2px var(--gantt-critical)',
              }}
              aria-hidden="true"
            />
          </Swatch>
        )}
        <Swatch label="Today">
          <span
            className="block h-3 w-0.5"
            style={{ background: 'var(--gantt-today)' }}
            aria-hidden="true"
          />
        </Swatch>
        <Swatch label="Project end">
          <span
            className="block h-3"
            style={{ borderLeft: '2px dashed var(--gantt-finish)' }}
            aria-hidden="true"
          />
        </Swatch>
        <Swatch label="Deadline (red once the plan runs past it)">
          <span aria-hidden="true" style={{ color: 'var(--gantt-today)' }}>
            ▲
          </span>
        </Swatch>
        <Swatch label="Starts before its dependencies allow">
          <span
            className="block h-2.5 w-2.5 rounded-full"
            style={{
              background: 'var(--gantt-today)',
              boxShadow: '0 0 0 1.5px var(--color-surface)',
            }}
            aria-hidden="true"
          />
        </Swatch>
      </div>
    </div>
  )
}

/**
 * The planner's corner of the timeline, folded away so a newcomer reading the chart meets none
 * of it: how to drag and link, what the key date and the critical path mean, and whatever
 * controls the page adds (the original plan, the critical-path highlight).
 */
export function PlanningTools({ children }: { children?: React.ReactNode }) {
  return (
    <details className="border-brand-border mt-3 rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Planning tools</summary>
      <div className="mt-3 flex flex-col gap-3">
        {children}
        <dl className="text-text-light m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
          <dt className="whitespace-nowrap" style={{ color: 'var(--gantt-anchor)' }}>
            ★ Key date
          </dt>
          <dd className="m-0">
            The fixed point the plan is built around — the event date itself. Mark one by selecting
            a bar and ticking <em>Key date</em>. With none set, the last item to finish stands in
            for one.
          </dd>
          <dt className="whitespace-nowrap" style={{ color: 'var(--gantt-critical)' }}>
            Critical path
          </dt>
          <dd className="m-0">
            Zero slack: a one-day delay here delays the key date by a day. Work that finishes with a
            gap before whatever follows it has that many days spare, so it is not on the path.
          </dd>
        </dl>
        <p className="text-text-light m-0 text-xs">
          Drag a bar to move it, its right edge to change duration, or the circle at its end onto
          another row to link them. Click a bar to select it — a × appears on each of its dependency
          arrows, and removes that link.
        </p>
      </div>
    </details>
  )
}
