'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireConfirmed } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import Button from '@/components/Button'
import Checkbox from '@/components/Checkbox'
import DatesBlock from '@/components/DatesBlock'
import ReplanDialog from '@/components/ReplanDialog'
import VolunteerSelect from '@/components/VolunteerSelect'
import { plural } from '@/lib/plural'
import TaskDatesSummary from '@/components/TaskDatesSummary'
import WorkItemCard from '@/components/WorkItemCard'
import type { WorkItemSummary } from '@/lib/work-item-summary'
import { EMPTY_DATES, datesPayload, datesValueFrom, type DatesValue } from '@/lib/task-dates'
import { Badge } from '@/components/Badge'
import CommentThread from '@/components/CommentThread'
import MessageDialog from '@/components/MessageDialog'
import Linkify from '@/components/Linkify'
import { useToast } from '@/lib/toast'
import { TaskStatus } from '@/generated/prisma/enums'
import { TASK_STATUS_LABELS, TASK_STATUS_VARIANTS, UNCLAIMED_LABEL } from '@/lib/status-labels'
import { shortDay } from '@/lib/relative-date'
import { PROJECT_TASK_CLAIMED_MESSAGE, TASK_REQUESTED_MESSAGE } from '@/lib/action-messages'
import { CLAIMING, JOIN_AS_HELPER, UNASSIGN, claimLabel } from '@/lib/action-labels'
import { TASK_INACTIVITY_RULE } from '@/lib/staleness'
import { awaitsOwnerReview } from '@/lib/task-review'
import { handedIn } from '@/lib/overdue'
import { quotedTitles } from '@/lib/task-status'
import PageLoading from '@/components/PageLoading'
import NotFoundCard from '@/components/NotFoundCard'
import { SubmitWorkForm } from '@/components/SubmitWorkButton'
import SubmissionAskFields, {
  NEW_SUBMISSION_ASK,
  submissionAskDraft,
  submissionAskPayload,
} from '@/components/SubmissionAskFields'
import WorkItemHeader, { WorkItemPerson } from '@/components/WorkItemHeader'
import { EmptyPersonChip, PersonChip } from '@/components/ui/PersonChip'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import SubmittedWork from '@/components/SubmittedWork'
import RequestChangesButton from '@/components/RequestChangesButton'
import ReopenTaskDialog from '@/components/ReopenTaskDialog'
import LockedProjectBanner from '@/components/LockedProjectBanner'
import TaskHelpers from '@/components/TaskHelpers'
import HelpersWantedField, {
  helpersWantedDraft,
  helpersWantedPayload,
} from '@/components/HelpersWantedField'
import { TERMINAL_STATUSES } from '@/lib/project-status'

/** "Waiting on 1 of 2.", or that everything it waits on is done; nothing once it is handed in. */
function waitsOnSummary(waitsOn: WorkItemSummary[], status: string): string | null {
  if (handedIn(status)) return null
  const open = waitsOn.filter((i) => i.displayStatus !== TaskStatus.completed).length
  if (open > 0) return `Waiting on ${open} of ${waitsOn.length}.`
  return status === TaskStatus.not_started
    ? 'Everything this waits on is done. You can start.'
    : 'Everything this waits on is done.'
}

/**
 * What the task waits on and what it unblocks, as work item cards. An empty list is left out.
 * Once everything it waits on is done, those cards drop to their compact form.
 */
function LinkedWork({
  waitsOn,
  unblocks,
  status,
}: {
  waitsOn: WorkItemSummary[]
  unblocks: WorkItemSummary[]
  status: string
}) {
  const allDone = waitsOn.every((i) => i.displayStatus === TaskStatus.completed)
  const summary = waitsOnSummary(waitsOn, status)
  const list = (items: WorkItemSummary[], variant: 'default' | 'compact') => (
    <ul className="m-0 list-none space-y-2 p-0">
      {items.map((item) => (
        <li key={item.id}>
          <WorkItemCard item={item} variant={variant} />
        </li>
      ))}
    </ul>
  )

  return (
    <>
      {waitsOn.length > 0 && (
        <section aria-labelledby="waits-on" className="mb-4">
          <h2 id="waits-on" className="mb-2 text-base">
            Waits on
          </h2>
          {summary && <p className={`mb-2 text-sm ${allDone ? '' : 'font-medium'}`}>{summary}</p>}
          {list(waitsOn, allDone ? 'compact' : 'default')}
        </section>
      )}
      {unblocks.length > 0 && (
        <section aria-labelledby="unblocks" className="mb-4">
          <h2 id="unblocks" className="mb-2 text-base">
            Unblocks
          </h2>
          {list(unblocks, 'default')}
        </section>
      )}
    </>
  )
}

