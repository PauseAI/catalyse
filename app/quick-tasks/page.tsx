'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRequireApproved } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge, type BadgeVariant } from '@/components/Badge'
import Button from '@/components/Button'
import CommentThread from '@/components/CommentThread'
import FilterDropdown, { useFilterOptions } from '@/components/FilterDropdown'
import VolunteerSelect from '@/components/VolunteerSelect'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Linkify from '@/components/Linkify'
import SubmitWorkButton from '@/components/SubmitWorkButton'
import SubmittedWork, { type Submission } from '@/components/SubmittedWork'
import RequestChangesButton from '@/components/RequestChangesButton'
import QuickTaskReviewDialog from '@/components/QuickTaskReviewDialog'
import {
  PROJECT_TASK_CLAIMED_MESSAGE,
  QUICK_TASK_CLAIMED_MESSAGE,
  TASK_REQUESTED_MESSAGE,
} from '@/lib/action-messages'
import {
  QUICK_TASK_STATUS_LABELS,
  QUICK_TASK_STATUS_VARIANTS,
  TASK_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
} from '@/lib/status-labels'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate, fromDateInputValue, toDateInputValue } from '@/lib/format-date'
import DeadlineChip from '@/components/DeadlineChip'
import { QuickTaskStatus, TaskStatus } from '@/generated/prisma/enums'
import PageLoading from '@/components/PageLoading'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import Tabs from '@/components/Tabs'

interface Skill {
  id: number
  name: string
  categoryName: string
}

interface AdminQuickTask {
  id: number
  title: string
  description: string
  skillId: number | null
  skillName: string | null
  projectTitle: string | null
  assignedToId: number | null
  assignedToName: string | null
  status: string
  reviewRating: string | null
  reviewNotes: string | null
  estimatedHours: number | null
  deadline: string | Date | null
  createdAt: string
  submission: Submission | null
  changesRequested: string | null
  reviewedByName: string | null
}

interface FeaturedProjectTask {
  id: number
  projectId: number
  projectTitle: string | null
  title: string
  description: string
  status: string
  assignedToId: number | null
  assignedToName: string | null
  estimatedHours: number | null
  deadline: string | Date | null
  createdAt: string
}

const RATING_CLASSES: Record<string, string> = {
  excellent: 'text-success',
  good: 'text-text-light',
  needs_improvement: 'text-error',
}

const RATING_LABELS: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_improvement: 'Needs improvement',
}

const SKILL_CHIP_CLASSES =
  'inline-flex items-center px-3 py-1 bg-accent text-secondary-dark rounded-full text-sm font-medium dark:bg-gray-700 dark:text-gray-300'

// One card shape shared by every quick-task list — volunteer or admin, standalone quick
// task or featured project task. What differs between them is the meta/description
// content and whichever role-specific controls get passed in as children, not the card
// itself.
function QuickTaskCard({
  anchorId,
  title,
  titleHref,
  status,
  statusVariant,
  statusLabel,
  meta,
  description,
  children,
}: {
  anchorId?: string
  title: string
  titleHref?: string
  status: string
  statusVariant: BadgeVariant
  statusLabel?: string
  meta?: React.ReactNode[]
  description?: string | null
  children?: React.ReactNode
}) {
  return (
    <div
      id={anchorId}
      role="article"
      className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word"
    >
      <div className="flex justify-between items-start gap-3 mb-2">
        <h3 className="m-0">{titleHref ? <Link href={titleHref}>{title}</Link> : title}</h3>
        <Badge role="status" variant={statusVariant} className="whitespace-nowrap shrink-0">
          {statusLabel ?? status}
        </Badge>
      </div>
      {meta && meta.some(Boolean) && (
        <div className="flex gap-2 mb-3 flex-wrap items-center">{meta}</div>
      )}
      {description && (
        <p className="whitespace-pre-wrap mb-4">
          <Linkify text={description} />
        </p>
      )}
      {children}
    </div>
  )
}

