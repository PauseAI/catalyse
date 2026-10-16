import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createTeam,
  createChapter,
  createChapterDeputy,
  createMember,
  createProject,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

async function leaderOf(teamId: number) {
  const leader = await createVolunteer()
  await prisma.teamMembership.create({ data: { teamId, volunteerId: leader.id, role: 'leader' } })
  return leader
}

describe('teams.list / getById', () => {
  it('serialises teams with viewer-specific fields and hides links from non-members', async () => {
    const team = await createTeam({ name: 'Zulu', lumaUrl: 'https://luma', docUrl: 'https://doc' })
    const leader = await leaderOf(team.id)
    const applicant = await createVolunteer()
    await prisma.teamJoinRequest.create({ data: { teamId: team.id, volunteerId: applicant.id } })

    const asLeader = (await clientAs(leader).teams.list()).teams.find((t) => t.id === team.id)!
    expect(
      (await clientAs(applicant).teams.list()).teams.find((t) => t.id === team.id)!
        .viewerRequestStatus,
    ).toBe('pending')
    expect(asLeader).toMatchObject({
      lumaUrl: 'https://luma',
      viewerRole: 'leader',
      memberCount: 1,
      leaders: [{ id: leader.id }],
    })
    const asApplicant = await clientAs(applicant).teams.getById({ id: team.id })
    expect(asApplicant).toMatchObject({
      lumaUrl: null,
      docUrl: null,
      viewerRole: null,
      viewerRequestStatus: 'pending',
    })
    const asAdmin = await clientAs(await createAdmin()).teams.getById({ id: team.id })
    expect(asAdmin.docUrl).toBe('https://doc')
    await expect(clientAs(applicant).teams.getById({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('team management', () => {
  it('getManageable and update are for leaders and admins', async () => {
    const team = await createTeam()
    const leader = await leaderOf(team.id)
    const member = await createVolunteer()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: member.id } })
    await expect(clientAs(member).teams.getManageable({ id: team.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const view = await clientAs(leader).teams.getManageable({ id: team.id })
    expect(view.members.map((m) => m.role).sort()).toEqual(['leader', 'member'])
    await expect(
      clientAs(await createAdmin()).teams.getManageable({ id: 999_999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(
      await clientAs(leader).teams.update({
        id: team.id,
        name: 'New',
        description: 'd',
        lumaUrl: null,
        docUrl: null,
      }),
    ).toEqual({ id: team.id, name: 'New' })
    await expect(
      clientAs(await createAdmin()).teams.update({
        id: 999_999,
        name: 'x',
        description: null,
        lumaUrl: null,
        docUrl: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('apply / review / leave flow with leader notifications', async () => {
    const team = await createTeam()
    const leader = await leaderOf(team.id)
    const vol = await createVolunteer()
    const c = clientAs(vol)
    await expect(c.teams.apply({ id: 999_999 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await c.teams.apply({ id: team.id, message: ' please ' })).toEqual({
      message: 'Application submitted',
    })
    await expect(c.teams.apply({ id: team.id })).rejects.toMatchObject({
      message: 'Already applied, awaiting review',
    })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: leader.id, type: 'team_join_request' },
        }),
      ).toBe(1),
    )

    const { requests } = await clientAs(leader).teams.listJoinRequests({ teamId: team.id })
    expect(requests).toEqual([
      expect.objectContaining({
        message: 'please',
        volunteer: { id: vol.id, name: vol.name, email: vol.email },
      }),
    ])
    await expect(c.teams.listJoinRequests({ teamId: team.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      c.teams.reviewJoinRequest({ id: requests[0].id, action: 'accept' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      clientAs(leader).teams.reviewJoinRequest({ id: 999_999, action: 'accept' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // The leader's notice names the request, so the Inbox can answer it in place.
    expect(
      await prisma.notification.findFirst({
        where: { volunteerId: leader.id, type: 'team_join_request' },
      }),
    ).toMatchObject({ entityId: requests[0].id })
    expect(
      await clientAs(leader).teams.reviewJoinRequest({ id: requests[0].id, action: 'accept' }),
    ).toEqual({ message: 'Request accepted' })
    // Once answered, it leaves every leader's inbox.
    expect(
      await prisma.notification.count({
        where: { type: 'team_join_request', entityId: requests[0].id },
      }),
    ).toBe(0)
    await expect(
      clientAs(leader).teams.reviewJoinRequest({ id: requests[0].id, action: 'accept' }),
    ).rejects.toMatchObject({ message: 'Request already reviewed' })
    expect((await c.teams.getById({ id: team.id })).viewerRole).toBe('member')
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findFirst({
          where: { volunteerId: vol.id, type: 'team_join_request_reviewed' },
        }),
      ).toMatchObject({
        title: `Approved: you've joined ${team.name}`,
        link: `/teams/${team.id}`,
      }),
    )
    await expect(c.teams.apply({ id: team.id })).rejects.toMatchObject({
      message: 'Already a member of this team',
    })
    expect(await c.teams.leave({ id: team.id })).toEqual({ message: 'Left team' })

    // Declined path, no message, and a team without leaders notifies nobody.
    const lonely = await createTeam()
    await c.teams.apply({ id: lonely.id, message: '' })
    const req = await prisma.teamJoinRequest.findFirstOrThrow({ where: { teamId: lonely.id } })
    expect(req.message).toBeNull()
    expect(
      await clientAs(await createAdmin()).teams.reviewJoinRequest({
        id: req.id,
        action: 'decline',
      }),
    ).toEqual({ message: 'Request declined' })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findFirst({
          where: { volunteerId: vol.id, title: { startsWith: 'Declined' } },
        }),
      ).toMatchObject({
        title: `Declined: your request to join ${lonely.name}`,
        link: `/teams/${lonely.id}`,
      }),
    )
  })

  it('assigns members, sets roles and removes them', async () => {
    const team = await createTeam()
    const leader = await leaderOf(team.id)
    const vol = await createVolunteer()
    const c = clientAs(leader)
    await expect(
      c.teams.assignMember({ teamId: team.id, volunteerId: 999_999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await c.teams.assignMember({ teamId: team.id, volunteerId: vol.id })).toEqual({
      message: 'Volunteer added to team',
    })
    await c.teams.assignMember({ teamId: team.id, volunteerId: vol.id, role: 'leader' })
    expect(
      (
        await prisma.teamMembership.findFirstOrThrow({
          where: { teamId: team.id, volunteerId: vol.id },
        })
      ).role,
    ).toBe('leader')
    expect(
      await c.teams.setMemberRole({ teamId: team.id, volunteerId: vol.id, role: 'member' }),
    ).toEqual({ message: 'Role updated' })
    await expect(
      c.teams.setMemberRole({ teamId: team.id, volunteerId: 999_999, role: 'member' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await c.teams.removeMember({ teamId: team.id, volunteerId: vol.id })).toEqual({
      message: 'Member removed',
    })
    expect(
      await prisma.teamMembership.count({ where: { teamId: team.id, volunteerId: vol.id } }),
    ).toBe(0)
  })
})

describe('teams by chapter', () => {
  it("shows a member their chapter's teams and their own, and lets them join only their chapter's", async () => {
    const [home, away] = [await createChapter(), await createChapter()]
    const me = await createMember(home)
    const ours = await createTeam({ name: 'Ours', nationalChapterId: home.id })
    const theirs = await createTeam({ name: 'Theirs', nationalChapterId: away.id })
    const joined = await createTeam({ name: 'Joined abroad', nationalChapterId: away.id })
    await prisma.teamMembership.create({ data: { teamId: joined.id, volunteerId: me.id } })
    const c = clientAs(me)
    const ids = (await c.teams.list()).teams.map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining([ours.id, joined.id]))
    expect(ids).not.toContain(theirs.id)
    await expect(c.teams.getById({ id: theirs.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await c.teams.getById({ id: joined.id })).name).toBe('Joined abroad')
    await expect(c.teams.apply({ id: theirs.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await c.teams.apply({ id: ours.id })).toEqual({ message: 'Application submitted' })
  })

  it("lets a chapter's staff run its teams, and a global admin move one", async () => {
    const [home, away] = [await createChapter(), await createChapter()]
    const deputy = await createChapterDeputy(home)
    const c = clientAs(deputy)
    const ours = await createTeam({ nationalChapterId: home.id })
    const theirs = await createTeam({ nationalChapterId: away.id })

    expect((await c.teams.getManageable({ id: ours.id })).viewerCanAdmin).toBe(true)
    await expect(c.teams.getManageable({ id: theirs.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const abroad = await createMember(away)
    await expect(
      c.teams.assignMember({ teamId: ours.id, volunteerId: abroad.id }),
    ).rejects.toMatchObject({ message: 'They are in another national chapter' })
    const listed = (await c.admin.teams.list()).teams.map((t) => t.id)
    expect(listed).toContain(ours.id)
    expect(listed).not.toContain(theirs.id)
    const made = await c.admin.teams.create({
      name: 'New team',
      description: null,
      lumaUrl: null,
      docUrl: null,
    })
    expect(
      (await prisma.team.findUniqueOrThrow({ where: { id: made.id } })).nationalChapterId,
    ).toBe(home.id)
    await expect(c.admin.teams.delete({ id: theirs.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      c.admin.teams.setChapter({ id: ours.id, chapterId: away.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const admin = clientAs(await createAdmin())
    expect(await admin.admin.teams.setChapter({ id: ours.id, chapterId: away.id })).toMatchObject({
      message: expect.stringContaining('moved'),
    })
    expect(
      (await prisma.team.findUniqueOrThrow({ where: { id: ours.id } })).nationalChapterId,
    ).toBe(away.id)
    expect(
      await prisma.chapterAuditEvent.findFirst({ where: { action: 'TEAM_CHAPTER_CHANGED' } }),
    ).toMatchObject({ nationalChapterId: away.id })
    await admin.admin.teams.setChapter({ id: ours.id, chapterId: null })
    await expect(
      admin.admin.teams.setChapter({ id: ours.id, chapterId: 999_999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      admin.admin.teams.setChapter({ id: 999_999, chapterId: null }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it("files a member's team suggestion under their chapter, for its staff to review", async () => {
    const [home, away] = [await createChapter(), await createChapter()]
    const deputy = await createChapterDeputy(home)
    const awayDeputy = clientAs(await createChapterDeputy(away))
    const member = await createMember(home)
    const { id } = await clientAs(member).teamSuggestions.create({
      name: 'Ideas',
      description: null,
    })
    expect(
      await prisma.notification.count({
        where: { volunteerId: deputy.id, type: 'team_suggestion' },
      }),
    ).toBe(1)
    expect(
      (await awayDeputy.admin.teams.listSuggestions({})).suggestions.map((x) => x.id),
    ).not.toContain(id)
    await expect(
      awayDeputy.admin.teams.reviewSuggestion({ id, action: 'decline' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await clientAs(deputy).admin.teams.reviewSuggestion({ id, action: 'accept' })
    const team = await prisma.team.findFirstOrThrow({ where: { name: 'Ideas' } })
    expect(team.nationalChapterId).toBe(home.id)
  })

  it("tags a project only with one of its chapter's teams", async () => {
    const [home, away] = [await createChapter(), await createChapter()]
    const owner = await createMember(home)
    const project = await createProject({ nationalChapterId: home.id, assigneeId: owner.id })
    const theirs = await createTeam({ nationalChapterId: away.id })
    await expect(
      clientAs(owner).projects.update({ id: project.id, teamId: theirs.id }),
    ).rejects.toMatchObject({ message: "Choose one of the project's chapter's teams" })
    await expect(
      clientAs(owner).projects.update({ id: project.id, teamId: 999_999 }),
    ).rejects.toMatchObject({ message: 'Team not found' })
  })
})
