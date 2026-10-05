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

const row = (id: number) => prisma.workItem.findUniqueOrThrow({ where: { id } })

describe('projects.update permissions', () => {
  it('only participants may edit; only owner/admin/draft-creator may reassign', async () => {
    const owner = await createVolunteer()
    const creator = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({
      assigneeId: owner.id,
      creatorId: creator.id,
      status: 'in_progress',
    })
    await createTask(project.id)
    await expect(clientAs(other).projects.update({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      clientAs(other).projects.update({ id: project.id, title: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      clientAs(creator).projects.update({ id: project.id, assigneeId: creator.id }),
    ).rejects.toMatchObject({ message: 'Only the project owner or an admin can change the owner' })
    await expect(
      clientAs(creator).projects.update({ id: project.id, teamId: 1 }),
    ).rejects.toMatchObject({ message: 'Only the project owner or an admin can change the team' })
    // Resubmitting current values is fine for the creator.
    const same = await clientAs(creator).projects.update({
      id: project.id,
      assigneeId: owner.id,
      teamId: null,
      title: 'Creator edit',
    })
    expect(same.title).toBe('Creator edit')

    const draft = await createProject({ status: 'draft', creatorId: creator.id })
    const claimed = await clientAs(creator).projects.update({
      id: draft.id,
      assigneeId: creator.id,
    })
    expect(claimed.ownerId).toBe(creator.id)
    expect(claimed.status).toBe('draft')
  })

  it('validates owner and team targets', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const c = clientAs(owner)
    await expect(c.projects.update({ id: project.id, teamId: 999_999 })).rejects.toMatchObject({
      message: 'Team not found',
    })
    await expect(c.projects.update({ id: project.id, assigneeId: 999_999 })).rejects.toMatchObject({
      message: 'Volunteer not found',
    })
    const pending = await createVolunteer({ approvalStatus: 'pending' })
    await expect(
      c.projects.update({ id: project.id, assigneeId: pending.id }),
    ).rejects.toMatchObject({ message: expect.stringContaining('not yet approved') })
  })
})

describe('projects.update fields and status', () => {
  it('writes scalar, schedule, skill and team fields, notifying a newly tagged team', async () => {
    const owner = await createVolunteer()
    const member = await createVolunteer()
    const team = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: member.id } })
    const s1 = await createSkill()
    const s2 = await createSkill()
    const project = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      skills: { create: [{ skillId: s1.id }] },
    })
    const out = await clientAs(owner).projects.update({
      id: project.id,
      title: 'New title',
      description: 'New desc',
      urgency: 'low',
      timeCommitmentHoursPerWeek: 7,
      startDate: new Date('2026-07-01T00:00:00Z'),
      durationDays: 3,
      teamId: team.id,
      skillIds: [s2.id],
      skillRequiredMap: { [s2.id]: false },
      isSeekingHelp: false,
    })
    expect(out).toMatchObject({
      title: 'New title',
      urgency: 'low',
      timeCommitmentHoursPerWeek: 7,
      durationDays: 3,
      teamId: team.id,
      isSeekingHelp: false,
    })
    expect(out.skills.map((s) => [s.id, s.isRequired])).toEqual([[s2.id, false]])
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: member.id, type: 'team_project_assigned', entityId: project.id },
        }),
      ).toBe(1),
    )
    const cleared = await clientAs(owner).projects.update({ id: project.id, skillIds: [] })
    expect(cleared.skills).toEqual([])

    // Tagging a team onto an unpublished project waits for approval; a failed team notify is logged.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pendingP = await createProject({
      status: 'pending_review',
      creatorId: owner.id,
      assigneeId: owner.id,
    })
    await clientAs(owner).projects.update({ id: pendingP.id, teamId: team.id })
    expect(
      await prisma.notification.count({
        where: { type: 'team_project_assigned', entityId: pendingP.id },
      }),
    ).toBe(0)
    const live = await createProject({ status: 'in_progress', assigneeId: owner.id })
    vi.spyOn(prisma.teamMembership, 'findMany').mockRejectedValueOnce(new Error('t') as never)
    await clientAs(owner).projects.update({ id: live.id, teamId: team.id })
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('[TEAM NOTIFY]', expect.any(Error)))
    vi.restoreAllMocks()
  })

  it('applies status rules: owner-allowed statuses, admin any, and the ready⇄in_progress moves', async () => {
    const owner = await createVolunteer()
    const creator = await createVolunteer()
    const helper = await createVolunteer()
    const admin = await createAdmin()
    const project = await createProject({
      assigneeId: owner.id,
      creatorId: creator.id,
      status: 'in_progress',
    })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: helper.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })

    // Owner cannot pick an admin-only status (silently ignored), but can pick on_hold.
    expect(
      (await clientAs(owner).projects.update({ id: project.id, status: 'archived' })).status,
    ).toBe('in_progress')
    expect(
      (await clientAs(owner).projects.update({ id: project.id, status: 'on_hold' })).status,
    ).toBe('on_hold')
    await vi.waitFor(async () => {
      const notified = await prisma.notification.findMany({
        where: { type: 'project_status_changed' },
      })
      expect(notified.map((n) => n.volunteerId).sort()).toEqual([creator.id, helper.id].sort())
      expect(notified[0].title).toBe(`'${project.title}' is now On Hold`)
    })

    // Dropping the owner keeps the status; giving a ready project an owner starts it.
    expect(
      (await clientAs(admin).projects.update({ id: project.id, assigneeId: null })).status,
    ).toBe('on_hold')
    await expect(
      clientAs(admin).projects.update({ id: project.id, status: 'in_progress' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('without at least one open task') })
    await createTask(project.id)
    await prisma.workItem.update({ where: { id: project.id }, data: { status: 'ready' } })
    expect(
      (await clientAs(admin).projects.update({ id: project.id, assigneeId: owner.id })).status,
    ).toBe('in_progress')
    // Completing clears the seeking-help flag.
    const done = await clientAs(owner).projects.update({ id: project.id, status: 'completed' })
    expect(done).toMatchObject({ status: 'completed', isSeekingHelp: false })
    // Terminal projects keep their status even when the owner changes.
    expect(
      (await clientAs(admin).projects.update({ id: project.id, assigneeId: null })).status,
    ).toBe('completed')
    // Explicit in_progress while already in_progress needs no task check; admin can set anything.
    const p2 = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    expect(
      (
        await clientAs(admin).projects.update({
          id: p2.id,
          status: 'in_progress',
          outcome: 'ongoing',
        })
      ).outcome,
    ).toBe('ongoing')
    expect(
      (
        await clientAs(admin).projects.update({
          id: p2.id,
          status: 'archived',
          isSeekingHelp: true,
        })
      ).isSeekingHelp,
    ).toBe(true)
    // An unapproved project with no owner stays where it is.
    const pending = await createProject({ status: 'pending_review', creatorId: creator.id })
    expect((await clientAs(creator).projects.update({ id: pending.id, title: 't' })).status).toBe(
      'pending_review',
    )
  })
})

