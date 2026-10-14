'use client'

import { useState } from 'react'
import { useRequireSuperAdmin } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { formatDateTime } from '@/lib/format-date'
import { Badge, type BadgeVariant } from '@/components/Badge'
import { useToast } from '@/lib/toast'
import { CRON_JOB_NAMES, CRON_JOB_INFO } from '@/lib/cron-job-names'
import Button from '@/components/Button'
import Modal from '@/components/ui/Modal'

type CronRun = {
  id: number
  jobName: string
  triggeredBy: string
  status: string
  startedAt: string | Date
  finishedAt: string | Date | null
  summary: string | null
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  running: 'info',
  success: 'success',
  error: 'danger',
}

function duration(startedAt: string | Date, finishedAt: string | Date | null): string {
  if (!finishedAt) return '—'
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function AdminCronRunsPage() {
  const { user, loading } = useRequireSuperAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [selectedRun, setSelectedRun] = useState<CronRun | null>(null)

  const { data: runs = [], isLoading: loadingData } = useQuery({
    ...orpc.admin.cronRuns.list.queryOptions({ input: {} }),
    enabled: !!user?.isSuperAdmin,
  })

  const runMutation = useMutation({
    ...orpc.admin.cronRuns.run.mutationOptions(),
    onSuccess: (_data, variables) => {
      showToast(`${variables.jobName} finished`, 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.admin.cronRuns.list.key() })
    },
    onError: (_error, variables) => showToast(`${variables.jobName} failed`, 'error'),
  })

  if (loading || !user?.isSuperAdmin) return null

  return (
    <main className="container py-5 pb-15">
      <h1>Cron job runs</h1>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CRON_JOB_NAMES.map((jobName) => {
          const info = CRON_JOB_INFO[jobName]
          return (
            <div
              key={jobName}
              className="border border-brand-border rounded-lg p-4 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{jobName}</span>
                <Badge variant={info.idempotent ? 'success' : 'attention'}>
                  {info.idempotent ? 'idempotent' : 'not idempotent'}
                </Badge>
              </div>
              <p className="text-sm text-text-light m-0 flex-1">{info.description}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={runMutation.isPending}
                onClick={() => runMutation.mutate({ jobName })}
              >
                {runMutation.isPending && runMutation.variables?.jobName === jobName
                  ? 'Running…'
                  : 'Run now'}
              </Button>
            </div>
          )
        })}
      </div>

      {loadingData ? (
        <div className="text-center py-10 text-text-light">Loading…</div>
      ) : runs.length === 0 ? (
        <p>No cron job runs recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-brand-border text-left">
                <th className="p-3">Job</th>
                <th className="p-3">Triggered by</th>
                <th className="p-3">Status</th>
                <th className="p-3">Started</th>
                <th className="p-3">Finished</th>
                <th className="p-3">Duration</th>
                <th className="p-3">Summary</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-brand-border align-top cursor-pointer hover:bg-accent"
                  onClick={() => setSelectedRun(run)}
                >
                  <td className="p-3 font-semibold whitespace-nowrap">{run.jobName}</td>
                  <td className="p-3">
                    <Badge variant={run.triggeredBy === 'admin' ? 'info' : 'neutral'}>
                      {run.triggeredBy}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <Badge variant={STATUS_VARIANT[run.status] ?? 'neutral'}>{run.status}</Badge>
                  </td>
                  <td className="p-3 whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                  <td className="p-3 whitespace-nowrap">
                    {run.finishedAt ? formatDateTime(run.finishedAt) : '—'}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {duration(run.startedAt, run.finishedAt)}
                  </td>
                  <td className="p-3 text-text-light wrap-break-word max-w-md truncate">
                    {run.summary ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        id="cron-run-detail"
        title={selectedRun ? `${selectedRun.jobName}: ${selectedRun.status}` : ''}
        isOpen={!!selectedRun}
        onClose={() => setSelectedRun(null)}
      >
        {selectedRun && (
          <div>
            <p className="text-sm text-text-light mb-1">Triggered by: {selectedRun.triggeredBy}</p>
            <p className="text-sm text-text-light mb-1">
              Started: {formatDateTime(selectedRun.startedAt)}
            </p>
            <p className="text-sm text-text-light mb-3">
              Finished:{' '}
              {selectedRun.finishedAt ? formatDateTime(selectedRun.finishedAt) : 'still running'}
            </p>
            <pre className="whitespace-pre-wrap wrap-break-word text-xs bg-black/5 dark:bg-white/5 rounded-lg p-3 max-h-96 overflow-y-auto">
              {selectedRun.summary ?? 'No summary recorded.'}
            </pre>
          </div>
        )}
      </Modal>
    </main>
  )
}
