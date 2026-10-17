import type { Volunteer } from '@/generated/prisma/client'
import type { MergeConflict } from './account-merge-fields'
import { maskEmail } from './mask-email'
import { prisma } from './prisma'

/**
 * Things a signed-in person is asked to settle, worked out from their account as it stands:
 * once the state changes the action is gone, with nothing to clear. Each kind is one finder
 * below and one entry in `components/required-actions/registry.tsx`, which draws it.
 */
export type RequiredAction =
  | { kind: 'confirm_location'; id: string }
  | {
      kind: 'merge_account'
      id: string
      other: { id: number; name: string; email: string | null; createdAt: Date | null }
      /** Which account a global admin chose to keep. */
      keep: 'this' | 'other'
      /** The kept account's address, masked unless it is the signed-in one. */
      keptEmail: string | null
      /** When a confirmation link was last sent and is still good, if one was. */
      requestedAt: Date | null
    }
  | { kind: 'reconcile_profile'; id: string; mergeId: number; conflicts: MergeConflict[] }

type Finder = (volunteer: Volunteer) => Promise<RequiredAction[]>

const confirmLocation: Finder = async (volunteer) =>
  volunteer.locationConfirmedAt ? [] : [{ kind: 'confirm_location', id: 'confirm_location' }]

/** A global admin marked this account and another as one person's. */
const mergeAccount: Finder = async (volunteer) => {
  const others = await prisma.volunteer.findMany({
    where: {
      deletedAt: null,
      OR: [{ id: volunteer.duplicateOfId ?? -1 }, { duplicateOfId: volunteer.id }],
    },
    select: { id: true, name: true, email: true, createdAt: true, duplicateOfId: true },
    orderBy: { id: 'asc' },
  })
  const requests = await prisma.accountMergeRequest.findMany({
    where: {
      requesterId: volunteer.id,
      otherId: { in: others.map((o) => o.id) },
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })
  return others.map(({ duplicateOfId, ...other }) => {
    const keep = duplicateOfId === volunteer.id ? 'this' : 'other'
    return {
      kind: 'merge_account',
      id: `merge_account:${other.id}`,
      other: { ...other, email: other.email && maskEmail(other.email) },
      keep,
      keptEmail: keep === 'this' ? volunteer.email : other.email && maskEmail(other.email),
      requestedAt: requests.find((r) => r.otherId === other.id)?.createdAt ?? null,
    }
  })
}

/** A merge left fields the two accounts filled in differently. */
const reconcileProfile: Finder = async (volunteer) => {
  const merges = await prisma.accountMerge.findMany({
    where: { keptId: volunteer.id, conflictsResolvedAt: null },
    orderBy: { id: 'asc' },
  })
  return merges.flatMap((m) => {
    const conflicts = m.conflicts as MergeConflict[]
    return conflicts.length
      ? [{ kind: 'reconcile_profile', id: `reconcile_profile:${m.id}`, mergeId: m.id, conflicts }]
      : []
  })
}

const FINDERS: Finder[] = [mergeAccount, reconcileProfile, confirmLocation]

/** Every action waiting on `volunteer`, the most pressing first. */
export async function requiredActionsFor(volunteer: Volunteer): Promise<RequiredAction[]> {
  return (await Promise.all(FINDERS.map((find) => find(volunteer)))).flat()
}
