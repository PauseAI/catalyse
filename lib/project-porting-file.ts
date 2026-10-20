/**
 * What a project export file holds and how it is read: the live state a router loads, the
 * schema an upload is checked against, and the payload an export writes. No runtime beyond
 * zod, so the import guide and template pages can use it in the browser; the hashing, diff
 * and apply plan stay in `project-porting.ts`.
 */

import { z } from 'zod'
import { addDays } from './schedule'

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
  submissionPrompt: string | null
  submissionAsksLink: boolean
  helpersWanted: number | null
  sortOrder: number | null
}

export type CurrentDependency = {
  predecessorId: number
  successorId: number
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

const TASK_STATUSES = ['not_started', 'in_progress', 'completed'] as const

/** Files exported before the status split say `open` for `not_started`. */
const TaskStatusFieldSchema = z
  .enum([...TASK_STATUSES, 'open'])
  .transform((s) => (s === 'open' ? 'not_started' : s))

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

/** Unknown keys are stripped, so a `lagDays` from a file exported when links had one is ignored. */
const DependsOnSchema = z.object({
  /** A `ref` of another task in the file, or the numeric `id` of an existing task. */
  on: z.union([z.string().min(1).max(64), z.number().int().positive()]),
})

/**
 * Fields left out (`undefined`) mean "not specified": on an existing row they are untouched,
 * on a new row the system default applies. `null` is an explicit clear. `dependsOn` omitted
 * leaves a row's existing links alone; `dependsOn: []` clears them.
 */
const ImportTaskSchema = z
  .object({
    id: z.number().int().positive().optional(),
    ref: z.string().min(1).max(64).optional(),
    title: z.string().min(1).max(300),
    description: z.string().max(20_000).nullable().optional(),
    status: TaskStatusFieldSchema.optional(),
    assigneeEmail: z.string().email().nullable().optional(),
    deadline: ymd.optional(),
    startDate: ymd.optional(),
    durationDays: z.number().int().min(0).max(3650).nullable().optional(),
    featuredAsQuickTask: z.boolean().optional(),
    isAnchor: z.boolean().optional(),
    timing: z.enum(['flexible', 'fixed']).optional(),
    submissionPrompt: z.string().max(200).nullable().optional(),
    submissionAsksLink: z.boolean().optional(),
    helpersWanted: z.number().int().min(1).max(100).nullable().optional(),
    dependsOn: z.array(DependsOnSchema).max(MAX_DEPENDENCIES_PER_TASK).optional(),
  })
  .transform((t) => {
    // A task ends on its deadline and stores no length but a milestone's zero. A length given
    // anyway becomes the deadline it implies from the start.
    if (!t.durationDays) return t
    const start = fromYmd(t.startDate)
    const implied = start ? toYmd(addDays(start, t.durationDays - 1)) : undefined
    return { ...t, durationDays: null, deadline: t.deadline ?? implied }
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
    submissionPrompt: string | null
    submissionAsksLink: boolean
    helpersWanted: number | null
    dependsOn: Array<{ on: number }>
  }>
}

export function toYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

export function fromYmd(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}
