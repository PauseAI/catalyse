import { ORPCError } from '@orpc/server'
import type { Prisma } from '@/generated/prisma/client'
import { ApprovalStatus, ChapterTransferStatus } from '@/generated/prisma/enums'
import { prisma } from './prisma'
import {
  CONSENT_FIELDS,
  MERGE_FIELDS,
  type MergeConflict,
  type MergeField,
  type MergeValue,
} from './account-merge-fields'

type Tx = Prisma.TransactionClient

/**
 * What a merge does with each column that references `volunteers.id`, keyed `table.column`:
 * - `move` points the merged account's rows at the kept account. A row that would then repeat
 *   one the kept account already has, by any unique index, is dropped instead.
 * - `delete` drops the merged account's rows (credentials, and requests the merge settles).
 * - `keep` leaves them on the merged account.
 * - `refuse` stops the merge while the merged account has any: a chapter role must be handed to
 *   the kept account first, since staff belong to the chapter they serve.
 * - `pairs` is the distinct-account pair table, whose lower id comes first.
 *
 * A reference missing from this map stops every merge, and `account-merge.test.ts` fails on it.
 */
export const MERGE_REFERENCES = {
  'account_merge_requests.other_id': 'delete',
  'account_merge_requests.requester_id': 'delete',
  'account_merges.kept_id': 'move',
  'api_tokens.volunteer_id': 'delete',
  'account_merges.merged_id': 'keep',
  'admin_invites.accepted_by_id': 'move',
  'admin_invites.invited_by_id': 'move',
  'admin_notes.author_id': 'move',
  'admin_notes.volunteer_id': 'move',
  'bug_report_comments.author_id': 'move',
  'bug_reports.assignee_id': 'move',
  'bug_reports.reporter_id': 'move',
  'bug_reports.resolved_by_id': 'move',
  'chapter_audit_events.actor_id': 'move',
  'chapter_audit_events.target_volunteer_id': 'move',
  'chapter_deputies.appointed_by_id': 'move',
  'chapter_deputies.volunteer_id': 'refuse',
  'chapter_transfer_requests.decided_by_id': 'move',
  'chapter_transfer_requests.volunteer_id': 'move',
  'contact_messages.from_volunteer_id': 'move',
  'contact_messages.to_volunteer_id': 'move',
  'contact_requests.from_volunteer_id': 'move',
  'contact_requests.to_volunteer_id': 'move',
  'distinct_account_pairs.dismissed_by_id': 'move',
  'distinct_account_pairs.volunteer_a_id': 'pairs',
  'distinct_account_pairs.volunteer_b_id': 'pairs',
  'email_verification_tokens.volunteer_id': 'delete',
  'finish_by_reminders.recipient_id': 'move',
  'local_group_suggestions.reviewed_by_id': 'move',
  'local_group_suggestions.suggested_by_id': 'move',
  'national_chapters.lead_id': 'refuse',
  'notifications.volunteer_id': 'move',
  'password_reset_tokens.volunteer_id': 'delete',
  // The kept account's own picture wins over the merged one's.
  'profile_pictures.volunteer_id': 'move',
  'project_deputies.appointed_by_id': 'move',
  'project_deputies.volunteer_id': 'move',
  'project_review_requests.requested_by_id': 'move',
  'sessions.volunteer_id': 'delete',
  'skill_endorsements.endorsed_by_id': 'move',
  'skill_endorsements.volunteer_id': 'move',
  'team_join_requests.reviewed_by_id': 'move',
  'team_join_requests.volunteer_id': 'move',
  'team_memberships.volunteer_id': 'move',
  'team_suggestions.reviewed_by_id': 'move',
  'team_suggestions.suggested_by_id': 'move',
  'templates.created_by_id': 'move',
  'volunteer_skills.volunteer_id': 'move',
  'volunteers.duplicate_of_id': 'move',
  'volunteers.merged_into_id': 'move',
  'volunteers.reviewer_id': 'move',
  'work_item_comments.author_id': 'move',
  'work_item_dependencies.created_by_id': 'move',
  'work_item_events.actor_id': 'move',
  'work_item_interests.invited_by_id': 'move',
  'work_item_interests.volunteer_id': 'move',
  'work_items.assignee_id': 'move',
  'work_items.creator_id': 'move',
  'work_items.requested_by_id': 'move',
  'work_items.reviewed_by_id': 'move',
  'work_items.stakeholder_id': 'move',
} as const satisfies Record<string, 'move' | 'delete' | 'keep' | 'refuse' | 'pairs'>

