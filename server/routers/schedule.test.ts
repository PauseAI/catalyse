import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createQuickTask,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

describe('schedule.rescheduleItems', () => {
  it("writes a task's start and deadline, and a project's start and duration", async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id })
    const task = await createTask(project.id)
    const result = await clientAs(owner).schedule.rescheduleItems({
      items: [
        {
          id: task.id,
          startDate: new Date('2026-06-01T00:00:00Z'),
          deadline: new Date('2026-06-05T00:00:00Z'),
        },
        { id: project.id, startDate: null, durationDays: 20 },
      ],
    })
    expect(result).toEqual({ count: 2 })
    const after = await prisma.workItem.findUniqueOrThrow({ where: { id: task.id } })
    expect(after).toMatchObject({
      startDate: new Date('2026-06-01T00:00:00Z'),
      deadline: new Date('2026-06-05T00:00:00Z'),
      durationDays: null,
    })
    expect(after.scheduleUpdatedAt).not.toBeNull()
    expect(
      (await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })).durationDays,
    ).toBe(20)
  })

  it("refuses a task's length and a project's deadline", async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id })
    const task = await createTask(project.id)
    const c = clientAs(owner).schedule
    await expect(
      c.rescheduleItems({ items: [{ id: task.id, startDate: null, durationDays: 5 }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('deadline') })
    await expect(
      c.rescheduleItems({ items: [{ id: project.id, startDate: null, deadline: null }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('target') })
    // A milestone's zero is a length a task may have.
    expect(
      await c.rescheduleItems({ items: [{ id: task.id, startDate: null, durationDays: 0 }] }),
    ).toEqual({ count: 1 })
  })

  it('rejects unknown ids, quick tasks, and projects the caller cannot manage', async () => {
    const owner = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id })
    const task = await createTask(project.id)
    const qt = await createQuickTask()
    const c = clientAs(other)
    await expect(
      c.schedule.rescheduleItems({ items: [{ id: 999_999, startDate: null }] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      c.schedule.rescheduleItems({ items: [{ id: qt.id, startDate: null }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      c.schedule.rescheduleItems({ items: [{ id: task.id, startDate: null }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // An admin can reschedule anything.
    expect(
      await clientAs(await createAdmin()).schedule.rescheduleItems({
        items: [{ id: task.id, startDate: null }],
      }),
    ).toEqual({ count: 1 })
  })
})
