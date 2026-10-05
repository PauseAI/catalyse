'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRequireApproved } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import Button from '@/components/Button'
import { Badge } from '@/components/Badge'
import CommentThread from '@/components/CommentThread'
import { QUICK_TASK_STATUS_LABELS } from '@/lib/status-labels'
import Linkify from '@/components/Linkify'
import SubmitWorkButton from '@/components/SubmitWorkButton'
import SubmittedWork from '@/components/SubmittedWork'
import RequestChangesButton from '@/components/RequestChangesButton'
import QuickTaskReviewDialog from '@/components/QuickTaskReviewDialog'
import { QUICK_TASK_CLAIMED_MESSAGE } from '@/lib/action-messages'
import { QuickTaskStatus } from '@/generated/prisma/enums'
import PageLoading from '@/components/PageLoading'

const REVIEW_RATING_LABELS: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_improvement: 'Needs Improvement',
  unsatisfactory: 'Unsatisfactory',
}

function statusVariant(status: string) {
  if (status === QuickTaskStatus.completed) return 'success'
  if (status === QuickTaskStatus.under_review) return 'warning'
  return 'neutral'
}

export default function QuickTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params)
  const id = parseInt(idStr, 10)
  const { user, loading } = useRequireApproved()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [reviewing, setReviewing] = useState(false)

  const { data: task, isLoading } = useQuery({
    ...orpc.quickTasks.get.queryOptions({ input: { id } }),
    enabled: !!user && !isNaN(id),
  })

  const claimMutation = useMutation({
    ...orpc.quickTasks.claim.mutationOptions(),
    onSuccess: () => {
      showToast(QUICK_TASK_CLAIMED_MESSAGE, 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.get.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.my.quickTasks.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.available.key() })
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to claim task', 'error')
    },
  })

  if (loading || !user) return <PageLoading />

  if (isLoading) {
    return (
      <main className="container py-5">
        <div className="text-center py-10 text-text-light">Loading…</div>
      </main>
    )
  }

  if (!task) {
    return (
      <main className="container py-5">
        <p className="text-text-light">Task not found.</p>
        <Button href="/quick-tasks" variant="secondary" size="sm">
          Back to Quick Tasks
        </Button>
      </main>
    )
  }

  const mine = task.assignedToId === user.id

  return (
    <main className="container py-5 pb-15">
      <Link
        href={mine ? '/quick-tasks' : '/quick-tasks#browse-quick-tasks'}
        className="text-sm text-primary-text underline block mb-4"
      >
        {mine ? '← Back to My Quick Tasks' : '← Back to Quick Tasks'}
      </Link>

      <div className="bg-surface rounded-xl shadow p-6 overflow-hidden wrap-break-word">
        <div className="flex justify-between items-start mb-3 gap-4">
          <h1 className="m-0">{task.title}</h1>
          <Badge variant={statusVariant(task.status)}>
            {QUICK_TASK_STATUS_LABELS[task.status] ?? task.status}
          </Badge>
        </div>

        <div className="flex gap-3 mb-4 flex-wrap">
          {task.skillName && (
            <span className="inline-flex items-center px-3 py-1 bg-accent text-secondary-dark rounded-full text-sm font-medium dark:bg-gray-700 dark:text-gray-300">
              {task.skillName}
            </span>
          )}
          {task.estimatedHours && (
            <span className="text-text-light text-sm self-center">
              ~{task.estimatedHours}h estimated
            </span>
          )}
          {task.projectTitle && task.projectId && (
            <Link href={`/projects/${task.projectId}`} className="text-sm self-center">
              Related project: {task.projectTitle}
            </Link>
          )}
        </div>

        {task.description && (
          <p className="whitespace-pre-wrap mb-6">
            <Linkify text={task.description} />
          </p>
        )}

        {task.status === QuickTaskStatus.completed && (
          <div className="bg-brand-bg rounded-lg p-4 mb-4 border border-brand-border">
            <h3 className="m-0 mb-2 text-base">Review</h3>
            {task.reviewRating && (
              <p className="mb-1">
                <span className="font-medium">Rating: </span>
                {REVIEW_RATING_LABELS[task.reviewRating] ?? task.reviewRating}
              </p>
            )}
            {task.reviewNotes && <p className="mb-0 text-text-light">{task.reviewNotes}</p>}
          </div>
        )}

        {task.status === QuickTaskStatus.open && task.assignedToId === null && (
          <Button
            onClick={() => claimMutation.mutate({ id: task.id })}
            disabled={claimMutation.isPending}
          >
            {claimMutation.isPending ? 'Claiming…' : 'Claim'}
          </Button>
        )}

        <SubmittedWork
          submission={task.submission}
          changesRequested={
            task.changesRequested
              ? { message: task.changesRequested, byName: task.reviewedByName }
              : null
          }
        />

        {mine && task.status === QuickTaskStatus.in_progress && (
          <div className="mt-4">
            <SubmitWorkButton target={{ kind: 'quick', taskId: task.id }} reviewer="An admin" />
          </div>
        )}

        {mine && task.status === QuickTaskStatus.under_review && (
          <p className="text-text-light text-sm mt-4 mb-0">Your submission is awaiting review.</p>
        )}

        {user.isAdmin && task.status === QuickTaskStatus.under_review && (
          <div className="flex flex-wrap gap-2 mt-4">
            <Button onClick={() => setReviewing(true)}>Accept…</Button>
            <RequestChangesButton target={{ kind: 'quick', taskId: task.id }} assigneeName={null} />
          </div>
        )}
      </div>
      {reviewing && (
        <QuickTaskReviewDialog
          task={{ id: task.id, title: task.title, assignedToName: null }}
          onClose={() => setReviewing(false)}
        />
      )}

      <div className="bg-surface rounded-xl shadow p-6">
        <h2 className="text-lg mb-4">Discussion</h2>
        <CommentThread workItemId={task.id} />
      </div>
    </main>
  )
}
