import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createTeam,
  createLocalGroup,
  createProject,
  createMember,
  createChapterDeputy,
  chapterFor,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

vi.spyOn(console, 'log').mockImplementation(() => {})

async function teamSuggestion(suggestedById: number, over: Record<string, unknown> = {}) {
  return prisma.teamSuggestion.create({ data: { name: 'Sug', suggestedById, ...over } })
}
async function groupSuggestion(suggestedById: number, over: Record<string, unknown> = {}) {
  return prisma.localGroupSuggestion.create({
    data: { name: 'Leeds', country: 'UK', suggestedById, ...over },
  })
}

describe('admin.teams', () => {
  it('creates, lists with members, and deletes (detaching merged suggestions)', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const created = await c.admin.teams.create({
      name: 'Ops',
      description: null,
      lumaUrl: null,
      docUrl: null,
    })
    const member = await createVolunteer()
    await prisma.teamMembership.create({
      data: { teamId: created.id, volunteerId: member.id, role: 'leader' },
    })
    const sug = await teamSuggestion(member.id, { mergedIntoId: created.id })
    const { teams } = await c.admin.teams.list()
    expect(teams.find((t) => t.id === created.id)).toMatchObject({
      name: 'Ops',
      members: [{ id: member.id, name: member.name, email: member.email, role: 'leader' }],
    })
    await c.admin.teams.create({
      name: 'Full',
      description: 'd',
      lumaUrl: 'https://l',
      docUrl: 'https://d',
    })
    expect(await c.admin.teams.delete({ id: created.id })).toEqual({ message: 'Team deleted' })
    expect(
      (await prisma.teamSuggestion.findUniqueOrThrow({ where: { id: sug.id } })).mergedIntoId,
    ).toBeNull()
    await expect(c.admin.teams.delete({ id: created.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('lists suggestions by status and deletes them', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const vol = await createVolunteer()
    const team = await createTeam()
    const s1 = await teamSuggestion(vol.id)
    const s2 = await teamSuggestion(vol.id, { status: 'accepted', mergedIntoId: team.id })
    expect((await c.admin.teams.listSuggestions({})).suggestions.map((s) => s.id)).toContain(s1.id)
    const accepted = (await c.admin.teams.listSuggestions({ status: 'accepted' })).suggestions
    expect(accepted.find((s) => s.id === s2.id)).toMatchObject({
      suggestedBy: { id: vol.id, name: vol.name },
      mergedInto: { id: team.id, name: team.name },
    })
    expect(await c.admin.teams.deleteSuggestion({ id: s1.id })).toEqual({
      message: 'Suggestion deleted',
    })
    await expect(c.admin.teams.deleteSuggestion({ id: s1.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('reviews suggestions: accept creates a team with a leader', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const vol = await createVolunteer()
    await expect(
      c.admin.teams.reviewSuggestion({ id: 999_999, action: 'accept' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // A row with an empty name can only come from the database, not the API.
    const blank = await teamSuggestion(vol.id, { name: '' })
    await expect(
      c.admin.teams.reviewSuggestion({ id: blank.id, action: 'accept', name: ' ' }),
    ).rejects.toMatchObject({ message: 'Name required' })

    const s = await teamSuggestion(vol.id, { description: 'orig' })
    await expect(
      c.admin.teams.reviewSuggestion({ id: s.id, action: 'accept', leaderId: 999_999 }),
    ).rejects.toMatchObject({ message: 'Leader not found' })
    expect(
      await c.admin.teams.reviewSuggestion({
        id: s.id,
        action: 'accept',
        name: ' Renamed ',
        adminNotes: ' ok ',
      }),
    ).toEqual({ message: 'Suggestion updated' })
    const team = await prisma.team.findFirstOrThrow({ where: { name: 'Renamed' } })
    expect(team.description).toBe('orig')
    expect(
      await prisma.teamMembership.findFirst({ where: { teamId: team.id, volunteerId: vol.id } }),
    ).toMatchObject({ role: 'leader' })
    const note = await prisma.notification.findFirstOrThrow({
      where: { volunteerId: vol.id, type: 'team_suggestion_reviewed' },
    })
    expect(note).toMatchObject({
      title: 'Approved: your team suggestion "Renamed"',
      body: 'ok',
      link: `/teams/${team.id}`,
    })

    const leader = await createVolunteer()
    const s2 = await teamSuggestion(vol.id)
    await c.admin.teams.reviewSuggestion({
      id: s2.id,
      action: 'accept',
      description: 'new desc',
      leaderId: leader.id,
    })
    const team2 = await prisma.team.findFirstOrThrow({ where: { name: 'Sug' } })
    expect(team2.description).toBe('new desc')
    expect(
      await prisma.teamMembership.count({ where: { teamId: team2.id, volunteerId: leader.id } }),
    ).toBe(1)
  })

  it('reviews suggestions: merge, on_hold, decline', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const vol = await createVolunteer()
    const target = await createTeam()
    const s = await teamSuggestion(vol.id)
    await expect(
      c.admin.teams.reviewSuggestion({ id: s.id, action: 'merge' }),
    ).rejects.toMatchObject({ message: 'mergedIntoId required for merge' })
    await expect(
      c.admin.teams.reviewSuggestion({ id: s.id, action: 'merge', mergedIntoId: 999_999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await c.admin.teams.reviewSuggestion({ id: s.id, action: 'merge', mergedIntoId: target.id })
    expect(
      await prisma.teamMembership.count({ where: { teamId: target.id, volunteerId: vol.id } }),
    ).toBe(1)
    // Merging again is idempotent for the membership.
    await c.admin.teams.reviewSuggestion({ id: s.id, action: 'merge', mergedIntoId: target.id })
    expect(await prisma.teamSuggestion.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      status: 'accepted',
      mergedIntoId: target.id,
    })

    const s2 = await teamSuggestion(vol.id)
    await c.admin.teams.reviewSuggestion({ id: s2.id, action: 'on_hold', adminNotes: '' })
    expect(await prisma.teamSuggestion.findUniqueOrThrow({ where: { id: s2.id } })).toMatchObject({
      status: 'on_hold',
      adminNotes: null,
    })
    await c.admin.teams.reviewSuggestion({ id: s2.id, action: 'decline' })
    expect((await prisma.teamSuggestion.findUniqueOrThrow({ where: { id: s2.id } })).status).toBe(
      'declined',
    )
    const notes = await prisma.notification.findMany({ where: { volunteerId: vol.id } })
    expect(notes.map((n) => [n.title, n.link])).toEqual(
      expect.arrayContaining([
        ['Merged: your team suggestion "Sug"', `/teams/${target.id}`],
        ['Under review: your team suggestion "Sug"', '/suggest-team'],
        ['Declined: your team suggestion "Sug"', '/suggest-team'],
      ]),
    )
  })
})

describe('admin.localGroups', () => {
  it('creates, lists, updates and deletes groups in a chapter', async () => {
    const c = clientAs(await createAdmin())
    const uk = await chapterFor('UK')
    const france = await chapterFor('France')
    await expect(
      c.admin.localGroups.create({ name: 'X', country: 'Remote' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'That country has no chapter yet' })
    const g = await c.admin.localGroups.create({ name: 'Zeta', country: 'UK' })
    expect(await prisma.localGroup.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({
      nationalChapterId: uk.id,
    })
    await expect(c.admin.localGroups.create({ name: 'Zeta', country: 'UK' })).rejects.toMatchObject(
      {
        message: 'This chapter already has a group of that name',
      },
    )
    expect((await c.admin.localGroups.list()).groups.map((x) => x.id)).toContain(g.id)
    await expect(
      c.admin.localGroups.update({ id: g.id, name: 'Z', country: 'Nowhere' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      c.admin.localGroups.update({ id: 999_999, name: 'Z', country: 'UK' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // Moving a group to another chapter takes it away from the old chapter's members and projects.
    const member = await createMember(uk, { localGroupId: g.id })
    const local = await createProject({
      nationalChapterId: uk.id,
      reach: 'LOCAL',
      localGroupId: g.id,
    })
    expect(
      await c.admin.localGroups.update({ id: g.id, name: 'Zeta2', country: 'France' }),
    ).toEqual({ id: g.id, name: 'Zeta2', country: 'France' })
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: member.id } })).localGroupId,
    ).toBeNull()
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({
      localGroupId: null,
      reach: 'COUNTRY_WIDE',
    })
    expect(
      await c.admin.localGroups.update({ id: g.id, name: 'Zeta3', country: 'France' }),
    ).toEqual({
      id: g.id,
      name: 'Zeta3',
      country: 'France',
    })

    const vol = await createVolunteer()
    const sug = await groupSuggestion(vol.id, { mergedIntoId: g.id })
    const frenchMember = await createMember(france, { localGroupId: g.id })
    const project = await createProject({
      nationalChapterId: france.id,
      reach: 'LOCAL',
      localGroupId: g.id,
    })
    expect(await c.admin.localGroups.delete({ id: g.id })).toEqual({ message: 'Group deleted' })
    expect(
      (await prisma.localGroupSuggestion.findUniqueOrThrow({ where: { id: sug.id } })).mergedIntoId,
    ).toBeNull()
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({
      localGroupId: null,
      reach: 'COUNTRY_WIDE',
    })
    expect(
      await prisma.volunteer.findUniqueOrThrow({ where: { id: frenchMember.id } }),
    ).toMatchObject({
      localGroupId: null,
      nationalChapterId: france.id,
    })
    await expect(c.admin.localGroups.delete({ id: g.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it("holds chapter staff to their own chapter's groups and suggestions", async () => {
    const uk = await chapterFor('UK')
    const de = await chapterFor('Germany')
    const deputy = clientAs(await createChapterDeputy(uk))
    const mine = await createLocalGroup({ country: 'UK' })
    const theirs = await createLocalGroup({ country: 'Germany' })
    const vol = await createVolunteer()
    const theirSuggestion = await groupSuggestion(vol.id, {
      country: 'Germany',
      nationalChapterId: de.id,
    })
    const pooled = await groupSuggestion(vol.id, { country: 'Ghana' })

    const ids = (await deputy.admin.localGroups.list()).groups.map((g) => g.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(theirs.id)
    await expect(
      deputy.admin.localGroups.create({ name: 'Berlin', country: 'Germany' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      deputy.admin.localGroups.update({ id: theirs.id, name: 'Mine now', country: 'UK' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(deputy.admin.localGroups.delete({ id: theirs.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const listed = (await deputy.admin.localGroups.listSuggestions({})).suggestions.map((s) => s.id)
    expect(listed).not.toContain(theirSuggestion.id)
    expect(listed).not.toContain(pooled.id)
    for (const id of [theirSuggestion.id, pooled.id]) {
      await expect(
        deputy.admin.localGroups.reviewSuggestion({ id, action: 'decline' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(deputy.admin.localGroups.deleteSuggestion({ id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    }
    const own = await groupSuggestion(vol.id, { nationalChapterId: uk.id })
    await expect(
      deputy.admin.localGroups.reviewSuggestion({
        id: own.id,
        action: 'merge',
        mergedIntoId: theirs.id,
      }),
    ).rejects.toMatchObject({ message: 'Target local group not found' })
    await expect(clientAs(vol).admin.localGroups.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    // A pool suggestion for a country with no chapter has nowhere to go until one is opened.
    await expect(
      clientAs(await createAdmin()).admin.localGroups.reviewSuggestion({
        id: pooled.id,
        action: 'accept',
      }),
    ).rejects.toMatchObject({ message: 'That country has no chapter yet' })
  })

  it('lists and deletes suggestions', async () => {
    const c = clientAs(await createAdmin())
    const vol = await createVolunteer()
    const g = await createLocalGroup()
    const s1 = await groupSuggestion(vol.id)
    const s2 = await groupSuggestion(vol.id, { status: 'accepted', mergedIntoId: g.id })
    expect((await c.admin.localGroups.listSuggestions({})).suggestions.map((s) => s.id)).toContain(
      s1.id,
    )
    expect(
      (await c.admin.localGroups.listSuggestions({ status: 'accepted' })).suggestions.find(
        (s) => s.id === s2.id,
      ),
    ).toMatchObject({
      mergedInto: { id: g.id, name: g.name },
      suggestedBy: { id: vol.id },
    })
    expect(await c.admin.localGroups.deleteSuggestion({ id: s1.id })).toEqual({
      message: 'Suggestion deleted',
    })
    await expect(c.admin.localGroups.deleteSuggestion({ id: s1.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('reviews suggestions through every action', async () => {
    const c = clientAs(await createAdmin())
    const vol = await createVolunteer()
    await expect(
      c.admin.localGroups.reviewSuggestion({ id: 999_999, action: 'accept' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // A row with an empty country can only come from the database, not the API.
    const blank = await groupSuggestion(vol.id, { country: '' })
    await expect(
      c.admin.localGroups.reviewSuggestion({ id: blank.id, action: 'accept' }),
    ).rejects.toMatchObject({ message: 'Name and country required' })

    const s = await groupSuggestion(vol.id)
    await c.admin.localGroups.reviewSuggestion({
      id: s.id,
      action: 'accept',
      name: ' Leeds North ',
      country: ' UK ',
      adminNotes: 'fine',
    })
    const group = await prisma.localGroup.findFirstOrThrow({ where: { name: 'Leeds North' } })
    expect(
      await prisma.notification.findFirst({
        where: { volunteerId: vol.id, type: 'local_group_suggestion_reviewed' },
      }),
    ).toMatchObject({
      title: 'Approved: your local group suggestion "Leeds North"',
      link: `/local-groups/${group.id}`,
    })

    const s2 = await groupSuggestion(vol.id)
    await expect(
      c.admin.localGroups.reviewSuggestion({ id: s2.id, action: 'merge' }),
    ).rejects.toMatchObject({ message: 'mergedIntoId required for merge' })
    await expect(
      c.admin.localGroups.reviewSuggestion({ id: s2.id, action: 'merge', mergedIntoId: 999_999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await c.admin.localGroups.reviewSuggestion({
      id: s2.id,
      action: 'merge',
      mergedIntoId: group.id,
    })
    expect(
      (await prisma.localGroupSuggestion.findUniqueOrThrow({ where: { id: s2.id } })).mergedIntoId,
    ).toBe(group.id)

    const s3 = await groupSuggestion(vol.id)
    await c.admin.localGroups.reviewSuggestion({ id: s3.id, action: 'on_hold' })
    expect(
      (await prisma.localGroupSuggestion.findUniqueOrThrow({ where: { id: s3.id } })).status,
    ).toBe('on_hold')
    await c.admin.localGroups.reviewSuggestion({ id: s3.id, action: 'decline', adminNotes: '  ' })
    expect(
      (await prisma.localGroupSuggestion.findUniqueOrThrow({ where: { id: s3.id } })).status,
    ).toBe('declined')
    expect(
      (await prisma.notification.findMany({ where: { volunteerId: vol.id } })).map((n) => [
        n.title,
        n.link,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [`Under review: your local group suggestion "${s3.name}"`, '/suggest-local-group'],
        [`Declined: your local group suggestion "${s3.name}"`, '/suggest-local-group'],
      ]),
    )

    // A suggester with no email still gets the in-app notification path.
    const noEmail = await createVolunteer({ email: null })
    const s4 = await groupSuggestion(noEmail.id)
    expect(await c.admin.localGroups.reviewSuggestion({ id: s4.id, action: 'decline' })).toEqual({
      message: 'Suggestion updated',
    })
  })
})
