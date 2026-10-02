/**
 * Project + task serialisation for the export / edit / re-import flow.
 *
 * A project manager exports a project (its editable fields, all its tasks, and the
 * intra-project finish-to-start dependencies) to one JSON file, edits it by hand or with an
 * LLM, and re-uploads it. `computeProjectDiff` turns the file plus the live DB state into a
 * reviewable diff; `buildApplyPlan` turns the same pair into an ordered set of writes the
 * router runs in a single transaction.
 *
 * This module is pure — no Prisma, no oRPC. The router loads a `CurrentState` and passes it
 * in. `node:crypto` is the only import with a runtime, and nothing here is bundled for the
 * browser (the import page reads the diff type off the router's inferred output).
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'

// ── Live state the router hands in ────────────────────────────────────────────

export type CurrentProject = {
  id: number
  title: string
  description: string | null
  status: string
}

export type CurrentTask = {
  id: number
  title: string
  description: string | null
  status: string
  assigneeId: number | null
  assigneeEmail: string | null
  deadline: Date | null
  startDate: Date | null
  durationDays: number | null
  /** Read by applyScheduleWrite in the router; not part of the diff or the hash. */
  baselineSetAt: Date | null
  featuredAsQuickTask: boolean
  isAnchor: boolean
  timing: 'flexible' | 'fixed'
  sortOrder: number | null
}

export type CurrentDependency = {
  predecessorId: number
  successorId: number
  lagDays: number
}

export type CurrentState = {
  project: CurrentProject
  tasks: CurrentTask[]
  dependencies: CurrentDependency[]
}

// ── File schema ──────────────────────────────────────────────────────────────

const PROJECT_STATUSES = [
  'draft',
  'pending_review',
  'needs_discussion',
  'ready',
  'in_progress',
  'on_hold',
  'completed',
  'archived',
] as const

const TASK_STATUSES = ['open', 'in_progress', 'completed'] as const

/**
 * Bounds on how much one file may ask for. The byte cap on the upload alone would allow tens
 * of thousands of tasks, each of which becomes a row written inside a single transaction — so
 * the count is capped here, where it is refused before any of that work begins. The largest
 * real project has 38 tasks.
 */
const MAX_TASKS_PER_IMPORT = 1000
const MAX_DEPENDENCIES_PER_TASK = 100

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be written as YYYY-MM-DD')
  .nullable()

const DependsOnSchema = z.object({
  /** A `ref` of another task in the file, or the numeric `id` of an existing task. */
  on: z.union([z.string().min(1).max(64), z.number().int().positive()]),
  lagDays: z.number().int().min(-365).max(365).optional(),
})

/**
 * Fields left out (`undefined`) mean "not specified": on an existing row they are untouched,
 * on a new row the system default applies. `null` is an explicit clear. `dependsOn` omitted
 * leaves a row's existing links alone; `dependsOn: []` clears them.
 */
const ImportTaskSchema = z.object({
  id: z.number().int().positive().optional(),
  ref: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeEmail: z.string().email().nullable().optional(),
  deadline: ymd.optional(),
  startDate: ymd.optional(),
  durationDays: z.number().int().min(0).max(3650).nullable().optional(),
  featuredAsQuickTask: z.boolean().optional(),
  isAnchor: z.boolean().optional(),
  timing: z.enum(['flexible', 'fixed']).optional(),
  dependsOn: z.array(DependsOnSchema).max(MAX_DEPENDENCIES_PER_TASK).optional(),
})

const ImportProjectSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
})

export const ProjectImportFileSchema = z.object({
  _meta: z
    .object({
      format: z.string().optional(),
      version: z.number().int().optional(),
      projectId: z.number().int().optional(),
      exportedAt: z.string().optional(),
      baseHash: z.string().nullable().optional(),
    })
    .optional(),
  project: ImportProjectSchema,
  tasks: z.array(ImportTaskSchema).max(MAX_TASKS_PER_IMPORT),
})

export type ProjectImportFile = z.infer<typeof ProjectImportFileSchema>
export type ImportTask = z.infer<typeof ImportTaskSchema>

// ── Export payload ───────────────────────────────────────────────────────────

