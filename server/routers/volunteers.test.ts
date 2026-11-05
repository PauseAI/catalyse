import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createQuickTask,
  createSkill,
  createLocalGroup,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createMember,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'
import type { InterestStatus } from '@/generated/prisma/enums'

describe('volunteers.list', () => {
  it('filters the approved, visible directory by skill, search and location', async () => {
    const me = await createVolunteer()
    const skill = await createSkill()
    const ann = await createVolunteer({
      name: 'Ann Searchable',
      localGroupId: (await createLocalGroup({ name: 'Lambeth North' })).id,
      bio: 'x',
      country: 'UK',
      skills: { create: [{ skillId: skill.id }] },
    })
    const bob = await createVolunteer({
      name: 'Bob',
      bio: 'Searchable bio',
      country: null,
      location: 'Paris, France',
    })
    await createVolunteer({ name: 'Hidden', consentMakeProfileVisibleInDirectory: false })
    await createVolunteer({ name: 'Pending', approvalStatus: 'pending' })
    await createVolunteer({ name: 'Gone', deletedAt: new Date() })
    const c = clientAs(me)
    const names = async (input: Parameters<typeof c.volunteers.list>[0]) =>
      (await c.volunteers.list(input)).volunteers.map((v) => v.name)

    const all = await c.volunteers.list({})
    expect(all.total).toBe(3)
    expect(all.volunteers.every((v) => v.hiddenFromDirectory === false)).toBe(true)
    expect(await names({ skillIds: [skill.id] })).toEqual(['Ann Searchable'])
    expect(await names({ skillIds: [] })).toHaveLength(3)
    expect((await names({ search: 'Searchable' })).sort()).toEqual(['Ann Searchable', 'Bob'])
    expect(await names({ localGroup: 'Lambeth North' })).toEqual(['Ann Searchable'])
    expect(await names({ localGroup: 'Paris' })).toEqual(['Bob'])
    expect((await c.volunteers.list({ limit: 1, offset: 1 })).volunteers).toHaveLength(1)
    expect(
      (await c.volunteers.list({ skillIds: [skill.id] })).volunteers[0].skills[0],
    ).toMatchObject({ id: skill.id, categoryName: expect.any(String) })

    expect(all.volunteers.every((v) => !('email' in v))).toBe(true)
    expect(await names({ search: ann.email! })).toEqual([])

    const admin = await createAdmin()
    const adminView = await clientAs(admin).volunteers.list({ search: 'Hidden' })
    expect(adminView.volunteers[0].hiddenFromDirectory).toBe(true)
    // A global admin sees each login address and can search by it.
    const byEmail = await clientAs(admin).volunteers.list({ search: ann.email! })
    expect(byEmail.volunteers.map((v) => [v.name, v.email])).toEqual([[ann.name, ann.email]])
    void bob
  })

  it("shows each member their own chapter's directory, and its staff the hidden profiles", async () => {
    const [home, away] = [await createChapter(), await createChapter()]
    const me = await createMember(home)
    const neighbour = await createMember(home, { name: 'Nell Neighbour' })
    const hidden = await createMember(home, {
      name: 'Hal Hidden',
      consentMakeProfileVisibleInDirectory: false,
    })
    const abroad = await createMember(away, { name: 'Abe Abroad' })
    const pooled = await createVolunteer({ name: 'Pat Pooled' })
    const ids = async (viewer: typeof me, input = {}) =>
      (await clientAs(viewer).volunteers.list(input)).volunteers.map((v) => v.id)

    const mine = await ids(me)
    expect(mine).toContain(neighbour.id)
    for (const id of [hidden.id, abroad.id, pooled.id]) expect(mine).not.toContain(id)
    // Asking for another chapter changes nothing for a member.
    expect(await ids(me, { chapter: away.id })).toEqual(mine)
    expect(await ids(await createChapterDeputy(home))).toContain(hidden.id)

    const admin = await createAdmin()
    expect(await ids(admin, { chapter: away.id })).toEqual([abroad.id])
    const pool = await ids(admin, { chapter: 'pool' })
    expect(pool).toContain(pooled.id)
    expect(pool).not.toContain(neighbour.id)
    expect(await ids(admin)).toEqual(expect.arrayContaining([neighbour.id, abroad.id, pooled.id]))
  })
})

