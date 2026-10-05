/**
 * Project template serialisation and instantiation.
 *
 * A "template" is a location- and people-free copy of a project's structure — tasks, schedule
 * offsets, finish-to-start dependencies, and skill tags — that an admin can save from an
 * existing project (`serializeProjectAsTemplate`) or build from scratch, then later spin up as
 * a brand-new draft project in a different country/local group (`buildInstantiatePlan`).
 *
 * This module is pure — no Prisma, no oRPC — mirroring lib/project-porting.ts, whose types and
 * ref-resolution approach it reuses directly rather than reinventing. Unlike that module, there
 * is no diff step: instantiate always creates a brand-new tree, never merges against live state.
 *
 * `sourceType: 'QUICK_TASK'` templates (a template that fans out into N independent items, one
 * per volunteer, instead of one hierarchical project tree) are represented in the schema below
 * but have no working serialize/instantiate path yet — see CURRENT_TEMPLATE_SCHEMA_VERSION and
 * the BAD_REQUEST guard in server/routers/templates.ts.
 */

import { z } from 'zod'
import { HttpUrlSchema } from '@/lib/schemas'
import type { CurrentTask, CurrentDependency, LocalRef } from '@/lib/project-porting'
import { fromYmd } from '@/lib/project-porting'

export const CURRENT_TEMPLATE_SCHEMA_VERSION = 1

// ── Structure schema ─────────────────────────────────────────────────────────

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be written as YYYY-MM-DD')
  .nullable()

const TemplateSkillSchema = z.object({
  skillId: z.number().int().positive(),
  isRequired: z.boolean(),
})

const TemplateDependsOnSchema = z.object({
  on: z.union([z.string().min(1).max(64), z.number().int().positive()]),
  lagDays: z.number().int().min(-365).max(365).default(0),
})

const TemplateTaskSchema = z.object({
  ref: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).nullable().default(null),
  estimatedHours: z.number().min(0).max(10_000).nullable().default(null),
  deadline: ymd.default(null),
  /** Days after the project's own startOffsetDays anchor (0). Null = unscheduled. */
  startOffsetDays: z.number().int().min(0).max(3650).nullable().default(null),
  durationDays: z.number().int().min(0).max(3650).nullable().default(null),
  featuredAsQuickTask: z.boolean().default(false),
  isAnchor: z.boolean().default(false),
  skills: z.array(TemplateSkillSchema).default([]),
  dependsOn: z.array(TemplateDependsOnSchema).default([]),
})

const ProjectTemplateStructureSchema = z.object({
  sourceType: z.literal('PROJECT'),
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).nullable().default(null),
  projectType: z.string().nullable().default(null),
  estimatedDuration: z.string().nullable().default(null),
  timeCommitmentHoursPerWeek: z.number().int().min(0).max(1000).nullable().default(null),
  urgency: z.string().nullable().default('medium'),
  collaborationLink: HttpUrlSchema.nullable().default(null),
  remoteEligibility: z.enum(['NONE', 'COUNTRY', 'GLOBAL']).default('NONE'),
  /** Project's own scheduled start, relative to itself: always 0 when set, null if unscheduled. */
  startOffsetDays: z.number().int().min(0).max(0).nullable().default(null),
  durationDays: z.number().int().min(0).max(3650).nullable().default(null),
  skills: z.array(TemplateSkillSchema).default([]),
  tasks: z.array(TemplateTaskSchema).max(1000).default([]),
})

/**
 * Stub: no serialize/instantiate path exists yet for quick-task templates (see module docs).
 * `.passthrough()` keeps whatever shape a future implementation defines from being rejected by
 * a schema written before that shape existed.
 */
const QuickTaskTemplateStructureSchema = z
  .object({ sourceType: z.literal('QUICK_TASK') })
  .passthrough()

export const TemplateStructureSchema = z.discriminatedUnion('sourceType', [
  ProjectTemplateStructureSchema,
  QuickTaskTemplateStructureSchema,
])

export type TemplateStructure = z.infer<typeof TemplateStructureSchema>
export type ProjectTemplateStructure = z.infer<typeof ProjectTemplateStructureSchema>
export type TemplateTask = z.infer<typeof TemplateTaskSchema>

// ── Serialize (save-as-template) ─────────────────────────────────────────────

export type SourceProject = {
  title: string
  description: string | null
  projectType: string | null
  estimatedDuration: string | null
  timeCommitmentHoursPerWeek: number | null
  urgency: string | null
  collaborationLink: string | null
  remoteEligibility: string
  startDate: Date | null
  durationDays: number | null
}

export type SourceSkill = { skillId: number; isRequired: boolean }

export type SourceTaskWithSkills = CurrentTask & { skills: SourceSkill[] }

function toRef(taskId: number): string {
  return `task-${taskId}`
}

/**
 * Serialises a live project into a template structure. Offsets are computed relative to the
 * project's own startDate (day 0) if it has one, otherwise relative to the earliest scheduled
 * task; a project/task with no start at all keeps a null offset, same null-semantics as
 * `WorkItem.startDate` (unscheduled — derived from dependencies at instantiate time).
 */