export type ProjectExportPayload = {
  /**
   * Editors validate a JSON file against whatever URL this points at, so a bad hand-edit is
   * flagged in the editor before anyone tries to upload it. The importer ignores the key —
   * unknown top-level fields are stripped — so it is purely a hint to tooling.
   */
  $schema?: string
  _meta: {
    format: 'catalyse-project-export'
    version: 1
    projectId: number
    exportedAt: string
    baseHash: string
    /** Where the rules for editing this file live, so a file pasted alone still explains itself. */
    docs?: string
    /** Machine-readable counterpart of `docs`, for editors and assistants that fetch schemas. */
    schema?: string
  }
  project: { id: number; title: string; description: string | null; status: string }
  tasks: Array<{
    id: number
    title: string
    description: string | null
    status: string
    assigneeEmail: string | null
    deadline: string | null
    startDate: string | null
    durationDays: number | null
    featuredAsQuickTask: boolean
    isAnchor: boolean
    timing: 'flexible' | 'fixed'
    dependsOn: Array<{ on: number; lagDays: number }>
  }>
}

function toYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

export function fromYmd(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

function sortedTasks(state: CurrentState): CurrentTask[] {
  return [...state.tasks].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
}

export function serializeProjectExport(state: CurrentState, appUrl?: string): ProjectExportPayload {
  const base = appUrl?.replace(/\/$/, '')
  return {
    ...(base ? { $schema: `${base}/api/project-import/schema` } : {}),
    _meta: {
      format: 'catalyse-project-export',
      version: 1,
      projectId: state.project.id,
      exportedAt: new Date().toISOString(),
      baseHash: hashState(state),
      // Only when the deployment knows its own URL — a relative path in a downloaded file
      // would point nowhere.
      ...(base
        ? {
            docs: `${base}/projects/${state.project.id}/import`,
            schema: `${base}/api/project-import/schema`,
          }
        : {}),
    },
    project: {
      id: state.project.id,
      title: state.project.title,
      description: state.project.description,
      status: state.project.status,
    },
    tasks: sortedTasks(state).map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      assigneeEmail: t.assigneeEmail,
      deadline: toYmd(t.deadline),
      startDate: toYmd(t.startDate),
      durationDays: t.durationDays,
      featuredAsQuickTask: t.featuredAsQuickTask,
      isAnchor: t.isAnchor,
      timing: t.timing,
      dependsOn: state.dependencies
        .filter((d) => d.successorId === t.id)
        .sort((a, b) => a.predecessorId - b.predecessorId)
        .map((d) => ({ on: d.predecessorId, lagDays: d.lagDays })),
    })),
  }
}

// ── Content hash (optimistic concurrency) ────────────────────────────────────

/**
 * A hash over just the mutable projection, with keys and arrays in a fixed order, so a
 * cosmetic re-ordering of the export does not change it but any real edit does.
 */
function canonicalise(state: CurrentState): string {
  const project = {
    id: state.project.id,
    title: state.project.title,
    description: state.project.description ?? null,
    status: state.project.status,
  }
  const tasks = [...state.tasks]
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      assigneeEmail: t.assigneeEmail ?? null,
      deadline: toYmd(t.deadline),
      startDate: toYmd(t.startDate),
      durationDays: t.durationDays ?? null,
      featuredAsQuickTask: t.featuredAsQuickTask,
      isAnchor: t.isAnchor,
      timing: t.timing,
    }))
    .sort((a, b) => a.id - b.id)
  const dependencies = [...state.dependencies]
    .map((d) => ({ p: d.predecessorId, s: d.successorId, lag: d.lagDays }))
    .sort((a, b) => a.p - b.p || a.s - b.s)
  return JSON.stringify({ project, tasks, dependencies })
}

export function hashState(state: CurrentState): string {
  return `sha256:${createHash('sha256').update(canonicalise(state)).digest('hex')}`
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export type ParseResult = { ok: true; file: ProjectImportFile } | { ok: false; error: string }

export function parseImportFile(text: string): ParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `File is not valid JSON: ${(e as Error).message}` }
  }
  const parsed = ProjectImportFileSchema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    }
  }
  return { ok: true, file: parsed.data }
}

// ── Diff model ───────────────────────────────────────────────────────────────

export type FieldChange = { field: string; from: unknown; to: unknown }
export type DiffScope = 'file' | 'project' | 'task' | 'dependency'
export type DiffError = { scope: DiffScope; ref?: string; message: string }
export type EntityIdentity = { id?: number; ref?: string; title: string }

export type TaskDiffEntry = {
  op: 'create' | 'update' | 'delete' | 'noop'
  identity: EntityIdentity
  fieldChanges: FieldChange[]
}