type Reference = { table: string; column: string; uniques: string[][] }

/** Every column referencing `volunteers.id`, with the unique indexes it belongs to. */
export async function volunteerReferences(db: Tx | typeof prisma = prisma): Promise<Reference[]> {
  const rows = await db.$queryRaw<{ table: string; column: string; uniques: string[][] | null }[]>`
    SELECT t.relname AS table, a.attname AS column,
      (SELECT json_agg((SELECT json_agg(ia.attname ORDER BY k.ord)
                        FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                        JOIN pg_attribute ia ON ia.attrelid = i.indrelid AND ia.attnum = k.attnum))
       FROM pg_index i
       WHERE i.indrelid = c.conrelid AND i.indisunique AND i.indpred IS NULL
         AND a.attnum = ANY (i.indkey)) AS uniques
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = to_regclass('volunteers')
    ORDER BY 1, 2
  `
  return rows.map((r) => ({ ...r, uniques: r.uniques ?? [] }))
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`

const refused = (message: string) => new ORPCError('BAD_REQUEST', { message })

const blank = (v: unknown) => v === null || v === undefined || v === ''

async function moveReference(tx: Tx, ref: Reference, keptId: number, mergedId: number) {
  const table = ident(ref.table)
  const column = ident(ref.column)
  for (const unique of ref.uniques) {
    const same = unique
      .filter((c) => c !== ref.column)
      .map((c) => `k.${ident(c)} IS NOT DISTINCT FROM m.${ident(c)}`)
    await tx.$executeRawUnsafe(
      `DELETE FROM ${table} m WHERE m.${column} = $2 AND EXISTS (
         SELECT 1 FROM ${table} k WHERE k.${column} = $1 ${same.map((s) => `AND ${s}`).join(' ')})`,
      keptId,
      mergedId,
    )
  }
  await tx.$executeRawUnsafe(
    `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
    keptId,
    mergedId,
  )
}

/** Carries the merged account's distinct-account pairs over to the kept account. */
async function movePairs(tx: Tx, keptId: number, mergedId: number) {
  await tx.$executeRaw`
    INSERT INTO distinct_account_pairs (volunteer_a_id, volunteer_b_id, dismissed_by_id, created_at)
    SELECT least(${keptId}::int, o.other), greatest(${keptId}::int, o.other), o.dismissed_by_id, o.created_at
    FROM (
      SELECT CASE WHEN volunteer_a_id = ${mergedId} THEN volunteer_b_id ELSE volunteer_a_id END AS other,
        dismissed_by_id, created_at
      FROM distinct_account_pairs WHERE ${mergedId} IN (volunteer_a_id, volunteer_b_id)
    ) o
    WHERE o.other <> ${keptId}
    ON CONFLICT DO NOTHING`
  await tx.$executeRaw`
    DELETE FROM distinct_account_pairs WHERE ${mergedId} IN (volunteer_a_id, volunteer_b_id)`
}

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  passwordHash: true,
  emailConfirmed: true,
  deletedAt: true,
  country: true,
  nationalChapterId: true,
  localGroupId: true,
  locationConfirmedAt: true,
  approvalStatus: true,
  createdAt: true,
  lastActiveAt: true,
  ...(Object.fromEntries(MERGE_FIELDS.map((f) => [f, true])) as Record<MergeField, true>),
} as const satisfies Prisma.VolunteerSelect

