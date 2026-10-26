'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import FullVolunteerSelect from '@/components/FullVolunteerSelect'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

interface Props {
  report: { id: number; title: string; assigneeId: number | null }
  /** The signed-in admin, offered "Assign to me" unless the report is already theirs. */
  viewerId: number
}

/** An admin's assignment controls for one bug report: to themselves, to anyone, or to nobody. */
export default function BugReportAssignee({ report, viewerId }: Props) {
  const queryClient = useQueryClient()
  const showToast = useToast()

  const assignMutation = useMutation({
    ...orpc.admin.bugReports.assign.mutationOptions(),
    onSuccess: ({ message }) => {
      showToast(message, 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.admin.bugReports.list.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.bugReports.getById.key() })
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to assign', 'error')
    },
  })
  const assign = (volunteerId: number | null) =>
    assignMutation.mutate({ id: report.id, volunteerId })

  return (
    <div className="flex gap-2 items-end flex-wrap">
      <div className="flex-1 min-w-50 max-w-75">
        <FullVolunteerSelect
          id={`assign-bug-${report.id}`}
          label="Assign to"
          ariaLabel={`Assign volunteer to ${report.title}`}
          value=""
          onChange={(v) => v && assign(parseInt(v, 10))}
          placeholder="Select volunteer…"
        />
      </div>
      {report.assigneeId !== viewerId && (
        <Button
          variant="secondary"
          size="sm"
          disabled={assignMutation.isPending}
          onClick={() => assign(viewerId)}
        >
          Assign to me
        </Button>
      )}
      {report.assigneeId !== null && (
        <Button
          variant="ghost"
          size="sm"
          disabled={assignMutation.isPending}
          onClick={() => assign(null)}
        >
          Unassign
        </Button>
      )}
    </div>
  )
}
