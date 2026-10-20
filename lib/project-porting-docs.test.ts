import { describe, expect, it } from 'vitest'
import {
  PROJECT_IMPORT_EXAMPLE,
  PROJECT_IMPORT_GUIDE,
  projectImportJsonSchema,
} from './project-porting-docs'
import { parseImportFile, ProjectImportFileSchema } from './project-porting'

/**
 * Documentation for a format rots the moment the format moves. These tests pin the guide to
 * the validator: its worked example must actually parse, and every field and value it names
 * must be one the schema accepts.
 */
describe('the worked example', () => {
  it('parses with the real importer', () => {
    const parsed = parseImportFile(JSON.stringify(PROJECT_IMPORT_EXAMPLE))
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true)
  })

  it('is the example printed in the guide', () => {
    expect(PROJECT_IMPORT_GUIDE).toContain(JSON.stringify(PROJECT_IMPORT_EXAMPLE, null, 2))
  })

  it('demonstrates the things the guide claims it does', () => {
    const [update, created, anchor] = PROJECT_IMPORT_EXAMPLE.tasks
    expect(update).toHaveProperty('id') // updates in place
    expect(created).not.toHaveProperty('id') // creates
    expect(created.dependsOn?.[0].on).toBe(101) // by id
    expect(anchor.durationDays).toBe(0) // milestone
    expect(anchor.isAnchor).toBe(true)
    expect(anchor.dependsOn?.[0].on).toBe('permit') // by ref, not id
  })
})

describe('the guide only names fields the schema accepts', () => {
  const schema = projectImportJsonSchema()
  const defs = JSON.stringify(schema)

  const taskFields = [
    'id',
    'ref',
    'title',
    'description',
    'status',
    'assigneeEmail',
    'deadline',
    'startDate',
    'durationDays',
    'featuredAsQuickTask',
    'isAnchor',
    'submissionPrompt',
    'submissionAsksLink',
    'helpersWanted',
    'dependsOn',
  ]

  it.each(taskFields)('mentions %s, and the schema has it', (field) => {
    expect(PROJECT_IMPORT_GUIDE).toContain(field)
    expect(defs).toContain(`"${field}"`)
  })

  it('lists every project status the schema allows', () => {
    for (const status of [
      'draft',
      'pending_review',
      'needs_discussion',
      'ready',
      'in_progress',
      'on_hold',
      'completed',
      'archived',
    ]) {
      expect(PROJECT_IMPORT_GUIDE).toContain(status)
    }
  })

  it('quotes the real bound for durationDays', () => {
    expect(PROJECT_IMPORT_GUIDE).toContain('3650')
    expect(defs).toContain('3650')
  })

  it('no longer documents lagDays', () => {
    expect(PROJECT_IMPORT_GUIDE).not.toContain('lagDays')
    expect(defs).not.toContain('lagDays')
  })
})

describe('projectImportJsonSchema', () => {
  it('describes the same shape the importer validates', () => {
    const schema = projectImportJsonSchema()
    expect(schema).toMatchObject({ type: 'object' })
    const text = JSON.stringify(schema)
    expect(text).toContain('"tasks"')
    expect(text).toContain('"project"')
    expect(text).toContain('"baseHash"')
  })

  it('marks title as required and everything optional that is', () => {
    const schema = projectImportJsonSchema() as {
      properties: { project: { required?: string[]; properties: Record<string, unknown> } }
      required?: string[]
    }
    expect(schema.required).toContain('project')
    expect(schema.required).toContain('tasks')
    expect(schema.properties.project.required).toEqual(['title'])
  })

  it('is serialisable, since it is served as JSON', () => {
    expect(() => JSON.stringify(projectImportJsonSchema())).not.toThrow()
  })
})

describe('guard rails the guide promises', () => {
  it('rejects a date that is not YYYY-MM-DD, as the guide says', () => {
    const bad = {
      ...PROJECT_IMPORT_EXAMPLE,
      tasks: [{ id: 101, title: 'Book the venue', startDate: '02/09/2026' }],
    }
    const parsed = parseImportFile(JSON.stringify(bad))
    expect(parsed.ok).toBe(false)
  })

  it('rejects a duration beyond the stated maximum', () => {
    const bad = {
      ...PROJECT_IMPORT_EXAMPLE,
      tasks: [{ id: 101, title: 'Book the venue', durationDays: 3651 }],
    }
    expect(parseImportFile(JSON.stringify(bad)).ok).toBe(false)
  })

  it('accepts an empty dependsOn, which the guide documents as "clear the links"', () => {
    const cleared = {
      ...PROJECT_IMPORT_EXAMPLE,
      tasks: [{ id: 101, title: 'Book the venue', dependsOn: [] }],
    }
    expect(parseImportFile(JSON.stringify(cleared)).ok).toBe(true)
  })

  it('accepts null as an explicit clear', () => {
    const cleared = {
      ...PROJECT_IMPORT_EXAMPLE,
      tasks: [{ id: 101, title: 'Book the venue', description: null, durationDays: null }],
    }
    expect(parseImportFile(JSON.stringify(cleared)).ok).toBe(true)
  })

  it('still validates the example against the exported schema object directly', () => {
    expect(ProjectImportFileSchema.safeParse(PROJECT_IMPORT_EXAMPLE).success).toBe(true)
  })

  /**
   * Exports carry a top-level `$schema` so editors validate them as they are typed. The
   * importer must therefore accept a file that still has it, and ignore it — otherwise the
   * editor hint would break the round trip it exists to protect.
   */
  it('accepts a file carrying the top-level $schema an export writes', () => {
    const withSchema = {
      $schema: 'https://example.test/api/project-import/schema',
      ...PROJECT_IMPORT_EXAMPLE,
    }
    const parsed = parseImportFile(JSON.stringify(withSchema))
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true)
  })

  it('accepts a lagDays from an older export and drops it', () => {
    const old = {
      ...PROJECT_IMPORT_EXAMPLE,
      tasks: [
        { id: 101, title: 'Book the venue' },
        { ref: 'permit', title: 'Apply for the permit', dependsOn: [{ on: 101, lagDays: 2 }] },
      ],
    }
    const parsed = parseImportFile(JSON.stringify(old))
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true)
    expect(parsed.ok && parsed.file.tasks[1].dependsOn).toEqual([{ on: 101 }])
    // Editors validating against the published schema must not flag it either.
    expect(JSON.stringify(projectImportJsonSchema())).not.toContain('"additionalProperties":false')
  })

  it('drops $schema rather than treating it as data', () => {
    const result = ProjectImportFileSchema.safeParse({
      $schema: 'https://example.test/api/project-import/schema',
      ...PROJECT_IMPORT_EXAMPLE,
    })
    expect(result.success).toBe(true)
    expect(result.success && '$schema' in result.data).toBe(false)
  })
})
