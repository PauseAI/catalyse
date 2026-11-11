import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { addressedToWhere, addresseeWhere, audienceWhere, visibleToWhere } from '@/lib/calls'
import { createChapter, createMember, createSkill, createVolunteer } from '@/test/factories'

/** Two chapters, a volunteer in each and one in the pool, with only `skilled` holding the skill. */
async function setup() {
  const uk = await createChapter()
  const de = await createChapter()
  const skill = await createSkill()
  const skilled = await createMember(uk)
  await prisma.volunteerSkill.create({ data: { volunteerId: skilled.id, skillId: skill.id } })
  return {
    uk,
    de,
    skill,
    skilled,
    unskilled: await createMember(uk),
    germany: await createMember(de),
    pool: await createVolunteer(),
    sender: await createMember(uk),
  }
}

const people = async (where: ReturnType<typeof audienceWhere>, ids: number[]) =>
  (await prisma.volunteer.findMany({ where: { AND: [{ id: { in: ids } }, where] } }))
    .map((v) => v.id)
    .sort((a, b) => a - b)

const sorted = (...ids: number[]) => ids.sort((a, b) => a - b)

describe('who a call reaches', () => {
  it('is seen by its chapters whatever the skill, and delivered only to those with it', async () => {
    const s = await setup()
    const everyone = [s.skilled.id, s.unskilled.id, s.germany.id, s.pool.id, s.sender.id]
    const toUk = { senderId: s.sender.id, chapterIds: [s.uk.id], skillId: s.skill.id }
    const anywhere = { senderId: s.sender.id, chapterIds: [], skillId: null }

    expect(await people(audienceWhere(toUk), everyone)).toEqual(
      sorted(s.skilled.id, s.unskilled.id),
    )
    expect(await people(addresseeWhere(toUk), everyone)).toEqual([s.skilled.id])
    expect(await people(audienceWhere(anywhere), everyone)).toEqual(
      sorted(s.skilled.id, s.unskilled.id, s.germany.id, s.pool.id),
    )
    expect(await people(addresseeWhere(anywhere), everyone)).toEqual(
      await people(audienceWhere(anywhere), everyone),
    )
  })
})

describe('which calls a volunteer is shown', () => {
  it('takes in every call to their chapter, and is addressed only by those of their skills', async () => {
    const s = await setup()
    const make = (chapterIds: number[], skillId: number | null) =>
      prisma.call.create({
        data: { senderId: s.sender.id, title: 'Help', body: 'Please', chapterIds, skillId },
      })
    const ukSkill = await make([s.uk.id], s.skill.id)
    const ukAny = await make([s.uk.id], null)
    const everywhereSkill = await make([], s.skill.id)
    const germany = await make([s.de.id], null)
    const ids = [ukSkill.id, ukAny.id, everywhereSkill.id, germany.id]
    const calls = async (where: ReturnType<typeof visibleToWhere>) =>
      (await prisma.call.findMany({ where: { AND: [{ id: { in: ids } }, where] } }))
        .map((c) => c.id)
        .sort((a, b) => a - b)

    const all = sorted(ukSkill.id, ukAny.id, everywhereSkill.id)
    expect(await calls(visibleToWhere(s.skilled))).toEqual(all)
    expect(await calls(addressedToWhere(s.skilled))).toEqual(all)
    expect(await calls(visibleToWhere(s.unskilled))).toEqual(all)
    expect(await calls(addressedToWhere(s.unskilled))).toEqual([ukAny.id])
    expect(await calls(visibleToWhere(s.pool))).toEqual([everywhereSkill.id])
    expect(await calls(addressedToWhere(s.pool))).toEqual([])
    expect(await calls(visibleToWhere(s.sender))).toEqual([])
  })
})