export type DependencyDiffEntry = {
  op: 'create' | 'delete' | 'update' | 'noop'
  predecessor: EntityIdentity
  successor: EntityIdentity
  lagDays: number
  fieldChanges?: FieldChange[]
}

export type ImportDiff = {
  meta: { projectId: number; fileHash: string | null; currentHash: string; stale: boolean }
  project: { op: 'update' | 'noop'; fieldChanges: FieldChange[] }
  tasks: TaskDiffEntry[]
  dependencies: DependencyDiffEntry[]
  errors: DiffError[]
  warnings: string[]
}

export function emptyDiffWithErrors(state: CurrentState, errors: DiffError[]): ImportDiff {
  return {
    meta: {
      projectId: state.project.id,
      fileHash: null,
      currentHash: hashState(state),
      stale: false,
    },
    project: { op: 'noop', fieldChanges: [] },
    tasks: [],
    dependencies: [],
    errors,
    warnings: [],
  }
}

// ── Shared analysis ──────────────────────────────────────────────────────────

const TASK_FIELDS = [
  'title',
  'description',
  'status',
  'assigneeEmail',
  'deadline',
  'startDate',
  'durationDays',
  'featuredAsQuickTask',
  'isAnchor',
  'timing',
] as const

type NormalisedTask = {
  title: string
  description: string | null
  status: string
  assigneeEmail: string | null
  deadline: string | null
  startDate: string | null
  durationDays: number | null
  featuredAsQuickTask: boolean
  isAnchor: boolean
  timing: 'flexible' | 'fixed'
}

function normaliseCurrent(t: CurrentTask): NormalisedTask {
  return {
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    assigneeEmail: t.assigneeEmail ?? null,
    deadline: toYmd(t.deadline),
    startDate: toYmd(t.startDate),
    durationDays: t.durationDays ?? null,
    featuredAsQuickTask: t.featuredAsQuickTask,
    isAnchor: t.isAnchor,
    timing: t.timing,
  }
}

type TaskNode = {
  kind: 'create' | 'update' | 'delete'
  /** Positive = an existing task id (also used as its cycle-graph id). Negative = a new row. */
  localId: number
  currentId: number | null
  ref?: string
  title: string
  fileTask?: ImportTask
  current?: CurrentTask
  fieldChanges: FieldChange[]
}

type ProspectiveEdge = { predLocal: number; succLocal: number; lagDays: number }

type Analysis = {
  errors: DiffError[]
  warnings: string[]
  projectFieldChanges: FieldChange[]
  nodes: TaskNode[]
  identityByLocal: Map<number, EntityIdentity>
  prospectiveEdges: ProspectiveEdge[]
  createSortBase: number
  assigneeEmails: string[]
  fileHash: string | null
}

