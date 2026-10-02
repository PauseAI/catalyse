'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { InferRouterInputs } from '@orpc/server'
import { useRequireAuth } from '@/lib/hooks/auth'
import Button from '@/components/Button'
import Checkbox from '@/components/Checkbox'
import Radio from '@/components/Radio'
import FilterDropdown from '@/components/FilterDropdown'
import DescriptionTips from '@/components/DescriptionTips'
import SkillPicker from '@/components/SkillPicker'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import ChangesRequestedBanner from '@/components/ChangesRequestedBanner'
import { buildLocationOptions, type LocalGroupOption } from '@/lib/filter-options'
import { useToast } from '@/lib/toast'
import { toDateInputValue, fromDateInputValue } from '@/lib/format-date'
import { orpc } from '@/lib/orpc'
import type { AppRouter } from '@/server/router'

// A new proposal starts saving itself once the title or the description has this much in it.
const AUTOSAVE_MIN_TITLE = 3
const AUTOSAVE_MIN_DESCRIPTION = 20
const AUTOSAVE_DELAY_MS = 1500

interface SelectedSkill {
  skillId: number
  proficiencyLevel: string
}

const URGENCY_OPTIONS = [
  { value: 'low', label: 'Low - Nice to have' },
  { value: 'medium', label: 'Medium - Should do soon' },
  { value: 'high', label: 'High - Urgent / time-sensitive' },
]

const PROJECT_TYPES = [
  { value: '', label: 'Select a project type…' },
  { value: 'sprint', label: 'Sprint (1-2 weeks) - Focused burst of work with clear deliverable' },
  { value: 'container', label: 'Time-boxed (1-3 months) - Defined scope with end date' },
  { value: 'ongoing', label: 'Ongoing - Continuous work without fixed end date' },
  { value: 'one_off', label: 'One-off task - Single deliverable, minimal coordination' },
]

const REMOTE_ELIGIBILITY_OPTIONS = [
  { value: 'NONE', label: 'No - in-person / local only' },
  { value: 'COUNTRY', label: 'Yes - remote OK, within the same country' },
  { value: 'GLOBAL', label: 'Yes - remote OK, from any country' },
]

type CreateProjectInput = InferRouterInputs<AppRouter>['projects']['create']
type UpdateProjectInput = InferRouterInputs<AppRouter>['projects']['update']
type FieldPatch = Partial<Omit<UpdateProjectInput, 'id'>>

/** The fields that differ between two create payloads, as an update; null when none do. */
function changedSince(
  sent: CreateProjectInput,
  now: CreateProjectInput,
  userId: number | undefined,
): FieldPatch | null {
  const { tasks: _tasks, saveAsDraft: _saveAsDraft, wantToOwn, ...fields } = now
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    const before = sent[key as keyof CreateProjectInput]
    if (JSON.stringify(value) !== JSON.stringify(before)) patch[key] = value
  }
  if (wantToOwn !== sent.wantToOwn) patch.assigneeId = wantToOwn ? (userId ?? null) : null
  return Object.keys(patch).length > 0 ? (patch as FieldPatch) : null
}

type ProjectEditorProps =
  | { projectId: number; variant?: undefined; onCancel?: never }
  | { projectId?: undefined; variant: 'volunteer' | 'admin'; onCancel?: () => void }

