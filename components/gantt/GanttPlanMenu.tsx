'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@/components/Button'
import FormLabel from '@/components/FormLabel'
import { H4 } from '@/components/Heading'
import { P } from '@/components/Text'
import Tooltip from '@/components/Tooltip'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { ANCHOR_HINT } from './GanttLegend'

/** One link this task waits on, as the Plan menu edits it. */
export type PlanLink = {
  dependencyId: number
  predecessorId: number
  predecessorTitle: string
  lagDays: number
}

export type GanttPlan = {
  taskId: number
  taskTitle: string
  /** Every task in the project; the menu leaves out this one and those already linked. */
  tasks: { id: number; title: string }[]
  links: PlanLink[]
  isAnchor: boolean
  onAddDependency: (predecessorId: number) => void
  onRemoveDependency: (dependencyId: number) => void
  onSetLag: (dependencyId: number, lagDays: number) => void
  /** The key date is the owner's and an admin's; omit for a deputy. */
  onSetAnchor?: (isAnchor: boolean) => void
}

const POPOVER_WIDTH = 288
const MAX_LAG = 365

/** Saves on blur or Enter, and only a whole number of days that differs from the stored one. */
function GapField({
  link,
  busy,
  onSetLag,
}: {
  link: PlanLink
  busy?: boolean
  onSetLag: GanttPlan['onSetLag']
}) {
  const id = useId()
  const commit = (input: HTMLInputElement) => {
    const days = Number(input.value)
    if (input.value.trim() === '' || !Number.isInteger(days) || Math.abs(days) > MAX_LAG) {
      input.value = String(link.lagDays)
      return
    }
    if (days !== link.lagDays) onSetLag(link.dependencyId, days)
  }
  return (
    <form
      className="mt-1 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        commit(e.currentTarget.elements.namedItem('gap') as HTMLInputElement)
      }}
    >
      <FormLabel htmlFor={id} className="text-text-light m-0 text-xs font-normal">
        Gap after it finishes (days)
      </FormLabel>
      <Input
        // Re-seeded whenever the stored gap changes underneath it.
        key={link.lagDays}
        id={id}
        name="gap"
        type="number"
        step={1}
        min={-MAX_LAG}
        max={MAX_LAG}
        defaultValue={link.lagDays}
        disabled={busy}
        aria-label={`Gap after “${link.predecessorTitle}” finishes (days)`}
        className="w-16 px-2 py-1 text-sm"
        onBlur={(e) => commit(e.currentTarget)}
      />
    </form>
  )
}

/**
 * The owner's planning actions for one task — what it waits on, the gap after each, and the key
 * date — behind a ⋯ button. Opens in a layer of its own so the chart's scroller cannot clip it.
 */
export default function GanttPlanMenu({ plan, busy }: { plan: GanttPlan; busy?: boolean }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [picked, setPicked] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const pickerId = useId()

  const close = () => {
    setPos(null)
    setPicked('')
  }

  useEffect(() => {
    if (!pos) return
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [pos])

  function toggle(trigger: HTMLButtonElement) {
    if (pos) return close()
    const rect = trigger.getBoundingClientRect()
    setPos({
      top: rect.bottom + window.scrollY + 4,
      left:
        Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8)) + window.scrollX,
    })
  }

  const linked = new Set(plan.links.map((l) => l.predecessorId))
  const addable = plan.tasks.filter((t) => t.id !== plan.taskId && !linked.has(t.id))
  const setAnchor = plan.onSetAnchor

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Plan “${plan.taskTitle}”`}
        aria-haspopup="dialog"
        aria-expanded={pos !== null}
        title="Plan"
        onClick={(e) => toggle(e.currentTarget)}
        className="border-brand-border bg-surface text-brand-text hover:bg-accent inline-flex h-6 w-7 cursor-pointer items-center justify-center rounded-md border text-sm leading-none"
      >
        ⋯
      </button>
      {pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={`Plan “${plan.taskTitle}”`}
            className="border-brand-border bg-surface absolute z-50 flex flex-col gap-3 rounded-lg border p-3 text-sm shadow-lg"
            style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
          >
            <section>
              <H4 className="mb-1 text-sm font-semibold">Waits on</H4>
              {plan.links.length === 0 ? (
                <P className="text-text-light m-0">Nothing — can start whenever.</P>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {plan.links.map((l) => (
                    <li key={l.dependencyId} className="border-brand-border rounded-md border p-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="leading-snug">{l.predecessorTitle}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => plan.onRemoveDependency(l.dependencyId)}
                          aria-label={`Stop waiting on ${l.predecessorTitle}`}
                        >
                          Remove
                        </Button>
                      </div>
                      <GapField link={l} busy={busy} onSetLag={plan.onSetLag} />
                    </li>
                  ))}
                </ul>
              )}
              {addable.length > 0 && (
                <form
                  className="mt-2 flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!picked) return
                    plan.onAddDependency(parseInt(picked, 10))
                    setPicked('')
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <FormLabel htmlFor={pickerId} className="text-xs">
                      Waits on…
                    </FormLabel>
                    <Select
                      id={pickerId}
                      value={picked}
                      disabled={busy}
                      onChange={(e) => setPicked(e.target.value)}
                    >
                      <option value="">Pick a task</option>
                      {addable.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button type="submit" size="sm" disabled={busy || !picked}>
                    Add
                  </Button>
                </form>
              )}
            </section>

            {setAnchor && (
              <section className="border-brand-border border-t pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setAnchor(!plan.isAnchor)}
                >
                  {plan.isAnchor ? 'Stop using as key date' : 'Make this the key date'}
                </Button>
                <P className="text-text-light mt-1 mb-0 text-xs">
                  <Tooltip content={ANCHOR_HINT}>
                    <span className="decoration-dotted underline-offset-2 [text-decoration-line:underline]">
                      A fixed point the plan is built around
                    </span>
                  </Tooltip>
                </P>
              </section>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