function analyse(state: CurrentState, file: ProjectImportFile): Analysis {
  const errors: DiffError[] = []
  const warnings: string[] = []

  // Project ---------------------------------------------------------------
  if (file.project.id !== undefined && file.project.id !== state.project.id) {
    errors.push({
      scope: 'project',
      message: `File is for project ${file.project.id}, but you are importing into project ${state.project.id}`,
    })
  }
  const projectFieldChanges: FieldChange[] = []
  if (file.project.title !== state.project.title) {
    projectFieldChanges.push({ field: 'title', from: state.project.title, to: file.project.title })
  }
  if (
    file.project.description !== undefined &&
    (file.project.description ?? null) !== (state.project.description ?? null)
  ) {
    projectFieldChanges.push({
      field: 'description',
      from: state.project.description ?? null,
      to: file.project.description ?? null,
    })
  }
  // A project's status is a lifecycle transition — some of it admin-only, some of it gated on
  // review — so it is not something a file may perform. An unchanged status round-trips
  // silently; a changed one is refused loudly, because quietly ignoring it would leave someone
  // believing they had published.
  if (file.project.status !== undefined && file.project.status !== state.project.status) {
    errors.push({
      scope: 'project',
      message: `Status cannot be changed by import. Change it on the project page instead (this file asks for "${file.project.status}", the project is "${state.project.status}").`,
    })
  }

  // Task pairing --------------------------------------------------------------
  const currentById = new Map(state.tasks.map((t) => [t.id, t]))
  const seenIds = new Set<number>()
  const seenRefs = new Set<string>()
  const nodes: TaskNode[] = []
  const nodeByRef = new Map<string, TaskNode>()
  let nextTempId = -1

  file.tasks.forEach((ft) => {
    if (ft.ref !== undefined) {
      if (seenRefs.has(ft.ref)) {
        errors.push({ scope: 'task', ref: ft.ref, message: `Duplicate ref "${ft.ref}"` })
        return
      }
      seenRefs.add(ft.ref)
    }
    if (ft.id !== undefined) {
      if (seenIds.has(ft.id)) {
        errors.push({ scope: 'task', ref: ft.ref, message: `Duplicate id ${ft.id}` })
        return
      }
      seenIds.add(ft.id)
      const current = currentById.get(ft.id)
      if (!current) {
        errors.push({
          scope: 'task',
          ref: ft.ref,
          message: `id ${ft.id} is not a task of this project`,
        })
        return
      }
      const fieldChanges = diffTaskFields(current, ft)
      const node: TaskNode = {
        kind: 'update',
        localId: ft.id,
        currentId: ft.id,
        ref: ft.ref,
        title: ft.title,
        fileTask: ft,
        current,
        fieldChanges,
      }
      nodes.push(node)
      if (ft.ref !== undefined) nodeByRef.set(ft.ref, node)
    } else {
      const node: TaskNode = {
        kind: 'create',
        localId: nextTempId--,
        currentId: null,
        ref: ft.ref,
        title: ft.title,
        fileTask: ft,
        fieldChanges: createTaskFieldList(ft),
      }
      nodes.push(node)
      if (ft.ref !== undefined) nodeByRef.set(ft.ref, node)
    }
  })

  const claimedIds = new Set(nodes.filter((n) => n.kind === 'update').map((n) => n.currentId!))
  for (const cur of state.tasks) {
    if (!claimedIds.has(cur.id)) {
      nodes.push({
        kind: 'delete',
        localId: cur.id,
        currentId: cur.id,
        title: cur.title,
        current: cur,
        fieldChanges: [],
      })
    }
  }

  const identityByLocal = new Map<number, EntityIdentity>()
  for (const n of nodes) {
    identityByLocal.set(n.localId, {
      ...(n.currentId !== null ? { id: n.currentId } : {}),
      ...(n.ref !== undefined ? { ref: n.ref } : {}),
      title: n.title,
    })
  }

  // Dependency resolution --------------------------------------------------
  const nodeByLocal = new Map(nodes.map((n) => [n.localId, n]))
  const liveNodeIds = new Set(nodes.filter((n) => n.kind !== 'delete').map((n) => n.localId))
  const prospectiveEdges: ProspectiveEdge[] = []
  const assigneeEmails = new Set<string>()

  const resolveOn = (on: string | number, forRef: string | undefined): number | null => {
    if (typeof on === 'number') {
      if (currentById.has(on)) {
        // May be a delete row; the edge is dropped either way, but flag an outright bad ref.
        return on
      }
      errors.push({
        scope: 'dependency',
        ref: forRef,
        message: `dependsOn references id ${on}, which is not a task of this project`,
      })
      return null
    }
    const target = nodeByRef.get(on)
    if (!target) {
      errors.push({
        scope: 'dependency',
        ref: forRef,
        message: `dependsOn references ref "${on}", which no task in the file declares`,
      })
      return null
    }
    return target.localId
  }

  for (const node of nodes) {
    if (node.kind === 'delete' || !node.fileTask) continue
    const ft = node.fileTask

    if (ft.assigneeEmail) assigneeEmails.add(ft.assigneeEmail)

    if (ft.dependsOn === undefined) {
      // Leave this successor's existing links untouched.
      if (node.kind === 'update' && node.currentId !== null) {
        for (const e of state.dependencies) {
          if (e.successorId === node.currentId) {
            prospectiveEdges.push({
              predLocal: e.predecessorId,
              succLocal: e.successorId,
              lagDays: e.lagDays,
            })
          }
        }
      }
      continue
    }

    for (const dep of ft.dependsOn) {
      const predLocal = resolveOn(dep.on, ft.ref)
      if (predLocal === null) continue
      if (predLocal === node.localId) {
        errors.push({
          scope: 'dependency',
          ref: ft.ref,
          message: `"${node.title}" cannot depend on itself`,
        })
        continue
      }
      if (!liveNodeIds.has(predLocal) || !nodeByLocal.has(predLocal)) {
        errors.push({
          scope: 'dependency',
          ref: ft.ref,
          message: `"${node.title}" depends on a task that the file deletes or does not contain`,
        })
        continue
      }
      prospectiveEdges.push({
        predLocal,
        succLocal: node.localId,
        lagDays: dep.lagDays ?? 0,
      })
    }
  }

  const createSortBase = state.tasks.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), 0)

  return {
    errors,
    warnings,
    projectFieldChanges,
    nodes,
    identityByLocal,
    prospectiveEdges,
    createSortBase,
    assigneeEmails: [...assigneeEmails],
    fileHash: file._meta?.baseHash ?? null,
  }
}

