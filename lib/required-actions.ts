import type { Volunteer } from '@/generated/prisma/client'
import { ApprovalStatus } from '@/generated/prisma/enums'
import type { MergeConflict } from './account-merge-fields'
import { countryName } from './countries'
import { listCountries } from './countries-server'
import { maskEmail } from './mask-email'
import { prisma } from './prisma'

/**
 * Things a signed-in person is asked to settle, worked out from their account as it stands:
 * once the state changes the action is gone, with nothing to clear. Each kind is one entry in
 * REQUIRED_ACTION_KINDS below and one in `components/required-actions/registry.tsx`, which
 * draws it.
 */
export type RequiredAction =
  | { kind: 'confirm_location'; id: string }
  | {
      kind: 'merge_account'
      id: string
      other: { id: number; name: string; email: string | null; createdAt: Date | null }
      /** When a confirmation link was last sent and is still good, if one was. */
      requestedAt: Date | null
    }
  | { kind: 'reconcile_profile'; id: string; mergeId: number; conflicts: MergeConflict[] }
  | { kind: 'choose_chapter'; id: string }

export type RequiredActionKind = RequiredAction['kind']

/** Someone with an action of one kind waiting, as a global admin sees them. */
export type OutstandingAction = {
  volunteer: { id: number; name: string; email: string | null }
  detail: string | null
}

type Kind = {
  /** The actions of this kind waiting on `volunteer`. */
  find: (volunteer: Volunteer) => Promise<RequiredAction[]>
  /** Everyone with one waiting: the rule `find` applies, over every live account. */
  outstanding: () => Promise<OutstandingAction[]>
}

const PERSON = { id: true, name: true, email: true } as const

/** A global admin marked this account and another as one person's. */
const mergeAccount: Kind = {
  async find(volunteer) {
    const others = await prisma.volunteer.findMany({
      where: {
        deletedAt: null,
        OR: [{ id: volunteer.duplicateOfId ?? -1 }, { duplicateOfId: volunteer.id }],
      },
      select: { id: true, name: true, email: true, createdAt: true },
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
    return others.map((other) => ({
      kind: 'merge_account',
      id: `merge_account:${other.id}`,
      other: { ...other, email: other.email && maskEmail(other.email) },
      requestedAt: requests.find((r) => r.otherId === other.id)?.createdAt ?? null,
    }))
  },
  async outstanding() {
    const marked = await prisma.volunteer.findMany({
      where: { deletedAt: null, duplicateOf: { deletedAt: null } },
      select: { ...PERSON, duplicateOf: { select: PERSON } },
      orderBy: { name: 'asc' },
    })
    const links = await prisma.accountMergeRequest.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      select: { requesterId: true, otherId: true },
    })
    return marked.flatMap(({ duplicateOf: kept, ...volunteer }) => {
      const pair = [volunteer.id, kept?.id]
      const sent = links.some((l) => pair.includes(l.requesterId) && pair.includes(l.otherId))
      return kept
        ? [{ volunteer, detail: `Duplicate of ${kept.name}${sent ? ', link sent' : ''}` }]
        : []
    })
  },
}

/** A merge left fields the two accounts filled in differently. */
const reconcileProfile: Kind = {
  async find(volunteer) {
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
  },
  async outstanding() {
    const merges = await prisma.accountMerge.findMany({
      where: { conflictsResolvedAt: null, kept: { deletedAt: null } },
      select: { conflicts: true, kept: { select: PERSON } },
      orderBy: { id: 'asc' },
    })
    return merges.flatMap(({ kept, conflicts }) => {
      const count = (conflicts as MergeConflict[]).length
      return count
        ? [{ volunteer: kept, detail: count === 1 ? '1 detail' : `${count} details` }]
        : []
    })
  },
}

const confirmLocation: Kind = {
  find: async (volunteer) =>
    volunteer.locationConfirmedAt ? [] : [{ kind: 'confirm_location', id: 'confirm_location' }],
  outstanding: async () =>
    (
      await prisma.volunteer.findMany({
        where: { deletedAt: null, locationConfirmedAt: null },
        select: PERSON,
        orderBy: { name: 'asc' },
      })
    ).map((volunteer) => ({ volunteer, detail: null })),
}

/** An approved volunteer in the holding pool, who may join any chapter. */
const chooseChapter: Kind = {
  find: async (volunteer) =>
    volunteer.nationalChapterId === null && volunteer.approvalStatus === ApprovalStatus.approved
      ? [{ kind: 'choose_chapter', id: 'choose_chapter' }]
      : [],
  outstanding: async () => {
    const countries = await listCountries()
    return (
      await prisma.volunteer.findMany({
        where: {
          deletedAt: null,
          nationalChapterId: null,
          approvalStatus: ApprovalStatus.approved,
        },
        select: { ...PERSON, country: true },
        orderBy: { name: 'asc' },
      })
    ).map(({ country, ...volunteer }) => ({
      volunteer,
      detail: country ? countryName(countries, country) : 'No country given',
    }))
  },
}

/** Every kind, the most pressing first. */
export const REQUIRED_ACTION_KINDS: Record<RequiredActionKind, Kind> = {
  merge_account: mergeAccount,
  reconcile_profile: reconcileProfile,
  confirm_location: confirmLocation,
  choose_chapter: chooseChapter,
}

/** Every action waiting on `volunteer`, the most pressing first. */
export async function requiredActionsFor(volunteer: Volunteer): Promise<RequiredAction[]> {
  const kinds = Object.values(REQUIRED_ACTION_KINDS)
  return (await Promise.all(kinds.map((k) => k.find(volunteer)))).flat()
}

/** Who has each kind of action waiting, for global admins. */
export async function outstandingActions() {
  return Promise.all(
    (Object.keys(REQUIRED_ACTION_KINDS) as RequiredActionKind[]).map(async (kind) => ({
      kind,
      people: await REQUIRED_ACTION_KINDS[kind].outstanding(),
    })),
  )
}
