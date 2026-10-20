import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createQuickTask,
  createTeam,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

describe('dependencies.add', () => {
  it('validates the pair before anything else', async () => {
    const owner = await createVolunteer()
    const c = clientAs(owner)
    const p = await createProject({ assigneeId: owner.id })
    const p2 = await createProject({ assigneeId: owner.id })
    const t1 = await createTask(p.id)
    const t2 = await createTask(p2.id)
    const qt = await createQuickTask()
    const add = (predecessorId: number, successorId: number) =>
      c.dependencies.add({ predecessorId, successorId })
    await expect(add(t1.id, t1.id)).rejects.toMatchObject({
      message: 'A task cannot depend on itself',
    })
    await expect(add(t1.id, 999_999)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(add(qt.id, t1.id)).rejects.toMatchObject({
      message: 'Quick tasks cannot have dependencies',
    })
    await expect(add(p.id, t1.id)).rejects.toMatchObject({
      message: expect.stringContaining('not one of each'),
    })
    await expect(add(t1.id, t2.id)).rejects.toMatchObject({
      message: 'Tasks can only depend on other tasks in the same project',
    })
    const t3 = await createTask(p.id)
    const orphan = await prisma.workItem.create({
      data: { type: 'TASK', status: 'not_started', title: 'orphan', parentId: null },
    })
    const orphan2 = await prisma.workItem.create({
      data: { type: 'TASK', status: 'not_started', title: 'orphan2', parentId: null },
    })
    await expect(add(orphan.id, orphan2.id)).rejects.toMatchObject({ message: 'Project not found' })
    const other = await createVolunteer()
    await expect(
      clientAs(other).dependencies.add({ predecessorId: t1.id, successorId: t3.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('links tasks, keeps one link on re-add, refuses loops, and bumps the successor schedule stamp', async () => {
    const owner = await createVolunteer()
    const c = clientAs(owner)
    const p = await createProject({ assigneeId: owner.id })
    const a = await createTask(p.id)
    const b = await createTask(p.id)
    const cc = await createTask(p.id)
    const link = await c.dependencies.add({ predecessorId: a.id, successorId: b.id })
    expect(link).toMatchObject({
      predecessorId: a.id,
      successorId: b.id,
      predecessorTitle: a.title,
      successorTitle: b.title,
    })
    expect(
      (await prisma.workItem.findUniqueOrThrow({ where: { id: b.id } })).scheduleUpdatedAt,
    ).not.toBeNull()
    const again = await c.dependencies.add({ predecessorId: a.id, successorId: b.id })
    expect(again.id).toBe(link.id)
    expect(await prisma.workItemDependency.count({ where: { successorId: b.id } })).toBe(1)
    await c.dependencies.add({ predecessorId: b.id, successorId: cc.id })
    await expect(
      c.dependencies.add({ predecessorId: cc.id, successorId: a.id }),
    ).rejects.toMatchObject({
      message: `That link would create a loop: ${a.title} → ${b.title} → ${cc.title} → ${a.title}`,
    })
  })

  it('links projects across the portfolio with view rights on the predecessor', async () => {
    const owner = await createVolunteer()
    const c = clientAs(owner)
    const mine = await createProject({ assigneeId: owner.id })
    const other = await createProject()
    const team = await createTeam()
    const restricted = await createProject({ teamId: team.id })
    await expect(
      c.dependencies.add({ predecessorId: mine.id, successorId: other.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      c.dependencies.add({ predecessorId: restricted.id, successorId: mine.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const link = await c.dependencies.add({ predecessorId: other.id, successorId: mine.id })
    expect(link.predecessorTitle).toBe(other.title)
    // Sub-projects (parentId set) must share the same parent scope.
    const child = await createProject({ parentId: other.id, assigneeId: owner.id })
    await expect(
      c.dependencies.add({ predecessorId: mine.id, successorId: child.id }),
    ).rejects.toMatchObject({ message: 'These projects are not in the same scope' })
  })
})

describe('dependencies.remove', () => {
  it('re-proves rights and removes the link', async () => {
    const owner = await createVolunteer()
    const other = await createVolunteer()
    const p = await createProject({ assigneeId: owner.id })
    const a = await createTask(p.id)
    const b = await createTask(p.id)
    const link = await clientAs(owner).dependencies.add({ predecessorId: a.id, successorId: b.id })
    await expect(
      clientAs(other).dependencies.remove({ dependencyId: link.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      clientAs(owner).dependencies.remove({ dependencyId: 999_999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(
      await clientAs(await createAdmin()).dependencies.remove({ dependencyId: link.id }),
    ).toEqual({ id: link.id })
    expect(await prisma.workItemDependency.count({ where: { id: link.id } })).toBe(0)
  })
})

describe('links of a done task', () => {
  it('locks what a done task waits on, but not what waits on it', async () => {
    const owner = await createVolunteer()
    const c = clientAs(owner)
    const p = await createProject({ assigneeId: owner.id })
    const before = await createTask(p.id)
    const done = await createTask(p.id)
    const after = await createTask(p.id)
    const waitsOn = await c.dependencies.add({ predecessorId: before.id, successorId: done.id })
    await prisma.workItem.update({ where: { id: done.id }, data: { status: 'completed' } })

    const locked = { code: 'FORBIDDEN', message: 'Reopen the task to change it' }
    const other = await createTask(p.id)
    await expect(
      c.dependencies.add({ predecessorId: other.id, successorId: done.id }),
    ).rejects.toMatchObject(locked)
    await expect(c.dependencies.remove({ dependencyId: waitsOn.id })).rejects.toMatchObject(locked)

    const unblocks = await c.dependencies.add({ predecessorId: done.id, successorId: after.id })
    expect(await c.dependencies.remove({ dependencyId: unblocks.id })).toEqual({ id: unblocks.id })
  })
})