function diffTaskFields(cur: CurrentTask, ft: ImportTask): FieldChange[] {
  const curN = normaliseCurrent(cur) as unknown as Record<string, unknown>
  const ftR = ft as unknown as Record<string, unknown>
  const out: FieldChange[] = []
  for (const field of TASK_FIELDS) {
    const to = ftR[field]
    if (to === undefined) continue
    const from = curN[field]
    if (!Object.is(from ?? null, to ?? null))
      out.push({ field, from: from ?? null, to: to ?? null })
  }
  return out
}

function createTaskFieldList(ft: ImportTask): FieldChange[] {
  const effective: NormalisedTask = {
    title: ft.title,
    description: ft.description ?? null,
    status: ft.status ?? 'open',
    assigneeEmail: ft.assigneeEmail ?? null,
    deadline: ft.deadline ?? null,
    startDate: ft.startDate ?? null,
    durationDays: ft.durationDays ?? null,
    featuredAsQuickTask: ft.featuredAsQuickTask ?? false,
    isAnchor: ft.isAnchor ?? false,
    timing: ft.timing ?? 'flexible',
  }
  const rec = effective as unknown as Record<string, unknown>
  const out: FieldChange[] = []
  for (const field of TASK_FIELDS) {
    const v = rec[field]
    // Only what differs from a blank task is worth listing; `flexible` is the timing default.
    if (v !== null && v !== false && v !== '' && v !== 'flexible')
      out.push({ field, from: null, to: v })
  }
  return out
}

// ── Public: diff ─────────────────────────────────────────────────────────────

export function computeProjectDiff(state: CurrentState, file: ProjectImportFile): ImportDiff {
  const a = analyse(state, file)
  const currentHash = hashState(state)

  const tasks: TaskDiffEntry[] = a.nodes.map((n) => ({
    op: n.kind === 'update' ? (n.fieldChanges.length > 0 ? 'update' : 'noop') : n.kind,
    identity: a.identityByLocal.get(n.localId)!,
    fieldChanges: n.fieldChanges,
  }))

  // Dependency diff: prospective (local-id) edges vs current (real-id) edges. An existing
  // task's localId equals its real id, so positive-keyed edges compare directly.
  const key = (p: number, s: number) => `${p}:${s}`
  const prospectiveByKey = new Map(
    a.prospectiveEdges.map((e) => [key(e.predLocal, e.succLocal), e]),
  )
  const currentByKey = new Map(
    state.dependencies.map((e) => [key(e.predecessorId, e.successorId), e]),
  )
  const identity = (local: number): EntityIdentity =>
    a.identityByLocal.get(local) ?? { id: local, title: `#${local}` }

  const dependencies: DependencyDiffEntry[] = []
  for (const e of a.prospectiveEdges) {
    const existing =
      e.predLocal > 0 && e.succLocal > 0
        ? currentByKey.get(key(e.predLocal, e.succLocal))
        : undefined
    if (existing) {
      dependencies.push({
        op: existing.lagDays === e.lagDays ? 'noop' : 'update',
        predecessor: identity(e.predLocal),
        successor: identity(e.succLocal),
        lagDays: e.lagDays,
        ...(existing.lagDays === e.lagDays
          ? {}
          : { fieldChanges: [{ field: 'lagDays', from: existing.lagDays, to: e.lagDays }] }),
      })
    } else {
      dependencies.push({
        op: 'create',
        predecessor: identity(e.predLocal),
        successor: identity(e.succLocal),
        lagDays: e.lagDays,
      })
    }
  }
  for (const e of state.dependencies) {
    if (!prospectiveByKey.has(key(e.predecessorId, e.successorId))) {
      dependencies.push({
        op: 'delete',
        predecessor: identity(e.predecessorId),
        successor: identity(e.successorId),
        lagDays: e.lagDays,
      })
    }
  }

  const errors = [...a.errors]
  const cycle = findCycle(a.prospectiveEdges)
  if (cycle) {
    const names = cycle.map((local) => identity(local).title)
    errors.push({
      scope: 'dependency',
      message: `These dependencies form a loop: ${names.join(' → ')}`,
    })
  }

  const warnings = [...a.warnings]
  const stale = a.fileHash !== null && a.fileHash !== currentHash
  if (stale) {
    warnings.push(
      'This file was exported before the project last changed. Applying it may overwrite newer edits — re-export to be safe.',
    )
  }

  return {
    meta: { projectId: state.project.id, fileHash: a.fileHash, currentHash, stale },
    project: {
      op: a.projectFieldChanges.length > 0 ? 'update' : 'noop',
      fieldChanges: a.projectFieldChanges,
    },
    tasks,
    dependencies,
    errors,
    warnings,
  }
}

