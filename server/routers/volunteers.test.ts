import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createQuickTask,
  createSkill,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

describe('volunteers.list', () => {
  it('filters the approved, visible directory by skill, search and location', async () => {
    const me = await createVolunteer()
    const skill = await createSkill()
    const ann = await createVolunteer({
      name: 'Ann Searchable',
      bio: 'x',
      country: 'UK',
      localGroup: 'London',
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
    expect(await names({ country: 'UK' })).toEqual(['Ann Searchable'])
    expect(await names({ country: 'France' })).toEqual(['Bob'])
    expect(await names({ localGroup: 'London' })).toEqual(['Ann Searchable'])
    expect(await names({ localGroup: 'Paris' })).toEqual(['Bob'])
    expect((await c.volunteers.list({ limit: 1, offset: 1 })).volunteers).toHaveLength(1)
    expect(
      (await c.volunteers.list({ skillIds: [skill.id] })).volunteers[0].skills[0],
    ).toMatchObject({ id: skill.id, categoryName: expect.any(String) })

    const admin = await createAdmin()
    const adminView = await clientAs(admin).volunteers.list({ search: 'Hidden' })
    expect(adminView.volunteers[0].hiddenFromDirectory).toBe(true)
    const tech = await createVolunteer({ isTechnicalAdmin: true })
    expect((await clientAs(tech).volunteers.list({ search: 'Hidden' })).total).toBe(1)
    void ann
    void bob
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
    expect(view.projects.map((p) => [p.id, p.role]).sort()).toEqual(
      [
        [owned.id, 'owner'],
        [proposed.id, 'proposer'],
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
    // The login address stays off every profile, even for the volunteer and for admins.
    for (const [viewer, target] of [
      [me, vol],
      [shy, shy],
      [admin, shy],
    ]) {
      expect(await clientAs(viewer).volunteers.getById({ id: target.id })).not.toHaveProperty(
        'email',
      )
    }
    await expect(clientAs(me).volunteers.getById({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('reveals a hidden profile only to themselves, admins, or an involving project owner', async () => {
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
    expect(
      (
        await clientAs(await createVolunteer({ isTechnicalAdmin: true })).volunteers.getById({
          id: hidden.id,
        })
      ).id,
    ).toBe(hidden.id)
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
