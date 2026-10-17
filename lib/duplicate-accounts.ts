import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

/** Why two accounts look like the same person. */
export type DuplicateReason = 'name' | 'discord' | 'phone'

/** The shortest phone number compared, so a stray digit or two never makes a match. */
const MIN_PHONE_DIGITS = 7

/**
 * Pairs of live accounts that look like one person: the same name once case, accents and
 * spacing are set aside, the same Discord handle, or the same Signal or WhatsApp number. An
 * account already marked as a duplicate, and a pair a global admin has said are two people, are
 * left out. With `volunteerId`, only that account's pairs.
 */
export async function findDuplicatePairs(volunteerId?: number) {
  const only = volunteerId ? Prisma.sql`WHERE ${volunteerId} IN (m.a_id, m.b_id)` : Prisma.empty
  const rows = await prisma.$queryRaw<{ a_id: number; b_id: number; reasons: DuplicateReason[] }[]>`
    WITH live AS (
      SELECT id,
        lower(public.unaccent(regexp_replace(btrim(name), '\\s+', ' ', 'g'))) AS name_key,
        NULLIF(lower(btrim(COALESCE(discord_handle, ''))), '') AS discord_key
      FROM volunteers
      WHERE deleted_at IS NULL AND duplicate_of_id IS NULL
    ),
    phones AS (
      SELECT DISTINCT live.id, regexp_replace(p.number, '\\D', '', 'g') AS phone
      FROM live
      JOIN volunteers v ON v.id = live.id
      CROSS JOIN LATERAL (VALUES (v.signal_number), (v.whatsapp_number)) AS p(number)
      WHERE length(regexp_replace(COALESCE(p.number, ''), '\\D', '', 'g')) >= ${MIN_PHONE_DIGITS}
    ),
    matches AS (
      SELECT a.id AS a_id, b.id AS b_id, 'name' AS reason
        FROM live a JOIN live b ON a.name_key = b.name_key AND a.id < b.id
      UNION ALL
      SELECT a.id, b.id, 'discord'
        FROM live a JOIN live b ON a.discord_key = b.discord_key AND a.id < b.id
      UNION ALL
      SELECT a.id, b.id, 'phone'
        FROM phones a JOIN phones b ON a.phone = b.phone AND a.id < b.id
    )
    SELECT m.a_id, m.b_id, array_agg(DISTINCT m.reason ORDER BY m.reason) AS reasons
    FROM matches m
    ${only}
    GROUP BY m.a_id, m.b_id
    HAVING NOT EXISTS (
      SELECT 1 FROM distinct_account_pairs d
      WHERE d.volunteer_a_id = m.a_id AND d.volunteer_b_id = m.b_id
    )
    ORDER BY m.a_id, m.b_id
  `
  const accounts = await prisma.volunteer.findMany({
    where: { id: { in: rows.flatMap((r) => [r.a_id, r.b_id]) } },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      chapter: { select: { name: true } },
      ledChapter: { select: { name: true } },
      chapterDeputyRole: { select: { chapter: { select: { name: true } } } },
    },
  })
  const byId = new Map(
    accounts.map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name,
        email: a.email,
        createdAt: a.createdAt,
        chapterName: a.chapter?.name ?? null,
        role: a.ledChapter
          ? `Lead of ${a.ledChapter.name}`
          : a.chapterDeputyRole
            ? `Deputy of ${a.chapterDeputyRole.chapter.name}`
            : null,
      },
    ]),
  )
  // An account removed for good between the two queries takes its pairs with it.
  return rows.flatMap((r) => {
    const [a, b] = [byId.get(r.a_id), byId.get(r.b_id)]
    return a && b ? [{ a, b, reasons: r.reasons }] : []
  })
}

/** Records that two accounts are different people, so they are not paired again. */
export async function dismissDuplicatePair(ids: [number, number], dismissedById: number) {
  const [volunteerAId, volunteerBId] = [...ids].sort((x, y) => x - y)
  await prisma.distinctAccountPair.createMany({
    data: [{ volunteerAId, volunteerBId, dismissedById }],
    skipDuplicates: true,
  })
}
