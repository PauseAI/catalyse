import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createChapter,
  createChapterDeputy,
  createTeam,
  createVolunteer,
  nextSeq,
} from '@/test/factories'
import { anon, clientAs } from '@/test/rpc'
import { emails, linkParam } from '@/test/fakes/email'
import { rateLimit } from '@/test/fakes/rate-limit'
import { ACCOUNT_MERGE_SUBJECT } from '@/lib/email'
import { maskEmail } from '@/lib/mask-email'

/** `merged` marked by a global admin as a duplicate of `kept`. */
async function markedPair(
  keptOverrides: Parameters<typeof createVolunteer>[0] = {},
  mergedOverrides: Parameters<typeof createVolunteer>[0] = {},
) {
  const n = nextSeq()
  const name = `Sam ${n}`
  const kept = await createVolunteer({
    name,
    email: `sam${n}@example.com`,
    locationConfirmedAt: new Date(),
    ...keptOverrides,
  })
  const merged = await createVolunteer({
    name,
    email: `sam${n}.other@example.com`,
    duplicateOfId: kept.id,
    ...mergedOverrides,
  })
  return { kept, merged }
}

async function requestLink(from: { id: number }, otherId: number) {
  const signedIn = await prisma.volunteer.findUniqueOrThrow({ where: { id: from.id } })
  await clientAs(signedIn).accountMerges.request({ otherId })
  return linkParam(emails.last, 'token')
}

describe('requiredActions.list', () => {
  it('asks both accounts of a marked pair to merge', async () => {
    const { kept, merged } = await markedPair()
    expect(await clientAs(kept).requiredActions.list()).toEqual([
      {
        kind: 'merge_account',
        id: `merge_account:${merged.id}`,
        other: {
          id: merged.id,
          name: merged.name,
          email: maskEmail(merged.email!),
          createdAt: merged.createdAt,
        },
        requestedAt: null,
      },
    ])
    const [mergeAction, location] = await clientAs(merged).requiredActions.list()
    expect(mergeAction).toMatchObject({ other: { id: kept.id, email: maskEmail(kept.email!) } })
    expect(location).toEqual({ kind: 'confirm_location', id: 'confirm_location' })

    await requestLink(merged, kept.id)
    const [again] = await clientAs(merged).requiredActions.list()
    expect(again).toMatchObject({ requestedAt: expect.any(Date) })
  })
})

