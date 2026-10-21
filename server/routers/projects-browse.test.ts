import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createSkill,
  createTeam,
  createLocalGroup,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

vi.mock('@/lib/project-match-notify', () => ({ notifyMatchingVolunteers: vi.fn(async () => {}) }))
import { notifyMatchingVolunteers } from '@/lib/project-match-notify'

const ids = (projects: { id: number }[]) => projects.map((p) => p.id).sort((a, b) => a - b)

describe('projects.list', () => {
  it('requires a confirmed email', async () => {
    const unconfirmed = await createVolunteer({ emailConfirmed: false })
    await expect(clientAs(unconfirmed).projects.list({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(clientAs(unconfirmed).projects.listGrouped({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('applies every filter and hides team projects from outsiders', async () => {
    const me = await createVolunteer()
    const owner = await createVolunteer()
    const skill = await createSkill()
    const team = await createTeam()
    const c = clientAs(me)

    const group = await createLocalGroup({ name: 'Browse Town' })
    const ready = await createProject({
      title: 'Alpha ready',
      urgency: 'high',
      reach: 'LOCAL',
      localGroupId: group.id,
      skills: { create: [{ skillId: skill.id, isRequired: true }] },
    })
    const owned = await createProject({
      title: 'Beta owned',
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
      isOrgProposed: true,
      urgency: 'low',
    })
    const quiet = await createProject({
      title: 'Gamma quiet',
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: false,
      description: 'needle',
    })
    const teamP = await createProject({ title: 'Team only', teamId: team.id })
    await createProject({ title: 'Pending', status: 'pending_review' })
    await createProject({ title: 'Archived', status: 'archived' })

    expect(ids((await c.projects.list({})).projects)).toEqual(ids([ready, owned, quiet]))
    expect(ids((await c.projects.list({ status: 'in_progress' })).projects)).toEqual(
      ids([owned, quiet]),
    )
    expect(ids((await c.projects.list({ skillIds: [skill.id] })).projects)).toEqual([ready.id])
    expect(ids((await c.projects.list({ search: 'needle' })).projects)).toEqual([quiet.id])
    expect(ids((await c.projects.list({ urgency: 'high' })).projects)).toEqual([ready.id])
    expect(ids((await c.projects.list({ localGroupId: group.id })).projects)).toEqual([ready.id])
    expect(ids((await c.projects.list({ isOrgProposed: true })).projects)).toEqual([owned.id])
    expect(ids((await c.projects.list({ isSeekingHelp: false })).projects)).toEqual(
      ids([ready, quiet]),
    )
    expect(ids((await c.projects.list({ isSeekingOwner: true })).projects)).toEqual([ready.id])
    expect(ids((await c.projects.list({ isSeekingOwner: false })).projects)).toEqual(
      ids([owned, quiet]),
    )
    expect(ids((await c.projects.list({ isSeekingAny: true })).projects)).toEqual(
      ids([ready, owned]),
    )
    expect(ids((await c.projects.list({ notSeeking: true })).projects)).toEqual([quiet.id])
    expect((await c.projects.list({ teamId: team.id })).total).toBe(0)
    expect((await c.projects.list({ limit: 1, offset: 1 })).projects).toHaveLength(1)

    // Team visibility: member, owner, accepted helper, admin.
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    const mine = await c.projects.list({ teamId: team.id })
    expect(ids(mine.projects)).toEqual([teamP.id])
    expect(mine.projects[0].isMyTeam).toBe(true)
    expect(
      ids((await clientAs(await createAdmin()).projects.list({ teamId: team.id })).projects),
    ).toEqual([teamP.id])
  })

  it('sorts by match score client-side, paging the full set', async () => {
    const skill = await createSkill()
    const other = await createSkill()
    const me = await createVolunteer({ skills: { create: [{ skillId: skill.id }] } })
    const noSkills = await createVolunteer()
    const weak = await createProject({
      title: 'matchsort weak',
      skills: { create: [{ skillId: other.id, isRequired: true }] },
    })
    const strong = await createProject({
      title: 'matchsort strong',
      skills: { create: [{ skillId: skill.id, isRequired: true }] },
    })
    const q = { sortBy: 'match', search: 'matchsort', limit: 1 }
    const res = await clientAs(me).projects.list(q)
    expect(res.projects.map((p) => p.id)).toEqual([strong.id])
    expect(res.total).toBe(2)
    expect(
      (await clientAs(me).projects.list({ ...q, offset: 1 })).projects.map((p) => p.id),
    ).toEqual([weak.id])
    expect((await clientAs(noSkills).projects.list(q)).projects).toHaveLength(1)
  })

  it('orders by newest or most urgent when asked, seeking-first otherwise', async () => {
    const me = await createVolunteer()
    // Owned, so that only the seeking-help flag marks one as looking for people.
    const assigneeId = (await createVolunteer()).id
    const day = (n: number) => new Date(Date.UTC(2026, 0, n))
    const oldUrgent = await createProject({
      title: 'ordersort old urgent',
      assigneeId,
      urgency: 'high',
      createdAt: day(1),
    })
    const newCalm = await createProject({
      title: 'ordersort new calm',
      assigneeId,
      urgency: 'low',
      createdAt: day(3),
    })
    const seeking = await createProject({
      title: 'ordersort seeking',
      assigneeId,
      urgency: 'medium',
      isSeekingHelp: true,
      createdAt: day(2),
    })
    const order = async (sortBy?: string) =>
      (await clientAs(me).projects.list({ search: 'ordersort', sortBy })).projects.map((p) => p.id)
    expect(await order('created_at')).toEqual([newCalm.id, seeking.id, oldUrgent.id])
    expect(await order('urgency')).toEqual([oldUrgent.id, seeking.id, newCalm.id])
    expect(await order()).toEqual([seeking.id, oldUrgent.id, newCalm.id])
  })
})

describe('projects.listGrouped', () => {
  it("buckets projects and cross-cuts by the viewer's team", async () => {
    const me = await createVolunteer()
    const owner = await createVolunteer()
    const team = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    const skill = await createSkill()
    const G = 'grouped'
    const groupL = await createLocalGroup({ name: 'Grouped Town' })
    const seeking = await createProject({
      title: `${G} seek`,
      skills: { create: [{ skillId: skill.id }] },
      urgency: 'high',
      localGroupId: groupL.id,
      isOrgProposed: true,
      teamId: team.id,
    })
    const inProgress = await createProject({
      title: `${G} ip`,
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: false,
    })
    const onHold = await createProject({
      title: `${G} hold`,
      assigneeId: owner.id,
      status: 'on_hold',
      isSeekingHelp: false,
    })
    const completed = await createProject({ title: `${G} done`, status: 'completed' })
    const other = await createProject({
      title: `${G} odd`,
      status: 'in_progress',
      assigneeId: owner.id,
      isSeekingHelp: false,
    })
    const groups = (await clientAs(me).projects.listGrouped({ search: G })).groups
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]))
    expect(ids(byKey.seeking.projects)).toEqual([seeking.id])
    expect(ids(byKey.in_progress.projects)).toEqual(ids([inProgress, other]))
    expect(ids(byKey.on_hold.projects)).toEqual([onHold.id])
    expect(ids(byKey.completed.projects)).toEqual([completed.id])
    expect(byKey.other.total).toBe(0)
    expect(ids(byKey.your_team.projects)).toEqual([seeking.id])

    const filtered = (
      await clientAs(me).projects.listGrouped({
        skillIds: [skill.id],
        search: G,
        urgency: 'high',
        localGroupId: groupL.id,
        teamId: team.id,
        isOrgProposed: true,
        previewLimit: 5,
      })
    ).groups
    expect(filtered.find((g) => g.key === 'seeking')!.total).toBe(1)

    const loner = await createVolunteer({ skills: { create: [{ skillId: skill.id }] } })
    const lonerGroups = (await clientAs(loner).projects.listGrouped({ search: G })).groups
    expect(
      lonerGroups.find((g) => g.key === 'in_progress')!.projects[0].match?.matchedRequiredCount,
    ).toBe(0)
    expect(lonerGroups.find((g) => g.key === 'your_team')!.total).toBe(0)
    const adminGroups = (await clientAs(await createAdmin()).projects.listGrouped({})).groups
    expect(adminGroups.map((g) => g.key)).not.toContain('your_team')
  })
})

describe('projects.create / drafts', () => {
  const base = {
    title: 'Proposal',
    description: 'desc',
    projectType: 'sprint',
    estimatedDuration: '1 week',
    timeCommitmentHoursPerWeek: 2,
    urgency: 'medium',
    collaborationLink: null,
    isSeekingHelp: true,
  }

  it('submits a proposal for review, or saves a draft (capped at two)', async () => {
    const admin = await createAdmin()
    const me = await createVolunteer()
    const c = clientAs(me)
    const withoutTasks = await c.projects.create({ ...base })
    expect(withoutTasks.message).toBe('Project submitted for review')
    expect(
      (await prisma.workItem.findUniqueOrThrow({ where: { id: withoutTasks.id } })).status,
    ).toBe('pending_review')

    const skill = await createSkill()
    const res = await c.projects.create({
      ...base,
      wantToOwn: true,
      tasks: [{ title: 'T', description: 'd' }],
      skillIds: [skill.id],
      skillRequiredMap: { [skill.id]: false },
      startDate: new Date('2026-05-01T00:00:00Z'),
      reach: 'REMOTE',
      isSeekingHelp: false,
    })
    expect(res.message).toBe('Project submitted for review')
    const row = await prisma.workItem.findUniqueOrThrow({
      where: { id: res.id },
      include: { skills: true, children: true },
    })
    expect(row).toMatchObject({
      status: 'pending_review',
      assigneeId: me.id,
      isOrgProposed: false,
      reach: 'REMOTE',
      isSeekingHelp: false,
    })
    expect(row.skills[0].isRequired).toBe(false)
    expect(row.children).toHaveLength(1)
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: admin.id, type: 'new_project_proposal', entityId: res.id },
        }),
      ).toBe(1),
    )

    const d1 = await c.projects.create({ ...base, saveAsDraft: true })
    expect(d1.message).toBe('Draft saved')
    await c.projects.create({ ...base, saveAsDraft: true })
    await expect(c.projects.create({ ...base, saveAsDraft: true })).rejects.toMatchObject({
      message: expect.stringContaining('already have 2 drafts'),
    })
    expect((await c.projects.myDrafts()).map((d) => d.id)).toContain(d1.id)
  })

  it('publishes and deletes drafts with the right guards', async () => {
    const admin = await createAdmin()
    const me = await createVolunteer()
    const other = await createVolunteer()
    const c = clientAs(me)
    const draft = await c.projects.create({ ...base, saveAsDraft: true })
    await expect(c.projects.publishDraft({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(clientAs(other).projects.publishDraft({ id: draft.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    // A volunteer's own draft publishes straight to review with no task required.
    expect(await c.projects.publishDraft({ id: draft.id })).toEqual({
      message: 'Project submitted for review',
    })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      'pending_review',
    )
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: admin.id, type: 'new_project_proposal', entityId: draft.id },
        }),
      ).toBe(1),
    )
    await expect(c.projects.publishDraft({ id: draft.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    // An org draft goes live directly (ready or in_progress), notifying matches and the team —
    // with no review to catch a missing task list, it still needs at least one.
    const team = await createTeam()
    const orgDraft = await createProject({
      status: 'draft',
      isOrgProposed: true,
      creatorId: admin.id,
      teamId: team.id,
    })
    await expect(clientAs(admin).projects.publishDraft({ id: orgDraft.id })).rejects.toMatchObject({
      message: expect.stringContaining('at least one task'),
    })
    await createTask(orgDraft.id)
    expect(await clientAs(admin).projects.publishDraft({ id: orgDraft.id })).toEqual({
      message: 'Project published',
    })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: orgDraft.id } })).status).toBe(
      'ready',
    )
    expect(notifyMatchingVolunteers).toHaveBeenCalledWith(orgDraft.id)
    const ownedOrg = await createProject({
      status: 'draft',
      isOrgProposed: true,
      creatorId: admin.id,
      assigneeId: admin.id,
    })
    await createTask(ownedOrg.id)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger)
    vi.mocked(notifyMatchingVolunteers).mockRejectedValueOnce(new Error('m'))
    await clientAs(admin).projects.publishDraft({ id: ownedOrg.id })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: ownedOrg.id } })).status).toBe(
      'in_progress',
    )
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.any(Error), '[MATCH NOTIFY]'))
    const { notifyTeamOfProject } = await import('@/lib/notify')
    const teamDraft = await createProject({
      status: 'draft',
      isOrgProposed: true,
      creatorId: admin.id,
      teamId: team.id,
    })
    await createTask(teamDraft.id)
    vi.spyOn(prisma.teamMembership, 'findMany').mockRejectedValueOnce(new Error('t') as never)
    await clientAs(admin).projects.publishDraft({ id: teamDraft.id })
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.any(Error), '[TEAM NOTIFY]'))
    void notifyTeamOfProject

    const d2 = await c.projects.create({ ...base, saveAsDraft: true })
    await expect(c.projects.deleteDraft({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(clientAs(other).projects.deleteDraft({ id: d2.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await c.projects.deleteDraft({ id: d2.id })).toEqual({ message: 'Draft deleted' })
    expect(await prisma.workItem.count({ where: { id: d2.id } })).toBe(0)
  })
})

describe('projects.getById', () => {
  it('returns the project with tasks, interests (for owner/admin) and claim state', async () => {
    const me = await createVolunteer()
    const owner = await createVolunteer()
    const helper = await createVolunteer()
    const skill = await createSkill()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const t1 = await createTask(project.id, {
      sortOrder: 2,
      assigneeId: helper.id,
      creatorId: owner.id,
    })
    const t2 = await createTask(project.id, { sortOrder: 1 })
    const t3 = await createTask(project.id, { status: 'completed' })
    const t4 = await createTask(project.id, { sortOrder: 1 })
    await prisma.workItemComment.create({
      data: { workItemId: t1.id, authorId: owner.id, content: 'c' },
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: helper.id,
        interestType: 'want_to_contribute',
        message: 'me!',
      },
    })
    await prisma.volunteerSkill.create({ data: { volunteerId: helper.id, skillId: skill.id } })

    await expect(clientAs(me).projects.getById({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const asMe = await clientAs(me).projects.getById({ id: project.id })
    expect(asMe.tasks.map((t) => t.id)).toEqual([t4.id, t2.id, t1.id, t3.id])
    expect(asMe.tasks[2]).toMatchObject({
      assignedToName: helper.name,
      createdByName: owner.name,
      commentCount: 1,
    })
    expect(asMe.interests).toBeUndefined()
    expect(asMe.myInterest).toBeNull()
    expect(asMe.canClaimTasks).toBe(true)

    const asOwner = await clientAs(owner).projects.getById({ id: project.id })
    expect(asOwner.interests).toEqual([
      expect.objectContaining({
        volunteerName: helper.name,
        message: 'me!',
        volunteerSkills: [expect.objectContaining({ id: skill.id })],
      }),
    ])
    const asHelper = await clientAs(helper).projects.getById({ id: project.id })
    expect(asHelper.myInterest).toMatchObject({ interestType: 'want_to_contribute' })

    await prisma.workItemInterest.update({
      where: { volunteerId_workItemId: { volunteerId: helper.id, workItemId: project.id } },
      data: { status: 'declined' },
    })
    expect((await clientAs(helper).projects.getById({ id: project.id })).canClaimTasks).toBe(false)
    expect(
      (await clientAs(await createAdmin()).projects.getById({ id: project.id })).interests,
    ).toHaveLength(1)
  })

  it('hides team-restricted and unpublished projects from outsiders', async () => {
    const me = await createVolunteer()
    const creator = await createVolunteer()
    const team = await createTeam()
    const teamP = await createProject({ teamId: team.id })
    await expect(clientAs(me).projects.getById({ id: teamP.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })
    expect((await clientAs(me).projects.getById({ id: teamP.id })).isMyTeam).toBe(true)
    const ownTeamP = await createProject({ teamId: team.id, creatorId: creator.id })
    expect((await clientAs(creator).projects.getById({ id: ownTeamP.id })).id).toBe(ownTeamP.id)

    const draft = await createProject({ status: 'draft', creatorId: creator.id })
    await expect(clientAs(me).projects.getById({ id: draft.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect((await clientAs(creator).projects.getById({ id: draft.id })).id).toBe(draft.id)
    expect((await clientAs(await createAdmin()).projects.getById({ id: draft.id })).id).toBe(
      draft.id,
    )
  })
})

describe('direct links', () => {
  it('keeps a direct link to a project, its tasks or the roadmap closed to an unconfirmed email', async () => {
    const project = await createProject({ title: 'Direct link' })
    const task = await createTask(project.id)
    const unconfirmed = clientAs(await createVolunteer({ emailConfirmed: false }))
    const refused = { code: 'FORBIDDEN', message: /confirm your email/ }
    await expect(unconfirmed.projects.getById({ id: project.id })).rejects.toMatchObject(refused)
    await expect(unconfirmed.projects.listTasks({ projectId: project.id })).rejects.toMatchObject(
      refused,
    )
    await expect(
      unconfirmed.projects.getTask({ projectId: project.id, taskId: task.id }),
    ).rejects.toMatchObject(refused)
    await expect(unconfirmed.projects.ganttOverview({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      unconfirmed.projects.expressInterest({
        projectId: project.id,
        interestType: 'want_to_contribute',
      }),
    ).rejects.toMatchObject(refused)
  })
})