export function serializeProjectAsTemplate(
  project: SourceProject,
  tasks: SourceTaskWithSkills[],
  dependencies: CurrentDependency[],
  projectSkills: SourceSkill[],
): ProjectTemplateStructure {
  const anchor =
    project.startDate ??
    tasks
      .map((t) => t.startDate)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ??
    null

  const offsetDays = (d: Date | null): number | null => {
    if (d === null || anchor === null) return null
    const diffMs = d.getTime() - anchor.getTime()
    return Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)))
  }

  return {
    sourceType: 'PROJECT',
    title: project.title,
    description: project.description,
    projectType: project.projectType,
    estimatedDuration: project.estimatedDuration,
    timeCommitmentHoursPerWeek: project.timeCommitmentHoursPerWeek,
    urgency: project.urgency ?? 'medium',
    collaborationLink: project.collaborationLink,
    remoteEligibility: (project.remoteEligibility as 'NONE' | 'COUNTRY' | 'GLOBAL') ?? 'NONE',
    startOffsetDays: anchor !== null && project.startDate !== null ? 0 : null,
    durationDays: project.durationDays,
    skills: projectSkills,
    tasks: tasks.map((t) => ({
      ref: toRef(t.id),
      title: t.title,
      description: t.description,
      estimatedHours: null,
      deadline: toYmd(t.deadline),
      startOffsetDays: offsetDays(t.startDate),
      durationDays: t.durationDays,
      featuredAsQuickTask: t.featuredAsQuickTask,
      isAnchor: t.isAnchor,
      skills: t.skills,
      dependsOn: dependencies
        .filter((d) => d.successorId === t.id)
        .map((d) => ({ on: toRef(d.predecessorId), lagDays: d.lagDays })),
    })),
  }
}

function toYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

// ── Instantiate (copy-from-template) ─────────────────────────────────────────

export type InstantiateProjectFields = {
  title: string
  description: string | null
  projectType: string | null
  estimatedDuration: string | null
  timeCommitmentHoursPerWeek: number | null
  urgency: string
  collaborationLink: string | null
  remoteEligibility: 'NONE' | 'COUNTRY' | 'GLOBAL'
  startDate: Date | null
  durationDays: number | null
}

export type InstantiateTaskCreate = {
  ref: string
  title: string
  description: string | null
  estimatedHours: number | null
  deadline: Date | null
  startDate: Date | null
  durationDays: number | null
  featuredAsQuickTask: boolean
  isAnchor: boolean
  skills: SourceSkill[]
}

export type InstantiatePlan = {
  errors: string[]
  project: InstantiateProjectFields
  projectSkills: SourceSkill[]
  taskCreates: InstantiateTaskCreate[]
  dependencyCreates: Array<{ predecessor: LocalRef; successor: LocalRef; lagDays: number }>
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/**
 * Builds an always-create apply plan for a new project from a template structure. Deliberately
 * has no field in its return type for assignee/team/country/localGroup/comments/interests — the
 * caller (server/routers/templates.ts) supplies country/localGroup/teamId/owner separately, and
 * nothing here can be capable of copying them from the template because the type has no slot
 * for them to travel in.
 */
export function buildInstantiatePlan(
  structure: ProjectTemplateStructure,
  opts: { newTitle: string; newStartDate: string | null },
): InstantiatePlan {
  const errors: string[] = []
  const newStart = fromYmd(opts.newStartDate)

  const refs = new Set<string>()
  for (const t of structure.tasks) {
    if (refs.has(t.ref)) errors.push(`Duplicate task ref "${t.ref}" in template`)
    refs.add(t.ref)
  }
  for (const t of structure.tasks) {
    for (const dep of t.dependsOn) {
      if (typeof dep.on === 'string' && !refs.has(dep.on)) {
        errors.push(`Task "${t.title}" depends on unknown ref "${dep.on}"`)
      }
      if (typeof dep.on === 'string' && dep.on === t.ref) {
        errors.push(`Task "${t.title}" cannot depend on itself`)
      }
    }
  }

  const resolveDate = (offsetDays: number | null): Date | null => {
    if (offsetDays === null || newStart === null) return null
    return addDays(newStart, offsetDays)
  }

  return {
    errors,
    project: {
      title: opts.newTitle,
      description: structure.description,
      projectType: structure.projectType,
      estimatedDuration: structure.estimatedDuration,
      timeCommitmentHoursPerWeek: structure.timeCommitmentHoursPerWeek,
      urgency: structure.urgency ?? 'medium',
      collaborationLink: structure.collaborationLink,
      remoteEligibility: structure.remoteEligibility,
      startDate: resolveDate(structure.startOffsetDays),
      durationDays: structure.durationDays,
    },
    projectSkills: structure.skills,
    taskCreates: structure.tasks.map((t) => ({
      ref: t.ref,
      title: t.title,
      description: t.description,
      estimatedHours: t.estimatedHours,
      deadline: fromYmd(t.deadline),
      startDate: resolveDate(t.startOffsetDays),
      durationDays: t.durationDays,
      featuredAsQuickTask: t.featuredAsQuickTask,
      isAnchor: t.isAnchor,
      skills: t.skills,
    })),
    dependencyCreates: structure.tasks.flatMap((t) =>
      t.dependsOn
        .filter((dep) => refs.has(String(dep.on)))
        .map((dep) => ({
          predecessor: { kind: 'created', ref: String(dep.on) } as LocalRef,
          successor: { kind: 'created', ref: t.ref } as LocalRef,
          lagDays: dep.lagDays,
        })),
    ),
  }
}
