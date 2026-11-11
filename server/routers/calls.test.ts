import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { CALL_ANSWERED, CALL_POSTED } from '@/lib/calls'
import {
  createAdmin,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createCoordinator,
  createMember,
  createSkill,
  createVolunteer,
  TEST_PASSWORD,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { emails } from '@/test/fakes/email'

const forbidden = { code: 'FORBIDDEN' }
const notFound = { code: 'NOT_FOUND' }

const call = (
  overrides: Partial<{ title: string; body: string; chapterIds: number[]; skillIds: number[] }>,
) => ({
  title: 'Photos of your next event',
  body: 'We need photos and short videos of events in every country.',
  chapterIds: [],
  skillIds: [],
  ...overrides,
})

/** Everything the coordinator can read about their calls, as one string to search. */
async function everythingTheCoordinatorSees(c: ReturnType<typeof clientAs>) {
  const sent = await c.calls.sent()
  const responses = await Promise.all(sent.map((s) => c.calls.responses({ callId: s.id })))
  return JSON.stringify({ sent, responses })
}

// The file shares one database, and countries run out, so the chapters are made once.
let chapters: Promise<Awaited<ReturnType<typeof createChapter>>[]> | undefined
const twoChapters = () =>
  (chapters ??= createChapter().then(async (uk) => [uk, await createChapter()]))

/** Two chapters, with a visible and a hidden (opted-out of the directory) volunteer in each. */
async function setup() {
  const [uk, de] = await twoChapters()
  const coordinator = await createCoordinator(uk)
  const hidden = { consentMakeProfileVisibleInDirectory: false }
  return {
    uk,
    de,
    coordinator,
    c: clientAs(coordinator),
    ukVisible: await createMember(uk),
    ukHidden: await createMember(uk, hidden),
    deVisible: await createMember(de),
    deHidden: await createMember(de, hidden),
    poolHidden: await createVolunteer(hidden),
  }
}

const delivered = async (callId: number, volunteerId: number) =>
  expect(await notifiedOf(callId, volunteerId)).toBe(1)

const notifiedOf = (callId: number, volunteerId: number) =>
  prisma.notification.count({ where: { type: CALL_POSTED, entityId: callId, volunteerId } })

describe('who may put out a call', () => {
  it('is a coordinator or a global admin, and no one else', async () => {
    const [uk] = await twoChapters()
    const coordinator = await createCoordinator(uk)
    await expect(clientAs(coordinator).calls.send(call({}))).resolves.toEqual({
      id: expect.any(Number),
    })
    await expect(clientAs(await createAdmin()).calls.send(call({}))).resolves.toBeTruthy()

    for (const person of [
      await createChapterLead(uk),
      await createChapterDeputy(uk),
      await createMember(uk),
    ]) {
      await expect(clientAs(person).calls.send(call({}))).rejects.toMatchObject(forbidden)
      await expect(clientAs(person).calls.sent()).rejects.toMatchObject(forbidden)
    }
    await expect(clientAs(null).calls.send(call({}))).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    await expect(
      clientAs(await createAdmin(), { viewingAsVolunteer: true }).calls.send(call({})),
    ).rejects.toMatchObject(forbidden)
  })

  it('refuses chapters and skills that do not exist', async () => {
    const { c } = await setup()
    await expect(c.calls.send(call({ chapterIds: [987654] }))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    await expect(c.calls.send(call({ skillIds: [987654] }))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })
})

describe('delivering a call', () => {
  it('reaches every chapter and the pool, hidden volunteers included, in the Inbox only', async () => {
    const s = await setup()
    const pending = await createMember(s.de, { approvalStatus: 'pending' })
    const unconfirmed = await createMember(s.de, { emailConfirmed: false })
    const gone = await createMember(s.de, { deletedAt: new Date() })
    const { id } = await s.c.calls.send(call({ title: 'Everywhere' }))

    for (const v of [s.ukVisible, s.ukHidden, s.deVisible, s.deHidden, s.poolHidden]) {
      await delivered(id, v.id)
    }
    await emails.settle()
    for (const v of [s.ukVisible, s.ukHidden, s.deVisible, s.deHidden, s.poolHidden]) {
      expect(emails.to(v.email!)).toEqual([])
    }
    for (const v of [pending, unconfirmed, gone, s.coordinator]) {
      expect(await notifiedOf(id, v.id)).toBe(0)
    }
  })

  it('reaches only the chapters it names, and only those with its skill', async () => {
    const s = await setup()
    const photography = await createSkill()
    await prisma.volunteerSkill.create({
      data: { volunteerId: s.deHidden.id, skillId: photography.id },
    })
    const toGermany = await s.c.calls.send(call({ chapterIds: [s.de.id] }))
    const photographers = await s.c.calls.send(call({ skillIds: [photography.id] }))

    await delivered(toGermany.id, s.deVisible.id)
    await delivered(toGermany.id, s.deHidden.id)
    await delivered(photographers.id, s.deHidden.id)
    for (const v of [s.ukVisible, s.ukHidden, s.poolHidden]) {
      expect(await notifiedOf(toGermany.id, v.id)).toBe(0)
    }
    for (const v of [s.ukVisible, s.ukHidden, s.deVisible, s.poolHidden]) {
      expect(await notifiedOf(photographers.id, v.id)).toBe(0)
    }

    expect((await clientAs(s.deHidden).calls.forMe()).map((x) => x.id)).toEqual(
      expect.arrayContaining([toGermany.id, photographers.id]),
    )
    expect((await clientAs(s.ukVisible).calls.forMe()).map((x) => x.id)).not.toContain(toGermany.id)
    expect((await clientAs(s.poolHidden).calls.forMe()).map((x) => x.id)).not.toContain(
      toGermany.id,
    )
    await expect(
      clientAs(s.ukVisible).calls.respond({ callId: toGermany.id, message: 'Me!' }),
    ).rejects.toMatchObject(notFound)
  })

  it('is shown to those without its skill, apart from the calls that match, and they may answer', async () => {
    const s = await setup()
    const photography = await createSkill({ name: 'Photography' })
    await prisma.volunteerSkill.create({
      data: { volunteerId: s.deHidden.id, skillId: photography.id },
    })
    const { id } = await s.c.calls.send(call({ skillIds: [photography.id] }))
    await delivered(id, s.deHidden.id)
    expect(await notifiedOf(id, s.deVisible.id)).toBe(0)

    const shown = async (v: Parameters<typeof clientAs>[0]) =>
      (await clientAs(v).calls.forMe()).find((x) => x.id === id)
    expect(await shown(s.deHidden)).toMatchObject({
      matchesSkills: true,
      skillNames: ['Photography'],
    })
    expect(await shown(s.deVisible)).toMatchObject({
      matchesSkills: false,
      skillNames: ['Photography'],
    })

    await clientAs(s.deVisible).calls.respond({ callId: id, message: 'I take photos too' })
    expect(await s.c.calls.responses({ callId: id })).toEqual([
      expect.objectContaining({ name: s.deVisible.name, message: 'I take photos too' }),
    ])
    expect(await notifiedOf(id, s.deVisible.id)).toBe(0)
  })

  it('asking for several skills, reaches anyone with any of them, and lists them all', async () => {
    const s = await setup()
    const [film, photo, sound] = [
      await createSkill({ name: 'Film' }),
      await createSkill({ name: 'Photography' }),
      await createSkill({ name: 'Sound' }),
    ]
    await prisma.volunteerSkill.createMany({
      data: [
        { volunteerId: s.deHidden.id, skillId: photo.id },
        { volunteerId: s.ukHidden.id, skillId: film.id },
        { volunteerId: s.ukVisible.id, skillId: sound.id },
      ],
    })
    const { id } = await s.c.calls.send(call({ skillIds: [photo.id, film.id, photo.id] }))

    await delivered(id, s.deHidden.id)
    await delivered(id, s.ukHidden.id)
    for (const v of [s.ukVisible, s.deVisible, s.poolHidden]) {
      expect(await notifiedOf(id, v.id)).toBe(0)
    }
    const shown = async (v: Parameters<typeof clientAs>[0]) =>
      (await clientAs(v).calls.forMe()).find((x) => x.id === id)
    expect(await shown(s.ukHidden)).toMatchObject({
      matchesSkills: true,
      skillNames: ['Film', 'Photography'],
    })
    expect(await shown(s.ukVisible)).toMatchObject({ matchesSkills: false })
    expect((await s.c.calls.sent()).find((x) => x.id === id)?.skillNames).toEqual([
      'Film',
      'Photography',
    ])
  })
})

describe('who a call reached', () => {
  it('is never named to the coordinator, only those who answer', async () => {
    const s = await setup()
    const { id } = await s.c.calls.send(call({}))
    for (const v of [s.ukHidden, s.deHidden, s.poolHidden]) await delivered(id, v.id)
    await clientAs(s.ukVisible).calls.respond({ callId: id, message: 'Happy to film' })

    const seen = await everythingTheCoordinatorSees(s.c)
    expect(seen).toContain(s.ukVisible.name)
    for (const v of [s.ukHidden, s.deHidden, s.poolHidden, s.deVisible]) {
      expect(seen).not.toContain(v.name)
      expect(seen).not.toContain(v.email)
    }
  })

  it('who answer share their name, email and message, and take them back by withdrawing', async () => {
    const s = await setup()
    const { id } = await s.c.calls.send(call({ title: 'Video' }))
    await delivered(id, s.deHidden.id)
    const them = clientAs(s.deHidden)

    expect((await them.calls.forMe()).find((x) => x.id === id)).toMatchObject({
      senderName: s.coordinator.name,
      senderRemit: 'Media',
    })
    await them.calls.respond({ callId: id, message: 'I film every protest in Berlin' })
    expect(await s.c.calls.responses({ callId: id })).toEqual([
      expect.objectContaining({
        name: s.deHidden.name,
        email: s.deHidden.email,
        chapterName: s.de.name,
        message: 'I film every protest in Berlin',
      }),
    ])
    expect((await s.c.calls.sent())[0].responseCount).toBe(1)
    const answered = await prisma.notification.findFirstOrThrow({
      where: { type: CALL_ANSWERED, volunteerId: s.coordinator.id },
    })
    expect(answered.title).toContain(s.deHidden.name)
    await emails.settle()
    expect(emails.to(s.coordinator.email!)).toEqual([])

    await them.calls.respond({ callId: id, message: 'Berlin and Hamburg' })
    expect((await s.c.calls.responses({ callId: id }))[0].message).toBe('Berlin and Hamburg')
    expect(
      await prisma.notification.count({
        where: { type: CALL_ANSWERED, volunteerId: s.coordinator.id },
      }),
    ).toBe(1)

    await them.calls.withdraw({ callId: id })
    expect(await s.c.calls.responses({ callId: id })).toEqual([])
    expect(await prisma.notification.count({ where: { id: answered.id } })).toBe(0)
    const seen = await everythingTheCoordinatorSees(s.c)
    expect(seen).not.toContain(s.deHidden.name)
    expect(seen).not.toContain(s.deHidden.email)
    await expect(them.calls.withdraw({ callId: id })).rejects.toMatchObject(notFound)
  })
})

describe("a coordinator's sight of volunteers", () => {
  it('takes in every chapter and the pool, hidden volunteers included', async () => {
    const s = await setup()
    const everyone = [s.ukVisible, s.ukHidden, s.deVisible, s.deHidden, s.poolHidden]
    const directory = (await s.c.volunteers.list({ limit: 100 })).volunteers
    const ids = directory.map((v) => v.id)
    for (const v of everyone) expect(ids).toContain(v.id)
    expect(directory.find((v) => v.id === s.deHidden.id)).toMatchObject({
      hiddenFromDirectory: true,
      canMessage: true,
    })
    expect(directory[0]).not.toHaveProperty('email')

    const inGermany = (await s.c.volunteers.list({ chapter: s.de.id, limit: 100 })).volunteers
    expect(inGermany.map((v) => v.id)).toEqual(
      expect.arrayContaining([s.deVisible.id, s.deHidden.id]),
    )
    expect(inGermany.map((v) => v.id)).not.toContain(s.ukHidden.id)
    const pool = (await s.c.volunteers.list({ chapter: 'pool', limit: 100 })).volunteers
    expect(pool.map((v) => v.id)).toContain(s.poolHidden.id)
    expect(pool.map((v) => v.id)).not.toContain(s.deHidden.id)

    const people = await s.c.volunteers.lookup({ ids: everyone.map((v) => v.id) })
    expect(people.every((p) => p.canView)).toBe(true)
  })

  it('opens the full profile of a hidden volunteer in another chapter, skills and contact included', async () => {
    const s = await setup()
    const skill = await createSkill({ name: 'Drone filming' })
    await prisma.volunteerSkill.create({ data: { volunteerId: s.deHidden.id, skillId: skill.id } })
    await prisma.volunteer.update({
      where: { id: s.deHidden.id },
      data: { signalNumber: '+49 30 1234567' },
    })

    const profile = await s.c.volunteers.getById({ id: s.deHidden.id })
    expect(profile).toMatchObject({
      name: s.deHidden.name,
      signalNumber: '+49 30 1234567',
      canMessage: true,
      skills: [expect.objectContaining({ name: 'Drone filming' })],
    })
    // The login address and duplicate marking stay a global admin's, as does the admin area.
    expect(profile).not.toHaveProperty('email')
    await expect(s.c.admin.volunteers.getById({ id: s.deHidden.id })).rejects.toMatchObject(
      forbidden,
    )
  })

  it('messages a hidden volunteer in another chapter, who can reply', async () => {
    const s = await setup()
    const { threadId } = await s.c.messages.send({
      recipientId: s.deHidden.id,
      subject: 'Your photos',
      message: 'Could we use your march photos?',
    })
    const them = clientAs(s.deHidden)
    expect(await them.messages.thread({ id: threadId })).toMatchObject({ canReply: true })
    await them.messages.reply({ threadId, message: 'Yes, go ahead' })
    expect((await s.c.messages.thread({ id: threadId })).messages.map((m) => m.body)).toEqual([
      'Could we use your march photos?',
      'Yes, go ahead',
    ])
  })

  it('ends with the role, and was never another volunteer’s to have', async () => {
    const s = await setup()
    const { threadId } = await s.c.messages.send({
      recipientId: s.deHidden.id,
      subject: 'Hi',
      message: 'Hello',
    })
    const plain = clientAs(s.ukVisible)
    await expect(plain.volunteers.getById({ id: s.deHidden.id })).rejects.toMatchObject(notFound)
    expect((await plain.volunteers.list({ limit: 100 })).volunteers.map((v) => v.id)).not.toContain(
      s.ukHidden.id,
    )

    const viewingAs = clientAs(s.coordinator, { viewingAsVolunteer: true })
    await expect(viewingAs.volunteers.getById({ id: s.deHidden.id })).rejects.toMatchObject(
      notFound,
    )

    // A volunteer whose approval is revoked is out of reach, old conversations included.
    await prisma.volunteer.update({
      where: { id: s.deHidden.id },
      data: { approvalStatus: 'rejected' },
    })
    await expect(s.c.messages.reply({ threadId, message: 'Still there?' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    await prisma.volunteer.update({
      where: { id: s.deHidden.id },
      data: { approvalStatus: 'approved' },
    })

    await prisma.coordinator.deleteMany({ where: { volunteerId: s.coordinator.id } })
    await expect(s.c.volunteers.getById({ id: s.deHidden.id })).rejects.toMatchObject(notFound)
    await expect(
      s.c.messages.send({ recipientId: s.deHidden.id, subject: 'Hi', message: 'Again' }),
    ).rejects.toMatchObject(forbidden)
    await expect(
      clientAs(s.deHidden).messages.reply({ threadId, message: 'Hello back' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('running calls', () => {
  it('shows a coordinator their own calls only, and a global admin every call', async () => {
    const s = await setup()
    const other = await createCoordinator(s.de)
    const mine = await s.c.calls.send(call({ title: 'Mine' }))
    const theirs = await clientAs(other).calls.send(call({ title: 'Theirs' }))

    expect((await s.c.calls.sent()).map((x) => x.id)).toEqual([mine.id])
    await expect(s.c.calls.responses({ callId: theirs.id })).rejects.toMatchObject(notFound)
    await expect(s.c.calls.close({ callId: theirs.id })).rejects.toMatchObject(notFound)

    const admin = clientAs(await createAdmin())
    expect((await admin.calls.sent()).map((x) => x.id)).toEqual(
      expect.arrayContaining([mine.id, theirs.id]),
    )
    await expect(admin.calls.responses({ callId: theirs.id })).resolves.toEqual([])
  })

  it('stops taking answers once closed, while those who answered still see it', async () => {
    const s = await setup()
    const { id } = await s.c.calls.send(call({ chapterIds: [s.uk.id] }))
    await delivered(id, s.ukHidden.id)
    await clientAs(s.ukVisible).calls.respond({ callId: id, message: 'Yes' })

    await s.c.calls.close({ callId: id })
    await s.c.calls.close({ callId: id })
    expect((await s.c.calls.sent())[0].closedAt).not.toBeNull()
    await expect(
      clientAs(s.ukHidden).calls.respond({ callId: id, message: 'Too late' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect((await clientAs(s.ukHidden).calls.forMe()).map((x) => x.id)).not.toContain(id)
    expect((await clientAs(s.ukVisible).calls.forMe()).find((x) => x.id === id)).toMatchObject({
      open: false,
      myResponse: { message: 'Yes' },
    })
  })

  it('names a removed chapter and an unknown sender plainly', async () => {
    const s = await setup()
    const admin = await createAdmin()
    const { id } = await clientAs(admin).calls.send(call({ chapterIds: [s.de.id] }))
    await prisma.call.update({ where: { id }, data: { chapterIds: [s.de.id, 987654] } })
    await prisma.volunteer.delete({ where: { id: admin.id } })
    const listed = await clientAs(await createAdmin()).calls.sent()
    expect(listed.find((x) => x.id === id)).toMatchObject({
      chapters: [s.de.name, 'A removed chapter'],
      senderName: null,
    })
    expect((await clientAs(s.deVisible).calls.forMe()).find((x) => x.id === id)).toMatchObject({
      senderName: null,
    })
    await expect(
      clientAs(s.deVisible).calls.respond({ callId: id, message: 'Hi' }),
    ).resolves.toBeTruthy()
  })

  it('takes the role away, closing the open calls of a removed coordinator', async () => {
    const s = await setup()
    const { id } = await s.c.calls.send(call({}))
    const admin = clientAs(await createAdmin())

    await admin.admin.coordinators.remove({ volunteerId: s.coordinator.id })
    await expect(s.c.calls.sent()).rejects.toMatchObject(forbidden)
    expect((await prisma.call.findUniqueOrThrow({ where: { id } })).closedAt).not.toBeNull()
  })
})

describe('admin.coordinators', () => {
  it('lets only a global admin appoint, re-describe and remove coordinators', async () => {
    const [uk] = await twoChapters()
    const person = await createMember(uk)
    const lead = clientAs(await createChapterDeputy(uk))
    await expect(
      lead.admin.coordinators.appoint({ volunteerId: person.id, remit: null }),
    ).rejects.toMatchObject(forbidden)
    await expect(lead.admin.coordinators.list()).rejects.toMatchObject(forbidden)

    const adminUser = await createAdmin()
    const admin = clientAs(adminUser)
    await admin.admin.coordinators.appoint({ volunteerId: person.id, remit: 'Media' })
    await admin.admin.coordinators.appoint({ volunteerId: person.id, remit: 'Media and comms' })
    const listed = await admin.admin.coordinators.list()
    expect(listed.filter((x) => x.volunteerId === person.id)).toEqual([
      expect.objectContaining({
        volunteerId: person.id,
        name: person.name,
        remit: 'Media and comms',
        appointedByName: adminUser.name,
      }),
    ])
    await expect(clientAs(person).calls.sent()).resolves.toEqual([])
    // Being a coordinator makes no one staff anywhere.
    await expect(
      clientAs(person).admin.volunteers.getById({ id: person.id }),
    ).rejects.toMatchObject(forbidden)

    await admin.admin.coordinators.remove({ volunteerId: person.id })
    expect((await admin.admin.coordinators.list()).map((x) => x.volunteerId)).not.toContain(
      person.id,
    )
    await expect(admin.admin.coordinators.remove({ volunteerId: person.id })).rejects.toMatchObject(
      notFound,
    )
    await expect(
      admin.admin.coordinators.appoint({ volunteerId: 987654, remit: null }),
    ).rejects.toMatchObject(notFound)

    const events = await prisma.chapterAuditEvent.findMany({
      where: { targetVolunteerId: person.id },
      orderBy: { id: 'asc' },
    })
    expect(events.map((e) => [e.action, e.details])).toEqual([
      ['COORDINATOR_APPOINTED', { remit: 'Media' }],
      ['COORDINATOR_APPOINTED', { remit: 'Media and comms', previousRemit: 'Media' }],
      ['COORDINATOR_REMOVED', null],
    ])
  })
})

describe('edges of a call', () => {
  it('loses a deleted skill, closing only once none it asked for is left, rather than widening to everyone', async () => {
    const s = await setup()
    const [film, photo] = [await createSkill(), await createSkill()]
    const admin = clientAs(await createAdmin())
    const { id } = await s.c.calls.send(call({ skillIds: [film.id, photo.id] }))
    const callNow = () =>
      prisma.call.findUniqueOrThrow({ where: { id }, include: { skills: true } })

    await admin.admin.skills.delete({ id: film.id })
    expect(await callNow()).toMatchObject({ closedAt: null, skills: [{ skillId: photo.id }] })
    await admin.admin.skills.delete({ id: photo.id })
    expect(await callNow()).toMatchObject({ closedAt: expect.any(Date), skills: [] })
    await expect(
      clientAs(s.deVisible).calls.respond({ callId: id, message: 'Me' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('closes when its last two skills are deleted at once', async () => {
    const s = await setup()
    const [film, photo] = [await createSkill(), await createSkill()]
    const { id } = await s.c.calls.send(call({ skillIds: [film.id, photo.id] }))
    const [a, b] = [clientAs(await createAdmin()), clientAs(await createAdmin())]
    await Promise.all([
      a.admin.skills.delete({ id: film.id }),
      b.admin.skills.delete({ id: photo.id }),
    ])
    expect((await prisma.call.findUniqueOrThrow({ where: { id } })).closedAt).not.toBeNull()
  })

  it("closes, with the role, when the coordinator's account is deleted", async () => {
    const s = await setup()
    const { id } = await s.c.calls.send(call({}))
    await s.c.auth.deleteAccount({ password: TEST_PASSWORD })
    expect((await prisma.call.findUniqueOrThrow({ where: { id } })).closedAt).not.toBeNull()
    expect(await prisma.coordinator.count({ where: { volunteerId: s.coordinator.id } })).toBe(0)
    expect(
      await prisma.chapterAuditEvent.findFirstOrThrow({
        where: { targetVolunteerId: s.coordinator.id, action: 'COORDINATOR_REMOVED' },
      }),
    ).toMatchObject({ actorId: s.coordinator.id, details: { reason: 'account deleted' } })
  })

  it('is not shown to an account a call could never reach', async () => {
    const s = await setup()
    const { id } = await s.c.calls.send(call({}))
    const duplicate = await createMember(s.uk, { duplicateOfId: s.ukVisible.id })
    expect(await clientAs(duplicate).calls.forMe()).toEqual([])
    expect((await clientAs(s.ukVisible).calls.forMe()).map((x) => x.id)).toContain(id)
  })

  it('counts only the answers it lists', async () => {
    const s = await setup()
    const { id } = await s.c.calls.send(call({}))
    for (const v of [s.ukVisible, s.deVisible]) {
      await clientAs(v).calls.respond({ callId: id, message: 'Here' })
    }
    await prisma.volunteer.update({
      where: { id: s.deVisible.id },
      data: { deletedAt: new Date() },
    })
    expect((await s.c.calls.sent()).find((x) => x.id === id)?.responseCount).toBe(1)
    expect(await s.c.calls.responses({ callId: id })).toHaveLength(1)
  })

  it('notifies the sender once when the first answer is sent twice at once', async () => {
    const s = await setup()
    const { id } = await s.c.calls.send(call({}))
    const them = clientAs(s.ukVisible)
    await Promise.all([
      them.calls.respond({ callId: id, message: 'First' }),
      them.calls.respond({ callId: id, message: 'First' }),
    ])
    expect(
      await prisma.notification.count({
        where: { type: CALL_ANSWERED, volunteerId: s.coordinator.id },
      }),
    ).toBe(1)
    expect(await prisma.callResponse.count({ where: { callId: id } })).toBe(1)
  })
})

describe('accounts awaiting approval', () => {
  it('cannot be appointed, and one who slips through can do nothing', async () => {
    const [uk] = await twoChapters()
    const pending = await createMember(uk, { approvalStatus: 'pending' })
    const unconfirmed = await createMember(uk, { emailConfirmed: false })
    for (const v of [pending, unconfirmed]) {
      await expect(
        clientAs(await createAdmin()).admin.coordinators.appoint({
          volunteerId: v.id,
          remit: null,
        }),
      ).rejects.toMatchObject(notFound)
    }
    await prisma.coordinator.create({ data: { volunteerId: unconfirmed.id } })
    await expect(clientAs(unconfirmed).calls.send(call({}))).rejects.toMatchObject(forbidden)

    await prisma.coordinator.create({ data: { volunteerId: pending.id } })
    await expect(clientAs(pending).calls.send(call({}))).rejects.toMatchObject(forbidden)
  })

  it('are not opened to a coordinator, nor are pending or rejected applicants', async () => {
    const s = await setup()
    for (const status of ['pending', 'rejected'] as const) {
      const applicant = await createMember(s.de, { approvalStatus: status })
      await expect(s.c.volunteers.getById({ id: applicant.id })).rejects.toMatchObject(notFound)
      await expect(
        s.c.messages.send({ recipientId: applicant.id, subject: 'Hi', message: 'Hello' }),
      ).rejects.toMatchObject(forbidden)
      expect((await s.c.volunteers.lookup({ ids: [applicant.id] }))[0].canView).toBe(false)
    }
  })
})
