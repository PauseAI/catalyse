'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Modal from '@/components/ui/Modal'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDateShort, fromDateInputValue, toDateInputValue } from '@/lib/format-date'
import { plural } from '@/lib/plural'
import { diffInDays } from '@/lib/schedule'
import { toClientScheduleInput } from '@/components/gantt/optimistic'
import { REPLAN_STEPS, previewReplan, replanWrite, stepBase, steppedEnd } from '@/lib/replan'

/** How many moved tasks the preview names before summing up the rest. */
const PREVIEW_NAMES = 5

/**
 * The owner moves the planned end of a task that has run past it. The preview is the same
 * scheduler the server runs, so what it shows moving is what will move.
 */
export default function ReplanDialog({
  projectId,
  taskId,
  taskTitle,
  plannedEnd,
  deadline,
  onClose,
}: {
  projectId: number
  taskId: number
  taskTitle: string
  plannedEnd: Date
  deadline: Date | null
  onClose: () => void
}) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [end, setEnd] = useState(toDateInputValue(steppedEnd(plannedEnd, REPLAN_STEPS[0].days)))
  const [reason, setReason] = useState('')

  const { data: timeline } = useQuery(
    orpc.projects.listTasks.queryOptions({ input: { projectId } }),
  )

  const newEnd = fromDateInputValue(end)
  const task = timeline?.tasks.find((t) => t.id === taskId)
  const placed = timeline?.scheduled.find((s) => s.id === taskId)
  const write =
    newEnd && task
      ? replanWrite(
          {
            startDate: task.startDate ? new Date(task.startDate) : null,
            placedStart: placed ? new Date(placed.start) : null,
          },
          newEnd,
        )
      : null

  const preview =
    timeline && write
      ? previewReplan(
          timeline.tasks.map(toClientScheduleInput),
          timeline.dependencies,
          new Date(timeline.scopeOrigin),
          taskId,
          write,
        )
      : null
  const titleOf = new Map(timeline?.tasks.map((t) => [t.id, t.title]))

  const replan = useMutation({
    ...orpc.projects.replanTask.mutationOptions(),
    onSuccess: () => {
      showToast(`Replanned. '${taskTitle}' now finishes ${formatDateShort(end)}.`, 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.projects.getTask.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.projects.listTasks.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
      onClose()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to replan', 'error'),
  })

  const lateBy = newEnd && deadline ? diffInDays(deadline, newEnd) : null

  return (
    <Modal id="replan-dialog" title={`Replan '${taskTitle}'`} isOpen onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!newEnd || !write || !reason.trim()) return
          replan.mutate({ projectId, taskId, newEnd, reason: reason.trim() })
        }}
      >
        <p className="mt-0">
          The plan had it finishing <strong>{formatDateShort(plannedEnd)}</strong>
          {deadline && (
            <>
              ; its deadline is <strong>{formatDateShort(deadline)}</strong>
            </>
          )}
          . When will it finish now?
        </p>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {REPLAN_STEPS.map((s) => {
            const stepped = toDateInputValue(steppedEnd(plannedEnd, s.days))
            return (
              <Button
                key={s.label}
                type="button"
                size="sm"
                variant={end === stepped ? 'primary' : 'secondary'}
                aria-pressed={end === stepped}
                onClick={() => setEnd(stepped)}
              >
                {s.label}
              </Button>
            )
          })}
          <label className="sr-only" htmlFor="replan-end">
            New planned end
          </label>
          <input
            id="replan-end"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-auto"
          />
        </div>
        <p className="text-text-light mt-0 mb-3 text-xs">
          Counted from {formatDateShort(stepBase(plannedEnd))}, since the planned end has passed.
        </p>
        {newEnd && task && !write && (
          <p role="alert" className="text-error text-sm">
            That is before the task starts.
          </p>
        )}

        <label htmlFor="replan-reason">Why is the plan changing?</label>
        <input
          id="replan-reason"
          type="text"
          required
          maxLength={500}
          value={reason}
          placeholder="e.g. waiting on the venue"
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-text-light mt-1 mb-3 text-xs">
          Posted in the task&rsquo;s discussion, and sent to the people whose tasks move.
        </p>

        <section aria-label="What changes" className="mb-4 text-sm">
          {!preview ? (
            <p className="text-text-light m-0">Working out what moves…</p>
          ) : (
            <ul className="m-0 list-disc space-y-1 pl-5">
              {preview.moved.length === 0 ? (
                <li>Nothing else moves.</li>
              ) : (
                <>
                  {preview.moved.slice(0, PREVIEW_NAMES).map((m) => (
                    <li key={m.id}>
                      &lsquo;{titleOf.get(m.id)}&rsquo; moves {plural(Math.abs(m.days), 'day')}{' '}
                      {m.days > 0 ? 'later' : 'earlier'}, to start {formatDateShort(m.start)}
                    </li>
                  ))}
                  {preview.moved.length > PREVIEW_NAMES && (
                    <li>and {preview.moved.length - PREVIEW_NAMES} more</li>
                  )}
                </>
              )}
              {preview.pinConflicts.map((c) => (
                <li key={`pin-${c.id}`} className="text-error">
                  &lsquo;{titleOf.get(c.id)}&rsquo; is set to start {plural(c.days, 'day')} too
                  early for it
                </li>
              ))}
              {preview.keyDatesLate.map((k) => (
                <li key={`key-${k.id}`} className="text-error">
                  The prep for key date &lsquo;{titleOf.get(k.id)}&rsquo; would finish{' '}
                  {k.days === 0 ? 'on the day itself' : `${plural(k.days, 'day')} after it`}
                </li>
              ))}
              {preview.endAfter.getTime() !== preview.endBefore.getTime() && (
                <li>The whole plan now ends {formatDateShort(preview.endAfter)}</li>
              )}
              {lateBy !== null && lateBy > 0 && (
                <li className="text-error">
                  Still {plural(lateBy, 'day')} after the task&rsquo;s deadline
                </li>
              )}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!write || !reason.trim() || replan.isPending}>
            {replan.isPending ? 'Replanning…' : 'Replan'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