export default function ProjectEditor(props: ProjectEditorProps) {
  const router = useRouter()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { user } = useRequireAuth()

  // Which variant created this screen — only meaningful before a project id exists, to
  // pick the create endpoint and review-notice wording. Once an id exists (from the
  // start, or from a lazy create below), org-ness comes from the loaded project instead.
  const initialVariant = props.projectId === undefined ? props.variant : undefined

  const [projectId, setProjectId] = useState<number | undefined>(props.projectId)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [autosaveError, setAutosaveError] = useState<string | null>(null)
  const creation = useRef<Promise<number | null> | null>(null)
  const [permissionChecked, setPermissionChecked] = useState(false)
  const [canEdit, setCanEdit] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [showDeleteDraftModal, setShowDeleteDraftModal] = useState(false)
  const [showDeleteProjectModal, setShowDeleteProjectModal] = useState(false)
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<{
    projectId: number
    taskId: number
  } | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [taskDrafts, setTaskDrafts] = useState<
    Record<number, { title: string; description: string }>
  >({})

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectType, setProjectType] = useState('')
  const [hoursPerWeek, setHoursPerWeek] = useState('')
  const [urgency, setUrgency] = useState('medium')
  const [locationValue, setLocationValue] = useState('') // 'UK' or 'UK:London'
  const [teamId, setTeamId] = useState('')
  const [remoteEligibility, setRemoteEligibility] = useState<'NONE' | 'COUNTRY' | 'GLOBAL'>('NONE')
  const [duration, setDuration] = useState('')
  const [startDate, setStartDate] = useState('')
  // Set by a Submit with no tasks; the error under Tasks shows until one is added.
  const [submitWithoutTasks, setSubmitWithoutTasks] = useState(false)
  const [durationDays, setDurationDays] = useState('')
  const [projectDeadline, setProjectDeadline] = useState('')
  const [collaborationLink, setCollaborationLink] = useState('')
  const [skills, setSkills] = useState<SelectedSkill[]>([])
  const [seekingHelp, setSeekingHelp] = useState(true)
  const [autoAccept, setAutoAccept] = useState(true)
  const [wantToOwn, setWantToOwn] = useState(false)

  const { data: localGroupsData } = useQuery(orpc.localGroups.list.queryOptions({ input: {} }))
  const allLocalGroups: LocalGroupOption[] = localGroupsData?.groups ?? []

  const { data: teamsData } = useQuery(orpc.teams.list.queryOptions())
  const teams = teamsData?.teams ?? []

  const { data: projectData, isPending: loadingProject } = useQuery({
    ...orpc.projects.getById.queryOptions({ input: { id: projectId ?? 0 } }),
    enabled: !!user && projectId !== undefined,
  })

  const isDraft = projectId === undefined ? true : projectData?.status === 'draft'
  const taskCount = projectData?.tasks.length ?? 0
  // Org-proposed AND template-originated drafts both skip review and publish straight live —
  // see the self-publish gate in server/routers/projects.ts:publishDraft. A template-originated
  // draft can't exist before a project id does, so `initialVariant` never needs to cover it.
  const isOrgDraft =
    projectId === undefined
      ? initialVariant === 'admin'
      : projectData?.isOrgProposed === true || (projectData?.templateOriginId ?? null) !== null

  useEffect(() => {
    if (!projectData || initialized) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialized(true)
    const data = projectData
    setTitle(data.title)
    setDescription(data.description ?? '')
    setCollaborationLink(data.collaborationLink ?? '')
    setSkills((data.skills ?? []).map((s) => ({ skillId: s.id, proficiencyLevel: 'intermediate' })))
    setProjectType(data.projectType ?? '')
    setHoursPerWeek(data.timeCommitmentHoursPerWeek?.toString() ?? '')
    setUrgency(data.urgency ?? 'medium')
    const country = data.country ?? ''
    const localGroup = data.localGroup ?? ''
    setLocationValue(country && localGroup ? `${country}:${localGroup}` : country)
    setTeamId(data.teamId ? String(data.teamId) : '')
    setRemoteEligibility(data.remoteEligibility ?? 'NONE')
    setDuration(data.estimatedDuration ?? '')
    setStartDate(toDateInputValue(data.startDate))
    setDurationDays(data.durationDays !== null ? String(data.durationDays) : '')
    setProjectDeadline(toDateInputValue(data.deadline))
    setSeekingHelp(data.isSeekingHelp ?? false)
    setAutoAccept(data.autoAcceptTasks)
    setWantToOwn(data.ownerId === user?.id)
    const isOwner = data.ownerId === user?.id || data.proposedById === user?.id
    setCanEdit(isOwner || (user?.isAdmin ?? false))
    setPermissionChecked(true)
  }, [projectData, initialized, user])

  // Seeds local editable copies of each task, without clobbering one mid-edit — a task
  // added or deleted elsewhere (or a save round-tripping through the server) should show
  // up or disappear, but a field the volunteer is still typing into shouldn't reset.
  useEffect(() => {
    if (!projectData?.tasks) return
    const tasks = projectData.tasks
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTaskDrafts((prev) => {
      const next: typeof prev = {}
      for (const t of tasks) {
        next[t.id] = prev[t.id] ?? { title: t.title, description: t.description ?? '' }
      }
      return next
    })
  }, [projectData?.tasks])

  const volunteerCreateMutation = useMutation(orpc.projects.create.mutationOptions())
  const adminCreateMutation = useMutation(orpc.admin.projects.create.mutationOptions())

  // The autosave line under the title: when the last save landed, or how to retry a failed one.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [retrySave, setRetrySave] = useState<(() => void) | null>(null)
  function saveSucceeded() {
    setLastSavedAt(new Date())
    setRetrySave(null)
  }
  function saveFailed<V>(mutate: (variables: V) => void, variables: V) {
    setRetrySave(() => () => mutate(variables))
  }

  const updateMutation = useMutation({
    ...orpc.projects.update.mutationOptions(),
    onSuccess: () => {
      saveSucceeded()
      queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
    },
    onError: (err: unknown, variables) => {
      toast(err instanceof Error ? err.message : 'Failed to save changes', 'error')
      saveFailed(updateMutation.mutate, variables)
    },
  })

  const deleteMutation = useMutation({
    ...orpc.projects.delete.mutationOptions(),
    onSuccess: () => router.push('/projects'),
    onError: (err: unknown) => {
      toast(err instanceof Error ? err.message : 'Failed to delete project', 'error')
      setShowDeleteProjectModal(false)
    },
  })

  const publishMutation = useMutation({
    ...orpc.projects.publishDraft.mutationOptions(),
    onSuccess: (_data, variables) => {
      toast(isOrgDraft ? 'Project published!' : 'Draft submitted for review!', 'success')
      setShowPublishModal(false)
      queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
      invalidateMyDrafts()
      const destination = isOrgDraft ? `/projects/${variables.id}` : '/dashboard#tab-projects'
      setTimeout(() => router.push(destination), 1500)
    },
    onError: (err: unknown) => {
      toast(err instanceof Error ? err.message : 'Failed to publish draft', 'error')
      setShowPublishModal(false)
    },
  })

  const deleteDraftMutation = useMutation({
    ...orpc.projects.deleteDraft.mutationOptions(),
    onSuccess: () => {
      toast('Draft deleted', 'success')
      invalidateMyDrafts()
      router.push(initialVariant === 'admin' || isOrgDraft ? '/admin/projects' : '/suggest')
    },
    onError: (err: unknown) => {
      toast(err instanceof Error ? err.message : 'Failed to delete draft', 'error')
      setShowDeleteDraftModal(false)
    },
  })

  const createTaskMutation = useMutation({
    ...orpc.projects.createTask.mutationOptions(),
    onSuccess: () => {
      saveSucceeded()
      queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
    },
    onError: (err: unknown, variables) => {
      toast(err instanceof Error ? err.message : 'Failed to create task', 'error')
      saveFailed(createTaskMutation.mutate, variables)
    },
  })

  const deleteTaskMutation = useMutation({
    ...orpc.projects.deleteTask.mutationOptions(),
    onSuccess: () => {
      saveSucceeded()
      queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
    },
    onError: (err: unknown, variables) => {
      toast(err instanceof Error ? err.message : 'Failed to delete task', 'error')
      saveFailed(deleteTaskMutation.mutate, variables)
    },
  })

  const updateTaskMutation = useMutation({
    ...orpc.projects.updateTask.mutationOptions(),
    onSuccess: () => {
      saveSucceeded()
      queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
    },
    onError: (err: unknown, variables) => {
      toast(err instanceof Error ? err.message : 'Failed to update task', 'error')
      saveFailed(updateTaskMutation.mutate, variables)
    },
  })

  const isSaving =
    creatingDraft ||
    updateMutation.isPending ||
    updateTaskMutation.isPending ||
    createTaskMutation.isPending ||
    deleteTaskMutation.isPending

  function buildCreatePayload(): CreateProjectInput {
    const [country, localGroup] = locationValue.split(':')
    return {
      title: title.trim() || 'Untitled draft',
      description: description.trim(),
      projectType: projectType || null,
      timeCommitmentHoursPerWeek: hoursPerWeek ? Number(hoursPerWeek) : null,
      urgency,
      country: country || null,
      localGroup: localGroup || null,
      teamId: teamId ? Number(teamId) : null,
      remoteEligibility: remoteEligibility as CreateProjectInput['remoteEligibility'],
      estimatedDuration: duration.trim() || null,
      collaborationLink: collaborationLink.trim() || null,
      startDate: fromDateInputValue(startDate),
      durationDays: durationDays ? parseInt(durationDays, 10) : null,
      skillIds: skills.map((s) => s.skillId),
      skillRequiredMap: Object.fromEntries(skills.map((s) => [s.skillId, true])),
      isSeekingHelp: seekingHelp,
      wantToOwn,
      tasks: [],
      saveAsDraft: true,
    }
  }

  // The /suggest and /admin/projects list pages cache their own "My Drafts" query — stale
  // after this component creates, publishes, or deletes a draft unless told to refetch.
  function invalidateMyDrafts() {
    queryClient.invalidateQueries({ queryKey: orpc.projects.myDrafts.key() })
    queryClient.invalidateQueries({ queryKey: orpc.admin.projects.myDrafts.key() })
  }

  // Creates the project the first time it's needed: once enough is written (see the autosave
  // effect below), or when the first task is added (a task needs a parent project id). A no-op
  // once an id already exists. A draft made this way leaves the form as it is, on screen, and
  // only moves the address to the edit page, so nothing jumps under the volunteer's cursor.
  async function ensureProjectExists(): Promise<number | null> {
    if (projectId !== undefined) return projectId
    // The timer and an Add Task click can both reach here before the first create lands.
    if (creation.current) return creation.current
    setCreatingDraft(true)
    setAutosaveError(null)
    const mutation = initialVariant === 'admin' ? adminCreateMutation : volunteerCreateMutation
    const sent = buildCreatePayload()
    creation.current = mutation
      .mutateAsync(sent)
      .then((result) => {
        setProjectId(result.id)
        // What is on screen is the truth; the copy just saved must not overwrite it.
        setInitialized(true)
        setPermissionChecked(true)
        window.history.replaceState(null, '', `/projects/${result.id}/edit`)
        invalidateMyDrafts()
        // Edits made while the create was in flight had no project to save to.
        const patch = changedSince(sent, latestPayload.current as CreateProjectInput, user?.id)
        if (patch) updateMutation.mutate({ id: result.id, ...patch })
        return result.id
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to save draft'
        toast(message, 'error')
        setAutosaveError(message)
        return null
      })
      .finally(() => {
        creation.current = null
        setCreatingDraft(false)
      })
    return creation.current
  }

  const readyToAutosave =
    projectId === undefined &&
    (title.trim().length >= AUTOSAVE_MIN_TITLE ||
      description.trim().length >= AUTOSAVE_MIN_DESCRIPTION)
  // Every field goes into the draft as it stands when the timer fires, so the timer restarts on
  // any change to the payload, not just the two fields that start it.
  const autosavePayloadKey = JSON.stringify(buildCreatePayload())
  // What a create would send now, for comparing with what an in-flight create did send.
  const latestPayload = useRef<CreateProjectInput | null>(null)
  useEffect(() => {
    latestPayload.current = buildCreatePayload()
  })
  useEffect(() => {
    if (!readyToAutosave || creatingDraft || autosaveError) return
    const timer = setTimeout(() => void ensureProjectExists(), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyToAutosave, creatingDraft, autosaveError, autosavePayloadKey])

  // Checked before any draft is created, since the server refuses to publish a project with
  // no tasks. The count is read fresh: just after a first task is added, the cached project
  // can still be the copy loaded before it existed.
  async function handleOpenPublishModal() {
    if (projectId === undefined && !title.trim()) {
      toast('A title is required, even for a draft.', 'error')
      return
    }
    let tasks = 0
    if (projectId !== undefined) {
      try {
        const fresh = await queryClient.fetchQuery({
          ...orpc.projects.getById.queryOptions({ input: { id: projectId } }),
          staleTime: 0,
        })
        tasks = fresh.tasks.length
      } catch (err: unknown) {
        toast(err instanceof Error ? err.message : 'Failed to load project', 'error')
        return
      }
    }
    if (tasks === 0) {
      setSubmitWithoutTasks(true)
      return
    }
    setShowPublishModal(true)
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    if (projectId === undefined && !title.trim()) {
      toast('A title is required, even for a draft.', 'error')
      return
    }
    const id = await ensureProjectExists()
    if (id === null) return
    try {
      await createTaskMutation.mutateAsync({
        projectId: id,
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim() || undefined,
      })
      setNewTaskTitle('')
      setNewTaskDescription('')
      // When the draft was just created, its first getById fetch can still be in flight here,
      // possibly having read the project before the task landed. Invalidating alone would not
      // refetch an in-flight initial load, so cancel it first.
      await queryClient.cancelQueries({ queryKey: orpc.projects.getById.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
    } catch {
      // createTaskMutation's onError already toasted.
    }
  }

  // Saves a task's title/description on blur, only if it actually changed from what's
  // currently persisted — otherwise every click into and out of a field would fire a
  // mutation.
  function handleTaskFieldBlur(
    projectId: number,
    task: { id: number; title: string; description: string | null },
  ) {
    const draft = taskDrafts[task.id]
    if (!draft || !draft.title.trim()) return
    const newTitle = draft.title.trim()
    const newDescription = draft.description.trim()
    if (newTitle === task.title && newDescription === (task.description ?? '')) return
    updateTaskMutation.mutate({
      projectId,
      taskId: task.id,
      data: { title: newTitle, description: newDescription || null },
    })
  }

  // Commits a single changed field once a project id exists — a no-op in new mode, where
  // fields just live in local state until the project is created.
  function commitField(patch: FieldPatch) {
    if (projectId === undefined) return
    updateMutation.mutate({ id: projectId, ...patch })
  }

  if (projectId !== undefined && loadingProject && !initialized) {
    return <div className="text-center py-10 text-text-light">Loading project…</div>
  }

  return (
    <>
      {projectId !== undefined && projectData && (
        <ChangesRequestedBanner
          projectId={projectId}
          requests={projectData.reviewRequests}
          canResubmit={
            user !== null &&
            (projectData.ownerId === user.id || projectData.proposedById === user.id)
          }
        />
      )}
      {(projectId === undefined || canEdit) && (
        <p role="status" className="text-sm text-text-light mt-0 mb-4">
          {isSaving ? (
            'Saving…'
          ) : autosaveError ? (
            <>
              <span className="text-error">Couldn&apos;t save.</span>{' '}
              <button
                type="button"
                className="underline cursor-pointer"
                onClick={() => setAutosaveError(null)}
              >
                Retry
              </button>
            </>
          ) : retrySave ? (
            <>
              <span className="text-error">Couldn&apos;t save.</span>{' '}
              <button type="button" className="underline cursor-pointer" onClick={retrySave}>
                Retry
              </button>
            </>
          ) : projectId === undefined ? (
            'Your draft saves automatically as you write.'
          ) : lastSavedAt ? (
            `Changes save automatically. Last saved ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
          ) : (
            'Changes save automatically.'
          )}
        </p>
      )}

      {isSaving && (
        <div
          aria-hidden="true"
          className="bg-surface border-brand-border text-text-light fixed bottom-4 left-6 z-[150] flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg"
        >
          <span
            aria-hidden="true"
            className="border-primary inline-block h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
          />
          Autosaving
        </div>
      )}

      {permissionChecked && !canEdit && (
        <div
          role="alert"
          className="flex items-center gap-3 p-4 rounded-lg mb-4 bg-red-100 text-red-800 border border-red-300 dark:bg-red-900 dark:text-red-300 dark:border-red-600"
        >
          You do not have permission to edit this project.
        </div>
      )}

      <div className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word">
        <div className="mb-5">
          <label htmlFor="project-title" className="required">
            Project Title
          </label>
          <input
            id="project-title"
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
            }}
            onBlur={() => {
              const next = title.trim()
              if (!next || next === (projectData?.title ?? '')) return
              commitField({ title: next })
            }}
            disabled={!canEdit}
            required
            placeholder="A clear, descriptive name for the project"
          />
          {isDraft && (projectData?.templateOriginId ?? null) !== null && (
            <p className="text-text-light mt-1 text-sm">
              Copied from a template — adjust the title so it&apos;s clear which local group or
              setting this copy is for.
            </p>
          )}
        </div>

        <div className="mb-5">
          <label htmlFor="project-description" className="required">
            Description
          </label>
          <DescriptionTips />
          <textarea
            id="project-description"
            rows={6}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
            }}
            onBlur={() => {
              const next = description.trim()
              if (next === (projectData?.description ?? '')) return
              commitField({ description: next })
            }}
            disabled={!canEdit}
            required
            placeholder="Describe the project: goals, approach, what success looks like, and what kind of help is needed."
          />
          <p className="text-sm text-text-light mt-1">
            The more detail you provide, the easier it is to find the right contributors and get
            started.
          </p>
        </div>

        <div className="mb-5">
          <FilterDropdown
            id="project-type"
            label="Project Type"
            ariaLabel="Select project type"
            value={projectType}
            options={PROJECT_TYPES}
            onChange={(v) => {
              setProjectType(v)
              commitField({ projectType: v || null })
            }}
          />
          <p className="text-sm text-text-light mt-1">
            This helps contributors understand the commitment involved
          </p>
        </div>

        <div className="grid grid-cols-2 gap-5 mb-5 max-[600px]:grid-cols-1">
          <div>
            <label htmlFor="hours-per-week">Hours per Week</label>
            <input
              id="hours-per-week"
              type="number"
              min={1}
              max={40}
              placeholder="e.g., 5"
              value={hoursPerWeek}
              onChange={(e) => {
                setHoursPerWeek(e.target.value)
              }}
              onBlur={() => {
                const next = hoursPerWeek ? Number(hoursPerWeek) : null
                if (next === (projectData?.timeCommitmentHoursPerWeek ?? null)) return
                commitField({ timeCommitmentHoursPerWeek: next })
              }}
              disabled={!canEdit}
            />
            <p className="text-sm text-text-light mt-1">
              Minimum time commitment for project members
            </p>
          </div>

          <div>
            <FilterDropdown
              id="urgency"
              label="Priority"
              ariaLabel="Select priority"
              value={urgency}
              options={URGENCY_OPTIONS}
              onChange={(v) => {
                setUrgency(v)
                commitField({ urgency: v })
              }}
            />
          </div>
        </div>

        {['sprint', 'container'].includes(projectType) && (
          <div className="mb-5">
            <label htmlFor="duration">Estimated Duration</label>
            <input
              id="duration"
              type="text"
              placeholder="e.g., 6 weeks, 2 months"
              value={duration}
              onChange={(e) => {
                setDuration(e.target.value)
              }}
              onBlur={() => {
                const next = duration.trim()
                if (next === (projectData?.estimatedDuration ?? '')) return
                commitField({ estimatedDuration: next })
              }}
              disabled={!canEdit}
            />
            <p className="text-sm text-text-light mt-1">
              Roughly how long do you expect this to take?
            </p>
          </div>
        )}

        <div className="mb-5">
          <FilterDropdown
            id="country"
            label="Country/Group"
            ariaLabel="Select country/group"
            value={locationValue}
            options={buildLocationOptions(allLocalGroups)}
            onChange={(v) => {
              setLocationValue(v)
              const [country, localGroup] = v.split(':')
              commitField({ country: country || null, localGroup: localGroup || null })
            }}
            searchable
          />
          <p className="text-sm text-text-light mt-1">
            Where is this project based? Local groups appear indented under their country.{' '}
            <a href="/suggest-local-group" className="underline">
              Don&apos;t see your group? Suggest one.
            </a>
          </p>
        </div>

        <div className="mb-5">
          <FilterDropdown
            id="team"
            label="Team"
            ariaLabel="Select team"
            value={teamId}
            options={[
              { value: '', label: 'No team: visible to everyone' },
              ...teams.map((t) => ({ value: String(t.id), label: t.name })),
            ]}
            onChange={(v) => {
              setTeamId(v)
              commitField({ teamId: v ? Number(v) : null })
            }}
            searchable
          />
          <p className="text-sm text-text-light mt-1">
            Assigning a team restricts visibility to that team, plus the owner and proposer.
          </p>
        </div>

        <div className="mb-5">
          <FilterDropdown
            id="remote-eligibility"
            label="Can this be done remotely?"
            ariaLabel="Select remote eligibility"
            value={remoteEligibility}
            options={REMOTE_ELIGIBILITY_OPTIONS}
            onChange={(v) => {
              setRemoteEligibility(v as 'NONE' | 'COUNTRY' | 'GLOBAL')
              commitField({ remoteEligibility: v as UpdateProjectInput['remoteEligibility'] })
            }}
          />
          <p className="text-sm text-text-light mt-1">
            Controls who gets project-match alerts outside the country above.
          </p>
        </div>

        {/* Timeline fields, offered for every project type — unlike the free-text estimate
            above, which is only asked for sprints and containers. */}
        <div className="mb-5 flex flex-wrap gap-3">
          <div>
            <label htmlFor="project-start-date">Start date</label>
            <input
              id="project-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              onBlur={() => {
                if (toDateInputValue(projectData?.startDate) === startDate) return
                commitField({ startDate: fromDateInputValue(startDate) })
              }}
              disabled={!canEdit}
            />
          </div>
          <div>
            <label htmlFor="project-duration-days">Duration (days)</label>
            <input
              id="project-duration-days"
              type="number"
              min="1"
              step="1"
              placeholder="from tasks"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              onBlur={() => {
                const next = durationDays ? parseInt(durationDays, 10) : null
                if (next === (projectData?.durationDays ?? null)) return
                commitField({ durationDays: next })
              }}
              disabled={!canEdit}
              className="w-30"
            />
          </div>
          {/* The deadline is the owner's promise, so it waits until the project exists and is
              set by its owner or an admin; the server holds the same line. */}
          {projectId !== undefined && (
            <div>
              <label htmlFor="project-deadline">Deadline (optional)</label>
              <input
                id="project-deadline"
                type="date"
                value={projectDeadline}
                onChange={(e) => setProjectDeadline(e.target.value)}
                onBlur={() => {
                  if (toDateInputValue(projectData?.deadline) === projectDeadline) return
                  commitField({ deadline: fromDateInputValue(projectDeadline) })
                }}
                disabled={
                  !canEdit || !(user?.isAdmin || projectData?.ownerId === user?.id || isDraft)
                }
              />
            </div>
          )}
          <p className="text-text-light basis-full text-sm">
            Used by the timeline view. Leave the duration empty to have the project span its own
            tasks. The deadline is the date the whole project should be done by; the timeline shows
            how far the plan lands from it.
          </p>
        </div>

        <div className="mb-5">
          <label htmlFor="collaboration-link">Collaboration Doc / Link (optional)</label>
          <input
            id="collaboration-link"
            type="url"
            placeholder="e.g., https://docs.google.com/…"
            value={collaborationLink}
            onChange={(e) => {
              setCollaborationLink(e.target.value)
            }}
            onBlur={() => {
              const next = collaborationLink.trim()
              if (next === (projectData?.collaborationLink ?? '')) return
              commitField({ collaborationLink: next || null })
            }}
            disabled={!canEdit}
          />
          <p className="text-sm text-text-light mt-1">
            A link (starting with https://) to a planning doc or workspace
          </p>
        </div>

        <div className="mb-5">
          <label>Skills Needed</label>
          <p className="text-sm text-text-light mt-0 mb-2">
            What skills would be helpful for this project?
          </p>
          <SkillPicker
            value={skills}
            onChange={
              canEdit
                ? (next) => {
                    setSkills(next)
                    commitField({
                      skillIds: next.map((s) => s.skillId),
                      skillRequiredMap: Object.fromEntries(next.map((s) => [s.skillId, true])),
                    })
                  }
                : () => {}
            }
          />
        </div>

        <div className="mb-5">
          <p className="font-medium mb-2">This project needs:</p>
          <div className="flex flex-col gap-2">
            <Checkbox
              checked={seekingHelp}
              onChange={(e) => {
                setSeekingHelp(e.target.checked)
                commitField({ isSeekingHelp: e.target.checked })
              }}
              disabled={!canEdit}
            >
              Help / contributors
            </Checkbox>
          </div>
        </div>

        {projectId !== undefined && (
          <div className="mb-5">
            <p className="font-medium mb-2">Finished tasks:</p>
            <Checkbox
              checked={autoAccept}
              onChange={(e) => {
                setAutoAccept(e.target.checked)
                commitField({ autoAcceptTasks: e.target.checked })
              }}
              disabled={!canEdit}
            >
              Accept submitted work automatically
            </Checkbox>
            <p className="text-sm text-text-light mt-1 mb-0">
              Helpers always say what they did. Turn this off to check each task before it counts as
              done.
            </p>
          </div>
        )}

        {/* Ownership is only settable here while it's still a draft. Once live, it's
            changed from the project page's owner menu instead. */}
        {isDraft && (
          <div className="mb-5">
            <p className="font-medium mb-2">Project ownership:</p>
            <div className="flex flex-col gap-2">
              <Radio
                name="ownership"
                checked={!wantToOwn}
                onChange={() => {
                  setWantToOwn(false)
                  commitField({ assigneeId: null })
                }}
                disabled={!canEdit}
              >
                This project needs an owner / lead
              </Radio>
              <Radio
                name="ownership"
                checked={wantToOwn}
                onChange={() => {
                  setWantToOwn(true)
                  commitField({ assigneeId: user?.id ?? null })
                }}
                disabled={!canEdit}
              >
                <span>
                  <strong>I want to lead this project</strong> &mdash; I&apos;ll be the owner and
                  coordinate the work
                </span>
              </Radio>
            </div>
          </div>
        )}

        {isDraft && canEdit && (
          <div className="mb-5">
            <label>
              Tasks <span className="text-error">*</span>
            </label>
            <p className="text-sm text-text-light mt-0 mb-2">
              Break the project into concrete tasks. This helps contributors understand the scope
              and gives them something to pick up.
            </p>
            {submitWithoutTasks && taskCount === 0 && (
              <p role="alert" className="text-sm text-error mt-0 mb-2">
                Add at least one task before submitting.
              </p>
            )}
            {projectId !== undefined &&
              projectData?.tasks.map((task) => {
                const draft = taskDrafts[task.id] ?? {
                  title: task.title,
                  description: task.description ?? '',
                }
                return (
                  <div
                    key={task.id}
                    className="bg-brand-bg rounded-lg p-4 mb-3 border border-brand-border"
                  >
                    <div className="mb-3">
                      <label htmlFor={`task-title-${task.id}`} className="text-sm required">
                        Task title
                      </label>
                      <input
                        id={`task-title-${task.id}`}
                        type="text"
                        value={draft.title}
                        onChange={(e) =>
                          setTaskDrafts((prev) => ({
                            ...prev,
                            [task.id]: { ...draft, title: e.target.value },
                          }))
                        }
                        onBlur={() => handleTaskFieldBlur(projectId, task)}
                        placeholder="e.g. Draft copy for homepage"
                      />
                    </div>
                    <div className="mb-2">
                      <label htmlFor={`task-desc-${task.id}`} className="text-sm">
                        Details (optional)
                      </label>
                      <textarea
                        id={`task-desc-${task.id}`}
                        value={draft.description}
                        onChange={(e) =>
                          setTaskDrafts((prev) => ({
                            ...prev,
                            [task.id]: { ...draft, description: e.target.value },
                          }))
                        }
                        onBlur={() => handleTaskFieldBlur(projectId, task)}
                        placeholder="More detail about what needs doing…"
                        className="min-h-14"
                      />
                    </div>
                    <div className="flex justify-end mt-2">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteTaskTarget({ projectId, taskId: task.id })}
                        disabled={deleteTaskMutation.isPending}
                      >
                        Delete task
                      </Button>
                    </div>
                  </div>
                )
              })}
            <div className="bg-brand-bg rounded-lg p-3 border border-brand-border">
              <div className="mb-2">
                <label htmlFor="new-task-title" className="text-sm required">
                  Task title
                </label>
                <input
                  id="new-task-title"
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="e.g. Draft copy for homepage"
                />
              </div>
              <div className="mb-2">
                <label htmlFor="new-task-description" className="text-sm">
                  Details (optional)
                </label>
                <textarea
                  id="new-task-description"
                  rows={2}
                  value={newTaskDescription}
                  onChange={(e) => setNewTaskDescription(e.target.value)}
                  placeholder="More detail about what needs doing…"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={handleAddTask}
                disabled={creatingDraft || createTaskMutation.isPending || !newTaskTitle.trim()}
              >
                {creatingDraft || createTaskMutation.isPending ? 'Adding…' : 'Add Task'}
              </Button>
            </div>
          </div>
        )}

        {isDraft && !isOrgDraft && (
          <div className="flex items-center gap-3 p-4 rounded-lg mb-5 bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-600">
            Your project will be reviewed by PauseAI team leads before being published. We&apos;ll
            reach out if we have questions or suggestions.
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          {projectId === undefined && (
            <Button type="button" onClick={handleOpenPublishModal} disabled={creatingDraft}>
              {isOrgDraft ? 'Publish' : 'Submit'}
            </Button>
          )}

          {projectId === undefined && (
            <Button
              type="button"
              variant="secondary"
              onClick={props.onCancel ?? (() => router.back())}
            >
              Cancel
            </Button>
          )}

          {projectId !== undefined && !isDraft && (
            <Button href={`/projects/${projectId}`} variant="secondary">
              View Project
            </Button>
          )}

          {projectId !== undefined && isDraft && canEdit && (
            <Button
              type="button"
              onClick={handleOpenPublishModal}
              disabled={publishMutation.isPending}
            >
              {isOrgDraft ? 'Publish' : 'Submit'}
            </Button>
          )}

          {projectId !== undefined && isDraft && canEdit && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setShowDeleteDraftModal(true)}
              disabled={deleteDraftMutation.isPending}
            >
              Delete Draft
            </Button>
          )}

          {projectId !== undefined && user?.isAdmin && projectData && !isDraft && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setShowDeleteProjectModal(true)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete Project'}
            </Button>
          )}
        </div>
      </div>

      {/* Opens only once a task exists, so the draft does too. */}
      {projectId !== undefined && (
        <Modal
          id="confirm-publish-draft"
          title={isOrgDraft ? 'Publish this project?' : 'Submit draft for review?'}
          isOpen={showPublishModal}
          onClose={() => setShowPublishModal(false)}
        >
          <p>
            {isOrgDraft ? (
              <>
                This will publish <strong className="italic">{title || 'this project'}</strong>{' '}
                immediately. It will be visible to volunteers straight away.
              </>
            ) : (
              <>
                This will submit <strong className="italic">{title || 'this project'}</strong> to
                PauseAI team leads for review.
              </>
            )}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowPublishModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => publishMutation.mutate({ id: projectId })}
              disabled={publishMutation.isPending}
            >
              {isOrgDraft
                ? publishMutation.isPending
                  ? 'Publishing…'
                  : 'Publish'
                : publishMutation.isPending
                  ? 'Submitting…'
                  : 'Submit for Review'}
            </Button>
          </div>
        </Modal>
      )}

      {projectId !== undefined && (
        <>
          <ConfirmDialog
            id="confirm-delete-project"
            title="Delete this project?"
            isOpen={showDeleteProjectModal}
            body={
              <p>
                This will permanently delete{' '}
                <strong className="italic">{title || 'this project'}</strong>, including its tasks,
                comments, and interest history. This cannot be undone.
              </p>
            }
            confirmLabel="Delete Project"
            busyLabel="Deleting…"
            danger
            busy={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate({ id: projectId })}
            onClose={() => setShowDeleteProjectModal(false)}
          />

          <ConfirmDialog
            id="confirm-delete-draft"
            title="Delete this draft?"
            isOpen={showDeleteDraftModal}
            body={
              <p>
                This will permanently delete{' '}
                <strong className="italic">{title || 'this draft'}</strong>, including any tasks
                you&apos;ve added. This cannot be undone.
              </p>
            }
            confirmLabel="Delete Draft"
            busyLabel="Deleting…"
            danger
            busy={deleteDraftMutation.isPending}
            onConfirm={() => deleteDraftMutation.mutate({ id: projectId })}
            onClose={() => setShowDeleteDraftModal(false)}
          />
        </>
      )}

      {deleteTaskTarget && (
        <ConfirmDialog
          id="confirm-delete-editor-task"
          title="Delete this task?"
          isOpen
          body="The task and anything posted on it are removed. This cannot be undone."
          confirmLabel="Delete task"
          busyLabel="Deleting…"
          danger
          busy={deleteTaskMutation.isPending}
          onConfirm={() => {
            deleteTaskMutation.mutate(deleteTaskTarget)
            setDeleteTaskTarget(null)
          }}
          onClose={() => setDeleteTaskTarget(null)}
        />
      )}
    </>
  )
}
