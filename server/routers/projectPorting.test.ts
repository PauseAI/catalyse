import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createAdmin, createProject, createTask } from '@/test/factories'
import { clientAs } from '@/test/rpc'

// The in-transaction cycle re-check guards against a race the pure pass cannot see; it is
// unreachable through the API alone, so one test forces it through the cycle finder.
const { findCycleMock, buildPlanMock } = vi.hoisted(() => ({
  findCycleMock: vi.fn(),
  buildPlanMock: vi.fn(),
}))
vi.mock('@/lib/schedule', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/schedule')>()
  findCycleMock.mockImplementation(original.findDependencyCycle)
  return { ...original, findDependencyCycle: findCycleMock }
})
// Likewise the plan-level error check: the plan is built from the same analysis the diff
// already validated, so it cannot fail unless that invariant breaks.
vi.mock('@/lib/project-porting', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/project-porting')>()
  buildPlanMock.mockImplementation(original.buildApplyPlan)
  return { ...original, buildApplyPlan: buildPlanMock }
})

async function setup() {
  const owner = await createVolunteer()
  const project = await createProject({ assigneeId: owner.id, title: 'Rally', description: 'desc' })
  const a = await createTask(project.id, { title: 'A', sortOrder: 1, durationDays: 2 })
  const b = await createTask(project.id, { title: 'B', sortOrder: 2, assigneeId: owner.id })
  await prisma.workItemDependency.create({
    data: { predecessorId: a.id, successorId: b.id, lagDays: 1 },
  })
  const c = clientAs(owner)
  const file = await c.projects.exportPlan({ projectId: project.id })
  return { owner, project, a, b, c, file }
}