/** DFS cycle finder over local ids — same shape as findDependencyCycle in lib/schedule.ts. */
function findCycle(edges: ProspectiveEdge[]): number[] | null {
  const succ = new Map<number, number[]>()
  for (const e of edges) {
    const list = succ.get(e.predLocal)
    if (list) list.push(e.succLocal)
    else succ.set(e.predLocal, [e.succLocal])
  }
  const UNVISITED = 0
  const IN_STACK = 1
  const DONE = 2
  const stateOf = new Map<number, number>()
  const path: number[] = []
  const visit = (id: number): number[] | null => {
    stateOf.set(id, IN_STACK)
    path.push(id)
    for (const next of succ.get(id) ?? []) {
      const s = stateOf.get(next) ?? UNVISITED
      if (s === IN_STACK) return path.slice(path.indexOf(next)).concat(next)
      if (s === UNVISITED) {
        const c = visit(next)
        if (c) return c
      }
    }
    path.pop()
    stateOf.set(id, DONE)
    return null
  }
  for (const id of succ.keys()) {
    if ((stateOf.get(id) ?? UNVISITED) === UNVISITED) {
      const c = visit(id)
      if (c) return c
    }
  }
  return null
}

// ── Public: apply plan ───────────────────────────────────────────────────────

export type TaskWriteFields = {
  title?: string
  description?: string | null
  status?: string
  assigneeEmail?: string | null
  deadline?: Date | null
  startDate?: Date | null
  durationDays?: number | null
  featuredAsQuickTask?: boolean
  isAnchor?: boolean
  timing?: 'flexible' | 'fixed'
}

export type LocalRef = { kind: 'existing'; id: number } | { kind: 'created'; ref: string }

export type ApplyPlan = {
  errors: DiffError[]
  /** Never carries `status` — see the refusal in `analyse`. */
  project: Partial<{ title: string; description: string | null }>
  taskUpdates: Array<{ id: number; fields: TaskWriteFields }>
  taskCreates: Array<{ ref?: string; fields: TaskWriteFields }>
  taskDeletes: number[]
  createSortBase: number
  assigneeEmails: string[]
  dependencyPlan: {
    creates: Array<{ predecessor: LocalRef; successor: LocalRef; lagDays: number }>
    updates: Array<{ predecessorId: number; successorId: number; lagDays: number }>
    deletes: Array<{ predecessorId: number; successorId: number }>
  }
}

function writeFieldsForUpdate(node: TaskNode): TaskWriteFields {
  const ft = node.fileTask!
  const fields: TaskWriteFields = {}
  const changed = new Set(node.fieldChanges.map((c) => c.field))
  if (changed.has('title')) fields.title = ft.title
  if (changed.has('description')) fields.description = ft.description ?? null
  if (changed.has('status')) fields.status = ft.status
  if (changed.has('assigneeEmail')) fields.assigneeEmail = ft.assigneeEmail ?? null
  if (changed.has('deadline')) fields.deadline = fromYmd(ft.deadline ?? null)
  if (changed.has('startDate')) fields.startDate = fromYmd(ft.startDate ?? null)
  if (changed.has('durationDays')) fields.durationDays = ft.durationDays ?? null
  if (changed.has('featuredAsQuickTask')) fields.featuredAsQuickTask = ft.featuredAsQuickTask
  if (changed.has('isAnchor')) fields.isAnchor = ft.isAnchor
  if (changed.has('timing')) fields.timing = ft.timing
  return fields
}

