import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createSkill,
  createTeam,
  createLocalGroup,
  createChapter,
  createChapterDeputy,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

async function saveTemplate() {
  const admin = await createAdmin()
  const team = await createTeam({ name: 'Source Team' })
  const skill = await createSkill()
  const leeds = await createLocalGroup({ country: 'UK' })
  const project = await createProject({
    title: 'Rally',
    description: 'A rally',
    nationalChapterId: leeds.nationalChapterId,
    reach: 'LOCAL',
    localGroupId: leeds.id,
    teamId: team.id,
    startDate: new Date('2026-03-01T00:00:00.000Z'),
    durationDays: 10,
    collaborationLink: 'https://example.com/doc',
    skills: { create: [{ skillId: skill.id, isRequired: true }] },
  })
  const a = await createTask(project.id, {
    title: 'Book venue',
    startDate: new Date('2026-03-01T00:00:00.000Z'),
    durationDays: 2,
    skills: { create: [{ skillId: skill.id, isRequired: false }] },
    submissionAsksLink: true,
    helpersWanted: 3,
  })
  const b = await createTask(project.id, {
    title: 'Print posters',
    featuredAsQuickTask: true,
    submissionPrompt: 'Where did they go up?',
  })
  await prisma.workItemDependency.create({
    data: { predecessorId: a.id, successorId: b.id, lagDays: 1 },
  })
  const c = clientAs(admin)
  const { id } = await c.templates.saveAsTemplate({
    projectId: project.id,
    title: 'Rally template',
    description: 'Reusable rally',
  })
  return { admin, c, team, skill, project, a, b, id, leeds }
}

