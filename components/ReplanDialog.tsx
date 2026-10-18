'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Modal from '@/components/ui/Modal'
import Button from '@/components/Button'
import FormLabel from '@/components/FormLabel'
import Input from '@/components/ui/Input'
import { P } from '@/components/Text'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDateShort, fromDateInputValue, toDateInputValue } from '@/lib/format-date'
import { plural } from '@/lib/plural'
import { toClientScheduleInput } from '@/components/gantt/optimistic'
import {
  REPLAN_STEPS,
  barLength,
  previewReplan,
  replanWrite,
  stepBase,
  steppedEnd,
} from '@/lib/replan'

/** How many moved tasks the preview names before summing up the rest. */
const PREVIEW_NAMES = 5

/**
 * The owner moves the deadline of a task that has run past it, and the bar with it. The preview
 * is the same scheduler the server runs, so what it shows moving is what will move.
 */
export default function ReplanDialog({
  projectId,
  taskId,
  taskTitle,
  placement,
  onClose,
}: {
  projectId: number
  taskId: number
  taskTitle: string
  /** Where the plan has the task now. */
  placement: { start: Date; end: Date; isMilestone: boolean }
  onClose: () => void
}) {
  const plannedEnd = placement.end
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [end, setEnd] = useState(toDateInputValue(steppedEnd(plannedEnd, REPLAN_STEPS[0].days)))
  // Null until the owner types a length of their own; the task's own length stands until then.
  const [daysDraft, setDaysDraft] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const { data: timeline } = useQuery(
    orpc.projects.listTasks.queryOptions({ input: { projectId } }),
  )

  const newEnd = fromDateInputValue(end)
  const days = daysDraft ?? String(barLength(placement))
  const daysValue = Number.parseInt(days, 10)
  const write =
    newEnd && Number.isInteger(daysValue) && daysValue >= 0
      ? replanWrite(placement, newEnd, daysValue)
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
      void queryClient.invalidateQueries({ queryKey: orpc.workItemComments.list.key() })
      onClose()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to replan', 'error'),
  })

  return (
    <Modal id="replan-dialog" title={`Replan '${taskTitle}'`} isOpen onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!newEnd || !write || !reason.trim()) return
          replan.mutate({
            projectId,
            taskId,
            newEnd,
            durationDays: daysValue,
            reason: reason.trim(),
          })
        }}
      >
        <P className="mt-0">
          It was due <strong>{formatDateShort(plannedEnd)}</strong>. When is it due now?
        </P>
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
          <FormLabel className="sr-only" htmlFor="replan-end">
            New deadline
          </FormLabel>
          <Input
            id="replan-end"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-auto"
          />
        </div>
        <P className="text-text-light mt-0 mb-3 text-xs">
          Counted from {formatDateShort(stepBase(plannedEnd))}, since the deadline has passed.
        </P>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <FormLabel htmlFor="replan-days">Days</FormLabel>
          <Input
            id="replan-days"
            type="number"
            min={0}
            max={3650}
            value={days}
            onChange={(e) => setDaysDraft(e.target.value)}
            className="w-20"
          />
          {write && (
            <span className="text-sm">
              so it starts <strong>{formatDateShort(write.startDate)}</strong>
            </span>
          )}
        </div>
        <P className="text-text-light mt-0 mb-3 text-xs">
          The bar moves and keeps its length. Change the days only if the work turned out bigger or
          smaller.
        </P>

        <FormLabel htmlFor="replan-reason" required>
          Why is the plan changing?
        </FormLabel>
        <Input
          id="replan-reason"
          type="text"
          required
          maxLength={500}
          value={reason}
          placeholder="e.g. waiting on the venue"
          onChange={(e) => setReason(e.target.value)}
        />
        <P className="text-text-light mt-1 mb-3 text-xs">
          Posted in the task&rsquo;s discussion, and sent to the people whose tasks move.
        </P>

        <section aria-label="What changes" className="mb-4 text-sm">
          {!preview ? (
            <P className="text-text-light m-0">Working out what moves…</P>
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
