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
import { EMPTY_DATES, datesPayload, datesValueFrom, type DatesValue } from '@/lib/task-dates'
import { Badge } from '@/components/Badge'
import CommentThread from '@/components/CommentThread'
import MessageDialog from '@/components/MessageDialog'
import Linkify from '@/components/Linkify'
import { useToast } from '@/lib/toast'
import { TaskStatus } from '@/generated/prisma/enums'
import { TASK_STATUS_LABELS, TASK_STATUS_VARIANTS } from '@/lib/status-labels'
import { PROJECT_TASK_CLAIMED_MESSAGE, TASK_REQUESTED_MESSAGE } from '@/lib/action-messages'
import { UNASSIGN, claimLabel } from '@/lib/action-labels'
import { TASK_INACTIVITY_RULE } from '@/lib/staleness'
import { awaitsOwnerReview } from '@/lib/task-review'
import { handedIn } from '@/lib/overdue'
import { quotedTitles } from '@/lib/task-status'
import PageLoading from '@/components/PageLoading'
import NotFoundCard from '@/components/NotFoundCard'
import SubmitWorkButton from '@/components/SubmitWorkButton'
import SubmittedWork from '@/components/SubmittedWork'
import RequestChangesButton from '@/components/RequestChangesButton'
import ReopenTaskDialog from '@/components/ReopenTaskDialog'

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
  const [initialized, setInitialized] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [messaging, setMessaging] = useState(false)
  const [replanning, setReplanning] = useState(false)
  const [reassignTo, setReassignTo] = useState('')
  const [reopening, setReopening] = useState(false)

  useEffect(() => {
    if (!task || initialized) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialized(true)
    setEditTitle(task.title)
    setEditDescription(task.description ?? '')
    setEditDates(datesValueFrom(task))
    setEditFeatured(task.featuredAsQuickTask)
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

  const addDependencyMutation = useMutation({
    ...orpc.dependencies.add.mutationOptions(),
    onSuccess: () => {
      showToast('Dependency added', 'success')
      setNewPredecessorId('')
      void invalidateTask()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to add dependency', 'error'),
  })

  const removeDependencyMutation = useMutation({
    ...orpc.dependencies.remove.mutationOptions(),
    onSuccess: () => {
      showToast('Dependency removed', 'success')
      void invalidateTask()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to remove dependency', 'error'),
  })

  const [newPredecessorId, setNewPredecessorId] = useState('')

  function handleAddDependency(e: React.FormEvent) {
    e.preventDefault()
    if (!newPredecessorId) return
    addDependencyMutation.mutate({
      predecessorId: parseInt(newPredecessorId, 10),
      successorId: taskId,
      lagDays: 0,
    })
  }

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

  return (
    <main className="container py-5 pb-15">
      <Link
        href={`/projects/${projectId}`}
        className="text-sm text-primary-text underline block mb-4"
      >
        ← Back to {task.projectTitle}
      </Link>

      <div className="bg-surface rounded-xl shadow p-6 overflow-hidden wrap-break-word mb-5">
        <div className="flex justify-between items-start mb-3 gap-4">
          <h1 className="m-0">{task.title}</h1>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={TASK_STATUS_VARIANTS[task.displayStatus]}>
              {TASK_STATUS_LABELS[task.displayStatus]}
            </Badge>
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
          </div>
        </div>

        {/* The form below holds the same dates, so the summary steps aside while it is open. */}
        {!isEditing && (
          <TaskDatesSummary
            timing={task.timing}
            estimatedHours={task.estimatedHours}
            deadline={task.deadline}
            openStart={task.startDate === null && task.predecessors.length === 0}
            placement={task.placement}
            assigneeName={task.assignedToName}
            claimedAt={task.claimedAt}
            startedAt={task.startedAt}
            completedAt={task.completedAt}
          />
        )}
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
        {task.assignedToId !== null &&
          task.assignedToId !== user.id &&
          task.assigneeContactable && (
            <div className="mb-4">
              <Button size="sm" variant="secondary" onClick={() => setMessaging(true)}>
                Message {task.assignedToName}
              </Button>
            </div>
          )}

        {task.description && (
          <p className="whitespace-pre-wrap mb-0">
            <Linkify text={task.description} />
          </p>
        )}

        {task.requestedById !== null && (
          <p className="text-sm text-text-light mt-4 mb-0">
            {task.requestedById === user.id
              ? 'Held for you until the owner accepts you onto the project.'
              : `Requested by ${task.requestedByName}, waiting for the owner.`}
          </p>
        )}

        {task.status === TaskStatus.not_started &&
          task.assignedToId === null &&
          task.requestedById === null &&
          task.canClaim && (
            <div className="mt-4">
              <Button
                variant="secondary"
                size="sm"
                disabled={updateMutation.isPending}
                onClick={() => handleClaimTask(user.id)}
              >
                {claimLabel(task.claimViewer)}
              </Button>
              <p className="text-sm text-text-light mt-2 mb-0">{TASK_INACTIVITY_RULE}</p>
            </div>
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

        {!handedIn(task.status) && task.assignedToId === user.id && (
          <div className="mt-4 flex flex-wrap items-start gap-2">
            {task.status === TaskStatus.not_started && (
              <Button
                size="sm"
                disabled={startMutation.isPending}
                onClick={() => startMutation.mutate({ projectId, taskId })}
              >
                Start
              </Button>
            )}
            <SubmitWorkButton
              target={{ kind: 'project', projectId, taskId }}
              reviewer={
                awaitsOwnerReview(
                  { autoAcceptTasks: task.autoAcceptTasks, ownerId: task.projectOwnerId },
                  task.canManage,
                )
                  ? 'The project owner'
                  : null
              }
              size="sm"
              variant="secondary"
            />
            <p className="text-sm text-text-light mt-2 mb-0 basis-full">{TASK_INACTIVITY_RULE}</p>
          </div>
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
                followsTitle={task.predecessors[0]?.predecessorTitle ?? null}
                derivedStart={
                  task.placement && task.startDate === null ? new Date(task.placement.start) : null
                }
              />
            </div>

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
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>

      <div className="bg-surface mb-5 rounded-xl p-6 shadow">
        <h2 className="mb-1 text-lg">Depends on</h2>
        <p className="text-text-light mb-4 text-sm">
          This task can only start once the tasks below have finished.
        </p>

        {task.predecessors.length === 0 ? (
          <p className="text-text-light mb-4">Nothing yet — this task can start whenever.</p>
        ) : (
          <ul className="mb-4 list-none space-y-2 p-0">
            {task.predecessors.map((dep) => (
              <li key={dep.dependencyId}>
                <WorkItemCard
                  item={dep.item}
                  extra={
                    canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removeDependencyMutation.isPending}
                        onClick={() =>
                          removeDependencyMutation.mutate({ dependencyId: dep.dependencyId })
                        }
                      >
                        Remove
                      </Button>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {canEdit &&
          (task.siblingTasks.length === 0 ? (
            <p className="text-text-light text-sm">No other tasks in this project to depend on.</p>
          ) : (
            <form onSubmit={handleAddDependency} className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="new-dependency">Add a dependency</label>
                <select
                  id="new-dependency"
                  value={newPredecessorId}
                  onChange={(e) => setNewPredecessorId(e.target.value)}
                >
                  <option value="">Select a task…</option>
                  {task.siblingTasks
                    .filter((s) => !task.predecessors.some((p) => p.predecessorId === s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                </select>
              </div>
              <Button type="submit" disabled={!newPredecessorId || addDependencyMutation.isPending}>
                {addDependencyMutation.isPending ? 'Adding…' : 'Add'}
              </Button>
            </form>
          ))}
      </div>

      <div className="bg-surface rounded-xl shadow p-6">
        <h2 className="text-lg mb-1">Discussion</h2>
        <p className="text-sm text-text-light mb-4">
          About this task only. For the whole project, use the{' '}
          <Link href={`/projects/${projectId}#discussion`}>project discussion</Link>.
        </p>
        <CommentThread workItemId={task.id} />
      </div>
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