function writeFieldsForCreate(ft: ImportTask): TaskWriteFields {
  return {
    title: ft.title,
    description: ft.description ?? null,
    status: ft.status ?? 'open',
    assigneeEmail: ft.assigneeEmail ?? null,
    deadline: fromYmd(ft.deadline ?? null),
    startDate: fromYmd(ft.startDate ?? null),
    durationDays: ft.durationDays ?? null,
    featuredAsQuickTask: ft.featuredAsQuickTask ?? false,
    isAnchor: ft.isAnchor ?? false,
    timing: ft.timing ?? 'flexible',
  }
}

/**
 * `keepTaskIds` are deletion candidates (in the project, absent from the file) that the user
 * chose to keep. They are folded in as untouched rows so they survive the import with their
 * fields and dependency links intact.
 */
export function buildApplyPlan(
  state: CurrentState,
  file: ProjectImportFile,
  keepTaskIds: number[] = [],
): ApplyPlan {
  const keepSet = new Set(keepTaskIds)
  const fileTaskIds = new Set(
    file.tasks.map((t) => t.id).filter((v): v is number => v !== undefined),
  )
  const kept: ImportTask[] = state.tasks
    .filter((t) => keepSet.has(t.id) && !fileTaskIds.has(t.id))
    .map((t) => ({ id: t.id, title: t.title }))
  const effectiveFile: ProjectImportFile =
    kept.length > 0 ? { ...file, tasks: [...file.tasks, ...kept] } : file

  const a = analyse(state, effectiveFile)
  const errors = [...a.errors]
  const cycle = findCycle(a.prospectiveEdges)
  if (cycle) errors.push({ scope: 'dependency', message: 'These dependencies form a loop' })

  const project: ApplyPlan['project'] = {}
  for (const change of a.projectFieldChanges) {
    if (change.field === 'title') project.title = change.to as string
    if (change.field === 'description') project.description = (change.to as string | null) ?? null
  }

  const taskUpdates: ApplyPlan['taskUpdates'] = []
  const taskCreates: ApplyPlan['taskCreates'] = []
  const taskDeletes: number[] = []
  for (const node of a.nodes) {
    if (node.kind === 'update' && node.fieldChanges.length > 0) {
      taskUpdates.push({ id: node.currentId!, fields: writeFieldsForUpdate(node) })
    } else if (node.kind === 'create') {
      taskCreates.push({ ref: node.ref, fields: writeFieldsForCreate(node.fileTask!) })
    } else if (node.kind === 'delete') {
      taskDeletes.push(node.currentId!)
    }
  }

  // Dependency reconciliation, expressed against local refs so the router can resolve
  // newly-created ids after it inserts them.
  const toLocalRef = (local: number): LocalRef => {
    if (local > 0) return { kind: 'existing', id: local }
    const ident = a.identityByLocal.get(local)
    return { kind: 'created', ref: ident?.ref ?? String(local) }
  }
  const key = (p: number, s: number) => `${p}:${s}`
  const prospectiveByKey = new Map(
    a.prospectiveEdges.map((e) => [key(e.predLocal, e.succLocal), e]),
  )
  const currentByKey = new Map(
    state.dependencies.map((e) => [key(e.predecessorId, e.successorId), e]),
  )

  const creates: ApplyPlan['dependencyPlan']['creates'] = []
  const updates: ApplyPlan['dependencyPlan']['updates'] = []
  for (const e of a.prospectiveEdges) {
    const existing =
      e.predLocal > 0 && e.succLocal > 0
        ? currentByKey.get(key(e.predLocal, e.succLocal))
        : undefined
    if (existing) {
      if (existing.lagDays !== e.lagDays) {
        updates.push({ predecessorId: e.predLocal, successorId: e.succLocal, lagDays: e.lagDays })
      }
    } else {
      creates.push({
        predecessor: toLocalRef(e.predLocal),
        successor: toLocalRef(e.succLocal),
        lagDays: e.lagDays,
      })
    }
  }
  const deletes: ApplyPlan['dependencyPlan']['deletes'] = []
  for (const e of state.dependencies) {
    if (!prospectiveByKey.has(key(e.predecessorId, e.successorId))) {
      deletes.push({ predecessorId: e.predecessorId, successorId: e.successorId })
    }
  }

  return {
    errors,
    project,
    taskUpdates,
    taskCreates,
    taskDeletes,
    createSortBase: a.createSortBase,
    assigneeEmails: a.assigneeEmails,
    dependencyPlan: { creates, updates, deletes },
  }
}
