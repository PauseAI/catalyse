'use client'

import { useEffect, useRef, useState } from 'react'
import Radio from '@/components/Radio'
import Checkbox from '@/components/Checkbox'
import Button from '@/components/Button'
import { formatDateShort, fromDateInputValue } from '@/lib/format-date'
import {
  daysBetween,
  endInputValue,
  fitToDeadline,
  finishSentence,
  plannedEnd,
  windowText,
  type DatesValue,
} from '@/lib/task-dates'

/**
 * One way to enter a task's dates, used by Add Task, Edit Task and the timeline panel.
 *
 * The window can be typed as an end date or a number of days; each updates the other, and
 * moving the start keeps the days. A task that follows another has no start of its own, so it
 * takes days only. The sentence underneath relates the plan to the deadline as you type.
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
  const milestone = value.durationDays === '0'
  const set = (patch: Partial<DatesValue>) => onChange({ ...value, ...patch })

  // The end field shows what the start and days imply, except while someone is typing an end
  // that comes before the start: that stays on screen, flagged, and changes nothing.
  const [endDraft, setEndDraft] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEndDraft(null)
  }, [value.startDate, value.durationDays])
  const endValue = endDraft ?? endInputValue(value.startDate, value.durationDays)
  const endError = endDraft !== null && endDraft !== '' ? 'Ends before it starts' : null
  // A custom validity message stops the surrounding form submitting until the end is fixed.
  const endRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    endRef.current?.setCustomValidity(endError ?? '')
  }, [endError])

  function changeEnd(end: string) {
    const days = daysBetween(value.startDate, end)
    if (days === null) {
      setEndDraft(end)
      return
    }
    setEndDraft(null)
    set({ durationDays: String(days) })
  }

  const start = fromDateInputValue(value.startDate) ?? derivedStart ?? null
  const end = plannedEnd(value, derivedStart ?? null)
  const deadline = fixed ? null : fromDateInputValue(value.deadline)
  const fitted = fitToDeadline(value, derivedStart ?? null)

  return (
    <fieldset className="m-0 border-0 p-0" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold">When does the work happen?</legend>
      <div className="mb-3 flex flex-col gap-1.5">
        <Radio
          name={`${id}-timing`}
          checked={!fixed}
          onChange={() =>
            set({ timing: 'flexible', durationDays: milestone ? '' : value.durationDays })
          }
        >
          Any time in a window
        </Radio>
        <Radio name={`${id}-timing`} checked={fixed} onChange={() => set({ timing: 'fixed' })}>
          On set dates (a shift or an event)
        </Radio>
      </div>

      <div className="mb-1 flex flex-wrap items-start gap-3">
        <div>
          <label htmlFor={`${id}-start`}>{fixed ? 'Runs from' : 'From'}</label>
          <input
            id={`${id}-start`}
            type="date"
            value={value.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
          />
        </div>
        {value.startDate && !milestone && (
          <div>
            <label htmlFor={`${id}-end`}>To</label>
            <input
              ref={endRef}
              id={`${id}-end`}
              type="date"
              value={endValue}
              min={value.startDate}
              aria-invalid={endError ? true : undefined}
              aria-describedby={endError ? `${id}-end-error` : undefined}
              onChange={(e) => changeEnd(e.target.value)}
            />
          </div>
        )}
        {!milestone && (
          <div className="w-24">
            <label htmlFor={`${id}-days`}>Days</label>
            <input
              id={`${id}-days`}
              type="number"
              min="1"
              step="1"
              value={value.durationDays}
              placeholder="1"
              onChange={(e) => set({ durationDays: e.target.value })}
            />
          </div>
        )}
      </div>
      {endError && (
        <p id={`${id}-end-error`} role="alert" className="text-error mt-0 mb-1 text-sm">
          {endError}
        </p>
      )}
      <p className="text-text-light mt-0 mb-3 text-xs">
        {value.startDate
          ? followsTitle
            ? `Starts on this date even if “${followsTitle}” runs late. Clear it to follow that task instead.`
            : 'Starts on this date.'
          : followsTitle
            ? `Starts when “${followsTitle}” finishes${
                start && end ? ` (currently ${windowText(start, end)})` : ''
              }.`
            : 'No start date: it goes at the beginning of the plan until it has one.'}
      </p>

      {fixed && (
        <div className="mb-3">
          <Checkbox
            checked={milestone}
            onChange={(e) => set({ durationDays: e.target.checked ? '0' : '1' })}
          >
            It&rsquo;s a moment, not a stretch of work (a milestone)
          </Checkbox>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="w-48">
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
        {!fixed && (
          <div>
            <label htmlFor={`${id}-deadline`}>Deadline (optional)</label>
            <input
              id={`${id}-deadline`}
              type="date"
              value={value.deadline}
              onChange={(e) => set({ deadline: e.target.value })}
            />
          </div>
        )}
      </div>
      {fixed && (
        <p className="text-text-light mt-0 mb-3 text-xs">
          No deadline: the dates themselves are fixed.
          {value.deadline && (
            <> Saving removes the deadline of {formatDateShort(value.deadline)}.</>
          )}
        </p>
      )}

      {end && deadline && (
        <p
          className={`mt-0 mb-3 text-sm ${end.getTime() > deadline.getTime() ? 'text-error' : ''}`}
          aria-live="polite"
        >
          {finishSentence(end, deadline)}
        </p>
      )}
      {fitted && (
        <div className="mb-3">
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange(fitted)}>
            Fit to deadline
          </Button>
          <span className="text-text-light ml-2 text-xs">
            Stretch or shrink the window so it ends on the deadline.
          </span>
        </div>
      )}
      {note && <p className="text-text-light mt-0 mb-3 text-xs">{note}</p>}
    </fieldset>
  )
}
