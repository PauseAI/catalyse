import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createSkill,
  createTeam,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

vi.mock('@/lib/project-match-notify', () => ({ notifyMatchingVolunteers: vi.fn(async () => {}) }))
vi.mock('@/lib/notify', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/notify')>()
  return { ...original, notifyTeamOfProject: vi.fn(original.notifyTeamOfProject) }
})
import { notifyMatchingVolunteers } from '@/lib/project-match-notify'
import { notifyTeamOfProject } from '@/lib/notify'

const base = {
  title: 'Org project',
  description: 'desc',
  projectType: 'sprint',
  estimatedDuration: '2 weeks',
  timeCommitmentHoursPerWeek: 3,
  urgency: 'high',
  collaborationLink: null,
  country: 'UK',
  localGroup: null,
  isSeekingHelp: true,
}

describe('admin.projects.create / myDrafts', () => {
  it('requires a task unless saving a draft, and publishes live projects with notifications', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    await expect(c.admin.projects.create({ ...base })).rejects.toMatchObject({
      message: 'At least one task is required to create a project',
    })

    const draft = await c.admin.projects.create({ ...base, saveAsDraft: true })
    expect(draft.message).toBe('Draft saved')
    expect(await c.admin.projects.myDrafts()).toEqual([
      expect.objectContaining({ id: draft.id, title: 'Org project' }),
    ])
    expect(notifyMatchingVolunteers).not.toHaveBeenCalled()

    const skill = await createSkill()
    const team = await createTeam()
    const member = await createVolunteer()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: member.id } })
    const live = await c.admin.projects.create({
      ...base,
      wantToOwn: true,
      teamId: team.id,
      skillIds: [skill.id],
      skillRequiredMap: { [skill.id]: false },
      tasks: [{ title: 'T1', description: 'd' }, { title: 'T2' }],
      startDate: new Date('2026-06-01T00:00:00Z'),
      durationDays: 10,
      remoteEligibility: 'GLOBAL',
    })
    expect(live.message).toBe('Org project created')
    const row = await prisma.workItem.findUniqueOrThrow({
      where: { id: live.id },
      include: { skills: true, children: true },
    })
    expect(row).toMatchObject({
      status: 'in_progress',
      assigneeId: admin.id,
      isOrgProposed: true,
      urgency: 'high',
      remoteEligibility: 'GLOBAL',
      durationDays: 10,
    })
    expect(row.scheduleUpdatedAt).not.toBeNull()
    expect(row.skills[0].isRequired).toBe(false)
    expect(row.children.map((t) => [t.title, t.description])).toEqual([
      ['T1', 'd'],
      ['T2', null],
    ])
    expect(notifyMatchingVolunteers).toHaveBeenCalledWith(live.id)
    expect(notifyTeamOfProject).toHaveBeenCalledWith(team.id, live.id, 'Org project')
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: member.id, type: 'team_project_assigned' },
        }),
      ).toBe(1),
    )

    const unowned = await c.admin.projects.create({
      ...base,
      tasks: [{ title: 'T' }],
      isSeekingHelp: false,
      projectType: null,
      estimatedDuration: null,
      timeCommitmentHoursPerWeek: null,
      country: null,
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: unowned.id } })).toMatchObject({
      status: 'ready',
      assigneeId: null,
      isSeekingHelp: false,
    })
  })

  it('logs notification failures after a create', async () => {
    const c = clientAs(await createAdmin())
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(notifyMatchingVolunteers).mockRejectedValueOnce(new Error('m'))
    vi.mocked(notifyTeamOfProject).mockRejectedValueOnce(new Error('t'))
    const team = await createTeam()
    await c.admin.projects.create({ ...base, tasks: [{ title: 'T' }], teamId: team.id })
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('[MATCH NOTIFY]', expect.any(Error))
      expect(error).toHaveBeenCalledWith('[TEAM NOTIFY]', expect.any(Error))
    })
  })
})

