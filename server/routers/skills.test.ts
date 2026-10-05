import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { anon } from '@/test/rpc'
import { createProject, createSkill, createVolunteer } from '@/test/factories'

describe('skills.list', () => {
  it('returns categories with their skills ordered by sortOrder', async () => {
    // The migrations seed a skill catalogue; put ours at the top of the order to find it.
    const cat = await prisma.skillCategory.create({
      data: { name: 'Zeta', description: 'Visual things', sortOrder: -2 },
    })
    await prisma.skillCategory.create({ data: { name: 'Alpha', sortOrder: -1 } })
    await prisma.skill.create({ data: { name: 'Figma', categoryId: cat.id, sortOrder: 2 } })
    await prisma.skill.create({ data: { name: 'Illustration', categoryId: cat.id, sortOrder: 1 } })

    const result = await anon().skills.list()

    expect(result.slice(0, 2).map((c) => c.name)).toEqual(['Zeta', 'Alpha'])
    expect(result[0].skills.map((s) => s.name)).toEqual(['Illustration', 'Figma'])
    expect(result[0]).toMatchObject({ description: 'Visual things', sortOrder: -2 })
    expect(result[0].skills[0]).toMatchObject({ categoryId: cat.id, description: null })
  })
})

describe('skills.mostNeeded', () => {
  it('ranks skills by how many projects looking for people ask for them', async () => {
    const [a, b, c] = [await createSkill(), await createSkill(), await createSkill()]
    const seeking = await createProject({
      status: 'in_progress',
      isSeekingHelp: true,
      assigneeId: null,
    })
    const ownerless = await createProject({ status: 'ready' })
    const owned = await createProject({
      status: 'in_progress',
      isSeekingHelp: false,
      assigneeId: (await createVolunteer()).id,
    })
    const done = await createProject({ status: 'completed', isSeekingHelp: true })
    await prisma.workItemSkill.createMany({
      data: [
        { workItemId: seeking.id, skillId: a.id },
        { workItemId: ownerless.id, skillId: a.id },
        { workItemId: seeking.id, skillId: b.id },
        // Neither a full project nor a finished one counts.
        { workItemId: owned.id, skillId: c.id },
        { workItemId: done.id, skillId: c.id },
      ],
    })
    const result = await anon().skills.mostNeeded()
    expect(result.slice(0, 2)).toEqual([
      { id: a.id, name: a.name, projects: 2 },
      { id: b.id, name: b.name, projects: 1 },
    ])
    expect(result.some((s) => s.id === c.id)).toBe(false)
    expect(result.length).toBeLessThanOrEqual(10)
  })
})
