import { describe, expect, it } from 'vitest'
import {
  buildApplyPlan,
  computeProjectDiff,
  emptyDiffWithErrors,
  fromYmd,
  hashState,
  parseImportFile,
  serializeProjectExport,
  type CurrentState,
  type CurrentTask,
  type ProjectImportFile,
} from './project-porting'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function task(id: number, over: Partial<CurrentTask> = {}): CurrentTask {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    status: 'open',
    assigneeId: null,
    assigneeEmail: null,
    deadline: null,
    startDate: null,
    durationDays: null,
    baselineSetAt: null,
    featuredAsQuickTask: false,
    isAnchor: false,
    timing: 'flexible',
    sortOrder: id,
    ...over,
  }
}

function state(over: Partial<CurrentState> = {}): CurrentState {
  return {
    project: { id: 1, title: 'Rally', description: 'A rally', status: 'in_progress' },
    tasks: [task(10, { startDate: day('2026-09-02'), durationDays: 3 }), task(11)],
    dependencies: [{ predecessorId: 10, successorId: 11, lagDays: 1 }],
    ...over,
  }
}

const file = (over: Partial<ProjectImportFile> = {}): ProjectImportFile => ({
  project: { title: 'Rally' },
  tasks: [
    { id: 10, title: 'Task 10' },
    { id: 11, title: 'Task 11' },
  ],
  ...over,
})

describe('export serialisation', () => {
  it('omits the schema links without an app URL and strips a trailing slash with one', () => {
    const bare = serializeProjectExport(state())
    expect(bare).not.toHaveProperty('$schema')
    expect(bare._meta).not.toHaveProperty('docs')
    const withUrl = serializeProjectExport(state(), 'https://x.test/')
    expect(withUrl.$schema).toBe('https://x.test/api/project-import/schema')
    expect(withUrl._meta.docs).toBe('https://x.test/projects/1/import')
    expect(withUrl.tasks[1].dependsOn).toEqual([{ on: 10, lagDays: 1 }])
    expect(withUrl.tasks[0].startDate).toBe('2026-09-02')
  })

  it('orders tasks by sortOrder then id, treating a null sortOrder as zero', () => {
    const s = state({
      tasks: [
        task(3, { sortOrder: null }),
        task(2, { sortOrder: 5 }),
        task(1, { sortOrder: null }),
      ],
    })
    expect(serializeProjectExport(s).tasks.map((t) => t.id)).toEqual([1, 3, 2])
  })

  it("sorts a task's several predecessors by id in the export and the hash", () => {
    const s = state({
      tasks: [task(10), task(11), task(12)],
      dependencies: [
        { predecessorId: 11, successorId: 12, lagDays: 0 },
        { predecessorId: 10, successorId: 12, lagDays: 0 },
        { predecessorId: 10, successorId: 11, lagDays: 0 },
      ],
    })
    expect(serializeProjectExport(s).tasks[2].dependsOn.map((d) => d.on)).toEqual([10, 11])
    const reordered = state({ ...s, dependencies: [...s.dependencies].reverse() })
    expect(hashState(reordered)).toBe(hashState(s))
  })

  it('hashes the mutable projection independently of ordering', () => {
    const a = state()
    const b = state({ tasks: [...a.tasks].reverse(), dependencies: [...a.dependencies] })
    expect(hashState(a)).toBe(hashState(b))
    expect(hashState(state({ project: { ...a.project, title: 'Other' } }))).not.toBe(hashState(a))
    expect(fromYmd(undefined)).toBeNull()
  })
})