type Account = Prisma.VolunteerGetPayload<{ select: typeof ACCOUNT_SELECT }>

/**
 * The kept account's profile after the merge: blanks filled from the merged account, and the
 * fields both filled in differently listed as conflicts. Those keep the kept account's value,
 * except a consent, which is withheld until the person chooses.
 */
export function mergeProfiles(kept: Account, merged: Account) {
  const update: Prisma.VolunteerUpdateInput = {}
  const conflicts: MergeConflict[] = []
  for (const field of MERGE_FIELDS) {
    const k = kept[field] as MergeValue
    const m = merged[field] as MergeValue
    if (blank(m) || k === m) continue
    if (blank(k)) {
      Object.assign(update, { [field]: m })
      continue
    }
    conflicts.push({ field, kept: k, merged: m })
    if (CONSENT_FIELDS.includes(field)) Object.assign(update, { [field]: false })
  }

  // The kept account's chapter stands; one with none takes the merged account's.
  if (!kept.country && merged.country) {
    Object.assign(update, {
      country: merged.country,
      chapter: merged.nationalChapterId ? { connect: { id: merged.nationalChapterId } } : undefined,
      group: merged.localGroupId ? { connect: { id: merged.localGroupId } } : undefined,
      locationConfirmedAt: merged.locationConfirmedAt,
    })
  } else if (kept.country === merged.country) {
    if (!kept.localGroupId && merged.localGroupId) {
      update.group = { connect: { id: merged.localGroupId } }
    }
    if (!kept.locationConfirmedAt && merged.locationConfirmedAt) {
      update.locationConfirmedAt = merged.locationConfirmedAt
    }
  }

  if (
    merged.approvalStatus === ApprovalStatus.approved &&
    kept.approvalStatus !== ApprovalStatus.approved
  ) {
    update.approvalStatus = ApprovalStatus.approved
    update.rejectedAt = null
  }
  if (merged.createdAt && (!kept.createdAt || merged.createdAt < kept.createdAt)) {
    update.createdAt = merged.createdAt
  }
  if (merged.lastActiveAt && (!kept.lastActiveAt || merged.lastActiveAt > kept.lastActiveAt)) {
    update.lastActiveAt = merged.lastActiveAt
  }
  return { update, conflicts }
}

/** Whether two addresses are one mailbox, differing only in case. */
export function sameMailbox(a: string | null, b: string | null) {
  return !!a && a.toLowerCase() === b?.toLowerCase()
}

/**
 * The account whose address and password the kept one signs in with after a merge: the
 * person's pick, unless only one of them can be signed in with. Sign-in lowercases the address
 * it looks up, so of one mailbox in two cases only the lowercase one ever worked.
 */
function signInSource(kept: Account, merged: Account, signInWith: 'kept' | 'merged') {
  if (!kept.email) return merged
  if (sameMailbox(kept.email, merged.email)) {
    return kept.email === kept.email.toLowerCase() ? kept : merged
  }
  return signInWith === 'merged' ? merged : kept
}

const describe = (v: { id: number; name: string; email: string | null }) =>
  `${v.name} (${v.email ?? `#${v.id}`})`

/**
 * Folds `mergedId` into `keptId`: everything that references the merged account moves to the
 * kept one (see MERGE_REFERENCES), the kept profile fills its blanks from the merged one, and
 * the merged account is deleted, with `mergedIntoId` pointing at the account it became. The
 * kept account signs in with the address and password of `signInWith` (see signInSource),
 * lowercased; the deleted one holds the other address, so nobody signs up with it again. Refuses while the merged account holds a
 * chapter role.
 */
