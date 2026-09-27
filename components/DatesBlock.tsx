'use client'

import { useEffect, useRef } from 'react'
import Radio from '@/components/Radio'
import Checkbox from '@/components/Checkbox'
import { formatDateShort, fromDateInputValue } from '@/lib/format-date'
import { deadlineBeforeStart, lateStartSentence, type DatesValue } from '@/lib/task-dates'

/**
 * One way to enter a task's dates, used by Add Task, Edit Task and the timeline panel.
 *
 * A task has one end date, its deadline: the bar runs from the start to it, and reminders count
 * towards it. A task that follows another has no start of its own; the line underneath says
 * when that puts it, and whether it can still make its deadline.
 */
export default function DatesBlock({
  id,
  value,
  onChange,
  followsTitle,
  derivedStart,
  note,
  disabled,
}: {
  /** Prefix for input ids, so two blocks on one page never collide. */
  id: string
  value: DatesValue
  onChange: (next: DatesValue) => void
  /** The task this one follows, when it has a predecessor. */
  followsTitle?: string | null
  /** Where the schedule currently starts it when it has no start of its own. */
  derivedStart?: Date | null
  /** A line under the block, such as who can change the dates later. */
  note?: string
  disabled?: boolean
}) {
  const fixed = value.timing === 'fixed'
  const milestone = fixed && value.milestone
  const set = (patch: Partial<DatesValue>) => onChange({ ...value, ...patch })

  const typedStart = fromDateInputValue(value.startDate)
  const deadline = milestone ? null : fromDateInputValue(value.deadline)
  const endError =
    deadlineBeforeStart(typedStart, deadline) !== null
      ? fixed
        ? 'Ends before it starts'
        : 'The deadline is before the start'
      : null
  // A custom validity message stops the surrounding form submitting until the end is fixed.
  const endRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    endRef.current?.setCustomValidity(endError ?? '')
  }, [endError])

  const followedLate =
    !typedStart && followsTitle && derivedStart ? deadlineBeforeStart(derivedStart, deadline) : null

  return (
    <fieldset className="m-0 border-0 p-0" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold">When does the work happen?</legend>
      <div className="mb-3 flex flex-col gap-1.5">
        <Radio
          name={`${id}-timing`}
          checked={!fixed}
          onChange={() => set({ timing: 'flexible', milestone: false })}
        >
          Any time in a window
        </Radio>
        <Radio name={`${id}-timing`} checked={fixed} onChange={() => set({ timing: 'fixed' })}>
          On set dates (a shift or an event)
        </Radio>
      </div>

      <div className="mb-1 flex flex-wrap items-start gap-3">
        <div>
          <label htmlFor={`${id}-start`}>
            {milestone ? 'On' : fixed ? 'Runs from' : 'Start (optional)'}
          </label>
          <input
            id={`${id}-start`}
            type="date"
            value={value.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
          />
        </div>
        {!milestone && (
          <div>
            <label htmlFor={`${id}-deadline`}>{fixed ? 'To' : 'Deadline'}</label>
            <input
              ref={endRef}
              id={`${id}-deadline`}
              type="date"
              value={value.deadline}
              min={value.startDate || undefined}
              aria-invalid={endError ? true : undefined}
              aria-describedby={endError ? `${id}-deadline-error` : undefined}
              onChange={(e) => set({ deadline: e.target.value })}
            />
          </div>
        )}
      </div>
      {endError && (
        <p id={`${id}-deadline-error`} role="alert" className="text-error mt-0 mb-1 text-sm">
          {endError}
        </p>
      )}
      <p className="text-text-light mt-0 mb-3 text-xs">
        {typedStart
          ? followsTitle
            ? `Starts on this date even if “${followsTitle}” runs late. Clear it to follow that task instead.`
            : 'Starts on this date.'
          : followsTitle
            ? `Starts when “${followsTitle}” finishes${
                derivedStart ? ` (currently ${formatDateShort(derivedStart)})` : ''
              }.`
            : deadline
              ? 'No start date: any time up to the deadline.'
              : 'No start date: it goes at the beginning of the plan until it has one.'}
      </p>
      {followedLate !== null && followsTitle && derivedStart && (
        <p className="text-error mt-0 mb-3 text-sm" aria-live="polite">
          {lateStartSentence(followsTitle, derivedStart, followedLate)}
        </p>
      )}

      {fixed && (
        <div className="mb-3">
          <Checkbox
            checked={value.milestone}
            onChange={(e) => set({ milestone: e.target.checked })}
          >
            It&rsquo;s a moment, not a stretch of work (a milestone)
          </Checkbox>
        </div>
      )}

      <div className="mb-3 w-48">
        <label htmlFor={`${id}-hours`}>Effort (hours of work)</label>
        <input
          id={`${id}-hours`}
          type="number"
          min="0"
          step="0.5"
          placeholder="e.g. 3"
          value={value.estimatedHours}
          onChange={(e) => set({ estimatedHours: e.target.value })}
        />
      </div>
      {note && <p className="text-text-light mt-0 mb-3 text-xs">{note}</p>}
    </fieldset>
  )
}