describe('projects.exportPlan / previewImport', () => {
  it('exports the current state and previews a diff, or a parse error', async () => {
    const { project, a, b, c, file, owner } = await setup()
    expect(file.project).toMatchObject({ id: project.id, title: 'Rally', status: 'ready' })
    expect(file.tasks.map((t) => t.id)).toEqual([a.id, b.id])
    expect(file.tasks[1]).toMatchObject({
      assigneeEmail: owner.email,
      dependsOn: [{ on: a.id, lagDays: 1 }],
    })
    expect(file.$schema).toContain('/api/project-import/schema')

    const edited = { ...file, project: { ...file.project, title: 'Renamed' } }
    const diff = await c.projects.previewImport({
      projectId: project.id,
      file: JSON.stringify(edited),
    })
    expect(diff.project).toMatchObject({ op: 'update' })
    expect(diff.meta.stale).toBe(false)

    const bad = await c.projects.previewImport({ projectId: project.id, file: '{not json' })
    expect(bad.errors[0]).toMatchObject({
      scope: 'file',
      message: expect.stringContaining('valid JSON'),
    })

    await expect(c.projects.exportPlan({ projectId: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      c.projects.previewImport({ projectId: 999_999, file: '{}' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const stranger = await createVolunteer()
    await expect(
      clientAs(stranger).projects.exportPlan({ projectId: project.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('projects.applyImport', () => {
  it('rejects a stale hash, unparsable files, diff errors and unknown assignees', async () => {
    const { project, c, file } = await setup()
    const hash = file._meta.baseHash
    await expect(
      c.projects.applyImport({ projectId: 999_999, file: '{}', expectedHash: hash }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      c.projects.applyImport({ projectId: project.id, file: '{}', expectedHash: 'stale' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      c.projects.applyImport({ projectId: project.id, file: '{', expectedHash: hash }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const wrong = { ...file, project: { ...file.project, id: 12345 } }
    await expect(
      c.projects.applyImport({
        projectId: project.id,
        file: JSON.stringify(wrong),
        expectedHash: hash,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Import has problems'),
    })
    const badAssignee = {
      ...file,
      tasks: [{ ...file.tasks[0], assigneeEmail: 'nobody@example.com' }, file.tasks[1]],
    }
    await expect(
      c.projects.applyImport({
        projectId: project.id,
        file: JSON.stringify(badAssignee),
        expectedHash: hash,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('no approved volunteer has that address'),
    })
  })

  it('applies project, task and dependency changes in one go', async () => {
    const { project, a, b, c, file, owner } = await setup()
    const helper = await createVolunteer()
    const edited = {
      ...file,
      project: { ...file.project, title: 'Renamed', description: null },
      tasks: [
        {
          ...file.tasks[0],
          title: 'A2',
          description: 'd',
          status: 'in_progress',
          assigneeEmail: helper.email,
          deadline: '2026-12-01',
          startDate: '2026-10-01',
          durationDays: 4,
          featuredAsQuickTask: true,
          isAnchor: true,
        },
        { ...file.tasks[1], assigneeEmail: null, dependsOn: [{ on: a.id, lagDays: 3 }] },
        {
          ref: 'n',
          title: 'New',
          assigneeEmail: owner.email,
          startDate: '2026-11-01',
          durationDays: 1,
          dependsOn: [{ on: b.id }],
        },
        { ref: 'n2', title: 'New2', dependsOn: [{ on: 'n', lagDays: 2 }] },
      ],
    }
    const result = await c.projects.applyImport({
      projectId: project.id,
      file: JSON.stringify(edited),
      expectedHash: file._meta.baseHash,
    })
    expect(result).toEqual({
      projectUpdated: true,
      created: 2,
      updated: 2,
      deleted: 0,
      dependencyChanges: 3,
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({
      title: 'Renamed',
      description: null,
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      title: 'A2',
      status: 'in_progress',
      assigneeId: helper.id,
      durationDays: 4,
      isAnchor: true,
      featuredAsQuickTask: true,
      deadline: new Date('2026-12-01T00:00:00Z'),
    })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: b.id } })).assigneeId).toBeNull()
    const created = await prisma.workItem.findMany({
      where: { parentId: project.id, title: { in: ['New', 'New2'] } },
      orderBy: { sortOrder: 'asc' },
    })
    expect(created.map((t) => [t.title, t.sortOrder, t.assigneeId])).toEqual([
      ['New', 3, owner.id],
      ['New2', 4, null],
    ])
    const edges = await prisma.workItemDependency.findMany({
      where: { successor: { parentId: project.id } },
    })
    expect(edges.map((e) => e.lagDays).sort()).toEqual([0, 2, 3])
  })

  it('deletes only confirmed tasks and removes their dependency links', async () => {
    const { project, a, b, c, file } = await setup()
    const onlyA = { ...file, tasks: [file.tasks[0]] }
    const kept = await c.projects.applyImport({
      projectId: project.id,
      file: JSON.stringify(onlyA),
      expectedHash: file._meta.baseHash,
    })
    expect(kept).toMatchObject({ deleted: 0, projectUpdated: false })
    expect(await prisma.workItem.count({ where: { id: b.id } })).toBe(1)

    const fresh = await c.projects.exportPlan({ projectId: project.id })
    const gone = await c.projects.applyImport({
      projectId: project.id,
      file: JSON.stringify(onlyA),
      expectedHash: fresh._meta.baseHash,
      confirmedDeleteIds: [b.id],
    })
    expect(gone).toMatchObject({ deleted: 1, dependencyChanges: 1 })
    expect(await prisma.workItem.count({ where: { id: b.id } })).toBe(0)
    expect(await prisma.workItemDependency.count({ where: { predecessorId: a.id } })).toBe(0)
  })

  it('rejects a plan-level loop and the in-transaction loop re-check', async () => {
    const { project, a, b, c, file } = await setup()
    const loop = {
      ...file,
      tasks: [{ ...file.tasks[0], dependsOn: [{ on: b.id }] }, file.tasks[1]],
    }
    await expect(
      c.projects.applyImport({
        projectId: project.id,
        file: JSON.stringify(loop),
        expectedHash: file._meta.baseHash,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('loop'),
    })
    void a

    buildPlanMock.mockImplementationOnce((...args: Parameters<typeof buildPlanMock>) => ({
      ...buildPlanMock.getMockImplementation()!(...args),
      errors: [{ scope: 'dependency', message: 'plan-level problem' }],
    }))
    await expect(
      c.projects.applyImport({
        projectId: project.id,
        file: JSON.stringify(file),
        expectedHash: file._meta.baseHash,
      }),
    ).rejects.toMatchObject({
      message: 'plan-level problem',
    })

    findCycleMock.mockReturnValueOnce([1, 2, 1])
    await expect(
      c.projects.applyImport({
        projectId: project.id,
        file: JSON.stringify(file),
        expectedHash: file._meta.baseHash,
      }),
    ).rejects.toMatchObject({
      message: 'Import would create a dependency loop',
    })
    expect(
      await clientAs(await createAdmin()).projects.applyImport({
        projectId: project.id,
        file: JSON.stringify(file),
        expectedHash: file._meta.baseHash,
      }),
    ).toMatchObject({ updated: 0, created: 0 })
  })
})

describe('what an import may and may not say', () => {
  it('round-trips an unchanged export as a diff of nothing', async () => {
    const { project, c, file } = await setup()
    const diff = await c.projects.previewImport({
      projectId: project.id,
      file: JSON.stringify(file),
    })
    expect(diff.errors).toHaveLength(0)
    expect(diff.project.op).toBe('noop')
    expect(diff.tasks.every((t) => t.op === 'noop')).toBe(true)
    expect(diff.dependencies.every((d) => d.op === 'noop')).toBe(true)
  })

  it('creates a task the file adds by ref', async () => {
    const { project, c, file } = await setup()
    const edited = {
      ...file,
      tasks: [
        ...file.tasks,
        {
          ref: 'new1',
          title: 'Fresh task',
          description: null,
          status: 'open',
          assigneeEmail: null,
          deadline: null,
          startDate: '2026-05-04',
          durationDays: 2,
          featuredAsQuickTask: false,
          dependsOn: [],
        },
      ],
    }
    const diff = await c.projects.previewImport({
      projectId: project.id,
      file: JSON.stringify(edited),
    })
    expect(diff.errors).toHaveLength(0)
    expect(diff.tasks.some((t) => t.op === 'create' && t.identity.title === 'Fresh task')).toBe(
      true,
    )
    await c.projects.applyImport({
      projectId: project.id,
      file: JSON.stringify(edited),
      expectedHash: diff.meta.currentHash,
    })
    const { tasks } = await c.projects.listTasks({ projectId: project.id })
    expect(tasks.some((t) => t.title === 'Fresh task')).toBe(true)
  })

  it('refuses a dependency on a task from another project', async () => {
    const { project, a, c, file } = await setup()
    const other = await createProject()
    const foreign = await createTask(other.id, { title: 'Theirs' })
    const edited = {
      ...file,
      tasks: file.tasks.map((t) => (t.id === a.id ? { ...t, dependsOn: [{ on: foreign.id }] } : t)),
    }
    const diff = await c.projects.previewImport({
      projectId: project.id,
      file: JSON.stringify(edited),
    })
    expect(diff.errors.length).toBeGreaterThan(0)
  })

  it('cannot change the project status, however the file is edited', async () => {
    const { project, c, file } = await setup()
    const edited = { ...file, project: { ...file.project, status: 'archived' } }
    const diff = await c.projects.previewImport({
      projectId: project.id,
      file: JSON.stringify(edited),
    })
    expect(diff.errors.some((e) => e.message.includes('Status cannot be changed by import'))).toBe(
      true,
    )
    await expect(
      c.projects.applyImport({
        projectId: project.id,
        file: JSON.stringify(edited),
        expectedHash: file._meta.baseHash,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const after = await c.projects.exportPlan({ projectId: project.id })
    expect(after.project.status).toBe('ready')
  })

  it('refuses a file with an unreasonable number of tasks', async () => {
    const { project, c, file } = await setup()
    const edited = {
      ...file,
      tasks: Array.from({ length: 1001 }, (_, i) => ({
        title: `Bulk ${i}`,
        description: null,
        status: 'open',
        assigneeEmail: null,
        deadline: null,
        startDate: null,
        durationDays: 1,
        featuredAsQuickTask: false,
        dependsOn: [],
      })),
    }
    const diff = await c.projects.previewImport({
      projectId: project.id,
      file: JSON.stringify(edited),
    })
    // Refused by the schema, so no diff is computed and nothing is written.
    expect(diff.errors.length).toBeGreaterThan(0)
  })
})