describe('parseImportFile', () => {
  it('reports invalid JSON and schema violations with their paths', () => {
    expect(parseImportFile('{')).toMatchObject({
      ok: false,
      error: expect.stringContaining('valid JSON'),
    })
    const bad = parseImportFile(JSON.stringify({ project: {}, tasks: [{ title: '' }] }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/project\.title.*tasks\.0\.title/)
    const root = parseImportFile('42')
    if (!root.ok) expect(root.error).toContain('(root)')
    expect(parseImportFile(JSON.stringify(file())).ok).toBe(true)
  })
})

describe('computeProjectDiff', () => {
  it('reports project field changes, wrong-project files and staleness', () => {
    const diff = computeProjectDiff(
      state(),
      file({
        _meta: { baseHash: 'stale-hash' },
        project: { id: 2, title: 'Renamed', description: null },
      }),
    )
    expect(diff.errors[0].message).toContain('File is for project 2')
    expect(diff.project.op).toBe('update')
    expect(diff.project.fieldChanges).toEqual([
      { field: 'title', from: 'Rally', to: 'Renamed' },
      { field: 'description', from: 'A rally', to: null },
    ])
    expect(diff.meta.stale).toBe(true)
    expect(diff.warnings[0]).toContain('exported before the project last changed')
  })

  it('pairs tasks by id, creates the rest, and deletes the unmentioned', () => {
    const diff = computeProjectDiff(
      state(),
      file({
        tasks: [
          {
            id: 10,
            title: 'Renamed',
            description: 'd',
            status: 'completed',
            isAnchor: true,
            timing: 'fixed',
          },
          { ref: 'new', title: 'New one', durationDays: 2, assigneeEmail: 'a@b.c' },
        ],
      }),
    )
    const ops = diff.tasks.map((t) => [t.op, t.identity])
    expect(ops).toEqual([
      ['update', { id: 10, title: 'Renamed' }],
      ['create', { ref: 'new', title: 'New one' }],
      ['delete', { id: 11, title: 'Task 11' }],
    ])
    expect(diff.tasks[0].fieldChanges).toEqual(
      expect.arrayContaining([
        { field: 'title', from: 'Task 10', to: 'Renamed' },
        { field: 'status', from: 'open', to: 'completed' },
        { field: 'isAnchor', from: false, to: true },
        { field: 'timing', from: 'flexible', to: 'fixed' },
      ]),
    )
    expect(diff.tasks[1].fieldChanges.map((c) => c.field)).toEqual([
      'title',
      'status',
      'assigneeEmail',
      'durationDays',
    ])
    // The deleted task's incoming edge is gone.
    expect(diff.dependencies).toEqual([
      expect.objectContaining({ op: 'delete', predecessor: { id: 10, title: 'Renamed' } }),
    ])
  })

  it('rejects duplicate ids and refs, and ids from another project', () => {
    const diff = computeProjectDiff(
      state(),
      file({
        tasks: [
          { id: 10, title: 'A', ref: 'x' },
          { id: 10, title: 'B' },
          { ref: 'x', title: 'C' },
          { id: 999, title: 'D', ref: 'y' },
        ],
      }),
    )
    expect(diff.errors.map((e) => e.message)).toEqual([
      'Duplicate id 10',
      'Duplicate ref "x"',
      'id 999 is not a task of this project',
    ])
    expect(diff.errors[2].ref).toBe('y')
  })

  it('reconciles dependencies: noop, lag update, create by ref, delete, and leave-alone', () => {
    const diff = computeProjectDiff(
      state(),
      file({
        tasks: [
          { id: 10, title: 'Task 10' },
          { id: 11, title: 'Task 11', dependsOn: [{ on: 10, lagDays: 1 }] },
          { ref: 'n', title: 'N', dependsOn: [{ on: 'n2' }, { on: 11 }] },
          { ref: 'n2', title: 'N2' },
        ],
      }),
    )
    expect(diff.dependencies.map((d) => d.op)).toEqual(['noop', 'create', 'create'])
    expect(diff.dependencies[1].predecessor).toEqual({ ref: 'n2', title: 'N2' })

    const lag = computeProjectDiff(
      state(),
      file({
        tasks: [
          { id: 10, title: 'Task 10' },
          { id: 11, title: 'Task 11', dependsOn: [{ on: 10, lagDays: 4 }] },
        ],
      }),
    )
    expect(lag.dependencies[0]).toMatchObject({
      op: 'update',
      fieldChanges: [{ field: 'lagDays', from: 1, to: 4 }],
    })

    // Omitting dependsOn keeps the existing edge; an empty array clears it.
    const kept = computeProjectDiff(state(), file())
    expect(kept.dependencies.map((d) => d.op)).toEqual(['noop'])
    const cleared = computeProjectDiff(
      state(),
      file({
        tasks: [
          { id: 10, title: 'Task 10' },
          { id: 11, title: 'Task 11', dependsOn: [] },
        ],
      }),
    )
    expect(cleared.dependencies.map((d) => d.op)).toEqual(['delete'])
  })

  it('rejects bad dependency references, self-links, links to deleted tasks, and loops', () => {
    const diff = computeProjectDiff(
      state(),
      file({
        tasks: [
          {
            id: 10,
            title: 'Task 10',
            ref: 'a',
            dependsOn: [{ on: 999 }, { on: 'nope' }, { on: 'a' }, { on: 11 }],
          },
        ],
      }),
    )
    expect(diff.errors.map((e) => e.message)).toEqual([
      'dependsOn references id 999, which is not a task of this project',
      'dependsOn references ref "nope", which no task in the file declares',
      '"Task 10" cannot depend on itself',
      '"Task 10" depends on a task that the file deletes or does not contain',
    ])

    const loop = computeProjectDiff(
      state(),
      file({
        tasks: [
          { id: 10, title: 'Task 10', dependsOn: [{ on: 11 }] },
          { id: 11, title: 'Task 11', dependsOn: [{ on: 10 }] },
        ],
      }),
    )
    expect(loop.errors[0].message).toBe(
      'These dependencies form a loop: Task 11 → Task 10 → Task 11',
    )
  })

  it('emptyDiffWithErrors carries the current hash and no changes', () => {
    const diff = emptyDiffWithErrors(state(), [{ scope: 'file', message: 'bad' }])
    expect(diff.meta).toMatchObject({ projectId: 1, fileHash: null, stale: false })
    expect(diff.errors).toEqual([{ scope: 'file', message: 'bad' }])
  })

  it('names an unknown local id in a dependency identity', () => {
    // An edge kept from state whose predecessor is a deleted row falls back to `#id`.
    const s = state({ dependencies: [{ predecessorId: 11, successorId: 10, lagDays: 0 }] })
    const diff = computeProjectDiff(s, file({ tasks: [{ id: 10, title: 'Task 10' }] }))
    expect(diff.dependencies[0].predecessor).toEqual({ id: 11, title: 'Task 11' })
  })
})

describe('buildApplyPlan', () => {
  it('turns the analysis into writes, resolving new tasks by ref', () => {
    const plan = buildApplyPlan(
      state(),
      file({
        project: { title: 'Renamed', description: 'New desc' },
        tasks: [
          {
            id: 10,
            title: 'T10',
            description: 'd',
            status: 'in_progress',
            assigneeEmail: 'a@b.c',
            deadline: '2026-10-01',
            startDate: '2026-09-03',
            durationDays: 4,
            featuredAsQuickTask: true,
            isAnchor: true,
            dependsOn: [{ on: 'n', lagDays: 2 }],
          },
          { ref: 'n', title: 'N' },
          { id: 11, title: 'Task 11', dependsOn: [{ on: 10, lagDays: 3 }] },
          { ref: 'n2', title: 'N2', dependsOn: [{ on: 11, lagDays: 0 }] },
        ],
      }),
    )
    expect(plan.errors).toEqual([])
    expect(plan.project).toEqual({ title: 'Renamed', description: 'New desc' })
    expect(plan.taskUpdates).toEqual([
      {
        id: 10,
        fields: {
          title: 'T10',
          description: 'd',
          status: 'in_progress',
          assigneeEmail: 'a@b.c',
          deadline: day('2026-10-01'),
          startDate: day('2026-09-03'),
          durationDays: 4,
          featuredAsQuickTask: true,
          isAnchor: true,
        },
      },
    ])
    expect(plan.taskCreates).toEqual([
      {
        ref: 'n',
        fields: expect.objectContaining({ title: 'N', status: 'open', deadline: null }),
      },
      { ref: 'n2', fields: expect.objectContaining({ title: 'N2' }) },
    ])
    expect(plan.taskDeletes).toEqual([])
    expect(plan.createSortBase).toBe(11)
    expect(plan.assigneeEmails).toEqual(['a@b.c'])
    expect(plan.dependencyPlan).toEqual({
      creates: [
        {
          predecessor: { kind: 'created', ref: 'n' },
          successor: { kind: 'existing', id: 10 },
          lagDays: 2,
        },
        {
          predecessor: { kind: 'existing', id: 11 },
          successor: { kind: 'created', ref: 'n2' },
          lagDays: 0,
        },
      ],
      updates: [{ predecessorId: 10, successorId: 11, lagDays: 3 }],
      deletes: [],
    })
  })

  it('keeps chosen deletion candidates, deletes the rest, and reports loops', () => {
    const plan = buildApplyPlan(state(), file({ tasks: [{ id: 10, title: 'Task 10' }] }), [11, 10])
    expect(plan.taskDeletes).toEqual([])
    expect(plan.dependencyPlan.deletes).toEqual([])

    const dropped = buildApplyPlan(state(), file({ tasks: [{ id: 10, title: 'Task 10' }] }))
    expect(dropped.taskDeletes).toEqual([11])
    expect(dropped.dependencyPlan.deletes).toEqual([{ predecessorId: 10, successorId: 11 }])

    const loop = buildApplyPlan(
      state(),
      file({
        tasks: [
          { id: 10, title: 'Task 10', dependsOn: [{ on: 11 }] },
          { id: 11, title: 'Task 11', dependsOn: [{ on: 10 }] },
        ],
      }),
    )
    expect(loop.errors[0].message).toBe('These dependencies form a loop')
  })

  it('falls back to the temp id as a ref for an unnamed new task', () => {
    const plan = buildApplyPlan(
      state(),
      file({
        tasks: [
          { id: 10, title: 'Task 10' },
          { id: 11, title: 'Task 11' },
          { title: 'Anonymous', dependsOn: [{ on: 10 }] },
        ],
      }),
    )
    expect(plan.dependencyPlan.creates[0].successor).toEqual({ kind: 'created', ref: '-1' })
    expect(plan.taskCreates[0].ref).toBeUndefined()
  })
})