describe('admin.projects.review', () => {
  it('approves into ready or in_progress, with comment and notifications', async () => {
    const admin = await createAdmin()
    const creator = await createVolunteer()
    const team = await createTeam()
    const c = clientAs(admin)
    await expect(
      c.admin.projects.review({ id: 999_999, status: 'approved' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const unowned = await createProject({
      status: 'pending_review',
      creatorId: creator.id,
      teamId: team.id,
    })
    await prisma.notification.create({
      data: {
        volunteerId: admin.id,
        type: 'new_project_proposal',
        title: 't',
        entityId: unowned.id,
      },
    })
    expect(
      await c.admin.projects.review({
        id: unowned.id,
        status: 'approved',
        reviewNotes: 'ok',
        comment: ' nice ',
      }),
    ).toEqual({ message: 'Project marked as approved' })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: unowned.id } })).toMatchObject({
      status: 'ready',
      reviewNotes: 'ok',
      reviewedById: admin.id,
      stakeholderId: admin.id,
    })
    expect(
      await prisma.workItemComment.findFirst({ where: { workItemId: unowned.id } }),
    ).toMatchObject({ content: 'nice' })
    expect(notifyMatchingVolunteers).toHaveBeenCalledWith(unowned.id)
    expect(notifyTeamOfProject).toHaveBeenCalledWith(team.id, unowned.id, unowned.title)
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findMany({
          where: { volunteerId: creator.id, type: 'project_approved' },
        }),
      ).toEqual([
        expect.objectContaining({
          title: `Approved: '${unowned.title}' is now visible to volunteers`,
          link: `/projects/${unowned.id}`,
        }),
      ]),
    )
    expect(
      await prisma.notification.count({
        where: { type: 'new_project_proposal', entityId: unowned.id },
      }),
    ).toBe(0)

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(notifyMatchingVolunteers).mockRejectedValueOnce(new Error('m'))
    vi.mocked(notifyTeamOfProject).mockRejectedValueOnce(new Error('t'))
    const owned = await createProject({
      status: 'pending_review',
      assigneeId: creator.id,
      teamId: team.id,
    })
    await c.admin.projects.review({ id: owned.id, status: 'approved', comment: '  ' })
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('[MATCH NOTIFY]', expect.any(Error))
      expect(error).toHaveBeenCalledWith('[TEAM NOTIFY]', expect.any(Error))
    })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: owned.id } })).status).toBe(
      'in_progress',
    )
    expect(await prisma.workItemComment.count({ where: { workItemId: owned.id } })).toBe(0)
  })

  it('sends back for discussion with feedback', async () => {
    const admin = await createAdmin()
    const creator = await createVolunteer()
    const c = clientAs(admin)
    const p = await createProject({ status: 'pending_review', creatorId: creator.id })
    expect(
      await c.admin.projects.review({
        id: p.id,
        status: 'needs_discussion',
        comment: 'Please expand',
      }),
    ).toEqual({ message: 'Project marked as needs_discussion' })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'needs_discussion',
    )
    expect(await prisma.workItemComment.findFirst({ where: { workItemId: p.id } })).toMatchObject({
      content: 'Please expand',
    })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findFirst({
          where: { volunteerId: creator.id, type: 'project_needs_discussion' },
        }),
      ).toMatchObject({
        title: `Changes requested: '${p.title}'`,
        body: 'Please expand',
        link: `/projects/${p.id}`,
        entityId: p.id,
      }),
    )
    expect(await prisma.projectReviewRequest.findMany({ where: { projectId: p.id } })).toEqual([
      expect.objectContaining({
        message: 'Please expand',
        requestedById: admin.id,
        resolvedAt: null,
      }),
    ])
    const orphan = await createProject({ status: 'pending_review' })
    await c.admin.projects.review({ id: orphan.id, status: 'needs_discussion' })
    expect(await prisma.workItemComment.count({ where: { workItemId: orphan.id } })).toBe(0)
    expect(
      await prisma.projectReviewRequest.findFirst({ where: { projectId: orphan.id } }),
    ).toMatchObject({ message: 'A team lead would like some changes to your proposal.' })
  })

  it('keeps one open request per round, and approval closes it', async () => {
    const admin = await createAdmin()
    const creator = await createVolunteer()
    const c = clientAs(admin)
    const p = await createProject({ status: 'pending_review', creatorId: creator.id })
    await c.admin.projects.review({ id: p.id, status: 'needs_discussion', comment: 'One' })
    await c.admin.projects.review({ id: p.id, status: 'needs_discussion', comment: 'Two' })
    const rounds = await prisma.projectReviewRequest.findMany({
      where: { projectId: p.id },
      orderBy: { id: 'asc' },
    })
    expect(rounds.map((r) => [r.message, r.resolvedAt === null])).toEqual([
      ['One', false],
      ['Two', true],
    ])
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: creator.id, type: 'project_needs_discussion', entityId: p.id },
        }),
      ).toBe(2),
    )

    await c.admin.projects.review({ id: p.id, status: 'approved' })
    expect(
      await prisma.projectReviewRequest.count({ where: { projectId: p.id, resolvedAt: null } }),
    ).toBe(0)
    expect(
      await prisma.notification.count({
        where: { type: 'project_needs_discussion', entityId: p.id },
      }),
    ).toBe(0)
  })
})

