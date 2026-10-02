import { describe, expect, it } from 'vitest'
import { TemplateStructureSchema, CURRENT_TEMPLATE_SCHEMA_VERSION } from './template-porting'

/**
 * `Template.structure` is a separate serialized shape from `WorkItem`, chosen deliberately (see
 * the "project templates" design) over a flag on WorkItem — but that separation means nothing
 * stops the two shapes drifting apart as WorkItem's project fields evolve. This test is the
 * forcing function: it fails on any *unlisted* field difference between `PROJECT_INPUT_FIELDS`
 * (lib/schemas.ts, the fields a project create/edit form actually writes) and the project
 * template structure's field set. A maintainer who deliberately widens one side must also widen
 * the allow-list here, in the same reviewed diff — silent divergence is what this catches, not
 * deliberate divergence.
 */

// Fields templates intentionally never carry, and why — kept in sync manually.
const TEMPLATE_OMITTED_PROJECT_FIELDS = [
  'country', // always blanked + repicked on instantiate, never stored on the template
  'localGroup', // same
  'teamId', // same
  'isSeekingHelp', // per-instance recruiting flag, not part of the reusable structure
] as const

// Fields templates add that WorkItem's project input fields don't have, and why.
const TEMPLATE_ADDED_PROJECT_FIELDS = [
  'sourceType', // discriminator, not a WorkItem field
  'startOffsetDays', // relative-date replacement for absolute startDate
  'skills', // WorkItemSkill isn't part of PROJECT_INPUT_FIELDS but templates must carry it
  'tasks', // the task list itself
] as const

const TEMPLATE_TASK_ADDED_FIELDS = ['ref', 'startOffsetDays', 'skills', 'dependsOn'] as const

// Mirrors PROJECT_INPUT_FIELDS in lib/schemas.ts. If that object's keys change, this list (and
// TEMPLATE_OMITTED_PROJECT_FIELDS above, if the change is an intentional omission) must change
// with it — that hand-touch is the point.
const PROJECT_INPUT_FIELD_NAMES = [
  'title',
  'description',
  'projectType',
  'estimatedDuration',
  'timeCommitmentHoursPerWeek',
  'urgency',
  'collaborationLink',
  'country',
  'localGroup',
  'remoteEligibility',
  'isSeekingHelp',
  'teamId',
  'startDate',
  'durationDays',
] as const

// Mirrors the task fields used by CreateProjectTaskSchema / UpdateProjectTaskSchema in
// lib/schemas.ts (excluding assigneeId and status, which templates never carry).
const TASK_INPUT_FIELD_NAMES = [
  'title',
  'description',
  'estimatedHours',
  'deadline',
  'featuredAsQuickTask',
  'isAnchor',
  'timing',
  'startDate',
  'durationDays',
] as const

function projectTemplateShapeKeys(): string[] {
  const projectVariant = TemplateStructureSchema.options.find(
    (o) => o.shape.sourceType.value === 'PROJECT',
  )!
  return Object.keys(projectVariant.shape)
}

function templateTaskShapeKeys(): string[] {
  const projectVariant = TemplateStructureSchema.options.find(
    (o) => o.shape.sourceType.value === 'PROJECT',
  )! as unknown as {
    shape: { tasks: { def: { innerType: { def: { element: { shape: object } } } } } }
  }
  const taskItemSchema = projectVariant.shape.tasks.def.innerType.def.element
  return Object.keys(taskItemSchema.shape)
}

describe('template structure field-shape drift', () => {
  it('carries every structural PROJECT_INPUT_FIELDS field, or explicitly omits it', () => {
    const templateKeys = new Set(projectTemplateShapeKeys())
    for (const field of PROJECT_INPUT_FIELD_NAMES) {
      if ((TEMPLATE_OMITTED_PROJECT_FIELDS as readonly string[]).includes(field)) continue
      const mapped = field === 'startDate' ? 'startOffsetDays' : field
      expect(templateKeys.has(mapped), `template structure is missing "${field}"`).toBe(true)
    }
  })

  it('has no project-level field beyond PROJECT_INPUT_FIELDS + the declared additions', () => {
    const allowed = new Set<string>([
      ...PROJECT_INPUT_FIELD_NAMES.filter(
        (f) =>
          !(TEMPLATE_OMITTED_PROJECT_FIELDS as readonly string[]).includes(f) && f !== 'startDate',
      ),
      ...TEMPLATE_ADDED_PROJECT_FIELDS,
    ])
    for (const key of projectTemplateShapeKeys()) {
      expect(allowed.has(key), `unexpected/undeclared template field "${key}"`).toBe(true)
    }
  })

  it('carries every task input field, or explicitly adds to it', () => {
    const taskKeys = new Set(templateTaskShapeKeys())
    for (const field of TASK_INPUT_FIELD_NAMES) {
      const mapped = field === 'startDate' ? 'startOffsetDays' : field
      expect(taskKeys.has(mapped), `template task shape is missing "${field}"`).toBe(true)
    }
  })

  it('has no task-level field beyond TASK_INPUT_FIELD_NAMES + the declared additions', () => {
    const allowed = new Set<string>([
      ...TASK_INPUT_FIELD_NAMES.filter((f) => f !== 'startDate'),
      ...TEMPLATE_TASK_ADDED_FIELDS,
    ])
    for (const key of templateTaskShapeKeys()) {
      expect(allowed.has(key), `unexpected/undeclared template task field "${key}"`).toBe(true)
    }
  })

  it('pins the schema version so a bump forces a reviewed touch of this file', () => {
    expect(CURRENT_TEMPLATE_SCHEMA_VERSION).toBe(1)
  })
})
