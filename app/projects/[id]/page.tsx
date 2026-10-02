'use client'

import React, { use, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRequireConfirmed } from '@/lib/hooks/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import Checkbox from '@/components/Checkbox'
import DatesBlock from '@/components/DatesBlock'
import { plural } from '@/lib/plural'
import { isOverdue as deadlinePassed } from '@/lib/overdue'
import { KEY_DATE_SIDE_LABELS, bySide, keyDateSides } from '@/lib/key-date'
import { EMPTY_DATES, datesPayload, datesValueFrom, type DatesValue } from '@/lib/task-dates'
import { Badge } from '@/components/Badge'
import Tooltip from '@/components/Tooltip'
import { projectStatusVariant } from '@/components/ProjectCard'
import { INTEREST_STATUS_LABELS, interestHistoryLabel } from '@/lib/status-labels'
import {
  interestSentMessage,
  PROJECT_TASK_CLAIMED_MESSAGE,
  TASK_REQUESTED_MESSAGE,
  VOLUNTEER_ADDED_MESSAGE,
  INTEREST_WITHDRAWN_MESSAGE,
  INTEREST_ACCEPTED_MESSAGE,
  INTEREST_DECLINED_MESSAGE,
  volunteerRemovedMessage,
} from '@/lib/action-messages'
import CommentThread from '@/components/CommentThread'
import ChangesRequestedBanner from '@/components/ChangesRequestedBanner'
import ProjectInviteBanner from '@/components/ProjectInviteBanner'
import StatusSplitButton from '@/components/StatusSplitButton'
import MessageDialog from '@/components/MessageDialog'
import Linkify from '@/components/Linkify'
import SubmitWorkButton from '@/components/SubmitWorkButton'
import { awaitsOwnerReview } from '@/lib/task-review'
import { isHttpUrl } from '@/lib/schemas'
import { TASK_STATUS_LABELS, TASK_STATUS_VARIANTS } from '@/lib/status-labels'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import FilterDropdown, { useFilterOptions } from '@/components/FilterDropdown'
import VolunteerSelect from '@/components/VolunteerSelect'
import Tabs from '@/components/Tabs'
import GanttChart from '@/components/gantt/GanttChart'
import type { GanttRow as GanttRowData } from '@/components/gantt/types'
import GanttItemPanel from '@/components/gantt/GanttItemPanel'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate, formatDateShort } from '@/lib/format-date'
import BaselineDialog from '@/components/gantt/BaselineDialog'
import ReplanDialog from '@/components/ReplanDialog'
import { PlanningTools } from '@/components/gantt/GanttLegend'
import ProjectPorting from '@/components/ProjectPorting'
import SaveAsTemplateButton from '@/components/SaveAsTemplateButton'
import { scheduleWithPatches } from '@/components/gantt/optimistic'
import { startOfUtcDay } from '@/lib/schedule'
import { projectLocationParts } from '@/lib/filter-options'
import {
  ADMIN_ONLY_STATUSES,
  OWNER_ALLOWED_STATUSES,
  TERMINAL_STATUSES,
  UNAPPROVED_STATUSES,
  projectStatusLabel,
  proposerDisplay,
} from '@/lib/project-status'
import { InterestStatus, ProjectStatus, TaskStatus } from '@/generated/prisma/enums'
import type { InferRouterOutputs } from '@orpc/server'
import type { AppRouter } from '@/server/router'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import PageLoading from '@/components/PageLoading'

// ── Types ────────────────────────────────────────────────────────────────────

type ProjectTask = InferRouterOutputs<AppRouter>['projects']['getById']['tasks'][number]

// Both lists come from lib/project-status.ts, which the server's permission check reads
// too — they used to be hand-synced copies.
const toOptions = (statuses: string[]) =>
  statuses.map((value) => ({ value, label: projectStatusLabel(value) }))
const OWNER_STATUSES = toOptions(OWNER_ALLOWED_STATUSES)
const ADMIN_EXTRA_STATUSES = toOptions(ADMIN_ONLY_STATUSES)

// ── Tailwind class constants ──────────────────────────────────────────────────

const card = 'bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word'

// ── Task list item ──────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

function TaskAvatar({ name }: { name: string | null }) {
  if (!name) {
    return (
      <span
        aria-label="Unassigned"
        title="Unassigned"
        className="w-6 h-6 rounded-full border border-dashed border-brand-border shrink-0"
      />
    )
  }

  return (
    <Tooltip content={name}>
      <span
        aria-label={`Assigned to ${name}`}
        className="w-6 h-6 rounded-full bg-secondary text-white text-xs font-semibold flex items-center justify-center shrink-0"
      >
        {initials(name)}
      </span>
    </Tooltip>
  )
}

function ActionMenu({
  ariaLabel,
  children,
}: {
  ariaLabel: string
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node
      // A nested FilterDropdown's listbox portals to document.body too, so a
      // click on one of its options looks like an outside click — ignore it.
      if (target instanceof Element && target.closest('[role="listbox"]')) return
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className="inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = triggerRef.current!.getBoundingClientRect()
          setPos({ top: r.bottom + window.scrollY + 6, left: r.right + window.scrollX - 256 })
          setOpen((o) => !o)
        }}
        title={ariaLabel}
        className="w-7 h-7 flex items-center justify-center rounded-md text-base font-bold text-brand-text bg-brand-bg hover:bg-brand-border transition-colors cursor-pointer"
      >
        ⋯
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{
              position: 'absolute',
              top: pos.top,
              left: pos.left,
              width: 256,
              zIndex: 9999,
            }}
            className="bg-surface border border-brand-border rounded-lg shadow-lg py-2"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  )
}