describe('volunteers.getById across chapters', () => {
  it('hides someone in another chapter, unless the two already work on a project together', async () => {
    const [home, away] = [await createChapter(), await createChapter()]
    const me = await createMember(home)
    const abroad = await createMember(away)
    const c = clientAs(me)
    await expect(c.volunteers.getById({ id: abroad.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const project = await createProject({ assigneeId: abroad.id })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: me.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    const profile = await c.volunteers.getById({ id: abroad.id })
    // Seen, but not reachable: contact stays within a chapter.
    expect(profile).toMatchObject({ id: abroad.id, canMessage: false, canRequestContact: true })
    expect(await clientAs(await createAdmin()).volunteers.getById({ id: abroad.id })).toMatchObject(
      { id: abroad.id, canMessage: true },
    )
  })
})

describe('volunteers.getById', () => {
  it('shows visible profiles with contact details to people who work together, plus history', async () => {
    const me = await createVolunteer()
    const skill = await createSkill()
    const vol = await createVolunteer({
      consentContactableByProjectOwners: true,
      consentShareContactInfoWithProjectOwner: true,
      discordHandle: 'vol#1',
      skills: { create: [{ skillId: skill.id }] },
    })
    await prisma.skillEndorsement.create({
      data: { volunteerId: vol.id, skillId: skill.id, endorsedById: me.id, rating: 'strong' },
    })
    const owned = await createProject({ assigneeId: vol.id })
    // Helping on vol's project puts me and vol together.
    await prisma.workItemInterest.create({
      data: {
        workItemId: owned.id,
        volunteerId: me.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    const proposed = await createProject({ creatorId: vol.id })
    await createProject({ creatorId: vol.id, status: 'pending_review' })
    await createQuickTask({
      assigneeId: vol.id,
      status: 'completed',
      reviewRating: 'good',
      skillId: skill.id,
    })
    await createQuickTask({
      assigneeId: vol.id,
      status: 'completed',
      reviewRating: 'needs_improvement',
    })

    const view = await clientAs(me).volunteers.getById({ id: vol.id })
    expect(view.discordHandle).toBe('vol#1')
    expect(view).toMatchObject({ canMessage: true, canRequestContact: false })
    expect(view.endorsements).toEqual([
      { skillId: skill.id, rating: 'strong', skillName: skill.name },
    ])
    expect(view.projects.map((p) => [p.id, p.roles.map((r) => r.role)]).sort()).toEqual(
      [
        [owned.id, ['owner']],
        [proposed.id, ['creator']],
      ].sort(),
    )
    expect(view.completedTasks).toEqual([
      expect.objectContaining({ reviewRating: 'good', skillName: skill.name }),
    ])

    const shy = await createVolunteer({
      consentShareContactInfoWithProjectOwner: false,
      discordHandle: 'shy#1',
    })
    const stranger = await clientAs(me).volunteers.getById({ id: shy.id })
    expect(stranger.discordHandle).toBeUndefined()
    expect(stranger).toMatchObject({ canMessage: false, canRequestContact: true })
    expect((await clientAs(shy).volunteers.getById({ id: shy.id })).discordHandle).toBe('shy#1')
    const admin = await createAdmin()
    expect((await clientAs(admin).volunteers.getById({ id: shy.id })).discordHandle).toBe('shy#1')
    // The login address is on a profile for a global admin only, not even for the volunteer.
    for (const [viewer, target] of [
      [me, vol],
      [shy, shy],
    ]) {
      expect(await clientAs(viewer).volunteers.getById({ id: target.id })).not.toHaveProperty(
        'email',
      )
    }
    expect((await clientAs(admin).volunteers.getById({ id: shy.id })).email).toBe(shy.email)
    const chapter = await createChapter()
    const member = await createMember(chapter)
    expect(
      await clientAs(await createChapterLead(chapter)).volunteers.getById({ id: member.id }),
    ).not.toHaveProperty('email')
    await expect(clientAs(me).volunteers.getById({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('lists every project and task they had a part in, current and past, as far as the viewer can see', async () => {
    const [home, away] = [await createChapter(), await createChapter()]
    const viewer = await createMember(home)
    const vol = await createMember(home)
    const join = (workItemId: number, interestType: string, status: InterestStatus) =>
      prisma.workItemInterest.create({
        data: { workItemId, volunteerId: vol.id, interestType, status, respondedAt: new Date() },
      })
    const inHome = { nationalChapterId: home.id }

    const deputised = await createProject(inHome)
    await prisma.projectDeputy.create({ data: { projectId: deputised.id, volunteerId: vol.id } })
    const joined = await createProject(inHome)
    await join(joined.id, 'want_to_contribute', 'accepted')
    const left = await createProject({ ...inHome, status: 'completed', completedAt: new Date() })
    await join(left.id, 'want_to_contribute', 'removed')
    const tasked = await createProject(inHome)
    const led = await createTask(tasked.id, { assigneeId: vol.id, claimedAt: new Date() })
    const helped = await createTask(tasked.id, { status: 'completed' })
    await join(helped.id, 'want_to_help_task', 'accepted')
    await createTask(tasked.id, { title: 'Not theirs' })
    // An application never accepted is no part in a project.
    const applied = await createProject(inHome)
    await prisma.workItemInterest.create({
      data: { workItemId: applied.id, volunteerId: vol.id, interestType: 'want_to_contribute' },
    })
    const withdrawn = await createProject(inHome)
    await prisma.workItemInterest.create({
      data: {
        workItemId: withdrawn.id,
        volunteerId: vol.id,
        interestType: 'want_to_contribute',
        status: 'withdrawn',
      },
    })
    // Another chapter's project stays out of sight of someone with no part in it.
    const abroad = await createProject({ nationalChapterId: away.id, assigneeId: vol.id })

    const { projects } = await clientAs(viewer).volunteers.getById({ id: vol.id })
    const byId = new Map(projects.map((p) => [p.id, p]))
    expect([...byId.keys()].sort()).toEqual([deputised.id, joined.id, left.id, tasked.id].sort())
    expect(byId.get(deputised.id)).toMatchObject({
      current: true,
      roles: [{ role: 'deputy', ended: false }],
    })
    expect(byId.get(joined.id)!.roles).toMatchObject([{ role: 'member', ended: false }])
    expect(byId.get(left.id)).toMatchObject({
      current: false,
      roles: [{ role: 'member', ended: true }],
    })
    expect(byId.get(tasked.id)).toMatchObject({
      current: true,
      roles: [],
      tasks: [
        { id: led.id, role: 'assignee', current: true },
        { id: helped.id, role: 'helper', current: false },
      ],
    })
    expect(projects.at(-1)!.id).toBe(left.id)

    const adminView = await clientAs(await createAdmin()).volunteers.getById({ id: vol.id })
    expect(adminView.projects.map((p) => p.id)).toContain(abroad.id)
  })

  it('reveals a hidden profile only to themselves, global admins, or an involving project owner', async () => {
    const hidden = await createVolunteer({ consentMakeProfileVisibleInDirectory: false })
    const stranger = await createVolunteer()
    const owner = await createVolunteer()
    await expect(clientAs(stranger).volunteers.getById({ id: hidden.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(clientAs(owner).volunteers.getById({ id: hidden.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect((await clientAs(hidden).volunteers.getById({ id: hidden.id })).id).toBe(hidden.id)
    expect((await clientAs(await createAdmin()).volunteers.getById({ id: hidden.id })).id).toBe(
      hidden.id,
    )
    const project = await createProject({ assigneeId: owner.id })
    await prisma.workItemInterest.create({
      data: { workItemId: project.id, volunteerId: hidden.id, interestType: 'want_to_contribute' },
    })
    expect((await clientAs(owner).volunteers.getById({ id: hidden.id })).id).toBe(hidden.id)
    const owner2 = await createVolunteer()
    const project2 = await createProject({ assigneeId: owner2.id })
    await createTask(project2.id, { assigneeId: hidden.id })
    expect((await clientAs(owner2).volunteers.getById({ id: hidden.id })).id).toBe(hidden.id)
  })
})

describe('application procedures', () => {
  it('reports and resubmits my application', async () => {
    const pending = await createVolunteer({
      approvalStatus: 'needs_info',
      applicationMessage: 'msg',
      applicationApplicantNotes: 'n',
    })
    expect(await clientAs(pending).volunteers.myApplication()).toEqual({
      approvalStatus: 'needs_info',
      applicationMessage: 'msg',
      applicationApplicantNotes: 'n',
    })
    expect(await clientAs(pending).volunteers.resubmitApplication()).toEqual({
      message: 'Application resubmitted for review',
    })
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: pending.id } })).approvalStatus,
    ).toBe('under_review')
    const approved = await createVolunteer()
    await expect(clientAs(approved).volunteers.resubmitApplication()).rejects.toMatchObject({
      message: 'Cannot resubmit a approved application',
    })
  })
})

describe('volunteers.updateMe and chapters', () => {
  it('lets someone with no country name one, but changes of country go by transfer', async () => {
    const chapter = await createChapter()
    const group = await createLocalGroup({
      country: chapter.country,
      nationalChapterId: chapter.id,
    })
    const fresh = await createVolunteer({ country: null })
    const out = await clientAs(fresh).volunteers.updateMe({
      country: chapter.country,
      localGroup: group.name,
    })
    expect(out).toMatchObject({ country: chapter.country, localGroup: group.name })
    const placed = await prisma.volunteer.findUniqueOrThrow({ where: { id: fresh.id } })
    expect(placed).toMatchObject({ nationalChapterId: chapter.id, localGroupId: group.id })

    // Sending the same country again is harmless; a different one is refused.
    expect(
      await clientAs(placed).volunteers.updateMe({ country: chapter.country, localGroup: null }),
    ).toMatchObject({ localGroup: null })
    await expect(clientAs(placed).volunteers.updateMe({ country: 'Ghana' })).rejects.toMatchObject({
      message: expect.stringContaining('transfer'),
    })
    const other = await createLocalGroup({ country: 'Kenya' })
    await expect(
      clientAs(placed).volunteers.updateMe({ localGroup: other.name }),
    ).rejects.toMatchObject({ message: "Choose one of your country's local groups" })
  })
})

describe('volunteers.updateMe', () => {
  it('updates scalar fields, consents, cookie choice and skills', async () => {
    const me = await createVolunteer({
      consentMakeProfileVisibleInDirectory: false,
      consentContactableByProjectOwners: false,
    })
    const s1 = await createSkill()
    const s2 = await createSkill()
    const c = clientAs(me)
    const out = await c.volunteers.updateMe({
      name: 'Renamed',
      country: 'UK',
      consentMakeProfileVisibleInDirectory: true,
      consentContactableByProjectOwners: true,
      consentShareContactInfoWithProjectOwner: true,
      cookieConsentAnalytics: null,
      skillIds: [s1.id, s2.id],
    })
    expect(out).toMatchObject({
      name: 'Renamed',
      country: 'UK',
      email: me.email,
      cookieConsentAnalytics: null,
    })
    expect(out.skills?.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort())
    const row = await prisma.volunteer.findUniqueOrThrow({ where: { id: me.id } })
    expect(row.locationConfirmedAt).not.toBeNull()
    expect(row.consentGivenAt).not.toBeNull()

    const cleared = await c.volunteers.updateMe({
      skillIds: [],
      cookieConsentAnalytics: true,
      consentMakeProfileVisibleInDirectory: false,
      consentContactableByProjectOwners: false,
      consentShareContactInfoWithProjectOwner: false,
    })
    expect(cleared.skills).toEqual([])
    expect(cleared.cookieConsentAnalytics).toBe(true)
    await prisma.skillEndorsement.create({
      data: { volunteerId: me.id, skillId: s1.id, endorsedById: me.id },
    })
    const untouched = await c.volunteers.updateMe({ bio: 'A different bio that is long enough' })
    expect(untouched.endorsements).toEqual([
      { skillId: s1.id, rating: 'verified', skillName: s1.name },
    ])
    expect(untouched.skills).toEqual([])
    expect(untouched.bio).toBe('A different bio that is long enough')
  })
})
