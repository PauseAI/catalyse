'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireConfirmed } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import Button from '@/components/Button'
import Checkbox from '@/components/Checkbox'
import { Badge } from '@/components/Badge'
import CommentThread from '@/components/CommentThread'
import MessageDialog from '@/components/MessageDialog'
import Linkify from '@/components/Linkify'
import { useToast } from '@/lib/toast'
import { formatDate, toDateInputValue, fromDateInputValue } from '@/lib/format-date'
import { TaskStatus } from '@/generated/prisma/enums'
import { TASK_STATUS_LABELS, TASK_STATUS_VARIANTS } from '@/lib/status-labels'
import { PROJECT_TASK_CLAIMED_MESSAGE, TASK_REQUESTED_MESSAGE } from '@/lib/action-messages'
import { TASK_INACTIVITY_RULE } from '@/lib/staleness'
import { awaitsOwnerReview } from '@/lib/task-review'
import PageLoading from '@/components/PageLoading'
import NotFoundCard from '@/components/NotFoundCard'
import SubmitWorkButton from '@/components/SubmitWorkButton'
import SubmittedWork from '@/components/SubmittedWork'
import RequestChangesButton from '@/components/RequestChangesButton'

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

  const canEdit = !!user && !!task && task.canManage

  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editEstimatedHours, setEditEstimatedHours] = useState('')
  const [editDeadline, setEditDeadline] = useState('')
  const [editStartDate, setEditStartDate] = useState('')
  const [editDurationDays, setEditDurationDays] = useState('')
  const [editFeatured, setEditFeatured] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [messaging, setMessaging] = useState(false)

  useEffect(() => {
    if (!task || initialized) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialized(true)
    setEditTitle(task.title)
    setEditDescription(task.description ?? '')
    setEditEstimatedHours(task.estimatedHours !== null ? String(task.estimatedHours) : '')
    setEditDeadline(toDateInputValue(task.deadline))
    setEditStartDate(toDateInputValue(task.startDate))
    setEditDurationDays(task.durationDays !== null ? String(task.durationDays) : '')
    setEditFeatured(task.featuredAsQuickTask)
  }, [task, initialized])

  const updateMutation = useMutation({
    ...orpc.projects.updateTask.mutationOptions(),
    onSuccess: (data, variables) => {
      showToast(
        data.requested
          ? TASK_REQUESTED_MESSAGE
          : variables.data.status === TaskStatus.in_progress
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
      setNewLagDays('')
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

  const updateLagMutation = useMutation({
    ...orpc.dependencies.updateLag.mutationOptions(),
    onSuccess: () => void invalidateTask(),
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to update lag', 'error'),
  })

  const [newPredecessorId, setNewPredecessorId] = useState('')
  const [newLagDays, setNewLagDays] = useState('')

  function handleAddDependency(e: React.FormEvent) {
    e.preventDefault()
    if (!newPredecessorId) return
    addDependencyMutation.mutate({
      predecessorId: parseInt(newPredecessorId, 10),
      successorId: taskId,
      lagDays: newLagDays ? parseInt(newLagDays, 10) : 0,
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
        estimatedHours: editEstimatedHours ? parseFloat(editEstimatedHours) : null,
        deadline: fromDateInputValue(editDeadline),
        startDate: fromDateInputValue(editStartDate),
        durationDays: editDurationDays ? parseInt(editDurationDays, 10) : null,
        featuredAsQuickTask: editFeatured,
      },
    })
  }

  function handleClaimTask(assigneeId: number) {
    updateMutation.mutate({
      projectId,
      taskId,
      data: { status: TaskStatus.in_progress, assigneeId },
    })
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
            <Badge variant={TASK_STATUS_VARIANTS[task.status] ?? 'neutral'}>
              {TASK_STATUS_LABELS[task.status] ?? task.status}
            </Badge>
            {canEdit && !isEditing && (
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-3 mb-4 flex-wrap">
          {task.assignedToName && (
            <span className="text-text-light text-sm self-center">
              Assigned to {task.assignedToName}
            </span>
          )}
          {task.assignedToId !== null &&
            task.assignedToId !== user.id &&
            task.assigneeContactable && (
              <Button size="sm" variant="secondary" onClick={() => setMessaging(true)}>
                Message {task.assignedToName}
              </Button>
            )}
          {task.estimatedHours !== null && (
            <span className="text-text-light text-sm self-center">
              ~{task.estimatedHours}h estimated
            </span>
          )}
          {task.deadline && (
            <span className="text-text-light text-sm self-center">
              Due {formatDate(task.deadline)}
            </span>
          )}
          {task.startDate && (
            <span className="text-text-light text-sm self-center">
              Planned {formatDate(task.startDate)}
              {task.durationDays !== null &&
                ` · ${task.durationDays} day${task.durationDays === 1 ? '' : 's'}`}
            </span>
          )}
          {task.startedAt && (
            <span className="text-text-light text-sm self-center">
              {task.status === TaskStatus.completed || task.assigneeHasPosted
                ? 'Started'
                : 'Claimed on'}{' '}
              {formatDate(task.startedAt)}
              {task.completedAt && ` · finished ${formatDate(task.completedAt)}`}
            </span>
          )}
        </div>

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

        {task.status === TaskStatus.open && task.requestedById === null && task.canClaim && (
          <div className="mt-4">
            <Button
              variant="secondary"
              size="sm"
              disabled={updateMutation.isPending}
              onClick={() => handleClaimTask(user.id)}
            >
              Claim
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

        {task.status === TaskStatus.in_progress && task.assignedToId === user.id && (
          <div className="mt-4">
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
            <p className="text-sm text-text-light mt-2 mb-0">{TASK_INACTIVITY_RULE}</p>
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

            <div className="flex gap-3 flex-wrap mb-5">
              <div>
                <label htmlFor="edit-task-hours">Estimated hours</label>
                <input
                  id="edit-task-hours"
                  type="number"
                  min="0"
                  step="0.5"
                  value={editEstimatedHours}
                  onChange={(e) => setEditEstimatedHours(e.target.value)}
                  placeholder="e.g. 3"
                  className="w-30"
                />
              </div>
              <div>
                <label htmlFor="edit-task-deadline">Deadline</label>
                <input
                  id="edit-task-deadline"
                  type="date"
                  value={editDeadline}
                  onChange={(e) => setEditDeadline(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="edit-task-start">Start date</label>
                <input
                  id="edit-task-start"
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="edit-task-duration">Duration (days)</label>
                <input
                  id="edit-task-duration"
                  type="number"
                  min="1"
                  step="1"
                  value={editDurationDays}
                  onChange={(e) => setEditDurationDays(e.target.value)}
                  placeholder="e.g. 5"
                  className="w-30"
                />
              </div>
            </div>

            <p className="text-text-light -mt-2 mb-5 text-sm">
              Leave the start date empty to have this task follow whatever it depends on. Set one to
              pin it to that date instead.
            </p>

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
                  setEditEstimatedHours(
                    task.estimatedHours !== null ? String(task.estimatedHours) : '',
                  )
                  setEditDeadline(toDateInputValue(task.deadline))
                  setEditStartDate(toDateInputValue(task.startDate))
                  setEditDurationDays(task.durationDays !== null ? String(task.durationDays) : '')
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
          This task can only start once the tasks below have finished. A lag adds days between them;
          a negative lag lets them overlap.
        </p>

        {task.predecessors.length === 0 ? (
          <p className="text-text-light mb-4">Nothing yet — this task can start whenever.</p>
        ) : (
          <ul className="mb-4 list-none space-y-2 p-0">
            {task.predecessors.map((dep) => (
              <li key={dep.dependencyId} className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/projects/${projectId}/tasks/${dep.predecessorId}`}
                  className="text-primary-text underline"
                >
                  {dep.predecessorTitle}
                </Link>
                <label className="text-text-light flex items-center gap-1 text-sm">
                  Lag
                  <input
                    type="number"
                    step="1"
                    defaultValue={dep.lagDays}
                    disabled={!task.canManage || updateLagMutation.isPending}
                    className="w-20"
                    onBlur={(e) => {
                      const next = e.target.value ? parseInt(e.target.value, 10) : 0
                      if (next === dep.lagDays) return
                      updateLagMutation.mutate({ dependencyId: dep.dependencyId, lagDays: next })
                    }}
                  />
                  days
                </label>
                {task.canManage && (
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
                )}
              </li>
            ))}
          </ul>
        )}

        {task.canManage &&
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
              <div>
                <label htmlFor="new-dependency-lag">Lag (days)</label>
                <input
                  id="new-dependency-lag"
                  type="number"
                  step="1"
                  value={newLagDays}
                  onChange={(e) => setNewLagDays(e.target.value)}
                  placeholder="0"
                  className="w-20"
                />
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
