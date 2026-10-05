'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireAuth } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import Button from '@/components/Button'
import { Badge } from '@/components/Badge'
import FilterDropdown from '@/components/FilterDropdown'
import BugReportCommentThread from '@/components/BugReportCommentThread'
import { formatDate } from '@/lib/format-date'
import {
  BUG_STATUS_OPTIONS,
  BUG_STATUS_VARIANT,
  bugReportPagePath,
  bugStatusLabel,
} from '@/lib/bug-report-labels'
import NotFoundCard from '@/components/NotFoundCard'

export default function BugReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params)
  const id = parseInt(idStr, 10)
  const { user, loading } = useRequireAuth()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const { data: report, isLoading } = useQuery({
    ...orpc.bugReports.getById.queryOptions({ input: { id } }),
    enabled: !!user && !isNaN(id),
  })

  const [editStatus, setEditStatus] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (!report || initialized) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialized(true)
    setEditStatus(report.status)
    setEditNotes(report.resolutionNotes ?? '')
  }, [report, initialized])

  const updateMutation = useMutation({
    ...orpc.admin.bugReports.update.mutationOptions(),
    onSuccess: () => {
      showToast('Report updated!', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.bugReports.getById.key() })
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to update', 'error')
    },
  })

  if (loading || !user) return null

  if (isLoading) {
    return (
      <main className="container py-5">
        <div className="text-center py-10 text-text-light">Loading…</div>
      </main>
    )
  }

  if (!report) {
    return (
      <NotFoundCard
        title="Report not found"
        message="This report doesn't exist, or it isn't one you can see."
      />
    )
  }

  return (
    <main className="container py-5 pb-15">
      {user.isAdmin && (
        <Link href="/admin/bugs" className="text-sm text-primary-text underline block mb-4">
          ← Back to Bug Reports
        </Link>
      )}

      <div className="bg-surface rounded-xl shadow p-6 overflow-hidden wrap-break-word mb-5">
        <div className="flex justify-between items-start mb-3 gap-4">
          <h1 className="m-0">{report.title}</h1>
          <Badge variant={BUG_STATUS_VARIANT[report.status] ?? 'neutral'}>
            {bugStatusLabel(report.status)}
          </Badge>
        </div>

        <div className="text-text-light flex gap-2 flex-wrap text-sm mb-4">
          {report.category && <span>{report.category}</span>}
          {report.severity && <span>· {report.severity}</span>}
          {report.reporterName && <span>· {report.reporterName}</span>}
          {user.isAdmin && report.assigneeName && <span>· Assigned to: {report.assigneeName}</span>}
          <span>· {report.createdAt ? formatDate(report.createdAt) : ''}</span>
          {report.pageUrl &&
            (() => {
              const path = bugReportPagePath(report.pageUrl)
              return (
                <span>
                  ·{' '}
                  {path ? (
                    <a
                      href={path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-text"
                    >
                      {path}
                    </a>
                  ) : (
                    report.pageUrl
                  )}
                </span>
              )
            })()}
        </div>

        <p className="whitespace-pre-wrap mb-0">{report.description}</p>

        {!user.isAdmin && report.resolutionNotes && (
          <p className="mt-4 text-sm italic">Resolution: {report.resolutionNotes}</p>
        )}

        {user.isAdmin && (
          <div className="mt-5 pt-5 border-t border-brand-border">
            <div className="mb-5">
              <FilterDropdown
                id="edit-status"
                label="Status"
                ariaLabel="Status"
                value={editStatus}
                options={BUG_STATUS_OPTIONS}
                onChange={setEditStatus}
              />
            </div>

            <div className="mb-5">
              <label htmlFor="edit-notes">Resolution Notes</label>
              <textarea
                id="edit-notes"
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Describe what was fixed…"
                className="w-full"
              />
            </div>

            <Button
              disabled={updateMutation.isPending}
              onClick={() =>
                updateMutation.mutate({
                  id: report.id,
                  status: editStatus,
                  resolutionNotes: editNotes || null,
                })
              }
            >
              Update
            </Button>
          </div>
        )}
      </div>

      <div className="bg-surface rounded-xl shadow p-6">
        <h2 className="text-lg mb-4">Discussion</h2>
        <BugReportCommentThread bugReportId={report.id} />
      </div>
    </main>
  )
}