export default function QuickTasksPage() {
  const { user, loading } = useRequireApproved()

  if (loading || !user) return <PageLoading />

  return user.isAdmin ? <AdminQuickTasksView /> : <VolunteerQuickTasksView user={user} />
}

type ApprovedUser = NonNullable<ReturnType<typeof useRequireApproved>['user']>

function VolunteerQuickTasksView({ user }: { user: ApprovedUser }) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const router = useRouter()

  const { data: tasks = [], isLoading: loadingTasks } = useQuery({
    ...orpc.my.quickTasks.queryOptions(),
  })

  const { data: availableTasks = [], isLoading: loadingAvailable } = useQuery({
    ...orpc.quickTasks.available.queryOptions(),
  })

  const invalidateAvailable = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.available.key() })
    void queryClient.invalidateQueries({ queryKey: orpc.my.quickTasks.key() })
  }

  // Opens on my own tasks when there are any; a claim moves me there to see it land.
  const [chosenTab, setChosenTab] = useState<'mine' | 'open' | null>(null)
  const tab = chosenTab ?? (tasks.length > 0 ? 'mine' : 'open')

  const claimQuickMutation = useMutation({
    ...orpc.quickTasks.claim.mutationOptions(),
    onSuccess: () => {
      showToast(QUICK_TASK_CLAIMED_MESSAGE, 'success')
      invalidateAvailable()
      setChosenTab('mine')
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to claim task', 'error'),
  })

  // A claimed project task doesn't join "My Quick Tasks" below — that list is quick
  // tasks only — so send the volunteer to the task itself rather than leaving them on a
  // page where the thing they just claimed has silently vanished.
  const claimProjectTaskMutation = useMutation({
    ...orpc.projects.updateTask.mutationOptions(),
    onSuccess: (data, variables) => {
      showToast(data.requested ? TASK_REQUESTED_MESSAGE : PROJECT_TASK_CLAIMED_MESSAGE, 'success')
      invalidateAvailable()
      router.push(`/projects/${variables.projectId}/tasks/${variables.taskId}`)
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to claim task', 'error'),
  })

  return (
    <>
      <main className="container py-5 pb-15">
        <h1>Quick Tasks</h1>
        <p className="text-text-light mb-4">
          Small, self-contained tasks to help you get started and make an impact quickly.
        </p>
        <Tabs
          tabs={[
            { key: 'mine', label: `Mine${tasks.length ? ` (${tasks.length})` : ''}` },
            {
              key: 'open',
              label: `Open${availableTasks.length ? ` (${availableTasks.length})` : ''}`,
            },
          ]}
          activeTab={tab}
          onChange={setChosenTab}
        />

        {/* The two lists are separate landmarks: a task moves between them when it is
            claimed, and both refetch independently, so anything addressing "the card for
            task X" needs to say which list it means. */}
        {tab === 'mine' && (
          <section aria-labelledby="my-quick-tasks">
            <h2 id="my-quick-tasks" className="mt-0">
              My Quick Tasks
            </h2>

            {loadingTasks ? (
              <Skeleton label="Loading tasks…" count={1} />
            ) : tasks.length === 0 ? (
              <EmptyState
                title="No tasks assigned yet"
                body="Claim one from the Open tab, or browse projects for other ways to contribute."
                action={
                  <Button variant="outline" onClick={() => setChosenTab('open')}>
                    See open tasks
                  </Button>
                }
              />
            ) : (
              tasks.map((task) => (
                <QuickTaskCard
                  key={task.id}
                  anchorId={`task-${task.id}`}
                  title={task.title}
                  titleHref={`/quick-tasks/${task.id}`}
                  status={task.status}
                  statusVariant={QUICK_TASK_STATUS_VARIANTS[task.status] ?? 'neutral'}
                  statusLabel={QUICK_TASK_STATUS_LABELS[task.status] ?? task.status}
                  description={task.description}
                  meta={[
                    task.skillName && (
                      <span key="skill" className={SKILL_CHIP_CLASSES}>
                        {task.skillName}
                      </span>
                    ),
                    task.estimatedHours && (
                      <span key="hours" className="text-text-light text-sm">
                        ~{task.estimatedHours}h
                      </span>
                    ),
                    task.deadline && (
                      <DeadlineChip
                        key="deadline"
                        deadline={task.deadline}
                        done={task.status === QuickTaskStatus.completed}
                      />
                    ),
                    task.projectTitle && (
                      <span key="project" className="text-text-light text-sm">
                        Related: {task.projectTitle}
                      </span>
                    ),
                  ]}
                >
                  {task.status === QuickTaskStatus.in_progress && (
                    <>
                      {task.changesRequested && (
                        <p className="text-sm mt-0 mb-3">
                          <strong>Changes requested:</strong> {task.changesRequested}
                        </p>
                      )}
                      <SubmitWorkButton
                        target={{ kind: 'quick', taskId: task.id }}
                        reviewer="An admin"
                      />
                    </>
                  )}
                </QuickTaskCard>
              ))
            )}
          </section>
        )}

        {tab === 'open' && (
          <section aria-labelledby="browse-quick-tasks">
            <h2 id="browse-quick-tasks" className="mt-0">
              Browse Quick Tasks
            </h2>
            <p className="text-text-light mb-6">
              Open tasks to pick up right now, no need to browse projects first.
            </p>

            {loadingAvailable ? (
              <Skeleton label="Loading tasks…" />
            ) : availableTasks.length === 0 ? (
              <EmptyState
                title="No open Quick Tasks right now"
                body="Check back soon, or find a project that needs a hand."
                action={
                  <Button href="/projects" variant="outline">
                    Browse projects
                  </Button>
                }
              />
            ) : (
              availableTasks.map((task) =>
                task.kind === 'quick' ? (
                  <QuickTaskCard
                    key={`quick-${task.id}`}
                    title={task.title}
                    titleHref={`/quick-tasks/${task.id}`}
                    status="open"
                    statusVariant={QUICK_TASK_STATUS_VARIANTS.open}
                    statusLabel={QUICK_TASK_STATUS_LABELS.open}
                    description={task.description}
                    meta={[
                      task.skillName && (
                        <span key="skill" className={SKILL_CHIP_CLASSES}>
                          {task.skillName}
                        </span>
                      ),
                      task.estimatedHours !== null && (
                        <span key="hours" className="text-text-light text-sm">
                          ~{task.estimatedHours}h
                        </span>
                      ),
                      task.deadline && (
                        <DeadlineChip key="deadline" deadline={task.deadline} done={false} />
                      ),
                    ]}
                  >
                    <Button
                      onClick={() => claimQuickMutation.mutate({ id: task.id })}
                      disabled={
                        claimQuickMutation.isPending && claimQuickMutation.variables?.id === task.id
                      }
                    >
                      {claimQuickMutation.isPending && claimQuickMutation.variables?.id === task.id
                        ? 'Claiming…'
                        : 'Claim'}
                    </Button>
                  </QuickTaskCard>
                ) : (
                  <QuickTaskCard
                    key={`project-task-${task.id}`}
                    title={task.title}
                    titleHref={`/projects/${task.projectId}/tasks/${task.id}`}
                    status="open"
                    statusVariant={TASK_STATUS_VARIANTS.open}
                    statusLabel={TASK_STATUS_LABELS.open}
                    description={task.description}
                    meta={[
                      task.projectTitle && (
                        <span key="project" className="text-text-light text-sm">
                          Part of:{' '}
                          <Link href={`/projects/${task.projectId}`}>{task.projectTitle}</Link>
                        </span>
                      ),
                      task.estimatedHours !== null && (
                        <span key="hours" className="text-text-light text-sm">
                          ~{task.estimatedHours}h
                        </span>
                      ),
                      task.deadline && (
                        <DeadlineChip key="deadline" deadline={task.deadline} done={false} />
                      ),
                    ]}
                  >
                    <Button
                      onClick={() =>
                        claimProjectTaskMutation.mutate({
                          projectId: task.projectId,
                          taskId: task.id,
                          data: { status: TaskStatus.in_progress, assigneeId: user.id },
                        })
                      }
                      disabled={
                        claimProjectTaskMutation.isPending &&
                        claimProjectTaskMutation.variables?.taskId === task.id
                      }
                    >
                      {claimProjectTaskMutation.isPending &&
                      claimProjectTaskMutation.variables?.taskId === task.id
                        ? 'Claiming…'
                        : 'Claim'}
                    </Button>
                  </QuickTaskCard>
                ),
              )
            )}
          </section>
        )}
      </main>
    </>
  )
}

function AdminQuickTasksView() {
  const queryClient = useQueryClient()
  const {
    value: statusFilter,
    onChange: setStatusFilter,
    options: statusFilterOptions,
  } = useFilterOptions(
    [
      { value: '', label: 'All' },
      { value: 'open', label: 'Open' },
      { value: 'in_progress', label: 'In progress' },
      { value: 'under_review', label: 'Submitted (needs review)' },
      { value: 'completed', label: 'Completed' },
    ],
    '',
  )
  const toast = useToast()
  // useRef so the hash is captured client-side in a useEffect (useState initializer runs on server)
  const deepLinkHash = useRef('')

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createSkillId, setCreateSkillId] = useState('')
  const [createHours, setCreateHours] = useState('')
  const [createDeadline, setCreateDeadline] = useState('')

  // Edit modal
  const [editModal, setEditModal] = useState<AdminQuickTask | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editSkillId, setEditSkillId] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editDeadline, setEditDeadline] = useState('')

  // Assign — inline dropdown per task, matching the project-task assign pattern
  const [taskAssignSelections, setTaskAssignSelections] = useState<Record<number, string>>({})

  // Assign for featured project tasks — same inline dropdown, backed by the project
  // task mutations (these rows are WorkItemType.TASK, not QUICK_TASK).
  const [projectTaskAssignSelections, setProjectTaskAssignSelections] = useState<
    Record<number, string>
  >({})

  // Review modal
  const [reviewModal, setReviewModal] = useState<AdminQuickTask | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminQuickTask | null>(null)

  const { data: tasksRaw = [], isPending: loadingData } = useQuery({
    ...orpc.quickTasks.list.queryOptions({
      input: statusFilter ? { status: statusFilter as QuickTaskStatus } : {},
    }),
  })
  const tasks = tasksRaw as unknown as AdminQuickTask[]

  const { data: featuredProjectTasksRaw = [] } = useQuery({
    ...orpc.quickTasks.featuredProjectTasks.queryOptions(),
  })
  const featuredProjectTasks = featuredProjectTasksRaw as unknown as FeaturedProjectTask[]

  const { data: skillCats = [] } = useQuery({
    ...orpc.skills.list.queryOptions(),
  })
  const skills: Skill[] = skillCats.flatMap((cat) =>
    cat.skills.map((s) => ({ ...s, categoryName: cat.name })),
  )

  // Cards are always fully expanded now, so a deep link just needs to scroll to the
  // right card rather than toggle anything open.
  useEffect(() => {
    function scrollToHash(hash: string) {
      if (!hash.startsWith('#task-')) return
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
    }
    deepLinkHash.current = window.location.hash
    const onHashChange = () => {
      deepLinkHash.current = window.location.hash
      scrollToHash(deepLinkHash.current)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // When tasks first load, apply any hash that was present on initial page load
  useEffect(() => {
    const hash = deepLinkHash.current
    if (!hash.startsWith('#task-') || tasks.length === 0) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [tasks])

  const createTaskMutation = useMutation({
    ...orpc.quickTasks.create.mutationOptions(),
    onSuccess: () => {
      toast('Task created!', 'success')
      setShowCreate(false)
      setCreateTitle('')
      setCreateDesc('')
      setCreateSkillId('')
      setCreateHours('')
      setCreateDeadline('')
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.list.key() })
    },
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Failed to create task', 'error'),
  })

  const editTaskMutation = useMutation({
    ...orpc.quickTasks.update.mutationOptions(),
    onSuccess: () => {
      toast('Task updated!', 'success')
      setEditModal(null)
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.list.key() })
    },
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Failed to update task', 'error'),
  })

  const assignTaskMutation = useMutation({
    ...orpc.quickTasks.assign.mutationOptions(),
    onSuccess: (_data, variables) => {
      toast('Task assigned!', 'success')
      setTaskAssignSelections((s) => {
        const next = { ...s }
        delete next[variables.id]
        return next
      })
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.list.key() })
    },
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Failed to assign', 'error'),
  })

  const unassignTaskMutation = useMutation({
    ...orpc.quickTasks.unassign.mutationOptions(),
    onSuccess: () => {
      toast('Assignee removed', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.list.key() })
    },
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Failed to unassign', 'error'),
  })

  const assignProjectTaskMutation = useMutation({
    ...orpc.projects.assignTask.mutationOptions(),
    onSuccess: (_data, variables) => {
      toast('Task assigned!', 'success')
      setProjectTaskAssignSelections((s) => {
        const next = { ...s }
        delete next[variables.taskId]
        return next
      })
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.featuredProjectTasks.key() })
    },
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Failed to assign', 'error'),
  })

  const unassignProjectTaskMutation = useMutation({
    ...orpc.projects.updateTask.mutationOptions(),
    onSuccess: () => {
      toast('Assignee removed', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.featuredProjectTasks.key() })
    },
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Failed to unassign', 'error'),
  })

  const deleteTaskMutation = useMutation({
    ...orpc.quickTasks.delete.mutationOptions(),
    onSuccess: () => {
      toast('Task deleted', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.quickTasks.list.key() })
    },
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Failed to delete task', 'error'),
  })

  function openEdit(task: AdminQuickTask) {
    setEditModal(task)
    setEditTitle(task.title)
    setEditDesc(task.description)
    setEditSkillId(task.skillId ? String(task.skillId) : '')
    setEditHours(task.estimatedHours ? String(task.estimatedHours) : '')
    setEditDeadline(toDateInputValue(task.deadline))
  }

  function createTask(e: React.FormEvent) {
    e.preventDefault()
    createTaskMutation.mutate({
      title: createTitle.trim(),
      description: createDesc.trim(),
      skillId: createSkillId ? parseInt(createSkillId) : null,
      estimatedHours: createHours ? parseFloat(createHours) : null,
      deadline: fromDateInputValue(createDeadline),
    })
  }

  function editTask(e: React.FormEvent, task: AdminQuickTask) {
    e.preventDefault()
    editTaskMutation.mutate({
      id: task.id,
      title: editTitle.trim(),
      description: editDesc.trim(),
      skillId: editSkillId ? parseInt(editSkillId) : null,
      estimatedHours: editHours ? parseFloat(editHours) : null,
      deadline: fromDateInputValue(editDeadline),
    })
  }

  function handleAssignTask(taskId: number) {
    assignTaskMutation.mutate({
      id: taskId,
      volunteerId: parseInt(taskAssignSelections[taskId], 10),
    })
  }

  function handleUnassignTask(taskId: number) {
    unassignTaskMutation.mutate({ id: taskId })
  }

  function handleAssignProjectTask(task: FeaturedProjectTask) {
    assignProjectTaskMutation.mutate({
      projectId: task.projectId,
      taskId: task.id,
      assigneeId: parseInt(projectTaskAssignSelections[task.id], 10),
    })
  }

  function handleUnassignProjectTask(task: FeaturedProjectTask) {
    unassignProjectTaskMutation.mutate({
      projectId: task.projectId,
      taskId: task.id,
      data: { status: TaskStatus.open },
    })
  }

  async function copyLink(path: string) {
    const url = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied!', 'success')
    } catch {
      toast('Could not copy the link', 'error')
    }
  }

  return (
    <>
      <main className="container py-5 pb-15">
        <div className="flex justify-between items-center mb-3">
          <h1>Quick Tasks</h1>
          <Button onClick={() => setShowCreate(true)}>Create Task</Button>
        </div>

        <p className="text-text-light mb-6">
          Small, self-contained tasks to help you get started and make an impact quickly.
        </p>

        <div className="mb-6 max-w-[240px]">
          <FilterDropdown
            id="status-filter"
            label="Status"
            ariaLabel="Status"
            value={statusFilter}
            options={statusFilterOptions}
            onChange={setStatusFilter}
          />
        </div>

        {loadingData ? (
          <div className="text-center py-10 text-text-light">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="bg-surface rounded-xl shadow p-6 text-center">
            <h3>No quick tasks</h3>
            <p className="text-text-light">
              Create one to verify a volunteer&apos;s skills before giving them a bigger project.
            </p>
          </div>
        ) : (
          tasks.map((task) => (
            <QuickTaskCard
              key={task.id}
              anchorId={`task-${task.id}`}
              title={task.title}
              status={task.status}
              statusVariant={QUICK_TASK_STATUS_VARIANTS[task.status] ?? 'neutral'}
              statusLabel={QUICK_TASK_STATUS_LABELS[task.status] ?? task.status}
              description={task.description}
              meta={[
                task.skillName && (
                  <span key="skill" className={SKILL_CHIP_CLASSES}>
                    {task.skillName}
                  </span>
                ),
                task.estimatedHours !== null && (
                  <span key="hours" className="text-text-light text-sm">
                    ~{task.estimatedHours}h
                  </span>
                ),
                task.deadline && (
                  <DeadlineChip
                    key="deadline"
                    deadline={task.deadline}
                    done={task.status === QuickTaskStatus.completed}
                  />
                ),
                task.assignedToId && task.assignedToName && (
                  <span key="assignee" className="text-text-light text-sm">
                    Assigned to:{' '}
                    <Link href={`/admin/volunteers/${task.assignedToId}`}>
                      {task.assignedToName}
                    </Link>
                  </span>
                ),
                task.reviewRating && (
                  <span key="rating" className={`text-sm ${RATING_CLASSES[task.reviewRating]}`}>
                    {RATING_LABELS[task.reviewRating]}
                  </span>
                ),
              ]}
            >
              {task.reviewNotes && (
                <p className="text-sm text-text-light mb-3">Notes: {task.reviewNotes}</p>
              )}

              <div className="mb-3">
                <SubmittedWork
                  submission={task.submission}
                  changesRequested={
                    task.changesRequested
                      ? { message: task.changesRequested, byName: task.reviewedByName }
                      : null
                  }
                />
              </div>

              <div className="mb-3">
                <strong className="text-sm">Discussion</strong>
                <CommentThread workItemId={task.id} />
              </div>

              {task.status === QuickTaskStatus.open && (
                <div className="flex gap-2 items-end mb-3">
                  <div className="flex-1 max-w-75">
                    <VolunteerSelect
                      id={`assign-task-${task.id}`}
                      label="Assign to"
                      ariaLabel={`Assign volunteer to ${task.title}`}
                      value={taskAssignSelections[task.id] ?? ''}
                      onChange={(v) => setTaskAssignSelections((s) => ({ ...s, [task.id]: v }))}
                      placeholder="Select volunteer…"
                      enabled
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!taskAssignSelections[task.id] || assignTaskMutation.isPending}
                    onClick={() => handleAssignTask(task.id)}
                  >
                    Assign
                  </Button>
                </div>
              )}

              <div className="flex justify-between items-center mt-3 pt-3 border-t border-brand-border">
                <span className="text-sm text-text-light">
                  Created {formatDate(task.createdAt)}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void copyLink(`/quick-tasks/${task.id}`)}
                  >
                    Copy share link
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openEdit(task)}>
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setDeleteTarget(task)}>
                    Delete
                  </Button>
                  {task.assignedToId && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={unassignTaskMutation.isPending}
                      onClick={() => handleUnassignTask(task.id)}
                    >
                      Unassign
                    </Button>
                  )}
                  {task.status === QuickTaskStatus.under_review && (
                    <>
                      <RequestChangesButton
                        target={{ kind: 'quick', taskId: task.id }}
                        assigneeName={task.assignedToName}
                        size="sm"
                      />
                      <Button size="sm" onClick={() => setReviewModal(task)}>
                        Review
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </QuickTaskCard>
          ))
        )}

        {featuredProjectTasks.length > 0 && (
          <>
            <h2 className="mt-8">Featured project tasks</h2>
            <p className="text-text-light mb-6">
              Project tasks flagged to also appear on this page for volunteers.
            </p>
            {featuredProjectTasks.map((task) => (
              <QuickTaskCard
                key={`project-task-${task.id}`}
                title={task.title}
                titleHref={`/projects/${task.projectId}/tasks/${task.id}`}
                status={task.status}
                statusVariant={TASK_STATUS_VARIANTS[task.status] ?? 'neutral'}
                statusLabel={TASK_STATUS_LABELS[task.status] ?? task.status}
                description={task.description}
                meta={[
                  task.projectTitle && (
                    <span key="project" className="text-text-light text-sm">
                      Part of: <Link href={`/projects/${task.projectId}`}>{task.projectTitle}</Link>
                    </span>
                  ),
                  task.estimatedHours !== null && (
                    <span key="hours" className="text-text-light text-sm">
                      ~{task.estimatedHours}h
                    </span>
                  ),
                  task.deadline && (
                    <DeadlineChip
                      key="deadline"
                      deadline={task.deadline}
                      done={task.status === TaskStatus.completed}
                    />
                  ),
                  task.assignedToId && task.assignedToName && (
                    <span key="assignee" className="text-text-light text-sm">
                      Assigned to:{' '}
                      <Link href={`/admin/volunteers/${task.assignedToId}`}>
                        {task.assignedToName}
                      </Link>
                    </span>
                  ),
                ]}
              >
                {task.status === TaskStatus.open && (
                  <div className="flex gap-2 items-end mb-3">
                    <div className="flex-1 max-w-75">
                      <VolunteerSelect
                        id={`assign-project-task-${task.id}`}
                        label="Assign to"
                        ariaLabel={`Assign volunteer to ${task.title}`}
                        value={projectTaskAssignSelections[task.id] ?? ''}
                        onChange={(v) =>
                          setProjectTaskAssignSelections((s) => ({ ...s, [task.id]: v }))
                        }
                        placeholder="Select volunteer…"
                        enabled
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        !projectTaskAssignSelections[task.id] || assignProjectTaskMutation.isPending
                      }
                      onClick={() => handleAssignProjectTask(task)}
                    >
                      Assign
                    </Button>
                  </div>
                )}

                <div className="flex justify-between items-center mt-3 pt-3 border-t border-brand-border">
                  <span className="text-sm text-text-light">
                    Created {formatDate(task.createdAt)}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void copyLink(`/projects/${task.projectId}/tasks/${task.id}`)}
                    >
                      Copy share link
                    </Button>
                    {task.assignedToId && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={unassignProjectTaskMutation.isPending}
                        onClick={() => handleUnassignProjectTask(task)}
                      >
                        Unassign
                      </Button>
                    )}
                  </div>
                </div>
              </QuickTaskCard>
            ))}
          </>
        )}
      </main>

      {/* Create Task Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false)
          }}
        >
          <div
            role="dialog"
            aria-labelledby="create-dialog-title"
            className="bg-surface rounded-xl shadow-lg max-w-150 w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 id="create-dialog-title">Create Quick Task</h2>
            </div>
            <div className="p-6">
              <form onSubmit={createTask}>
                <div className="mb-5">
                  <label htmlFor="ct-title">Title</label>
                  <input
                    id="ct-title"
                    type="text"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    required
                    autoFocus
                    placeholder="e.g., Draft 3 social media posts about AI safety"
                  />
                </div>
                <div className="mb-5">
                  <label htmlFor="ct-desc">Description</label>
                  <textarea
                    id="ct-desc"
                    rows={4}
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                    required
                    placeholder="What should the volunteer do? Include any context, examples, or guidelines."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div>
                    <FilterDropdown
                      id="ct-skill"
                      label="Skill Being Tested"
                      ariaLabel="Skill Being Tested"
                      value={createSkillId}
                      options={[
                        { value: '', label: 'None specific' },
                        ...skills.map((s) => ({
                          value: String(s.id),
                          label: `${s.name} (${s.categoryName})`,
                        })),
                      ]}
                      onChange={(v) => setCreateSkillId(v)}
                      searchable
                    />
                  </div>
                  <div>
                    <label htmlFor="ct-hours">Estimated Hours</label>
                    <input
                      id="ct-hours"
                      type="number"
                      min="0.5"
                      max="20"
                      step="0.5"
                      value={createHours}
                      onChange={(e) => setCreateHours(e.target.value)}
                      placeholder="e.g., 2"
                    />
                  </div>
                  <div>
                    <label htmlFor="ct-deadline">Deadline (optional)</label>
                    <input
                      id="ct-deadline"
                      type="date"
                      value={createDeadline}
                      onChange={(e) => setCreateDeadline(e.target.value)}
                    />
                  </div>
                </div>
                <div className="px-0 py-4 border-t border-brand-border flex gap-3 justify-end">
                  <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createTaskMutation.isPending}>
                    {createTaskMutation.isPending ? 'Creating…' : 'Create Task'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Task Modal */}
      {editModal && (
        <div
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditModal(null)
          }}
        >
          <div
            role="dialog"
            aria-labelledby="edit-dialog-title"
            className="bg-surface rounded-xl shadow-lg max-w-150 w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 id="edit-dialog-title">Edit Quick Task</h2>
            </div>
            <div className="p-6">
              <form onSubmit={(e) => editTask(e, editModal)}>
                <div className="mb-5">
                  <label htmlFor="et-title">Title</label>
                  <input
                    id="et-title"
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="mb-5">
                  <label htmlFor="et-desc">Description</label>
                  <textarea
                    id="et-desc"
                    rows={4}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div>
                    <FilterDropdown
                      id="et-skill"
                      label="Skill Being Tested"
                      ariaLabel="Skill Being Tested"
                      value={editSkillId}
                      options={[
                        { value: '', label: 'None specific' },
                        ...skills.map((s) => ({
                          value: String(s.id),
                          label: `${s.name} (${s.categoryName})`,
                        })),
                      ]}
                      onChange={(v) => setEditSkillId(v)}
                      searchable
                    />
                  </div>
                  <div>
                    <label htmlFor="et-hours">Estimated Hours</label>
                    <input
                      id="et-hours"
                      type="number"
                      min="0.5"
                      max="20"
                      step="0.5"
                      value={editHours}
                      onChange={(e) => setEditHours(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="et-deadline">Deadline (optional)</label>
                    <input
                      id="et-deadline"
                      type="date"
                      value={editDeadline}
                      onChange={(e) => setEditDeadline(e.target.value)}
                    />
                  </div>
                </div>
                <div className="px-0 py-4 border-t border-brand-border flex gap-3 justify-end">
                  <Button type="button" variant="secondary" onClick={() => setEditModal(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={editTaskMutation.isPending}>
                    {editTaskMutation.isPending ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {reviewModal !== null && (
        <QuickTaskReviewDialog task={reviewModal} onClose={() => setReviewModal(null)} />
      )}

      {deleteTarget && (
        <ConfirmDialog
          id="confirm-delete-quick-task"
          isOpen
          title="Delete this task?"
          body={`"${deleteTarget.title}" and its comments are removed for everyone. This cannot be undone.`}
          confirmLabel="Delete task"
          busyLabel="Deleting…"
          danger
          busy={deleteTaskMutation.isPending}
          onConfirm={() => {
            deleteTaskMutation.mutate({ id: deleteTarget.id })
            setDeleteTarget(null)
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}
