'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRequireApproved } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import Button from '@/components/Button'
import { H1, H2, H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import { DueChip, WorkStatusBadge } from '@/components/StatusBadges'
import CommentThread from '@/components/CommentThread'
import Linkify from '@/components/Linkify'
import SubmitWorkButton from '@/components/SubmitWorkButton'
import SubmittedWork from '@/components/SubmittedWork'
import RequestChangesButton from '@/components/RequestChangesButton'
import QuickTaskReviewDialog from '@/components/QuickTaskReviewDialog'
import { QUICK_TASK_CLAIMED_MESSAGE } from '@/lib/action-messages'
import { CLAIM_TASK, CLAIMING } from '@/lib/action-labels'
import { QuickTaskStatus } from '@/generated/prisma/enums'
import { handedIn } from '@/lib/overdue'
import { SECTION_CARD } from '@/lib/ui-classes'
import PageLoading from '@/components/PageLoading'

const REVIEW_RATING_LABELS: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_improvement: 'Needs improvement',
  unsatisfactory: 'Unsatisfactory',
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
        <P className="text-text-light">Task not found.</P>
        <Button href="/quick-tasks" variant="outline" size="sm">
          Back to quick tasks
        </Button>
      </main>
    )
  }

  const mine = task.assignedToId === user.id
  const viewer = { isAssignee: mine, canReview: task.viewerCanAdmin }

  return (
    <main className="container py-5 pb-15">
      <Link
        href={mine ? '/quick-tasks' : '/quick-tasks#browse-quick-tasks'}
        className="text-sm text-primary-text underline block mb-4"
      >
        {mine ? '← Back to my quick tasks' : '← Back to quick tasks'}
      </Link>

      <div className={`${SECTION_CARD} overflow-hidden wrap-break-word`}>
        <div className="flex justify-between items-start mb-3 gap-4">
          <H1 className="m-0">{task.title}</H1>
          <WorkStatusBadge
            status={task.status}
            quick
            changesRequested={task.changesRequested !== null}
            viewer={viewer}
          />
        </div>

        <div className="flex gap-3 mb-4 flex-wrap">
          {task.skillName && (
            <span className="inline-flex items-center px-3 py-1 bg-chip text-chip-text rounded-full text-sm font-medium">
              {task.skillName}
            </span>
          )}
          {task.estimatedHours && (
            <span className="text-text-light text-sm self-center">
              ~{task.estimatedHours}h estimated
            </span>
          )}
          {task.deadline && (
            <span className="flex items-center gap-2 self-center text-sm">
              <DueChip deadline={task.deadline} done={handedIn(task.status)} viewer={viewer} />
            </span>
          )}
          {task.projectTitle && task.projectId && (
            <Link href={`/projects/${task.projectId}`} className="text-sm self-center">
              Related project: {task.projectTitle}
            </Link>
          )}
        </div>

        {task.description && (
          <P className="whitespace-pre-wrap mb-6">
            <Linkify text={task.description} />
          </P>
        )}

        {task.status === QuickTaskStatus.completed && (
          <div className="bg-brand-bg rounded-lg p-4 mb-4 border border-brand-border">
            <H3 className="m-0 mb-2 text-base">Review</H3>
            {task.reviewRating && (
              <P className="mb-1">
                <span className="font-medium">Rating: </span>
                {REVIEW_RATING_LABELS[task.reviewRating] ?? task.reviewRating}
              </P>
            )}
            {task.reviewNotes && <P className="mb-0 text-text-light">{task.reviewNotes}</P>}
          </div>
        )}

        {task.status === QuickTaskStatus.open && task.assignedToId === null && (
          <Button
            onClick={() => claimMutation.mutate({ id: task.id })}
            disabled={claimMutation.isPending}
          >
            {claimMutation.isPending ? CLAIMING : CLAIM_TASK}
          </Button>
        )}

        <SubmittedWork
          submission={task.submission}
          changesRequested={
            task.changesRequested
              ? {
                  message: task.changesRequested,
                  byId: task.reviewedById,
                  byName: task.reviewedByName,
                }
              : null
          }
        />

        {mine && task.status === QuickTaskStatus.in_progress && (
          <div className="mt-4">
            <SubmitWorkButton
              target={{ kind: 'quick', taskId: task.id }}
              ask={task}
              reviewer="An admin"
            />
          </div>
        )}

        {mine && task.status === QuickTaskStatus.under_review && (
          <P className="text-text-light text-sm mt-4 mb-0">Your submission is awaiting review.</P>
        )}

        {task.viewerCanAdmin && task.status === QuickTaskStatus.under_review && (
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

      <div className={SECTION_CARD}>
        <H2 className="text-lg mb-4">Discussion</H2>
        <CommentThread workItemId={task.id} />
      </div>
    </main>
  )
}