describe('admin.projects.setOutcome', () => {
  it('records the outcome, completes the project, notes reliability and endorses skills', async () => {
    const admin = await createAdmin()
    const owner = await createVolunteer()
    const skill = await createSkill()
    const optional = await createSkill()
    const c = clientAs(admin)
    await expect(
      c.admin.projects.setOutcome({ id: 999_999, outcome: 'successful' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const p = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
      skills: {
        create: [
          { skillId: skill.id, isRequired: true },
          { skillId: optional.id, isRequired: false },
        ],
      },
    })
    expect(
      await c.admin.projects.setOutcome({ id: p.id, outcome: 'successful', outcomeNotes: 'Great' }),
    ).toEqual({ message: 'Project outcome recorded as successful' })
    const row = await prisma.workItem.findUniqueOrThrow({ where: { id: p.id } })
    expect(row).toMatchObject({ outcome: 'successful', status: 'completed', isSeekingHelp: false })
    expect(row.completedAt).not.toBeNull()
    expect(await prisma.adminNote.findFirst({ where: { volunteerId: owner.id } })).toMatchObject({
      category: 'reliability',
      relatedWorkItemId: p.id,
    })
    const endorsements = await prisma.skillEndorsement.findMany({
      where: { volunteerId: owner.id },
    })
    expect(endorsements.map((e) => e.skillId)).toEqual([skill.id])
    // Upsert path on a second success.
    await c.admin.projects.setOutcome({ id: p.id, outcome: 'successful' })
    expect(await prisma.skillEndorsement.count({ where: { volunteerId: owner.id } })).toBe(1)

    const ongoing = await createProject({ status: 'in_progress', assigneeId: owner.id })
    await c.admin.projects.setOutcome({ id: ongoing.id, outcome: 'ongoing' })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: ongoing.id } })).toMatchObject({
      outcome: 'ongoing',
      status: 'in_progress',
      completedAt: null,
    })
    const unowned = await createProject({ status: 'ready' })
    await c.admin.projects.setOutcome({
      id: unowned.id,
      outcome: 'not_completed',
      outcomeNotes: 'n',
    })
    expect(await prisma.adminNote.count({ where: { relatedWorkItemId: unowned.id } })).toBe(0)
  })
})

describe('admin.projects.triage / staleInProgress', () => {
  it('lists review queue and owned projects with no open tasks', async () => {
    const c = clientAs(await createAdmin())
    const owner = await createVolunteer()
    const pending = await createProject({ status: 'pending_review' })
    const stale = await createProject({ status: 'in_progress', assigneeId: owner.id })
    const done = await createProject({ status: 'in_progress', assigneeId: owner.id })
    await createTask(done.id, { status: 'completed' })
    const busy = await createProject({ status: 'in_progress', assigneeId: owner.id })
    await createTask(busy.id)
    expect((await c.admin.projects.triage()).map((p) => p.id)).toContain(pending.id)
    const staleIds = (await c.admin.projects.staleInProgress()).map((p) => p.id)
    expect(staleIds).toEqual(expect.arrayContaining([stale.id, done.id]))
    expect(staleIds).not.toContain(busy.id)
  })
})