export async function mergeAccounts(
  keptId: number,
  mergedId: number,
  actorId: number,
  signInWith: 'kept' | 'merged' = 'kept',
) {
  if (keptId === mergedId) throw refused('An account cannot be merged into itself')
  return prisma.$transaction(
    async (tx) => {
      // Locked, so two merges of the same accounts cannot interleave.
      await tx.$queryRaw`SELECT id FROM volunteers WHERE id IN (${keptId}, ${mergedId}) FOR UPDATE`
      const [kept, merged] = await Promise.all(
        [keptId, mergedId].map((id) =>
          tx.volunteer.findUnique({ where: { id }, select: ACCOUNT_SELECT }),
        ),
      )
      if (!kept || kept.deletedAt || !merged || merged.deletedAt) {
        throw new ORPCError('NOT_FOUND', { message: 'Account not found' })
      }

      const references = await volunteerReferences(tx)
      const policyOf = (ref: Reference) =>
        (MERGE_REFERENCES as Record<string, string>)[`${ref.table}.${ref.column}`]
      const unknown = references.filter((r) => !policyOf(r))
      if (unknown.length) {
        throw new Error(
          `No merge policy for ${unknown.map((r) => `${r.table}.${r.column}`).join(', ')}`,
        )
      }

      for (const ref of references.filter((r) => policyOf(r) === 'refuse')) {
        const [{ count }] = await tx.$queryRawUnsafe<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM ${ident(ref.table)} WHERE ${ident(ref.column)} = $1`,
          mergedId,
        )
        if (count) {
          throw refused(
            'The account being merged in holds a chapter role. A global admin must give the role to the account being kept first.',
          )
        }
      }

      // Only one transfer request may wait at a time.
      const keptWaiting = await tx.chapterTransferRequest.count({
        where: { volunteerId: keptId, status: ChapterTransferStatus.pending },
      })
      if (keptWaiting) {
        await tx.chapterTransferRequest.updateMany({
          where: { volunteerId: mergedId, status: ChapterTransferStatus.pending },
          data: { status: ChapterTransferStatus.cancelled },
        })
      }

      await movePairs(tx, keptId, mergedId)
      for (const ref of references) {
        const policy = policyOf(ref)
        if (policy === 'move') await moveReference(tx, ref, keptId, mergedId)
        if (policy === 'delete') {
          await tx.$executeRawUnsafe(
            `DELETE FROM ${ident(ref.table)} WHERE ${ident(ref.column)} = $1`,
            mergedId,
          )
        }
      }
      // A mark either way between the two accounts would now point the kept one at itself.
      await tx.volunteer.updateMany({
        where: { id: keptId, duplicateOfId: keptId },
        data: { duplicateOfId: null },
      })

      const { update, conflicts } = mergeProfiles(kept, merged)
      const source = signInSource(kept, merged, signInWith)
      const signInEmail = source.email?.toLowerCase() ?? null
      // Freed first, as addresses are unique.
      await tx.volunteer.update({ where: { id: mergedId }, data: { email: null } })
      Object.assign(update, {
        email: signInEmail,
        emailConfirmed: source.emailConfirmed,
        passwordHash: source.passwordHash,
      })
      await tx.volunteer.update({ where: { id: keptId }, data: update })
      const other = source === kept ? merged : kept
      await tx.volunteer.update({
        where: { id: mergedId },
        data: {
          // The same mailbox is the live account's already.
          email: sameMailbox(kept.email, merged.email) ? null : other.email,
          emailConfirmed: other.emailConfirmed,
          mergedIntoId: keptId,
          duplicateOfId: null,
          deletedAt: new Date(),
          passwordHash: null,
          authToken: null,
          authTokenExpiresAt: null,
        },
      })
      const merge = await tx.accountMerge.create({
        data: { keptId, mergedId, conflicts },
      })
      await tx.adminNote.createMany({
        data: [
          {
            volunteerId: keptId,
            authorId: actorId,
            content: `Merged ${describe(merged)} into this account.`,
          },
          {
            volunteerId: mergedId,
            authorId: actorId,
            content: `Merged into ${describe(kept)}.`,
          },
        ],
      })
      return { merge, kept, merged, signInEmail }
    },
    { timeout: 30_000 },
  )
}
