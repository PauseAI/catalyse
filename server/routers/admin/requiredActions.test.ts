import { describe, it, expect } from 'vitest'
import { mergeAccounts } from '@/lib/account-merge'
import { createAdmin, createChapter, createMember, createVolunteer } from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { ApprovalStatus } from '@/generated/prisma/enums'

const person = (v: { id: number; name: string; email: string | null }) => ({
  id: v.id,
  name: v.name,
  email: v.email,
})

async function outstanding(kind: string) {
  const kinds = await clientAs(await createAdmin()).admin.requiredActions.outstanding()
  return kinds.find((k) => k.kind === kind)!.people
}

describe('admin.requiredActions.outstanding', () => {
  it('lists marked duplicates, saying when a link was sent', async () => {
    const kept = await createVolunteer({ name: 'Kept one' })
    const quiet = await createVolunteer({ duplicateOfId: kept.id })
    const asked = await createVolunteer({ duplicateOfId: kept.id })
    await clientAs(asked).accountMerges.request({ otherId: kept.id })
    const gone = await createVolunteer({ deletedAt: new Date() })
    await createVolunteer({ duplicateOfId: gone.id })

    const people = await outstanding('merge_account')
    expect(people).toContainEqual({ volunteer: person(quiet), detail: 'Duplicate of Kept one' })
    expect(people).toContainEqual({
      volunteer: person(asked),
      detail: 'Duplicate of Kept one, link sent',
    })
    expect(people.map((p) => p.volunteer.id)).not.toContain(gone.id)
  })

  it('lists kept accounts with details still to choose', async () => {
    const pairOf = async (kept: object, merged: object) => {
      const k = await createVolunteer({ name: 'Sam', ...kept })
      await mergeAccounts(k.id, (await createVolunteer({ name: 'Sam', ...merged })).id, k.id)
      return k
    }
    const one = await pairOf({ bio: 'One bio, long enough' }, { bio: 'Other bio, long enough' })
    const two = await pairOf(
      { discordHandle: 'a', bio: 'One bio' },
      { discordHandle: 'b', bio: 'Two' },
    )
    const settled = await pairOf({}, {})

    const people = await outstanding('reconcile_profile')
    expect(people).toContainEqual({ volunteer: person(one), detail: '1 detail' })
    expect(people).toContainEqual({ volunteer: person(two), detail: '2 details' })
    expect(people.map((p) => p.volunteer.id)).not.toContain(settled.id)
  })

  it('lists unconfirmed locations and approved volunteers with no chapter', async () => {
    const chapter = await createChapter()
    const unconfirmed = await createVolunteer({ locationConfirmedAt: null })
    const brazilian = await createVolunteer({ country: 'Brazil' })
    const pending = await createVolunteer({ approvalStatus: ApprovalStatus.pending })
    const member = await createMember(chapter)

    expect(await outstanding('confirm_location')).toContainEqual({
      volunteer: person(unconfirmed),
      detail: null,
    })
    const pool = await outstanding('choose_chapter')
    expect(pool).toContainEqual({ volunteer: person(brazilian), detail: 'Brazil' })
    expect(pool).toContainEqual({ volunteer: person(unconfirmed), detail: 'No country given' })
    expect(pool.map((p) => p.volunteer.id)).not.toContain(pending.id)
    expect(pool.map((p) => p.volunteer.id)).not.toContain(member.id)
  })

  it('is for global admins only', async () => {
    await expect(
      clientAs(await createVolunteer()).admin.requiredActions.outstanding(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