describe('accountMerges', () => {
  it('merges the pair once the link sent to the other address is followed', async () => {
    const { kept, merged } = await markedPair({ bio: 'Kept bio' }, { bio: 'Other bio' })
    const team = await createTeam()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: merged.id } })

    expect(await clientAs(kept).accountMerges.request({ otherId: merged.id })).toMatchObject({
      message: `We sent a link to ${maskEmail(merged.email!)}`,
    })
    expect(emails.last).toMatchObject({ to: merged.email, subject: ACCOUNT_MERGE_SUBJECT })
    expect(emails.last.html).toContain('choose which of the two addresses')
    const token = linkParam(emails.last, 'token')

    expect(await anon().accountMerges.preview({ token })).toEqual({
      keptName: kept.name,
      keptEmail: maskEmail(kept.email!),
      mergedName: merged.name,
      mergedEmail: maskEmail(merged.email!),
    })
    const mergedSession = await prisma.volunteer.findUniqueOrThrow({ where: { id: merged.id } })
    expect(
      await clientAs(mergedSession).accountMerges.confirm({ token, signInWith: 'kept' }),
    ).toEqual({
      email: maskEmail(kept.email!),
      signedOut: true,
    })
    expect(await prisma.teamMembership.count({ where: { volunteerId: kept.id } })).toBe(1)
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: merged.id } })).mergedIntoId,
    ).toBe(kept.id)
    await expect(anon().accountMerges.confirm({ token, signInWith: 'kept' })).rejects.toMatchObject(
      {
        message: 'This link has expired or was already used',
      },
    )

    const [reconcile] = await clientAs(kept).requiredActions.list()
    expect(reconcile).toMatchObject({
      kind: 'reconcile_profile',
      conflicts: [{ field: 'bio', kept: 'Kept bio', merged: 'Other bio' }],
    })
    if (reconcile.kind !== 'reconcile_profile') throw new Error('expected reconcile_profile')
    await expect(
      clientAs(kept).accountMerges.resolveConflicts({ mergeId: reconcile.mergeId, choices: {} }),
    ).rejects.toMatchObject({ message: 'Choose a value for bio' })
    expect(
      await clientAs(kept).accountMerges.resolveConflicts({
        mergeId: reconcile.mergeId,
        choices: { bio: 'merged' },
      }),
    ).toEqual({ message: 'Profile updated' })
    expect((await prisma.volunteer.findUniqueOrThrow({ where: { id: kept.id } })).bio).toBe(
      'Other bio',
    )
    expect(await clientAs(kept).requiredActions.list()).toEqual([])
    await expect(
      clientAs(kept).accountMerges.resolveConflicts({ mergeId: reconcile.mergeId, choices: {} }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('hands back the link itself only while email is stubbed', async () => {
    const { kept, merged } = await markedPair()
    const { _devMergeUrl } = await clientAs(kept).accountMerges.request({ otherId: merged.id })
    expect(_devMergeUrl).toBe(`/merge-accounts?token=${linkParam(emails.last, 'token')}`)
    vi.stubEnv('STUB_EMAIL', 'false')
    expect(await clientAs(kept).accountMerges.request({ otherId: merged.id })).not.toHaveProperty(
      '_devMergeUrl',
    )
    vi.unstubAllEnvs()
  })

  it('voids an earlier link when another is sent', async () => {
    const { kept, merged } = await markedPair()
    const first = await requestLink(kept, merged.id)
    const second = await requestLink(kept, merged.id)
    await expect(anon().accountMerges.preview({ token: first })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(await anon().accountMerges.confirm({ token: second, signInWith: 'merged' })).toEqual({
      email: maskEmail(merged.email!),
      signedOut: false,
    })
  })

  it('keeps a refused link good, and refuses a link whose mark was cleared', async () => {
    const chapter = await createChapter()
    const deputy = await createChapterDeputy(chapter)
    const { kept } = await markedPair()
    await prisma.volunteer.update({ where: { id: deputy.id }, data: { duplicateOfId: kept.id } })
    const token = await requestLink(kept, deputy.id)
    await expect(anon().accountMerges.confirm({ token, signInWith: 'kept' })).rejects.toMatchObject(
      {
        message: expect.stringContaining('holds a chapter role'),
      },
    )
    await anon().accountMerges.preview({ token })

    await prisma.volunteer.update({ where: { id: deputy.id }, data: { duplicateOfId: null } })
    await expect(anon().accountMerges.confirm({ token, signInWith: 'kept' })).rejects.toMatchObject(
      {
        message: 'Those accounts are not marked as yours',
      },
    )
  })

  it('loses the race when two confirmations of one link overlap', async () => {
    const { kept, merged } = await markedPair()
    const token = await requestLink(kept, merged.id)
    const results = await Promise.allSettled([
      anon().accountMerges.confirm({ token, signInWith: 'kept' }),
      anon().accountMerges.confirm({ token, signInWith: 'kept' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { message: 'This link has expired or was already used' },
    })
  })

  it('refuses accounts not marked as a pair, one with no address, and too many links', async () => {
    const { kept } = await markedPair()
    const stranger = await createVolunteer()
    await expect(
      clientAs(kept).accountMerges.request({ otherId: stranger.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const noAddress = await createVolunteer({ email: null, duplicateOfId: kept.id })
    await expect(
      clientAs(kept).accountMerges.request({ otherId: noAddress.id }),
    ).rejects.toMatchObject({ message: expect.stringContaining('no address') })

    rateLimit.denyNext()
    await expect(
      clientAs(kept).accountMerges.request({ otherId: noAddress.id }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })

  it('clears the mark when the person says the accounts are two people', async () => {
    const { kept, merged } = await markedPair()
    expect(await clientAs(merged).accountMerges.notSamePerson({ otherId: kept.id })).toEqual({
      message: 'Thanks, we will treat them as two people',
    })
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: merged.id } })).duplicateOfId,
    ).toBe(null)
    expect(
      await prisma.distinctAccountPair.count({
        where: { volunteerAId: kept.id, volunteerBId: merged.id },
      }),
    ).toBe(1)
    expect(
      await prisma.adminNote.count({ where: { volunteerId: { in: [kept.id, merged.id] } } }),
    ).toBe(2)
    const now = await prisma.volunteer.findUniqueOrThrow({ where: { id: merged.id } })
    expect(
      (await clientAs(now).requiredActions.list()).filter((a) => a.kind === 'merge_account'),
    ).toEqual([])
  })
})
