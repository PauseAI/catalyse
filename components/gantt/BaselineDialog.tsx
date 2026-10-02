'use client'

import Modal from '@/components/ui/Modal'
import Button from '@/components/Button'
import { formatDateShort } from '@/lib/format-date'

/**
 * Saving the original plan is cheap; replacing one is not. Overwriting discards every recorded
 * move and the old dates are not stored anywhere, so the dialog spells out what is lost before
 * it happens — and says less when there is nothing to lose.
 */
export default function BaselineDialog({
  isOpen,
  existingSetAt,
  taskCount,
  busy,
  onConfirm,
  onClose,
}: {
  isOpen: boolean
  /** When the current original plan was saved, or null if the project has never had one. */
  existingSetAt: Date | null
  /** How many dated tasks the write will cover. */
  taskCount: number
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const replacing = existingSetAt !== null

  return (
    <Modal
      id="baseline-dialog"
      title={replacing ? 'Replace the original plan?' : 'Set the original plan'}
      isOpen={isOpen}
      onClose={onClose}
    >
      <p>
        The original plan is what you agreed at the start. It records today&rsquo;s dates for the
        project and its {taskCount} dated task{taskCount === 1 ? '' : 's'}, and stays put while the
        real schedule moves — the difference is shown as days moved.
      </p>

      {replacing ? (
        <>
          <p>
            The original plan was saved on <strong>{formatDateShort(existingSetAt)}</strong>.
            Replacing it means:
          </p>
          <ul className="mb-4 list-disc pl-5">
            <li>every task&rsquo;s days moved resets to &ldquo;on plan&rdquo;</li>
            <li>the record of how far the schedule has slipped is gone</li>
            <li>the old plan is not stored anywhere, so this cannot be undone</li>
          </ul>
          <p className="text-text-light text-sm">
            Do this when the team has genuinely re-planned — not to clear days moved you would
            rather not report.
          </p>
        </>
      ) : (
        <p className="text-text-light text-sm">
          Nothing is overwritten: this project has no original plan yet. Until you set one, the
          timeline shows no original-plan track and no days moved.
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          {replacing ? 'Replace original plan' : 'Set original plan'}
        </Button>
      </div>
    </Modal>
  )
}