describe('templates.saveAsTemplate / get / list', () => {
  it('serialises a project without its location or people, and lists it', async () => {
    const { c, team, skill, project, id, leeds } = await saveTemplate()
    await expect(
      c.templates.saveAsTemplate({ projectId: 999_999, title: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const t = await c.templates.get({ id })
    expect(t).toMatchObject({
      title: 'Rally template',
      description: 'Reusable rally',
      sourceType: 'PROJECT',
      sourceCountry: 'UK',
      sourceLocalGroup: leeds.name,
      sourceTeam: { id: team.id, name: 'Source Team' },
    })
    const structure = t.structure!
    expect(structure.sourceType).toBe('PROJECT')
    if (structure.sourceType !== 'PROJECT') throw new Error('unreachable')
    expect(structure.title).toBe('Rally')
    expect(structure.skills).toEqual([{ skillId: skill.id, isRequired: true }])
    expect(structure.tasks.map((x) => [x.title, x.startOffsetDays, x.featuredAsQuickTask])).toEqual(
      [
        ['Book venue', 0, false],
        ['Print posters', null, true],
      ],
    )
    expect(structure.tasks.map((x) => [x.submissionPrompt, x.submissionAsksLink])).toEqual([
      [null, true],
      ['Where did they go up?', false],
    ])
    expect(structure.tasks.map((x) => x.helpersWanted)).toEqual([3, null])
    expect(structure.tasks[0].skills).toEqual([{ skillId: skill.id, isRequired: false }])
    expect(structure.tasks[1].dependsOn).toEqual([{ on: `task-${project.id + 1}`, lagDays: 1 }])
    expect(JSON.stringify(structure)).not.toContain('Leeds')

    await expect(c.templates.get({ id: 999_999 })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const listed = await c.templates.list()
    expect(listed.map((x) => x.id)).toContain(id)
    expect(listed.find((x) => x.id === id)).toMatchObject({ usedCount: 0, sourceCountry: 'UK' })
    expect((await c.templates.list({ sourceType: 'QUICK_TASK' })).map((x) => x.id)).not.toContain(
      id,
    )
  })

  it('reports an unparseable structure as null', async () => {
    const admin = await createAdmin()
    const row = await prisma.template.create({
      data: { title: 'Corrupt', structure: JSON.stringify({ sourceType: 'PROJECT' }) },
    })
    expect((await clientAs(admin).templates.get({ id: row.id })).structure).toBeNull()
  })
})

describe('templates.createFromScratch / update / archive', () => {
  it('builds a template from a task list, then edits and archives it', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    await expect(
      c.templates.createFromScratch({
        title: 'Bad',
        template: { title: 'Bad', tasks: [{ ref: 'a', title: 'A', dependsOnRefs: ['ghost'] }] },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('ghost') })

    const { id } = await c.templates.createFromScratch({
      title: 'Scratch',
      template: {
        title: 'Scratch',
        tasks: [
          { ref: 'a', title: 'A', startOffsetDays: 0, durationDays: 1, skillIds: [1] },
          {
            ref: 'b',
            title: 'B',
            dependsOnRefs: ['a'],
            isAnchor: true,
            submissionPrompt: 'Count?',
            submissionAsksLink: true,
          },
        ],
      },
    })
    const structure = (await c.templates.get({ id })).structure!
    if (structure.sourceType !== 'PROJECT') throw new Error('unreachable')
    expect(structure).toMatchObject({ urgency: 'medium', reach: 'COUNTRY_WIDE', skills: [] })
    expect(structure.tasks[0].skills).toEqual([{ skillId: 1, isRequired: true }])
    expect(structure.tasks[0]).toMatchObject({ submissionPrompt: null, submissionAsksLink: false })
    expect(structure.tasks[1]).toMatchObject({
      submissionPrompt: 'Count?',
      submissionAsksLink: true,
      isAnchor: true,
      dependsOn: [{ on: 'a', lagDays: 0 }],
    })
    // A template with no tasks at all is allowed.
    const bare = await c.templates.createFromScratch({ title: 'Bare', template: { title: 'Bare' } })
    expect((await c.templates.get({ id: bare.id })).structure).toMatchObject({ tasks: [] })

    expect(await c.templates.update({ id, title: 'Renamed' })).toEqual({
      message: 'Template updated',
    })
    expect(await c.templates.update({ id, description: 'Now described' })).toEqual({
      message: 'Template updated',
    })
    expect(await c.templates.get({ id })).toMatchObject({
      title: 'Renamed',
      description: 'Now described',
    })
    await expect(c.templates.update({ id: 999_999, title: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    expect(await c.templates.archive({ id })).toEqual({ message: 'Template archived' })
    expect((await c.templates.list()).map((x) => x.id)).not.toContain(id)
    await expect(c.templates.archive({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(c.templates.instantiate({ templateId: id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('is admin-only', async () => {
    const vol = await createVolunteer()
    await expect(
      clientAs(vol).templates.createFromScratch({ title: 'x', template: { title: 'x' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('templates.instantiate / canInstantiate', () => {
  it('copies the structure into a fresh draft owned by the caller', async () => {
    const { c, skill, id, admin } = await saveTemplate()
    const { id: newId, title } = await c.templates.instantiate({ templateId: id })
    expect(title).toBe('Rally template')
    const draft = await prisma.workItem.findUniqueOrThrow({
      where: { id: newId },
      include: {
        skills: true,
        children: { orderBy: { sortOrder: 'asc' }, include: { skills: true } },
      },
    })
    expect(draft).toMatchObject({
      status: 'draft',
      title: 'Rally template',
      description: 'A rally',
      // In the copier's chapter, its location left to them.
      nationalChapterId: admin.nationalChapterId,
      reach: 'COUNTRY_WIDE',
      localGroupId: null,
      teamId: null,
      collaborationLink: null,
      startDate: null,
      assigneeId: admin.id,
      creatorId: admin.id,
      templateOriginId: id,
    })
    expect(draft.skills).toEqual([expect.objectContaining({ skillId: skill.id, isRequired: true })])
    expect(
      draft.children.map((t) => [
        t.title,
        t.sortOrder,
        t.startDate,
        t.submissionPrompt,
        t.submissionAsksLink,
        t.helpersWanted,
      ]),
    ).toEqual([
      ['Book venue', 1, null, null, true, 3],
      ['Print posters', 2, null, 'Where did they go up?', false, null],
    ])
    expect(draft.children[0].skills).toEqual([
      expect.objectContaining({ skillId: skill.id, isRequired: false }),
    ])
    const deps = await prisma.workItemDependency.findMany({
      where: { successorId: draft.children[1].id },
    })
    expect(deps).toEqual([
      expect.objectContaining({ predecessorId: draft.children[0].id, lagDays: 1 }),
    ])
    expect((await c.templates.list()).find((x) => x.id === id)?.usedCount).toBe(1)
  })

  it("is for chapter staff and global admins, and puts the copy in the copier's chapter", async () => {
    const { id } = await saveTemplate()
    const chapter = await createChapter()
    const deputy = await createChapterDeputy(chapter)
    const leader = await createVolunteer()
    const team = await createTeam()
    await prisma.teamMembership.create({
      data: { teamId: team.id, volunteerId: leader.id, role: 'leader' },
    })
    expect(await clientAs(deputy).templates.canInstantiate()).toEqual({ canInstantiate: true })
    expect(await clientAs(leader).templates.canInstantiate()).toEqual({ canInstantiate: false })
    expect(await clientAs(await createAdmin()).templates.canInstantiate()).toEqual({
      canInstantiate: true,
    })
    // A team leader, like any member, no longer copies templates or sees the library.
    for (const call of [
      () => clientAs(leader).templates.instantiate({ templateId: id }),
      () => clientAs(leader).templates.list(),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    const copy = await clientAs(deputy).templates.instantiate({ templateId: id })
    expect(copy.title).toBe('Rally template')
    expect(
      (await prisma.workItem.findUniqueOrThrow({ where: { id: copy.id } })).nationalChapterId,
    ).toBe(chapter.id)
    // Shared across chapters: the deputy sees the template another chapter's author made.
    expect((await clientAs(deputy).templates.list()).map((t) => t.id)).toContain(id)
  })

  it("lets a template's author or a global admin change it, and staff save only their own chapter's projects", async () => {
    const chapter = await createChapter()
    const author = await createChapterDeputy(chapter)
    const other = await createChapterDeputy(await createChapter())
    const project = await createProject({ nationalChapterId: chapter.id, title: 'Ours' })
    const elsewhere = await createProject({ nationalChapterId: other.nationalChapterId })
    const { id } = await clientAs(author).templates.saveAsTemplate({
      projectId: project.id,
      title: 'Our kit',
    })
    await expect(
      clientAs(other).templates.saveAsTemplate({ projectId: project.id, title: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      clientAs(author).templates.saveAsTemplate({ projectId: elsewhere.id, title: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(clientAs(other).templates.update({ id, title: 'Mine now' })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    )
    await expect(clientAs(other).templates.archive({ id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await clientAs(author).templates.update({ id, title: 'Our kit 2' })).toEqual({
      message: 'Template updated',
    })
    expect(await clientAs(await createAdmin()).templates.archive({ id })).toEqual({
      message: 'Template archived',
    })
  })

  it('lets an admin instantiate past the draft cap a volunteer would hit', async () => {
    const { c, id } = await saveTemplate()
    // The volunteer draft cap is small; an admin making drafts from a template is not held to it.
    const ids: number[] = []
    for (let i = 0; i < 4; i++) ids.push((await c.templates.instantiate({ templateId: id })).id)
    expect(new Set(ids).size).toBe(4)
  })

  it('refuses quick-task, malformed and inconsistent templates', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const quick = await prisma.template.create({
      data: { title: 'Quick', sourceType: 'QUICK_TASK', structure: '{"sourceType":"QUICK_TASK"}' },
    })
    await expect(c.templates.instantiate({ templateId: quick.id })).rejects.toMatchObject({
      message: expect.stringContaining('not yet supported'),
    })
    const corrupt = await prisma.template.create({
      data: { title: 'Corrupt', structure: '{"sourceType":"PROJECT"}' },
    })
    await expect(c.templates.instantiate({ templateId: corrupt.id })).rejects.toMatchObject({
      message: expect.stringContaining('unrecognised structure'),
    })
    // A stored doc link is rendered as an href, so a non-http(s) scheme is not a template.
    const scripted = await prisma.template.create({
      data: {
        title: 'Scripted',
        structure: JSON.stringify({
          sourceType: 'PROJECT',
          title: 'Scripted',
          collaborationLink: 'javascript:alert(1)',
        }),
      },
    })
    await expect(c.templates.instantiate({ templateId: scripted.id })).rejects.toMatchObject({
      message: expect.stringContaining('unrecognised structure'),
    })
    // A structure can pass the schema yet carry a dangling dependency ref.
    const dangling = await prisma.template.create({
      data: {
        title: 'Dangling',
        structure: JSON.stringify({
          sourceType: 'PROJECT',
          title: 'Dangling',
          tasks: [{ ref: 'a', title: 'A', dependsOn: [{ on: 'ghost' }] }],
        }),
      },
    })
    await expect(c.templates.instantiate({ templateId: dangling.id })).rejects.toMatchObject({
      message: expect.stringContaining('unknown ref "ghost"'),
    })
    await expect(c.templates.instantiate({ templateId: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