/** When the assignee took it on, started or finished it: "claimed on 2 Jan", "finished 9 Oct". */
function assigneeSince(task: {
  assignedToName: string | null
  claimedAt: Date | string | null
  startedAt: Date | string | null
  completedAt: Date | string | null
}): string | null {
  if (task.completedAt) return `finished ${shortDay(task.completedAt)}`
  if (task.assignedToName === null) return null
  if (task.startedAt) return `started ${shortDay(task.startedAt)}`
  return task.claimedAt ? `claimed on ${shortDay(task.claimedAt)}` : null
}

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string }>
}) {
  const { id: projectIdStr, taskId: taskIdStr } = use(params)
  const projectId = parseInt(projectIdStr, 10)
  const taskId = parseInt(taskIdStr, 10)
  const { user, loading } = useRequireConfirmed()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const { data: task, isLoading } = useQuery({
    ...orpc.projects.getTask.queryOptions({ input: { projectId, taskId } }),
    enabled: !!user && !isNaN(projectId) && !isNaN(taskId),
  })

  const isDone = task?.status === TaskStatus.completed
  // A done task is read-only until it is reopened (lib/work-item-lock.ts).
  const canEdit = !!user && !!task && task.canManage && !isDone

  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editDates, setEditDates] = useState<DatesValue>(EMPTY_DATES)
  const [editFeatured, setEditFeatured] = useState(false)
  const [editAsk, setEditAsk] = useState(NEW_SUBMISSION_ASK)
  const [editHelpers, setEditHelpers] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [messaging, setMessaging] = useState(false)
  const [replanning, setReplanning] = useState(false)
  const [reassignTo, setReassignTo] = useState('')
  const [reopening, setReopening] = useState(false)
  const [confirmingClaim, setConfirmingClaim] = useState(false)

  useEffect(() => {
    if (!task || initialized) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialized(true)
    setEditTitle(task.title)
    setEditDescription(task.description ?? '')
    setEditDates(datesValueFrom(task))
    setEditFeatured(task.featuredAsQuickTask)
    setEditAsk(submissionAskDraft(task))
    setEditHelpers(helpersWantedDraft(task.helpersWanted))
  }, [task, initialized])

  const updateMutation = useMutation({
    ...orpc.projects.updateTask.mutationOptions(),
    onSuccess: (data, variables) => {
      showToast(
        data.requested
          ? TASK_REQUESTED_MESSAGE
          : variables.data.assigneeId !== undefined
            ? PROJECT_TASK_CLAIMED_MESSAGE
            : 'Task updated!',
        'success',
      )
      setIsEditing(false)
      void queryClient.invalidateQueries({ queryKey: orpc.projects.getTask.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.workItemComments.list.key() })
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to update task', 'error'),
  })

  const invalidateTask = () =>
    queryClient.invalidateQueries({ queryKey: orpc.projects.getTask.key() })

  const reassignMutation = useMutation({
    ...orpc.projects.assignTask.mutationOptions(),
    onSuccess: () => {
      showToast('Reassigned. The previous assignee has been told.', 'success')
      setReassignTo('')
      void invalidateTask()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to reassign', 'error'),
  })

  const acceptMutation = useMutation({
    ...orpc.projects.acceptTask.mutationOptions(),
    onSuccess: () => {
      showToast('Accepted. The task is done.', 'success')
      void invalidateTask()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to accept', 'error'),
  })

  function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTitle.trim()) return
    updateMutation.mutate({
      projectId,
      taskId,
      data: {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        ...datesPayload(editDates),
        featuredAsQuickTask: editFeatured,
        ...submissionAskPayload(editAsk),
        ...helpersWantedPayload(editHelpers),
      },
    })
  }

  const startMutation = useMutation({
    ...orpc.projects.startTask.mutationOptions(),
    onSuccess: () => {
      showToast('Started. Post updates as you go.', 'success')
      void invalidateTask()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to start the task', 'error'),
  })

  const joinAsHelperMutation = useMutation({
    ...orpc.projects.expressInterest.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      void invalidateTask()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to join', 'error'),
  })

  function handleClaimTask(assigneeId: number) {
    updateMutation.mutate({ projectId, taskId, data: { assigneeId } })
  }

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
      <NotFoundCard
        title="Task not found"
        message="This task doesn't exist, or it isn't one you can see."
      >
        <Link href={`/projects/${projectIdStr}`} className="text-sm">
          Back to Project
        </Link>
      </NotFoundCard>
    )
  }

  // Nothing on a completed project changes until it is reopened (lib/work-item-lock.ts).
  const projectLocked = TERMINAL_STATUSES.includes(task.projectStatus)
  const canClaimNow =
    task.status === TaskStatus.not_started &&
    task.assignedToId === null &&
    task.requestedById === null &&
    task.canClaim
  const canStartNow =
    !projectLocked &&
    !handedIn(task.status) &&
    task.assignedToId === user.id &&
    task.status === TaskStatus.not_started

  return (
    <main className="container py-5 pb-15">
      <Link
        href={`/projects/${projectId}`}
        className="text-sm text-primary-text underline block mb-4"
      >
        ← Back to {task.projectTitle}
      </Link>

      {projectLocked && (
        <LockedProjectBanner
          status={task.projectStatus}
          completedAt={task.projectCompletedAt}
          reopen={
            user.isAdmin || task.projectOwnerId === user.id
              ? { projectId, title: task.projectTitle }
              : undefined
          }
        />
      )}

      <div className="bg-surface rounded-xl shadow p-6 overflow-hidden wrap-break-word mb-5">
        <WorkItemHeader
          title={task.title}
          underTitle={
            // The form below holds the same dates, so the summary steps aside while it is open.
            !isEditing && (
              <TaskDatesSummary
                className=""
                estimatedHours={task.estimatedHours}
                deadline={task.deadline}
                openStart={task.startDate === null && task.waitsOn.length === 0}
                placement={task.placement}
                handedIn={handedIn(task.status)}
              />
            )
          }
          person={
            <WorkItemPerson
              // A task worked by several people names the one in charge as its lead.
              label={
                task.helpersWanted !== null || task.helpers.length > 0 ? 'Lead' : 'Assigned to'
              }
              summary={assigneeSince(task)}
              actions={
                <>
                  {canClaimNow && (
                    <Button
                      size="sm"
                      disabled={updateMutation.isPending}
                      onClick={() => setConfirmingClaim(true)}
                    >
                      {claimLabel(task.claimViewer)}
                    </Button>
                  )}
                  {task.assignedToId !== null &&
                    task.assignedToId !== user.id &&
                    task.assigneeContactable && (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Message ${task.assignedToName}`}
                        onClick={() => setMessaging(true)}
                      >
                        Message
                      </Button>
                    )}
                </>
              }
              secondActions={
                task.canJoinAsHelper && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={joinAsHelperMutation.isPending}
                    onClick={() =>
                      joinAsHelperMutation.mutate({
                        projectId,
                        taskId,
                        interestType: 'want_to_help_task',
                        message: null,
                      })
                    }
                  >
                    {JOIN_AS_HELPER}
                  </Button>
                )
              }
            >
              {task.assignedToId !== null && task.assignedToName !== null ? (
                <PersonChip
                  name={task.assignedToName}
                  href={`/volunteers/${task.assignedToId}`}
                  isViewer={task.assignedToId === user.id}
                />
              ) : (
                <EmptyPersonChip label={isDone ? 'No one' : UNCLAIMED_LABEL} />
              )}
            </WorkItemPerson>
          }
          status={
            <Badge variant={TASK_STATUS_VARIANTS[task.displayStatus]}>
              {TASK_STATUS_LABELS[task.displayStatus]}
            </Badge>
          }
          actions={
            <>
              {canStartNow && (
                <Button
                  size="sm"
                  disabled={startMutation.isPending}
                  onClick={() => startMutation.mutate({ projectId, taskId })}
                >
                  Start
                </Button>
              )}
              {canEdit && !isEditing && (
                <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                  Edit
                </Button>
              )}
              {isDone && task.canManage && (
                <Button variant="secondary" size="sm" onClick={() => setReopening(true)}>
                  Reopen
                </Button>
              )}
            </>
          }
        />

        {task.description && (
          <div className="whitespace-pre-wrap mb-6">
            <Linkify text={task.description} />
          </div>
        )}
        {canStartNow && <p className="text-sm text-text-light mb-4">{TASK_INACTIVITY_RULE}</p>}
        {task.blockedBy.length > 0 && (
          <p className="mb-4 text-sm">
            <strong>Blocked by</strong> {quotedTitles(task.blockedBy)}
          </p>
        )}
        {task.waitingOn.length > 0 && (
          <p role="status" className="border-warning-text mb-4 rounded-lg border p-3 text-sm">
            Still waiting on {quotedTitles(task.waitingOn)}.
          </p>
        )}
        <LinkedWork waitsOn={task.waitsOn} unblocks={task.unblocks} status={task.status} />
        {task.pastPlanDays !== null && task.canManage && !isEditing && (
          <section
            aria-label="Past plan"
            className="border-warning-text mb-4 rounded-lg border p-4 text-sm"
          >
            <p className="mt-0 mb-3">
              <strong>{plural(task.pastPlanDays, 'day')} past plan.</strong> {task.assignedToName}{' '}
              has it. Replan it, give it to someone else, or open it up again.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Button size="sm" onClick={() => setReplanning(true)}>
                Replan
              </Button>
              <div className="w-64">
                <VolunteerSelect
                  id="reassign-task"
                  label="Reassign to"
                  ariaLabel="Reassign to"
                  value={reassignTo}
                  onChange={setReassignTo}
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!reassignTo || reassignMutation.isPending}
                onClick={() =>
                  reassignMutation.mutate({
                    projectId,
                    taskId,
                    assigneeId: parseInt(reassignTo, 10),
                  })
                }
              >
                Reassign
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={updateMutation.isPending}
                onClick={() =>
                  updateMutation.mutate({
                    projectId,
                    taskId,
                    data: { status: TaskStatus.not_started },
                  })
                }
              >
                {UNASSIGN}
              </Button>
            </div>
          </section>
        )}
        {task.pastPlanDays !== null && !task.canManage && task.assignedToId === user.id && (
          <p role="status" className="border-warning-text mb-4 rounded-lg border p-3 text-sm">
            <strong>{plural(task.pastPlanDays, 'day')} past plan.</strong> The owner has been told.
            Post an update below, or submit your work if it is done.
          </p>
        )}
        {replanning && task.placement && (
          <ReplanDialog
            projectId={projectId}
            taskId={taskId}
            taskTitle={task.title}
            placement={{
              start: new Date(task.placement.start),
              end: new Date(task.placement.end),
              isMilestone: task.placement.isMilestone,
            }}
            onClose={() => setReplanning(false)}
          />
        )}
        {/* The key date is set on the project timeline; here it is only stated. */}
        {task.isAnchor && (
          <p className="mb-4 text-sm" style={{ color: 'var(--gantt-anchor)' }}>
            ★ Key date: the date this project is planned around
          </p>
        )}
        <TaskHelpers projectId={projectId} taskId={taskId} viewerId={user.id} state={task} />

        {task.requestedById !== null && (
          <p className="text-sm text-text-light mt-4 mb-0">
            {task.requestedById === user.id
              ? 'Held for you until the owner accepts you onto the project.'
              : `Requested by ${task.requestedByName}, waiting for the owner.`}
          </p>
        )}

        <SubmittedWork submission={task.submission} changesRequested={task.changesRequested} />

        {task.status === TaskStatus.under_review && task.canManage && (
          <div className="flex flex-wrap gap-2 mt-4">
            <Button
              disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate({ projectId, taskId })}
            >
              Accept
            </Button>
            <RequestChangesButton
              target={{ kind: 'project', projectId, taskId }}
              assigneeName={task.assignedToName}
            />
          </div>
        )}

        {!projectLocked && !handedIn(task.status) && task.assignedToId === user.id && (
          <SubmitWorkForm
            target={{ kind: 'project', projectId, taskId }}
            ask={task}
            reviewer={
              awaitsOwnerReview(
                { autoAcceptTasks: task.autoAcceptTasks, ownerId: task.projectOwnerId },
                task.canManage,
              )
                ? 'The project owner'
                : null
            }
          />
        )}

        {canEdit && isEditing && (
          <form
            onSubmit={handleSaveEdit}
            className="mt-5 pt-5 border-t border-brand-border max-w-xl"
          >
            <div className="mb-5">
              <label htmlFor="edit-task-title">Task title</label>
              <input
                id="edit-task-title"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
              />
            </div>

            <div className="mb-5">
              <label htmlFor="edit-task-description">Description</label>
              <textarea
                id="edit-task-description"
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional details…"
              />
            </div>

            <div className="mb-3">
              <DatesBlock
                id="edit-task"
                value={editDates}
                onChange={setEditDates}
                followsTitle={task.waitsOn[0]?.title ?? null}
                derivedStart={
                  task.placement && task.startDate === null ? new Date(task.placement.start) : null
                }
              />
            </div>

            <SubmissionAskFields id="edit-task" value={editAsk} onChange={setEditAsk} />
            <HelpersWantedField id="edit-task" value={editHelpers} onChange={setEditHelpers} />

            <div className="mb-5">
              <Checkbox checked={editFeatured} onChange={(e) => setEditFeatured(e.target.checked)}>
                Add this task to the Quick Tasks page so volunteers can find and claim it without
                first clicking into this project
              </Checkbox>
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={updateMutation.isPending || !editTitle.trim()}>
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={updateMutation.isPending}
                onClick={() => {
                  setIsEditing(false)
                  setEditTitle(task.title)
                  setEditDescription(task.description ?? '')
                  setEditDates(datesValueFrom(task))
                  setEditFeatured(task.featuredAsQuickTask)
                  setEditAsk(submissionAskDraft(task))
                  setEditHelpers(helpersWantedDraft(task.helpersWanted))
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>

      <div className="bg-surface rounded-xl shadow p-6">
        <h2 className="text-lg mb-1">Discussion</h2>
        <p className="text-sm text-text-light mb-4">
          About this task only. For the whole project, use the{' '}
          <Link href={`/projects/${projectId}#discussion`}>project discussion</Link>.
        </p>
        <CommentThread workItemId={task.id} />
      </div>
      {confirmingClaim && (
        <ConfirmDialog
          id="confirm-claim-task"
          isOpen
          title={`${task.claimViewer.onProject || task.claimViewer.invited ? 'Claim' : 'Ask to take'} '${task.title}'?`}
          body={TASK_INACTIVITY_RULE}
          confirmLabel={claimLabel(task.claimViewer)}
          busyLabel={CLAIMING}
          busy={updateMutation.isPending}
          onConfirm={() => {
            handleClaimTask(user.id)
            setConfirmingClaim(false)
          }}
          onClose={() => setConfirmingClaim(false)}
        />
      )}
      {reopening && (
        <ReopenTaskDialog
          target={{ projectId, taskId, title: task.title, assigneeName: task.assignedToName }}
          onClose={() => setReopening(false)}
        />
      )}
      {messaging && task.assignedToId !== null && (
        <MessageDialog
          id="message-assignee"
          title={`Message ${task.assignedToName}`}
          recipientId={task.assignedToId}
          recipientName={task.assignedToName ?? 'The assignee'}
          relatedProjectId={projectId}
          onClose={() => setMessaging(false)}
        />
      )}
    </main>
  )
}
