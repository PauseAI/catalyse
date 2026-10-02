import { describe, expect, it } from 'vitest'
import {
  buildApplyPlan,
  computeProjectDiff,
  parseImportFile,
  serializeProjectExport,
  type CurrentState,
} from './project-porting'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function state(over: Partial<CurrentState> = {}): CurrentState {
  return {
    project: { id: 1, title: 'Rally', description: 'A rally', status: 'in_progress' },
    tasks: [
      {
        id: 10,
        title: 'Book the venue',
        description: null,
        status: 'open',
        assigneeId: null,
        assigneeEmail: null,
        deadline: null,
        startDate: day('2026-09-02'),
        durationDays: 3,
        baselineSetAt: null,
        featuredAsQuickTask: false,
        isAnchor: false,
        timing: 'flexible',
        sortOrder: 1,
      },
    ],
    dependencies: [],
    ...over,
  }
}

/** The file a fresh export would produce, as the starting point for an edit. */
function roundTrip(s: CurrentState = state()) {
  return JSON.parse(JSON.stringify(serializeProjectExport(s, 'https://example.test')))
}

describe('project status cannot be changed by import', () => {
  it('refuses a status change, naming both sides', () => {
    const file = roundTrip()
    file.project.status = 'completed'

    const diff = computeProjectDiff(state(), file)
    expect(diff.errors).toHaveLength(1)
    expect(diff.errors[0].scope).toBe('project')
    expect(diff.errors[0].message).toContain('Status cannot be changed by import')
    expect(diff.errors[0].message).toContain('completed')
    expect(diff.errors[0].message).toContain('in_progress')
  })

  it('never puts a status in the apply plan, even when the file asks for one', () => {
    const file = roundTrip()
    file.project.status = 'archived'
    expect(buildApplyPlan(state(), file).project).not.toHaveProperty('status')
  })

  it('lets an unchanged status round-trip silently', () => {
    const diff = computeProjectDiff(state(), roundTrip())
    expect(diff.errors).toHaveLength(0)
    expect(diff.project.op).toBe('noop')
  })

  it('still allows the other project fields to be edited', () => {
    const file = roundTrip()
    file.project.title = 'Bigger rally'

    const diff = computeProjectDiff(state(), file)
    expect(diff.errors).toHaveLength(0)
    expect(diff.project.op).toBe('update')
    expect(buildApplyPlan(state(), file).project.title).toBe('Bigger rally')
  })
})

describe('bounds on how much one file may ask for', () => {
  const file = (tasks: unknown[]) => JSON.stringify({ project: { title: 'Rally' }, tasks })

  it('accepts a realistic project', () => {
    const tasks = Array.from({ length: 200 }, (_, i) => ({ title: `Task ${i}` }))
    expect(parseImportFile(file(tasks)).ok).toBe(true)
  })

  it('refuses more tasks than any real project has, before any work is done', () => {
    const tasks = Array.from({ length: 1001 }, (_, i) => ({ title: `Task ${i}` }))
    expect(parseImportFile(file(tasks)).ok).toBe(false)
  })

  it('refuses a title longer than the column is meant to hold', () => {
    expect(parseImportFile(file([{ title: 'x'.repeat(301) }])).ok).toBe(false)
    // Comfortably past the longest real one, which is around 100 characters.
    expect(parseImportFile(file([{ title: 'x'.repeat(300) }])).ok).toBe(true)
  })

  it('refuses a description beyond the cap but accepts a long real one', () => {
    expect(parseImportFile(file([{ title: 'T', description: 'x'.repeat(20_001) }])).ok).toBe(false)
    expect(parseImportFile(file([{ title: 'T', description: 'x'.repeat(3_000) }])).ok).toBe(true)
  })

  it('refuses an unreasonable number of dependencies on one task', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ on: i + 1 }))
    expect(parseImportFile(file([{ title: 'T', dependsOn: many }])).ok).toBe(false)
  })

  it('refuses an over-long ref', () => {
    expect(parseImportFile(file([{ ref: 'r'.repeat(65), title: 'T' }])).ok).toBe(false)
  })
})

describe('a real export still satisfies every bound', () => {
  it('round-trips to no changes', () => {
    const s = state()
    const parsed = parseImportFile(
      JSON.stringify(serializeProjectExport(s, 'https://example.test')),
    )
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true)

    const diff = computeProjectDiff(
      s,
      parsed.ok ? parsed.file : { project: { title: '' }, tasks: [] },
    )
    expect(diff.errors).toHaveLength(0)
    expect(diff.tasks.every((t) => t.op === 'noop')).toBe(true)
  })
})