describe('projects.delete', () => {
  it('lets an admin delete a project', async () => {
    const admin = await createAdmin()
    const p = await createProject({ title: 'Doomed' })
    await expect(clientAs(admin).projects.delete({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await clientAs(admin).projects.delete({ id: p.id })).toEqual({
      message: "Project 'Doomed' deleted",
    })
    expect(await prisma.workItem.count({ where: { id: p.id } })).toBe(0)
  })
})
void row

describe('projects awaiting triage', () => {
  it('lets nobody but an admin move a proposal out of an unapproved status', async () => {
    const proposer = await createVolunteer()
    for (const status of ['draft', 'pending_review', 'needs_discussion'] as const) {
      const project = await createProject({
        creatorId: proposer.id,
        assigneeId: proposer.id,
        status,
      })
      await createTask(project.id)
      for (const target of ['ready', 'in_progress', 'completed'] as const) {
        await expect(
          clientAs(proposer).projects.update({ id: project.id, status: target }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      }
      // Other fields stay editable, and resending the current status is not a change.
      const edited = await clientAs(proposer).projects.update({
        id: project.id,
        status,
        title: 'Still mine to edit',
      })
      expect(edited).toMatchObject({ status, title: 'Still mine to edit' })
    }

    const pending = await createProject({ creatorId: proposer.id, status: 'pending_review' })
    const approved = await clientAs(await createAdmin()).projects.update({
      id: pending.id,
      status: 'ready',
    })
    expect(approved.status).toBe('ready')
  })

  it('takes no interest in, and starts no work on, a proposal', async () => {
    const proposer = await createVolunteer()
    const friend = await createVolunteer()
    const project = await createProject({
      creatorId: proposer.id,
      assigneeId: proposer.id,
      status: 'pending_review',
      isSeekingHelp: true,
    })
    await expect(
      clientAs(friend).projects.expressInterest({
        projectId: project.id,
        interestType: 'want_to_own',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // On an ownerless proposal, an interest recorded before it went back to review hands
    // over ownership when accepted, but the status stays with the admins.
    await prisma.workItem.update({ where: { id: project.id }, data: { assigneeId: null } })
    const interest = await prisma.workItemInterest.create({
      data: { workItemId: project.id, volunteerId: friend.id, interestType: 'want_to_own' },
    })
    await clientAs(await createAdmin()).projects.respondToInterest({
      projectId: project.id,
      interestId: interest.id,
      status: 'accepted',
    })
    expect(await row(project.id)).toMatchObject({
      assigneeId: friend.id,
      status: 'pending_review',
    })
  })

  it('lists unapproved projects to their proposer and admins only', async () => {
    const proposer = await createVolunteer()
    const stranger = await createVolunteer()
    const mine = await createProject({ creatorId: proposer.id, status: 'draft' })
    const ids = async (as: Parameters<typeof clientAs>[0]) =>
      (await clientAs(as).projects.list({ status: 'draft' })).projects.map((p) => p.id)
    expect(await ids(stranger)).not.toContain(mine.id)
    expect(await ids(proposer)).toContain(mine.id)
    expect(await ids(await createAdmin())).toContain(mine.id)

    const gantt = async (as: Parameters<typeof clientAs>[0]) =>
      (await clientAs(as).projects.ganttOverview({ statuses: ['draft', 'ready'] })).projects.map(
        (p) => p.id,
      )
    expect(await gantt(proposer)).not.toContain(mine.id)
    expect(await gantt(await createAdmin())).toContain(mine.id)
  })
})