function SortableTaskItem({
  task,
  draggable,
  title,
  chips,
  assigneeName,
  primaryAction,
  menu,
}: {
  task: ProjectTask
  draggable: boolean
  title: React.ReactNode
  chips: React.ReactNode
  assigneeName: string | null
  primaryAction: React.ReactNode
  menu: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })
  return (
    <li
      ref={setNodeRef}
      className="group flex items-start gap-2 py-2 border-b border-brand-border last:border-0"
      style={{
        // dynamic: drag transform/transition/opacity
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <span
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
        className={`w-4 shrink-0 leading-none text-text-light text-center text-base mt-1 ${draggable ? 'cursor-grab' : ''}`}
        title={draggable ? 'Drag to reorder' : undefined}
        aria-label={draggable ? `Drag to reorder ${task.title}` : undefined}
      >
        {draggable ? '⠿' : ''}
      </span>
      <span className="flex-1 min-w-0 break-words">{title}</span>
      <div className="flex items-center gap-2 shrink-0 mt-1">
        {chips}
        {primaryAction}
        <TaskAvatar name={assigneeName} />
        {menu && (
          <div className="opacity-60 group-hover:opacity-100 focus-within:opacity-100 has-aria-expanded:opacity-100 transition-opacity">
            {menu}
          </div>
        )}
      </div>
    </li>
  )
}

type TimelineData = InferRouterOutputs<AppRouter>['projects']['listTasks']

/**
 * The Timeline tab. Splits the project's tasks into those placed on the calendar and those
 * still unscheduled (no dates, no predecessor): the first render as a draggable Gantt chart,
 * the rest as a tray. Clicking a bar opens a panel with the same edits, for keyboard users.
 */
function TaskTimeline({
  timeline,
  projectId,
  loading,
  canAssignTasks,
  canClaimTasks,
  assignOptions,
  onAssignTask,
  onClaimTask,
  onUnassignTask,
  highlightCritical,
}: {
  timeline: TimelineData | undefined
  projectId: number
  loading: boolean
  canAssignTasks: boolean
  canClaimTasks: boolean
  assignOptions: { value: string; label: string; header?: boolean }[]
  onAssignTask: (taskId: number, volunteerId: number) => void
  onClaimTask: (taskId: number) => void
  onUnassignTask: (taskId: number) => void
  highlightCritical: boolean
}) {
  const queryClient = useQueryClient()
  const showToast = useToast()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [replanId, setReplanId] = useState<number | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.projects.listTasks.key() })

  const onErr = (verb: string) => (err: unknown) =>
    showToast(err instanceof Error ? err.message : `Failed to ${verb}`, 'error')

  // The exact key the timeline query writes to, so the optimistic patch lands on the same entry.
  const timelineKey = orpc.projects.listTasks.queryOptions({ input: { projectId } }).queryKey

  const reschedule = useMutation({
    ...orpc.schedule.rescheduleItems.mutationOptions(),
    // Place the drag immediately, using the same scheduler the server will run. Without this the
    // bar snaps back the instant the pointer is released and only jumps forward on the refetch.
    onMutate: async (vars: {
      items: { id: number; startDate: Date | null; durationDays?: number | null }[]
    }) => {
      await queryClient.cancelQueries({ queryKey: timelineKey })
      const previous = queryClient.getQueryData<TimelineData>(timelineKey)
      if (!previous) return { previous }

      const patched = previous.tasks.map((t) => {
        const patch = vars.items.find((i) => i.id === t.id)
        if (!patch) return t
        return {
          ...t,
          startDate: patch.startDate,
          ...(patch.durationDays !== undefined ? { durationDays: patch.durationDays } : {}),
        }
      })
      const scheduled = scheduleWithPatches(
        previous.tasks,
        previous.dependencies,
        previous.scopeOrigin,
        vars.items,
      )
      const starts = scheduled.map((s) => s.start.getTime())
      const ends = scheduled.map((s) => s.end.getTime())

      queryClient.setQueryData<TimelineData>(timelineKey, {
        ...previous,
        tasks: patched,
        scheduled,
        // The axis has to grow with a bar dragged past either end of the old scope.
        scopeStart: new Date(Math.min(...starts, new Date(previous.scopeOrigin).getTime())),
        scopeEnd: new Date(Math.max(...ends)),
      } as TimelineData)

      return { previous }
    },
    onError: (err: unknown, _vars, context) => {
      // The server refused the move, so the bar belongs back where it was.
      if (context?.previous) queryClient.setQueryData(timelineKey, context.previous)
      onErr('reschedule')(err)
    },
    onSettled: () => void invalidate(),
  })
  const addDep = useMutation({
    ...orpc.dependencies.add.mutationOptions(),
    onSuccess: () => {
      showToast('Dependency added', 'success')
      void invalidate()
    },
    onError: onErr('add dependency'),
  })
  const removeDep = useMutation({
    ...orpc.dependencies.remove.mutationOptions(),
    onSuccess: () => void invalidate(),
    onError: onErr('remove dependency'),
  })
  const updateLag = useMutation({
    ...orpc.dependencies.updateLag.mutationOptions(),
    onSuccess: () => void invalidate(),
    onError: onErr('update lag'),
  })
  const updateTask = useMutation({
    ...orpc.projects.updateTask.mutationOptions(),
    onSuccess: () => void invalidate(),
    onError: onErr('update the task'),
  })

  if (loading || !timeline) {
    return <p className="text-text-light">Loading timeline…</p>
  }
  if (timeline.tasks.length === 0) {
    return <p className="text-text-light">No tasks yet.</p>
  }

  const canManage = timeline.canManageTasks
  const placementById = new Map(timeline.scheduled.map((p) => [p.id, p]))
  const hasPredecessor = new Set(timeline.dependencies.map((d) => d.successorId))
  const titleById = new Map(timeline.tasks.map((t) => [t.id, t.title]))

  const scheduledRows: GanttRowData[] = []
  const unscheduled: { id: number; title: string }[] = []
  for (const task of timeline.tasks) {
    const isUnscheduled =
      task.startDate === null && task.durationDays === null && !hasPredecessor.has(task.id)
    const placement = placementById.get(task.id)
    if (isUnscheduled || !placement) {
      unscheduled.push({ id: task.id, title: task.title })
    } else {
      scheduledRows.push({
        id: task.id,
        label: task.title,
        href: `/projects/${projectId}/tasks/${task.id}`,
        status: task.status,
        placement,
        timing: task.timing,
        effortHours: task.estimatedHours,
      })
    }
  }

  const selectedRow = scheduledRows.find((r) => r.id === selectedId) ?? null
  const selectedTask = selectedRow
    ? (timeline.tasks.find((t) => t.id === selectedRow.id) ?? null)
    : null
  /**
   * An unscheduled task has no bar, so there is nothing to drag — this is the way onto the
   * chart. It lands as a one-day bar at the start of the plan rather than anywhere cleverer:
   * a guessed duration looks like a decision someone made, and stacking them all on the same
   * day makes it obvious they still need placing.
   */
  function addToTimeline(ids: number[]) {
    const start = startOfUtcDay(new Date(timeline!.scopeOrigin))
    reschedule.mutate({ items: ids.map((id) => ({ id, startDate: start, durationDays: 1 })) })
  }

  function addAllToTimeline() {
    addToTimeline(unscheduled.map((t) => t.id))
  }

  const busy =
    reschedule.isPending ||
    addDep.isPending ||
    removeDep.isPending ||
    updateLag.isPending ||
    updateTask.isPending

  return (
    <div>
      {scheduledRows.length === 0 ? (
        <p className="text-text-light mb-4">
          No tasks have dates yet. Add them to the timeline below, then drag each bar to when it
          happens — or set a start date on an individual task from its own page.
        </p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <GanttChart
              rows={bySide(scheduledRows, keyDateSides(timeline.tasks, timeline.dependencies))}
              edges={timeline.dependencies}
              rangeStart={new Date(timeline.scopeStart)}
              rangeEnd={new Date(timeline.scopeEnd)}
              deadline={timeline.projectDeadline ? new Date(timeline.projectDeadline) : null}
              highlightCritical={highlightCritical}
              editable={canManage}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
              onReschedule={(patch) =>
                reschedule.mutate({
                  items: [
                    {
                      id: patch.id,
                      startDate: patch.startDate,
                      ...(patch.durationDays !== undefined
                        ? { durationDays: patch.durationDays }
                        : {}),
                    },
                  ],
                })
              }
              onLink={(predecessorId, successorId) =>
                addDep.mutate({ predecessorId, successorId, lagDays: 0 })
              }
              onUnlink={(dependencyId) => removeDep.mutate({ dependencyId })}
              busy={busy}
            />
          </div>

          {/* Sticky so the panel stays beside the bars on a long chart rather than scrolling off
              the top; it gets its own scrollbar if the contents outgrow the viewport. */}
          {selectedRow && selectedTask && (
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-96 lg:shrink-0 lg:self-start lg:overflow-y-auto">
              <GanttItemPanel
                row={selectedRow}
                dates={datesValueFrom(selectedTask)}
                description={selectedTask.description}
                assigneeName={selectedTask.assignedToName}
                canManage={canManage}
                busy={busy}
                siblings={timeline.tasks.map((t) => ({ id: t.id, title: t.title }))}
                predecessors={timeline.dependencies
                  .filter((d) => d.successorId === selectedRow.id)
                  .map((d) => ({
                    dependencyId: d.id,
                    predecessorId: d.predecessorId,
                    predecessorTitle: titleById.get(d.predecessorId) ?? `#${d.predecessorId}`,
                    lagDays: d.lagDays,
                  }))}
                onClose={() => setSelectedId(null)}
                onSaveDates={(p) => {
                  reschedule.mutate({
                    items: [
                      { id: selectedRow.id, startDate: p.startDate, durationDays: p.durationDays },
                    ],
                  })
                  // The rest is not schedule, so it goes by the ordinary task update, and only
                  // when something there changed.
                  const was = datesPayload(datesValueFrom(selectedTask))
                  if (
                    p.timing !== was.timing ||
                    p.estimatedHours !== was.estimatedHours ||
                    p.deadline?.getTime() !== was.deadline?.getTime()
                  ) {
                    updateTask.mutate({
                      projectId,
                      taskId: selectedRow.id,
                      data: {
                        timing: p.timing,
                        estimatedHours: p.estimatedHours,
                        deadline: p.deadline,
                      },
                    })
                  }
                }}
                onAddDependency={(predecessorId, lagDays) =>
                  addDep.mutate({ predecessorId, successorId: selectedRow.id, lagDays })
                }
                onRemoveDependency={(dependencyId) => removeDep.mutate({ dependencyId })}
                onUpdateLag={(dependencyId, lagDays) => updateLag.mutate({ dependencyId, lagDays })}
                onSetAnchor={
                  timeline.canSetKeyDate
                    ? (isAnchor) =>
                        updateTask.mutate(
                          { projectId, taskId: selectedRow.id, data: { isAnchor } },
                          {
                            onSuccess: () =>
                              showToast(
                                isAnchor ? 'This is now the key date.' : 'No longer the key date.',
                                'success',
                              ),
                          },
                        )
                    : undefined
                }
                onReplan={canManage ? () => setReplanId(selectedRow.id) : undefined}
                assignment={{
                  canAssign: canAssignTasks,
                  // Claiming is only offered while the task is genuinely free.
                  canClaim: canClaimTasks && selectedTask.assignedToId === null,
                  options: assignOptions,
                  onAssign: (volunteerId) => onAssignTask(selectedRow.id, volunteerId),
                  onClaim: () => onClaimTask(selectedRow.id),
                  onUnassign: () => onUnassignTask(selectedRow.id),
                }}
              />
            </div>
          )}
        </div>
      )}
      {replanId !== null &&
        (() => {
          const task = timeline.tasks.find((t) => t.id === replanId)
          const placed = scheduledRows.find((r) => r.id === replanId)
          return task && placed ? (
            <ReplanDialog
              projectId={projectId}
              taskId={replanId}
              taskTitle={task.title}
              plannedEnd={placed.placement.end}
              deadline={task.deadline ? new Date(task.deadline) : null}
              onClose={() => setReplanId(null)}
            />
          ) : null
        })()}

      {unscheduled.length > 0 && (
        <section
          aria-labelledby="unscheduled-tasks"
          className="border-brand-border mt-4 rounded-lg border border-dashed p-3"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 id="unscheduled-tasks" className="m-0 text-sm font-medium">
              Unscheduled ({unscheduled.length})
            </h3>
            {canManage && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={addAllToTimeline}
                title="Adds a one-day bar for each task, all starting on the first day of the plan. Spread them out or link them afterwards."
              >
                Add all to timeline
              </Button>
            )}
          </div>
          <p className="text-text-light mt-0 mb-2 text-xs">
            {canManage
              ? 'Adding a task puts a one-day bar on the first day of the plan and sets that as its start date. Drag it to when it happens, drag its edge to set how long it takes, and drag the circle at its end onto whatever follows it.'
              : 'These tasks have no dates yet, so they are not on the timeline.'}
          </p>
          <ul className="m-0 flex flex-wrap gap-2 p-0">
            {unscheduled.map((t) => (
              <li
                key={t.id}
                className="border-brand-border bg-brand-bg flex items-center gap-1 rounded border px-2 py-1 text-sm"
              >
                <Link href={`/projects/${projectId}/tasks/${t.id}`} className="hover:underline">
                  {t.title}
                </Link>
                {canManage && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addToTimeline([t.id])}
                    aria-label={`Add ${t.title} to the timeline`}
                    title="Adds a one-day bar starting on the first day of the plan; drag it or edit its dates to change that."
                    className="text-primary-text ml-1 rounded px-1 leading-none hover:underline"
                  >
                    + Add
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

type ProjectTab = 'overview' | 'tasks' | 'timeline' | 'discussion' | 'people'
const SIDEBAR_PEOPLE = 5
const HASH_TABS: ProjectTab[] = ['tasks', 'timeline', 'discussion', 'people']
/**
 * This many tasks past plan at once is a plan nobody laid out ("Add all to timeline" and
 * never dragged), not this many people running late, so the list says so above the badges.
 */
const STALE_PLAN_FROM = 5

// ── Component ─────────────────────────────────────────────────────────────────

type DeputyAction = { kind: 'appoint' | 'remove' | 'step_down'; volunteerId: number; name: string }

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = use(params)
  const router = useRouter()
  const { user, loading } = useRequireConfirmed()
  const queryClient = useQueryClient()

  const showToast = useToast()

  // Task section
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskDates, setNewTaskDates] = useState<DatesValue>(EMPTY_DATES)
  const [highlightCritical, setHighlightCritical] = useState(false)
  const [newTaskFeatured, setNewTaskFeatured] = useState(false)
  const [orderedTasks, setOrderedTasks] = useState<ProjectTask[]>([])
  const [tab, setTab] = useState<ProjectTab>('overview')

  /**
   * The open tab lives in the URL hash, so `#timeline` or `#discussion` is a shareable link
   * straight to it and the browser's Back button steps between tabs. The hash is read after
   * mount rather than in the initial state, because the server render cannot see it.
   */
  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash.slice(1)
      setTab(HASH_TABS.find((t) => t === hash) ?? 'overview')
    }
    readHash()
    window.addEventListener('popstate', readHash)
    window.addEventListener('hashchange', readHash)
    return () => {
      window.removeEventListener('popstate', readHash)
      window.removeEventListener('hashchange', readHash)
    }
  }, [])

  function selectTab(next: ProjectTab) {
    if (next === tab) return
    setTab(next)
    // pushState rather than assigning location.hash: it adds the history entry without the
    // browser trying to scroll to an element of that name.
    const url =
      next === 'overview' ? `${window.location.pathname}${window.location.search}` : `#${next}`
    window.history.pushState(null, '', url)
  }
  const [taskAssignSelections, setTaskAssignSelections] = useState<Record<number, string>>({})
  const [showBaselineDialog, setShowBaselineDialog] = useState(false)
  const [showPorting, setShowPorting] = useState(false)
  const taskDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // Status section
  const [newStatus, setNewStatus] = useState('')
  const [pendingStatus, setPendingStatus] = useState<string | null>(null)

  // Interest section
  const [interestType, setInterestType] = useState('want_to_contribute')
  const [interestMessage, setInterestMessage] = useState('')

  // Transfer ownership
  const [transferTo, setTransferTo] = useState('')

  // Direct assign
  const [assignTo, setAssignTo] = useState('')
  const [inviteNote, setInviteNote] = useState('')

  // Record outcome
  const {
    value: outcomeValue,
    onChange: setOutcomeValue,
    options: outcomeOptions,
  } = useFilterOptions(
    [
      { value: '', label: '— Select outcome —' },
      { value: 'successful', label: 'Successful' },
      { value: 'partial', label: 'Partial' },
      { value: 'not_completed', label: 'Not Completed' },
      { value: 'ongoing', label: 'Ongoing' },
    ],
    '',
  )
  const [outcomeNotes, setOutcomeNotes] = useState('')

  // Review (triage)
  const [reviewStatus, setReviewStatus] = useState('approved')
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewDone, setReviewDone] = useState(false)

  // Contact owner
  const [showContactModal, setShowContactModal] = useState(false)

  // Decline interest
  // Declining a request and removing an accepted helper share one dialog and one status.
  const [declineTarget, setDeclineTarget] = useState<{
    id: number
    name: string
    accepted: boolean
  } | null>(null)
  const [declineMessage, setDeclineMessage] = useState('')

  // Confirmations
  const [deleteTaskId, setDeleteTaskId] = useState<number | null>(null)
  const [withdrawAccepted, setWithdrawAccepted] = useState<boolean | null>(null)
  const [deputyAction, setDeputyAction] = useState<DeputyAction | null>(null)
  const [showJoin, setShowJoin] = useState(false)
  const [showTransferConfirm, setShowTransferConfirm] = useState(false)
  const [showRemoveOwnerConfirm, setShowRemoveOwnerConfirm] = useState(false)

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: projectRaw, isPending: loadingProject } = useQuery({
    ...orpc.projects.getById.queryOptions({ input: { id: parseInt(idParam, 10) } }),
    enabled: !!user,
  })
  const project = projectRaw
  const canClaimTasks = project?.canClaimTasks ?? false

  // Only loaded once the Timeline tab is opened — it carries the computed schedule and the
  // dependency edges the List view doesn't need.
  const { data: timeline } = useQuery({
    ...orpc.projects.listTasks.queryOptions({ input: { projectId: parseInt(idParam, 10) } }),
    enabled: !!user && !!project && tab === 'timeline',
  })

  const setBaselineMutation = useMutation({
    ...orpc.projects.setBaseline.mutationOptions(),
    onSuccess: () => {
      showToast('Original plan updated', 'success')
      setShowBaselineDialog(false)
      void queryClient.invalidateQueries({ queryKey: orpc.projects.listTasks.key() })
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to update the original plan', 'error'),
  })

  // The most recent baseline capture across the project's tasks — null until one is set.
  const baselineSetAt = (timeline?.tasks ?? []).reduce<Date | null>((latest, t) => {
    if (!t.baselineSetAt) return latest
    const at = new Date(t.baselineSetAt)
    return latest === null || at.getTime() > latest.getTime() ? at : latest
  }, null)
  const datedTaskCount = (timeline?.tasks ?? []).filter(
    (t) => t.startDate !== null || t.durationDays !== null,
  ).length

  // Sync orderedTasks when project data loads/changes. Rows already on screen keep their
  // place, so a task that changes status does not slide under the cursor (the server puts
  // finished tasks last); new tasks are added at the end and the next load uses server order.
  useEffect(() => {
    if (project?.tasks) {
      const fresh = new Map(project.tasks.map((t) => [t.id, t]))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrderedTasks((current) => {
        const kept = current.flatMap((t) => fresh.get(t.id) ?? [])
        const seen = new Set(kept.map((t) => t.id))
        return [...kept, ...project.tasks.filter((t) => !seen.has(t.id))]
      })
    }
  }, [project?.tasks])

  // Sync newStatus when project data first loads
  useEffect(() => {
    if (project?.status) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewStatus(project.status)
    }
  }, [project?.status])

  // Redirect to the project list if project not found
  useEffect(() => {
    if (!loadingProject && !project && user) {
      router.replace('/projects')
    }
  }, [loadingProject, project, user, router])

  // A draft has no read-only view of its own — everything happens on its edit page.
  useEffect(() => {
    if (project?.status === 'draft') {
      router.replace(`/projects/${idParam}/edit`)
    }
  }, [project?.status, idParam, router])

  const { data: volunteersData } = useQuery({
    ...orpc.volunteers.list.queryOptions({ input: { limit: 100 } }),
    enabled: !!project && (!!user?.isAdmin || project.ownerId === user?.id || project.isDeputy),
  })
  const volunteers = volunteersData?.volunteers ?? []

  const ownerId = project?.ownerId ?? null
  const { data: ownerContact } = useQuery({
    ...orpc.volunteers.getById.queryOptions({ input: { id: ownerId ?? 0 } }),
    enabled: ownerId !== null && showContactModal,
  })

  // ── Mutations ────────────────────────────────────────────────────────────

  // Task writes change both the list view (getById) and the timeline (listTasks); the panel
  // on the Timeline tab reads assignment from the latter, so both are refreshed together.
  // Who may post depends on being an accepted helper, so the comment lists refresh with the
  // project whenever interest or assignment changes.
  const invalidateProject = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.projects.listTasks.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.workItemComments.list.key() }),
    ])

  const createTaskMutation = useMutation({
    ...orpc.projects.createTask.mutationOptions(),
    onSuccess: () => {
      setNewTaskTitle('')
      setNewTaskDescription('')
      setNewTaskDates(EMPTY_DATES)
      setNewTaskFeatured(false)
      setShowTaskForm(false)
      showToast('Task added!', 'success')
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to add task', 'error'),
  })

  const updateTaskMutation = useMutation({
    ...orpc.projects.updateTask.mutationOptions(),
    onSuccess: (data, variables) => {
      if (data.requested) {
        showToast(TASK_REQUESTED_MESSAGE, 'success')
      } else if (variables.data.status === TaskStatus.in_progress) {
        showToast(PROJECT_TASK_CLAIMED_MESSAGE, 'success')
      } else if (variables.data.status === TaskStatus.open) {
        showToast('Task unassigned!', 'success')
      }
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to update task', 'error'),
  })

  const deleteTaskMutation = useMutation({
    ...orpc.projects.deleteTask.mutationOptions(),
    onSuccess: () => {
      showToast('Task deleted!', 'success')
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to delete task', 'error'),
  })

  const reorderTasksMutation = useMutation({
    ...orpc.projects.reorderTasks.mutationOptions(),
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to reorder tasks', 'error')
      void invalidateProject()
    },
  })

  const assignTaskMutation = useMutation({
    ...orpc.projects.assignTask.mutationOptions(),
    onSuccess: (_data, variables) => {
      showToast('Task assigned!', 'success')
      setTaskAssignSelections((s) => {
        const next = { ...s }
        delete next[variables.taskId]
        return next
      })
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to assign task', 'error'),
  })

  const updateProjectMutation = useMutation({
    ...orpc.projects.update.mutationOptions(),
    onSuccess: (_data, variables) => {
      if ('status' in variables) {
        showToast('Status updated!', 'success')
      } else {
        showToast('Ownership transferred!', 'success')
      }
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to update project', 'error'),
  })

  const expressInterestMutation = useMutation({
    ...orpc.projects.expressInterest.mutationOptions(),
    onSuccess: () => {
      showToast(interestSentMessage(projectRaw?.owner?.name ?? null), 'success')
      setShowJoin(false)
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to express interest', 'error'),
  })

  const withdrawInterestMutation = useMutation({
    ...orpc.projects.withdrawInterest.mutationOptions(),
    onSuccess: () => {
      showToast(INTEREST_WITHDRAWN_MESSAGE, 'success')
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to withdraw interest', 'error'),
  })

  const respondToInterestMutation = useMutation({
    ...orpc.projects.respondToInterest.mutationOptions(),
    onSuccess: (_data, variables) => {
      showToast(
        variables.status === InterestStatus.accepted
          ? INTEREST_ACCEPTED_MESSAGE
          : declineTarget?.accepted
            ? volunteerRemovedMessage(declineTarget.name)
            : INTEREST_DECLINED_MESSAGE,
        'success',
      )
      setDeclineTarget(null)
      setDeclineMessage('')
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to respond to interest', 'error'),
  })

  const assignMutation = useMutation({
    ...orpc.projects.assign.mutationOptions(),
    onSuccess: () => {
      showToast(VOLUNTEER_ADDED_MESSAGE, 'success')
      setAssignTo('')
      setInviteNote('')
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to assign volunteer', 'error'),
  })

  const inviteMutation = useMutation({
    ...orpc.projects.invite.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      setAssignTo('')
      setInviteNote('')
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to send the invite', 'error'),
  })

  const cancelInviteMutation = useMutation({
    ...orpc.projects.cancelInvite.mutationOptions(),
    onSuccess: () => {
      showToast('Invite cancelled.', 'success')
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to cancel the invite', 'error'),
  })

  const deputyResult = {
    onSuccess: (data: { message: string }) => {
      showToast(data.message, 'success')
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to change the deputy', 'error'),
  }
  const appointDeputyMutation = useMutation({
    ...orpc.projects.appointDeputy.mutationOptions(),
    ...deputyResult,
  })
  const removeDeputyMutation = useMutation({
    ...orpc.projects.removeDeputy.mutationOptions(),
    ...deputyResult,
  })
  const stepDownMutation = useMutation({
    ...orpc.projects.stepDownAsDeputy.mutationOptions(),
    ...deputyResult,
  })

  const setOutcomeMutation = useMutation({
    ...orpc.admin.projects.setOutcome.mutationOptions(),
    onSuccess: () => {
      showToast('Outcome recorded!', 'success')
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to record outcome', 'error'),
  })

  const reviewMutation = useMutation({
    ...orpc.admin.projects.review.mutationOptions(),
    onSuccess: (_data, variables) => {
      showToast(
        variables.status === 'approved' ? 'Project approved!' : 'Changes requested.',
        'success',
      )
      setReviewDone(true)
      void invalidateProject()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to submit review', 'error'),
  })

  // ── Handlers ─────────────────────────────────────────────────────────────

  if (loading || !user) return <PageLoading />
  if (loadingProject) {
    return (
      <>
        <main className="container py-5 pb-15">
          <div className="text-center py-10 text-text-light">Loading project…</div>
        </main>
      </>
    )
  }
  if (!project) return null
  if (project.status === 'draft') return null

  const isOwner = project.ownerId !== null && project.ownerId === user.id
  const isAdmin = user.isAdmin
  // Org-proposed projects are attributed to the org, not to the admin who filed them.
  const proposer = proposerDisplay(project)
  const isOwnerOrAdmin = isOwner || isAdmin
  const isDeputy = project.isDeputy
  // A deputy runs the project's tasks and nothing else about it.
  const canRunTasks = isOwnerOrAdmin || isDeputy
  // A draft has no owner yet, so its creator manages its own tasks until they publish it.
  const isDraftCreator = project.status === 'draft' && project.proposedById === user.id
  const canManageProject = isOwnerOrAdmin || isDraftCreator
  const canManageTasks = canRunTasks || isDraftCreator
  const deputyIds = new Set(
    (project.helpers ?? []).filter((h) => h.isDeputy).map((h) => h.volunteerId),
  )
  // Members (accepted helpers / team members) may add tasks even though they can't manage
  // the project's schedule/baseline — server-computed in getById, see canCreateProjectTask.
  const canCreateTasks = canManageTasks || project.canCreateTasks

  // Turning down or losing an invite leaves the way open to apply.
  const canApplyAgain =
    project.myInterest?.origin === 'invited' &&
    (project.myInterest.status === InterestStatus.declined ||
      project.myInterest.status === InterestStatus.cancelled)

  const canSeeInterest =
    !isOwnerOrAdmin &&
    (project.isSeekingHelp || project.isSeekingOwner) &&
    !TERMINAL_STATUSES.includes(project.status)

  // Until an admin approves it, a proposal's status is the admins' to change.
  const canPickStatus = isAdmin || (isOwner && !UNAPPROVED_STATUSES.includes(project.status))
  const pickableStatuses = isAdmin ? [...OWNER_STATUSES, ...ADMIN_EXTRA_STATUSES] : OWNER_STATUSES
  // Every status is pickable by someone now, but an owner viewing a project an admin put
  // into an admin-only status still needs the control to show its real current value.
  const statusOptions = pickableStatuses.some((o) => o.value === project.status)
    ? pickableStatuses
    : [{ value: project.status, label: projectStatusLabel(project.status) }, ...pickableStatuses]
  // newStatus is synced from the project in an effect, so it is empty for the first render.
  const shownStatus = newStatus || project.status

  // Excludes the current owner — they're already shown in the Owner box above.
  const volunteerInterests = (project.interests ?? []).filter(
    (i) => i.volunteerId !== project.ownerId,
  )
  const interestedVolunteers = volunteerInterests.filter(
    (i) => i.status === InterestStatus.pending || i.status === InterestStatus.accepted,
  )
  const peopleGroups = [
    {
      key: 'requested',
      title: 'Requested',
      rows: volunteerInterests.filter((i) => i.status === InterestStatus.pending),
    },
    {
      key: 'invited',
      title: 'Invited',
      rows: volunteerInterests.filter((i) => i.status === InterestStatus.invited),
    },
    {
      key: 'helpers',
      title: 'Helpers',
      rows: volunteerInterests.filter((i) => i.status === InterestStatus.accepted),
    },
  ]
  const pastPeople = volunteerInterests.filter((i) => !peopleGroups.some((g) => g.rows.includes(i)))
  const renderPerson = (interest: (typeof volunteerInterests)[number]) => (
    // [test hook] interest-card class used as test selector
    <li
      key={interest.id}
      className="interest-card flex items-center gap-2 py-2 border-b border-brand-border last:border-0 flex-wrap"
    >
      <TaskAvatar name={interest.volunteerName} />
      <div className="flex-1 min-w-0">
        {isAdmin || interestedVolunteerIds.has(interest.volunteerId) ? (
          <Link href={`/volunteers/${interest.volunteerId}`} className="underline truncate block">
            {interest.volunteerName}
          </Link>
        ) : (
          <div className="truncate">{interest.volunteerName}</div>
        )}
        <div className="text-text-light text-xs">
          {interest.status === InterestStatus.accepted
            ? interest.interestType === 'want_to_own'
              ? 'Owner'
              : deputyIds.has(interest.volunteerId)
                ? 'Deputy'
                : 'Helper'
            : interest.status === InterestStatus.pending
              ? interest.interestType === 'want_to_own'
                ? 'wants to own'
                : 'wants to help'
              : interest.status === InterestStatus.invited
                ? `Invited${interest.invitedByName ? ` by ${interest.invitedByName}` : ''}`
                : interestHistoryLabel(interest.origin, interest.status)}
        </div>
      </div>
      {interest.status === InterestStatus.pending ? (
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={() => handleAcceptInterest(interest.id)}>
            Accept
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleDeclineInterest(interest.id, interest.volunteerName, false)}
          >
            Decline
          </Button>
        </div>
      ) : interest.status === InterestStatus.accepted ? (
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={projectStatusVariant(interest.status)}>
            {INTEREST_STATUS_LABELS[interest.status] ?? interest.status}
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setDeputyAction({
                kind: deputyIds.has(interest.volunteerId) ? 'remove' : 'appoint',
                volunteerId: interest.volunteerId,
                name: interest.volunteerName,
              })
            }
          >
            {deputyIds.has(interest.volunteerId) ? 'Remove deputy' : 'Make deputy'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleDeclineInterest(interest.id, interest.volunteerName, true)}
          >
            Remove
          </Button>
        </div>
      ) : interest.status === InterestStatus.invited ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={cancelInviteMutation.isPending}
          onClick={() =>
            cancelInviteMutation.mutate({ projectId: project.id, interestId: interest.id })
          }
        >
          Cancel invite
        </Button>
      ) : null}
      {interest.message && interest.status !== InterestStatus.accepted && (
        <p className="text-sm text-text-light w-full m-0">{interest.message}</p>
      )}
    </li>
  )
  const interestedVolunteerIds = new Set(interestedVolunteers.map((i) => i.volunteerId))
  const assignVolunteerOptions = [
    { value: '', label: '— Select volunteer —' },
    ...(interestedVolunteers.length > 0
      ? [
          { value: '__interested_header', label: 'Interested in this project', header: true },
          ...interestedVolunteers.map((i) => ({
            value: String(i.volunteerId),
            label: i.volunteerName,
          })),
          { value: '__all_header', label: 'All volunteers', header: true },
        ]
      : []),
    ...volunteers
      .filter((v) => !interestedVolunteerIds.has(v.id))
      .map((v) => ({ value: String(v.id), label: v.name })),
  ]

  // ── Task handlers ────────────────────────────────────────────────────────

  function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTaskTitle.trim()) return
    createTaskMutation.mutate({
      projectId: parseInt(idParam, 10),
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim() || undefined,
      ...datesPayload(newTaskDates),
      featuredAsQuickTask: newTaskFeatured,
    })
  }

  function handleAssignTask(taskId: number) {
    assignTaskMutation.mutate({
      projectId: parseInt(idParam, 10),
      taskId,
      assigneeId: parseInt(taskAssignSelections[taskId], 10),
    })
  }

  function handleTaskDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedTasks.findIndex((t) => t.id === active.id)
    const newIndex = orderedTasks.findIndex((t) => t.id === over.id)
    const reordered = arrayMove(orderedTasks, oldIndex, newIndex)
    setOrderedTasks(reordered)
    reorderTasksMutation.mutate({
      projectId: parseInt(idParam, 10),
      items: reordered.map((t, i) => ({ id: t.id, sortOrder: i + 1 })),
    })
  }

  function handleClaimTask(taskId: number) {
    updateTaskMutation.mutate({
      projectId: parseInt(idParam, 10),
      taskId,
      data: { status: TaskStatus.in_progress, assigneeId: user!.id },
    })
  }

  function handleUnassignTask(taskId: number) {
    updateTaskMutation.mutate({
      projectId: parseInt(idParam, 10),
      taskId,
      data: { status: TaskStatus.open },
    })
  }

  function handleSelectStatus(value: string) {
    const validStatuses = Object.values(ProjectStatus)
    const status = validStatuses.find((s) => s === value)
    if (!status || status === newStatus) return
    setPendingStatus(status)
  }

  function handleConfirmStatus(status: NonNullable<typeof pendingStatus>) {
    updateProjectMutation.mutate({ id: parseInt(idParam, 10), status })
    setNewStatus(status)
    setPendingStatus(null)
  }

  function handleExpressInterest(e: React.FormEvent) {
    e.preventDefault()
    expressInterestMutation.mutate({
      projectId: parseInt(idParam, 10),
      interestType: interestType as 'want_to_contribute' | 'want_to_own',
      message: interestMessage.trim() || null,
    })
  }

  function confirmDeputyAction(action: DeputyAction) {
    const projectId = parseInt(idParam, 10)
    const { volunteerId } = action
    if (action.kind === 'appoint') appointDeputyMutation.mutate({ projectId, volunteerId })
    else if (action.kind === 'remove') removeDeputyMutation.mutate({ projectId, volunteerId })
    else stepDownMutation.mutate({ projectId })
    setDeputyAction(null)
  }

  function confirmWithdrawInterest() {
    withdrawInterestMutation.mutate({ projectId: parseInt(idParam, 10) })
    setWithdrawAccepted(null)
  }

  function handleAcceptInterest(interestId: number) {
    respondToInterestMutation.mutate({
      projectId: parseInt(idParam, 10),
      interestId,
      status: InterestStatus.accepted,
    })
  }

  function handleDeclineInterest(interestId: number, name: string, accepted: boolean) {
    setDeclineTarget({ id: interestId, name, accepted })
    setDeclineMessage('')
  }

  function confirmDeclineInterest(e: React.FormEvent, interestId: number) {
    e.preventDefault()
    respondToInterestMutation.mutate({
      projectId: parseInt(idParam, 10),
      interestId,
      status: 'declined',
      responseMessage: declineMessage.trim() || null,
    })
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!assignTo) return
    inviteMutation.mutate({
      projectId: parseInt(idParam, 10),
      volunteerId: parseInt(assignTo, 10),
      message: inviteNote.trim() || null,
    })
  }

  function handleAddNow() {
    assignMutation.mutate({
      projectId: parseInt(idParam, 10),
      volunteerId: parseInt(assignTo, 10),
    })
  }

  function handleRecordOutcome(e: React.FormEvent) {
    e.preventDefault()
    if (!outcomeValue) return
    setOutcomeMutation.mutate({
      id: parseInt(idParam, 10),
      outcome: outcomeValue,
      outcomeNotes: outcomeNotes.trim() || null,
    })
  }

  function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault()
    reviewMutation.mutate({
      id: parseInt(idParam, 10),
      status: reviewStatus as 'approved' | 'needs_discussion',
      ...(reviewStatus === 'needs_discussion' ? { comment: reviewMessage } : {}),
    })
  }

  const sidebarHelpers = project.helpers ?? []
  const waitingCount = isOwnerOrAdmin
    ? volunteerInterests.filter(
        (i) => i.status === InterestStatus.pending || i.status === InterestStatus.invited,
      ).length
    : 0
  const peopleCount = sidebarHelpers.length + (project.owner ? 1 : 0)
  const keyDateTask = orderedTasks.find((t) => t.keyDateSide === 'key')
  const pastPlanCount = orderedTasks.filter((t) => t.pastPlanDays).length

  const peopleTab = (
    <section aria-label="People on this project" className={card}>
      <h2>People</h2>
      <p className="text-sm">
        <span className="text-text-light">Owner: </span>
        {project.owner ? project.owner.name : 'No owner yet'}
      </p>
      {!isOwnerOrAdmin && Array.isArray(project.helpers) && (
        <div>
          <h3 className="text-sm mb-2">Volunteers</h3>
          {project.helpers.length === 0 ? (
            <p className="text-text-light text-sm">No helpers yet.</p>
          ) : (
            <ul className="list-none p-0 m-0">
              {project.helpers.map((helper) => (
                <li
                  key={helper.id}
                  className="interest-card flex items-center gap-2 py-2 border-b border-brand-border last:border-0 flex-wrap"
                >
                  <TaskAvatar name={helper.volunteerName} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{helper.volunteerName}</div>
                    <div className="text-text-light text-xs">
                      {helper.interestType === 'want_to_own'
                        ? 'Owner'
                        : helper.isDeputy
                          ? 'Deputy'
                          : 'Helper'}
                    </div>
                  </div>
                  {helper.volunteerId === user.id && helper.isDeputy && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setDeputyAction({
                          kind: 'step_down',
                          volunteerId: user.id,
                          name: helper.volunteerName,
                        })
                      }
                    >
                      Step down
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isOwnerOrAdmin && Array.isArray(project.interests) && (
        <div>
          <h3 className="text-sm mb-2">Volunteers</h3>

          {volunteerInterests.length === 0 && (
            <p className="text-text-light text-sm">No interests yet.</p>
          )}
          {peopleGroups
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <section key={g.key} aria-label={g.title} className="mb-2">
                <h4 className="text-xs uppercase text-text-light m-0 mt-2">
                  {g.title} ({g.rows.length})
                </h4>
                <ul className="list-none p-0 m-0">{g.rows.map(renderPerson)}</ul>
              </section>
            ))}
          {pastPeople.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs uppercase text-text-light cursor-pointer">
                Past ({pastPeople.length})
              </summary>
              <ul className="list-none p-0 m-0">{pastPeople.map(renderPerson)}</ul>
            </details>
          )}

          {volunteers.length > 0 && (
            <form
              onSubmit={handleInvite}
              className="flex flex-col gap-2 mt-3 pt-3 border-t border-brand-border"
            >
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-text-light text-sm shrink-0">+ Invite</span>
                <div className="flex-1 min-w-40">
                  <VolunteerSelect
                    id="assign-volunteer"
                    label=""
                    ariaLabel="Volunteer to invite"
                    value={assignTo}
                    onChange={(v) => setAssignTo(v)}
                  />
                </div>
              </div>
              <input
                type="text"
                aria-label="Note with the invite (optional)"
                placeholder="Note with the invite (optional)"
                value={inviteNote}
                onChange={(e) => setInviteNote(e.target.value)}
              />
              <div className="flex gap-2 flex-wrap">
                <Button type="submit" size="sm" disabled={!assignTo || inviteMutation.isPending}>
                  {inviteMutation.isPending ? 'Inviting…' : 'Invite'}
                </Button>
                {isAdmin && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!assignTo || assignMutation.isPending}
                    onClick={handleAddNow}
                  >
                    {assignMutation.isPending ? 'Adding…' : 'Add now'}
                  </Button>
                )}
              </div>
              <p className="text-xs text-text-light m-0">
                They get an invite and join once they accept.
                {isAdmin && ' Add now puts them on the project straight away.'}
              </p>
            </form>
          )}
        </div>
      )}
    </section>
  )

  const myStatus = project.myInterest?.status
  const joinControl = !isOwnerOrAdmin && (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {canSeeInterest && (!project.myInterest || canApplyAgain) && (
        <Button onClick={() => setShowJoin(true)}>Join this project</Button>
      )}
      {myStatus === InterestStatus.pending && (
        <>
          <span className="text-sm" aria-label="interest status">
            Request sent: waiting for the owner
          </span>
          <Button variant="secondary" size="sm" onClick={() => setWithdrawAccepted(false)}>
            Withdraw request
          </Button>
        </>
      )}
      {myStatus === InterestStatus.accepted && (
        <>
          <span className="text-sm" aria-label="interest status">
            You&apos;re on this project
            {project.myInterest?.interestType === 'want_to_own' ? ' as its lead' : ''}
          </span>
          {isDeputy && <Badge variant="success">Deputy</Badge>}
          <Button variant="secondary" size="sm" onClick={() => setWithdrawAccepted(true)}>
            Leave project
          </Button>
        </>
      )}
      {(myStatus === InterestStatus.declined || myStatus === InterestStatus.removed) &&
        !canApplyAgain && (
          <span className="text-sm text-text-light" aria-label="interest status">
            {myStatus === InterestStatus.removed
              ? 'You were taken off this project. Message the owner if you would like to rejoin.'
              : 'The owner declined your request.'}
            {project.myInterest?.responseMessage && ` "${project.myInterest.responseMessage}"`}
          </span>
        )}
      <Modal
        id="join-project"
        title="Join this project"
        isOpen={showJoin}
        onClose={() => setShowJoin(false)}
      >
        <form onSubmit={handleExpressInterest}>
          <fieldset className="mb-5">
            <legend className="mb-2">How would you like to take part?</legend>
            <label className="flex items-center gap-2 cursor-pointer mb-2 font-normal">
              <input
                type="radio"
                name="interest_type"
                value="want_to_contribute"
                checked={interestType === 'want_to_contribute'}
                onChange={() => setInterestType('want_to_contribute')}
              />
              Help out on the project
            </label>
            {project.isSeekingOwner && (
              <label className="flex items-center gap-2 cursor-pointer font-normal">
                <input
                  type="radio"
                  name="interest_type"
                  value="want_to_own"
                  checked={interestType === 'want_to_own'}
                  onChange={() => setInterestType('want_to_own')}
                />
                Lead the project
              </label>
            )}
          </fieldset>
          <div className="mb-5">
            <label htmlFor="interest-message">Message (optional)</label>
            <textarea
              id="interest-message"
              rows={3}
              value={interestMessage}
              onChange={(e) => setInterestMessage(e.target.value)}
              placeholder="Say a little about why you'd like to help…"
            />
          </div>
          <p className="text-sm text-text-light">
            The owner is asked, and you join once they accept.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowJoin(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={expressInterestMutation.isPending}>
              {expressInterestMutation.isPending ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <main className="container py-5 pb-15">
        {/* [test hook] projectContent id used by action helpers to confirm page has loaded */}
        <h1 id="projectContent" role="heading" aria-level={1}>
          {project.title}
        </h1>

        {joinControl}

        <Tabs
          role="tablist"
          className="mb-4"
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'tasks', label: `Tasks (${orderedTasks.length})` },
            { key: 'timeline', label: 'Timeline' },
            { key: 'discussion', label: 'Discussion' },
            { key: 'people', label: `People (${peopleCount})` },
          ]}
          activeTab={tab}
          onChange={(k) => selectTab(k as ProjectTab)}
        />

        {/* One page width for every tab: the timeline scrolls inside its own card. */}
        <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-3">
          {/* Main column */}
          <div className="min-w-0 lg:col-span-2">
            <ChangesRequestedBanner
              projectId={project.id}
              requests={project.reviewRequests}
              canResubmit={isOwner || project.proposedById === user.id}
              editHref={`/projects/${idParam}/edit`}
            />
            {project.myInterest?.status === InterestStatus.invited && (
              <ProjectInviteBanner
                projectId={project.id}
                invitedByName={project.myInterest.invitedByName}
                note={project.myInterest.message}
              />
            )}

            {tab === 'overview' && (
              <>
                {/* Main project card */}
                <div className={card}>
                  <p className="whitespace-pre-wrap">
                    <Linkify text={project.description} />
                  </p>

                  {project.skills.length > 0 && (
                    <div className="mt-3">
                      <strong>Skills needed:</strong>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {project.skills.map((s) => (
                          <span
                            key={s.id}
                            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                              s.isRequired
                                ? 'bg-secondary text-white dark:bg-gray-600'
                                : 'bg-accent text-secondary-dark dark:bg-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Match score */}
                  {!isOwner && project.match && project.match.totalRequired > 0 && (
                    <p className="mt-3 mb-0 text-sm">
                      You match {project.match.matchedRequiredCount} of{' '}
                      {project.match.totalRequired} skill
                      {project.match.totalRequired === 1 ? '' : 's'}
                    </p>
                  )}

                  {isHttpUrl(project.collaborationLink) && (
                    <p className="mt-2 text-sm">
                      <a
                        href={project.collaborationLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="link"
                        className="underline text-primary-dark"
                      >
                        Open Project Doc →
                      </a>
                    </p>
                  )}
                </div>

                {/* Outcome display */}
                {project.outcome && (
                  <div
                    role="status"
                    className="bg-emerald-100 dark:bg-emerald-900 border border-emerald-300 dark:border-emerald-600 rounded-xl p-6 mb-4"
                  >
                    <strong>Outcome: </strong>
                    {project.outcome === 'successful'
                      ? 'Successful'
                      : project.outcome === 'partial'
                        ? 'Partial'
                        : project.outcome === 'not_completed'
                          ? 'Not Completed'
                          : project.outcome === 'ongoing'
                            ? 'Ongoing'
                            : project.outcome}
                    {project.outcomeNotes && <p className="mt-1 text-sm">{project.outcomeNotes}</p>}
                  </div>
                )}
              </>
            )}

            {/* Tasks and Timeline */}
            {(tab === 'tasks' || tab === 'timeline') && (
              <div className={card}>
                <div className="flex justify-between items-center mb-3">
                  <h2 className="m-0">{tab === 'timeline' ? 'Timeline' : 'Tasks'}</h2>
                  <div className="flex items-center gap-2">
                    {canCreateTasks && (
                      <Button variant="secondary" onClick={() => setShowTaskForm((v) => !v)}>
                        Add Task
                      </Button>
                    )}
                  </div>
                </div>

                {showTaskForm && canCreateTasks && (
                  <div className="bg-brand-bg rounded-lg p-3 mb-4 border border-brand-border">
                    <form onSubmit={handleAddTask}>
                      <div className="mb-3">
                        <label htmlFor="new-task-title">Task title</label>
                        <input
                          id="new-task-title"
                          type="text"
                          aria-label="Task title"
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          placeholder="Describe the task…"
                          autoFocus
                        />
                      </div>
                      <div className="mb-3">
                        <label htmlFor="new-task-description">Description</label>
                        <textarea
                          id="new-task-description"
                          aria-label="Description"
                          rows={3}
                          value={newTaskDescription}
                          onChange={(e) => setNewTaskDescription(e.target.value)}
                          placeholder="Add any context, examples, or guidelines…"
                        />
                      </div>
                      <div className="mb-1">
                        <DatesBlock
                          id="new-task"
                          value={newTaskDates}
                          onChange={setNewTaskDates}
                          note={
                            canManageTasks
                              ? undefined
                              : 'Only the project owner can change these dates once the task exists.'
                          }
                        />
                      </div>
                      <div className="mb-3">
                        <Checkbox
                          checked={newTaskFeatured}
                          onChange={(e) => setNewTaskFeatured(e.target.checked)}
                        >
                          Add this task to the Quick Tasks page so volunteers can find and claim it
                          without first clicking into this project
                        </Checkbox>
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" disabled={createTaskMutation.isPending}>
                          {createTaskMutation.isPending ? 'Creating…' : 'Create Task'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setShowTaskForm(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </div>
                )}

                {tab === 'timeline' && (
                  <div className="overflow-x-auto">
                    <TaskTimeline
                      timeline={timeline}
                      projectId={parseInt(idParam, 10)}
                      loading={!timeline}
                      canAssignTasks={canManageTasks}
                      canClaimTasks={canClaimTasks}
                      assignOptions={assignVolunteerOptions}
                      onAssignTask={(taskId, volunteerId) =>
                        assignTaskMutation.mutate({
                          projectId: parseInt(idParam, 10),
                          taskId,
                          assigneeId: volunteerId,
                        })
                      }
                      onClaimTask={handleClaimTask}
                      onUnassignTask={handleUnassignTask}
                      highlightCritical={highlightCritical}
                    />
                    {canManageTasks && (
                      <PlanningTools>
                        {canManageProject && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={setBaselineMutation.isPending}
                              onClick={() => setShowBaselineDialog(true)}
                            >
                              {baselineSetAt ? 'Replace original plan' : 'Set original plan'}
                            </Button>
                            <span className="text-text-light text-xs">
                              {baselineSetAt
                                ? `Original plan set ${formatDateShort(baselineSetAt)}`
                                : 'Save today’s dates as the plan to measure moves against.'}
                            </span>
                          </div>
                        )}
                        <Checkbox
                          checked={highlightCritical}
                          onChange={(e) => setHighlightCritical(e.target.checked)}
                        >
                          Highlight the critical path
                        </Checkbox>
                      </PlanningTools>
                    )}
                  </div>
                )}

                {tab === 'tasks' && canManageTasks && pastPlanCount >= STALE_PLAN_FROM && (
                  <p className="text-text-light mb-3 text-sm">
                    {pastPlanCount} tasks are past plan. If their bars were never placed, set real
                    dates on the{' '}
                    <button
                      type="button"
                      className="text-primary-text cursor-pointer border-0 bg-transparent p-0 underline"
                      onClick={() => selectTab('timeline')}
                    >
                      Timeline
                    </button>{' '}
                    rather than replanning one at a time.
                  </p>
                )}
                {tab === 'tasks' && keyDateTask && (
                  <p className="text-text-light mb-3 text-sm">
                    <span style={{ color: 'var(--gantt-anchor)' }}>★ Key date:</span>{' '}
                    <strong>{keyDateTask.title}</strong>. The work it waits for is marked Before;
                    the work that follows it, After.
                  </p>
                )}
                {tab === 'tasks' &&
                  (orderedTasks.length === 0 ? (
                    <p className="text-text-light">No tasks yet.</p>
                  ) : (
                    <DndContext
                      sensors={taskDragSensors}
                      collisionDetection={closestCenter}
                      onDragEnd={canManageTasks ? handleTaskDragEnd : undefined}
                    >
                      <SortableContext
                        items={orderedTasks.map((t) => t.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className="list-none p-0 m-0">
                          {orderedTasks.map((task) => {
                            const isOverdue = deadlinePassed(
                              task.deadline,
                              task.status === TaskStatus.completed,
                            )
                            const canAssign =
                              canRunTasks &&
                              task.status !== TaskStatus.completed &&
                              volunteers.length > 0
                            const canUnassign =
                              canRunTasks &&
                              task.assignedToId !== null &&
                              task.status === TaskStatus.in_progress

                            return (
                              <SortableTaskItem
                                key={task.id}
                                task={task}
                                draggable={canManageTasks}
                                title={
                                  <Link
                                    href={`/projects/${idParam}/tasks/${task.id}`}
                                    className="hover:underline"
                                  >
                                    {task.title}
                                  </Link>
                                }
                                assigneeName={
                                  task.status !== TaskStatus.completed ? task.assignedToName : null
                                }
                                chips={
                                  <>
                                    {task.status === TaskStatus.completed && (
                                      <span className="text-success text-sm font-semibold">
                                        <span aria-hidden="true">✓</span> <span>done</span>
                                      </span>
                                    )}
                                    {task.requestedById !== null && (
                                      <span className="text-text-light text-xs whitespace-nowrap">
                                        {task.requestedById === user.id
                                          ? 'Held for you: waiting for the owner'
                                          : `Requested by ${task.requestedByName}`}
                                      </span>
                                    )}
                                    {task.status === TaskStatus.under_review && (
                                      <Badge variant={TASK_STATUS_VARIANTS.under_review}>
                                        {TASK_STATUS_LABELS.under_review}
                                      </Badge>
                                    )}
                                    {task.featuredAsQuickTask && (
                                      <span
                                        className="text-xs whitespace-nowrap"
                                        title="Also shown on the Quick Tasks page"
                                      >
                                        ⚡ Quick Task
                                      </span>
                                    )}
                                    {isOverdue && <Badge variant="danger">Overdue</Badge>}
                                    {task.pastPlanDays ? (
                                      <Badge variant="warning">
                                        {plural(task.pastPlanDays, 'day')} past plan
                                      </Badge>
                                    ) : null}
                                    {task.keyDateSide && task.keyDateSide !== 'other' && (
                                      <span
                                        className="text-xs whitespace-nowrap"
                                        style={
                                          task.keyDateSide === 'key'
                                            ? { color: 'var(--gantt-anchor)' }
                                            : undefined
                                        }
                                      >
                                        {KEY_DATE_SIDE_LABELS[task.keyDateSide]}
                                      </span>
                                    )}
                                    {task.estimatedHours !== null && (
                                      <span className="text-text-light text-xs whitespace-nowrap">
                                        ~{task.estimatedHours}h
                                      </span>
                                    )}
                                    {task.deadline && (
                                      <span className="text-text-light text-xs whitespace-nowrap">
                                        Deadline {formatDate(task.deadline)}
                                      </span>
                                    )}
                                    {task.commentCount > 0 && (
                                      <Link
                                        href={`/projects/${idParam}/tasks/${task.id}`}
                                        className="flex items-center gap-1 text-text-light text-xs whitespace-nowrap hover:underline"
                                        aria-label={`${task.commentCount} comment${task.commentCount !== 1 ? 's' : ''}`}
                                      >
                                        <svg
                                          width="14"
                                          height="14"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          aria-hidden="true"
                                        >
                                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                                        </svg>
                                        {task.commentCount}
                                      </Link>
                                    )}
                                  </>
                                }
                                primaryAction={
                                  <>
                                    {task.status === TaskStatus.open &&
                                      task.requestedById === null &&
                                      canClaimTasks && (
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          onClick={() => handleClaimTask(task.id)}
                                        >
                                          {project.isMember || isOwnerOrAdmin
                                            ? 'Claim'
                                            : 'Join and claim'}
                                        </Button>
                                      )}
                                    {task.status === TaskStatus.in_progress &&
                                      task.assignedToId === user.id && (
                                        <SubmitWorkButton
                                          target={{
                                            kind: 'project',
                                            projectId: project.id,
                                            taskId: task.id,
                                          }}
                                          reviewer={
                                            awaitsOwnerReview(project, canRunTasks)
                                              ? 'The project owner'
                                              : null
                                          }
                                          size="sm"
                                          variant="secondary"
                                        />
                                      )}
                                    {task.status === TaskStatus.under_review && canRunTasks && (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        href={`/projects/${idParam}/tasks/${task.id}`}
                                      >
                                        Review
                                      </Button>
                                    )}
                                  </>
                                }
                                menu={
                                  (canAssign || canManageTasks || task.createdById === user.id) && (
                                    <ActionMenu ariaLabel={`Task actions for ${task.title}`}>
                                      {(close) => (
                                        <>
                                          {canAssign && (
                                            <div className="px-3 py-2 flex flex-col gap-2">
                                              <FilterDropdown
                                                id={`assign-task-${task.id}`}
                                                label="Assign to"
                                                ariaLabel={`Assign volunteer to ${task.title}`}
                                                value={taskAssignSelections[task.id] ?? ''}
                                                options={assignVolunteerOptions}
                                                onChange={(v) =>
                                                  setTaskAssignSelections((s) => ({
                                                    ...s,
                                                    [task.id]: v,
                                                  }))
                                                }
                                                searchable
                                              />
                                              <Button
                                                variant="secondary"
                                                size="sm"
                                                disabled={
                                                  !taskAssignSelections[task.id] ||
                                                  assignTaskMutation.isPending
                                                }
                                                onClick={() => {
                                                  handleAssignTask(task.id)
                                                  close()
                                                }}
                                              >
                                                Assign
                                              </Button>
                                            </div>
                                          )}
                                          {canUnassign && (
                                            <button
                                              role="menuitem"
                                              className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors cursor-pointer ${canAssign ? 'border-t border-brand-border mt-1' : ''}`}
                                              onClick={() => {
                                                handleUnassignTask(task.id)
                                                close()
                                              }}
                                            >
                                              Unassign
                                            </button>
                                          )}
                                          {(canManageTasks || task.createdById === user.id) && (
                                            <button
                                              role="menuitem"
                                              className={`w-full text-left px-3 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-accent transition-colors cursor-pointer ${canAssign || canUnassign ? 'border-t border-brand-border mt-1' : ''}`}
                                              onClick={() => {
                                                setDeleteTaskId(task.id)
                                                close()
                                              }}
                                            >
                                              Delete task
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </ActionMenu>
                                  )
                                }
                              />
                            )
                          })}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  ))}
              </div>
            )}

            {tab === 'discussion' && (
              <div className={card} id="discussion">
                <h2>Discussion</h2>
                <CommentThread
                  workItemId={project.id}
                  emptyText="No messages yet."
                  placeholder="Share an update or ask a question. Type @ to mention someone."
                />
              </div>
            )}

            {tab === 'people' && peopleTab}
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 min-w-0 flex flex-col gap-4">
            {/* Status */}
            <div className={card}>
              <h2 className="mb-3">Status</h2>
              {canPickStatus ? (
                <StatusSplitButton
                  value={shownStatus}
                  options={statusOptions}
                  onSelect={handleSelectStatus}
                  disabled={updateProjectMutation.isPending}
                />
              ) : (
                <Badge variant={projectStatusVariant(project.status)} aria-label="project status">
                  {projectStatusLabel(project.status)}
                </Badge>
              )}
              <div className="flex gap-1 flex-wrap mt-2">
                {project.isSeekingOwner && <Badge variant="caution">Seeking Owner</Badge>}
                {project.isSeekingHelp && <Badge variant="caution">Seeking Help</Badge>}
                {project.needsTasks && <Badge variant="warning">Needs Tasks</Badge>}
              </div>
              {(() => {
                const parts = projectLocationParts(
                  project.country,
                  project.localGroup,
                  project.remoteEligibility,
                )
                return (
                  parts.length > 0 && (
                    <p className="text-sm text-text-light mt-3 mb-0">📍 {parts.join(' · ')}</p>
                  )
                )
              })()}
              {project.team && (
                <p className="text-sm text-text-light mt-1 mb-0">🧑‍🤝‍🧑 {project.team.name}</p>
              )}
              {pendingStatus !== null && (
                <Modal
                  id="confirm-status-change"
                  title="Change project status?"
                  isOpen
                  onClose={() => setPendingStatus(null)}
                >
                  <p>
                    Change status from <strong>{projectStatusLabel(newStatus)}</strong> to{' '}
                    <strong>{projectStatusLabel(pendingStatus)}</strong>?
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setPendingStatus(null)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => handleConfirmStatus(pendingStatus)}
                      disabled={updateProjectMutation.isPending}
                    >
                      {updateProjectMutation.isPending ? 'Updating…' : 'Confirm'}
                    </Button>
                  </div>
                </Modal>
              )}

              {/* Ownership — same panel as Status/Team above */}
              <div className="mt-4 pt-4 border-t border-brand-border">
                <h2>Owner</h2>
                <div className="flex items-center justify-between gap-2">
                  {project.owner ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <TaskAvatar name={project.owner.name} />
                      <Link href={`/volunteers/${project.owner.id}`} className="underline truncate">
                        {project.owner.name}
                      </Link>
                    </div>
                  ) : isAdmin && proposer ? (
                    // Ownerless projects still have a proposer. Admins triaging the queue need
                    // to know who to talk to, so show them that name in place of the empty state.
                    <div className="flex items-center gap-2 min-w-0">
                      <TaskAvatar name={proposer.name} />
                      <span className="truncate">
                        Proposer:{' '}
                        {proposer.volunteerId ? (
                          <Link href={`/volunteers/${proposer.volunteerId}`} className="underline">
                            {proposer.name}
                          </Link>
                        ) : (
                          proposer.name
                        )}
                      </span>
                    </div>
                  ) : (
                    <p className="text-text-light text-sm m-0">No owner yet.</p>
                  )}
                  {isAdmin && volunteers.length > 0 && (
                    <ActionMenu ariaLabel="Ownership actions">
                      {(close) => (
                        <>
                          <div className="px-3 py-2 flex flex-col gap-2">
                            <h3 className="m-0 text-sm">Transfer Ownership</h3>
                            <VolunteerSelect
                              id="transfer-to"
                              label="Transfer to"
                              ariaLabel="Transfer to"
                              value={transferTo}
                              onChange={(v) => setTransferTo(v)}
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!transferTo || updateProjectMutation.isPending}
                              onClick={() => {
                                setShowTransferConfirm(true)
                                close()
                              }}
                            >
                              {updateProjectMutation.isPending ? 'Transferring…' : 'Transfer'}
                            </Button>
                          </div>
                          {project.owner && (
                            <button
                              role="menuitem"
                              className="w-full text-left px-3 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-accent transition-colors cursor-pointer border-t border-brand-border mt-1"
                              onClick={() => {
                                setShowRemoveOwnerConfirm(true)
                                close()
                              }}
                            >
                              Remove ownership
                            </button>
                          )}
                        </>
                      )}
                    </ActionMenu>
                  )}
                </div>
                {project.canMessageOwner && !isAdmin && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => setShowContactModal(true)}
                  >
                    Message owner
                  </Button>
                )}

                <div className="mt-4 pt-4 border-t border-brand-border">
                  <h3 className="text-sm mb-2">People</h3>
                  {sidebarHelpers.length === 0 ? (
                    <p className="text-text-light text-sm m-0">No helpers yet.</p>
                  ) : (
                    <ul aria-label="Helpers" className="list-none p-0 m-0 flex flex-col gap-1">
                      {sidebarHelpers.slice(0, SIDEBAR_PEOPLE).map((h) => (
                        <li key={h.id} className="flex items-center gap-2 text-sm">
                          <TaskAvatar name={h.volunteerName} />
                          <span className="truncate">{h.volunteerName}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {sidebarHelpers.length > SIDEBAR_PEOPLE && (
                    <p className="text-text-light text-xs mt-1 mb-0">
                      and {sidebarHelpers.length - SIDEBAR_PEOPLE} more
                    </p>
                  )}
                  {waitingCount > 0 && (
                    <p className="text-sm mt-2 mb-0">{waitingCount} waiting for an answer</p>
                  )}
                  <button
                    type="button"
                    className="text-sm underline mt-2 bg-transparent border-0 p-0 cursor-pointer text-primary-text"
                    onClick={() => selectTab('people')}
                  >
                    {isOwnerOrAdmin ? 'Manage people' : 'See everyone'}
                  </button>
                </div>
              </div>
            </div>

            {canManageProject && (
              <details className={card}>
                <summary className="cursor-pointer font-semibold">Manage</summary>
                <div className="flex flex-col items-start gap-2 mt-3">
                  <Button href={`/projects/${idParam}/edit`} variant="secondary" size="sm">
                    Edit Project
                  </Button>
                  <details>
                    <summary className="cursor-pointer text-sm">More</summary>
                    <div className="flex flex-col items-start gap-2 mt-2">
                      <Button variant="secondary" size="sm" onClick={() => setShowPorting(true)}>
                        Export / Import
                      </Button>
                      {isAdmin && (
                        <SaveAsTemplateButton projectId={project.id} defaultTitle={project.title} />
                      )}
                    </div>
                  </details>
                </div>
              </details>
            )}

            {/* Admin triage */}
            {isAdmin &&
              (project.status === ProjectStatus.pending_review ||
                project.status === ProjectStatus.needs_discussion) &&
              !reviewDone && (
                <div className={card}>
                  <h2>Review Project</h2>
                  <form onSubmit={handleSubmitReview}>
                    <div className="mb-5">
                      <label className="flex items-center gap-2 cursor-pointer mb-2 font-normal">
                        <input
                          type="radio"
                          name="review_status"
                          value="approved"
                          checked={reviewStatus === 'approved'}
                          onChange={() => setReviewStatus('approved')}
                        />
                        Approve
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer font-normal">
                        <input
                          type="radio"
                          name="review_status"
                          value="needs_discussion"
                          checked={reviewStatus === 'needs_discussion'}
                          onChange={() => setReviewStatus('needs_discussion')}
                        />
                        Ask for changes
                      </label>
                    </div>
                    {reviewStatus === 'needs_discussion' && (
                      <div className="mb-5">
                        <label htmlFor="review-message">Message to Proposer</label>
                        <textarea
                          id="review-message"
                          aria-label="Message to Proposer"
                          rows={3}
                          value={reviewMessage}
                          onChange={(e) => setReviewMessage(e.target.value)}
                          placeholder="What needs to change before it goes live?"
                        />
                      </div>
                    )}
                    <Button type="submit" disabled={reviewMutation.isPending}>
                      {reviewMutation.isPending ? 'Submitting…' : 'Submit Review'}
                    </Button>
                  </form>
                </div>
              )}

            {/* Record Outcome */}
            {isAdmin && project.status === ProjectStatus.completed && !project.outcome && (
              <div className={card}>
                <h2>Record Project Outcome</h2>
                <form onSubmit={handleRecordOutcome}>
                  <div className="mb-5">
                    <FilterDropdown
                      id="outcome-select"
                      label="Outcome"
                      ariaLabel="Outcome"
                      value={outcomeValue}
                      options={outcomeOptions}
                      onChange={setOutcomeValue}
                    />
                  </div>
                  <div className="mb-5">
                    <label htmlFor="outcome-notes">Outcome Notes</label>
                    <textarea
                      id="outcome-notes"
                      aria-label="Outcome Notes"
                      rows={3}
                      value={outcomeNotes}
                      onChange={(e) => setOutcomeNotes(e.target.value)}
                      placeholder="Notes about the outcome…"
                    />
                  </div>
                  <Button type="submit" disabled={!outcomeValue || setOutcomeMutation.isPending}>
                    {setOutcomeMutation.isPending ? 'Recording…' : 'Record Outcome'}
                  </Button>
                </form>
              </div>
            )}
          </div>
        </div>
      </main>

      <Modal
        id="project-porting"
        title="Export and import"
        size="wide"
        isOpen={showPorting}
        onClose={() => setShowPorting(false)}
      >
        <ProjectPorting projectId={parseInt(idParam, 10)} onDone={() => setShowPorting(false)} />
      </Modal>

      <BaselineDialog
        isOpen={showBaselineDialog}
        existingSetAt={baselineSetAt}
        taskCount={datedTaskCount}
        busy={setBaselineMutation.isPending}
        onClose={() => setShowBaselineDialog(false)}
        onConfirm={() =>
          setBaselineMutation.mutate({
            projectId: parseInt(idParam, 10),
            includeTasks: true,
          })
        }
      />

      {showContactModal && ownerId !== null && (
        <MessageDialog
          id="contact-owner"
          title="Message owner"
          recipientId={ownerId}
          recipientName={project.owner?.name ?? 'The owner'}
          relatedProjectId={project.id}
          directContact={ownerContact}
          onClose={() => setShowContactModal(false)}
        />
      )}

      {/* Decline interest modal */}
      {declineTarget && (
        <Modal
          id="decline-interest"
          title={
            declineTarget.accepted
              ? `Remove ${declineTarget.name} from this project?`
              : 'Decline Volunteer'
          }
          isOpen
          onClose={() => setDeclineTarget(null)}
        >
          <form onSubmit={(e) => confirmDeclineInterest(e, declineTarget.id)}>
            <div className="mb-5">
              <label htmlFor="decline-message">Optional message for the volunteer</label>
              <textarea
                id="decline-message"
                rows={4}
                value={declineMessage}
                onChange={(e) => setDeclineMessage(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={() => setDeclineTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={respondToInterestMutation.isPending}>
                {respondToInterestMutation.isPending
                  ? declineTarget.accepted
                    ? 'Removing…'
                    : 'Declining…'
                  : declineTarget.accepted
                    ? 'Remove'
                    : 'Decline'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTaskId !== null && (
        <ConfirmDialog
          id="confirm-delete-project-task"
          isOpen
          title="Delete this task?"
          body="The task and anything posted on it are removed for everyone. This cannot be undone."
          confirmLabel="Delete task"
          busyLabel="Deleting…"
          danger
          busy={deleteTaskMutation.isPending}
          onConfirm={() => {
            deleteTaskMutation.mutate({ projectId: parseInt(idParam, 10), taskId: deleteTaskId })
            setDeleteTaskId(null)
          }}
          onClose={() => setDeleteTaskId(null)}
        />
      )}

      {deputyAction !== null && (
        <ConfirmDialog
          id="confirm-deputy"
          isOpen
          title={
            deputyAction.kind === 'appoint'
              ? `Make ${deputyAction.name} a deputy?`
              : deputyAction.kind === 'remove'
                ? `Remove ${deputyAction.name} as a deputy?`
                : 'Step down as a deputy?'
          }
          body={
            deputyAction.kind === 'appoint'
              ? 'A deputy can create, edit, assign and delete tasks, change their deadlines and dependencies, and review submitted work. They cannot edit the project, change its status, manage people, set the key date, project deadline or original plan, or appoint deputies.'
              : deputyAction.kind === 'remove'
                ? 'They stay on the project as a helper but can no longer manage its tasks.'
                : 'You stay on the project as a helper but can no longer manage its tasks.'
          }
          confirmLabel={
            deputyAction.kind === 'appoint'
              ? 'Make deputy'
              : deputyAction.kind === 'remove'
                ? 'Remove deputy'
                : 'Step down'
          }
          busyLabel="Saving…"
          busy={
            appointDeputyMutation.isPending ||
            removeDeputyMutation.isPending ||
            stepDownMutation.isPending
          }
          onConfirm={() => confirmDeputyAction(deputyAction)}
          onClose={() => setDeputyAction(null)}
        />
      )}

      <ConfirmDialog
        id="confirm-withdraw-interest"
        isOpen={withdrawAccepted !== null}
        title={withdrawAccepted ? 'Leave this project?' : 'Withdraw your request?'}
        body={
          withdrawAccepted
            ? 'Tasks you claimed will be released. You would need to ask to join again.'
            : 'The owner will no longer see your request. You can ask to join again later.'
        }
        confirmLabel={withdrawAccepted ? 'Leave' : 'Withdraw'}
        busyLabel="Leaving…"
        danger
        busy={withdrawInterestMutation.isPending}
        onConfirm={confirmWithdrawInterest}
        onClose={() => setWithdrawAccepted(null)}
      />

      <ConfirmDialog
        id="confirm-transfer-ownership"
        isOpen={showTransferConfirm}
        title="Transfer ownership to this volunteer?"
        body="They take over the project and you lose the owner's controls on it."
        confirmLabel="Transfer"
        busyLabel="Transferring…"
        busy={updateProjectMutation.isPending}
        onConfirm={() => {
          updateProjectMutation.mutate({
            id: parseInt(idParam, 10),
            assigneeId: parseInt(transferTo, 10),
          })
          setShowTransferConfirm(false)
        }}
        onClose={() => setShowTransferConfirm(false)}
      />

      <ConfirmDialog
        id="confirm-remove-owner"
        isOpen={showRemoveOwnerConfirm}
        title="Remove the current owner from this project?"
        body="The project is left without an owner until someone else takes it on."
        confirmLabel="Remove ownership"
        busyLabel="Removing…"
        danger
        busy={updateProjectMutation.isPending}
        onConfirm={() => {
          updateProjectMutation.mutate({ id: parseInt(idParam, 10), assigneeId: null })
          setShowRemoveOwnerConfirm(false)
        }}
        onClose={() => setShowRemoveOwnerConfirm(false)}
      />
    </>
  )
}
