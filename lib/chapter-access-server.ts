import { Prisma, type Volunteer } from '@/generated/prisma/client'
import { adminEmails, isSuperAdmin } from './auth'
import { NO_ACCESS, type ChapterAccess } from './chapter-access'
import { prisma } from './prisma'

type AccessSubject = Pick<Volunteer, 'id' | 'email' | 'emailConfirmed' | 'isAdmin'>

/**
 * A staff role counts only in the chapter the person belongs to; appointing and transferring
 * keep the two together, and a row that has drifted apart grants nothing.
 */
export async function loadAccess(volunteer: AccessSubject | null): Promise<ChapterAccess> {
  if (!volunteer) return NO_ACCESS
  const row = await prisma.volunteer.findUnique({
    where: { id: volunteer.id },
    select: {
      nationalChapterId: true,
      ledChapter: { select: { id: true } },
      chapterDeputyRole: { select: { nationalChapterId: true } },
    },
  })
  const chapterId = row?.nationalChapterId ?? null
  const role =
    chapterId === null
      ? null
      : row?.ledChapter?.id === chapterId
        ? 'LEAD'
        : row?.chapterDeputyRole?.nationalChapterId === chapterId
          ? 'DEPUTY'
          : null
  return {
    globalAdmin: Boolean(volunteer.isAdmin) && isSuperAdmin(volunteer),
    chapterId,
    role,
  }
}

/** A requested chapter: an id, the holding pool, or (undefined) every chapter. */
export type ChapterSelection = number | 'pool' | undefined

/**
 * The `nationalChapterId` a query matches. Everyone but a global admin is held to their own
 * chapter, whatever they ask for; a global admin gets what they ask for. Undefined matches all.
 */
export function chapterFilter(
  access: ChapterAccess,
  requested?: ChapterSelection,
): number | null | undefined {
  if (!access.globalAdmin) return access.chapterId
  return requested === 'pool' ? null : requested
}

/**
 * A global admin's narrowing of a project list to one chapter or the pool; null when there is
 * none. Everyone else's lists are held to their own chapter by the project scope rule already.
 */
export function chapterNarrowing(
  access: ChapterAccess,
  requested: ChapterSelection,
): { nationalChapterId: number | null } | null {
  if (!access.globalAdmin || requested === undefined) return null
  return { nationalChapterId: requested === 'pool' ? null : requested }
}

/** `chapterNarrowing` as a raw SQL condition on `work_items`. */
export function chapterNarrowingSql(
  access: ChapterAccess,
  requested: ChapterSelection,
): Prisma.Sql | null {
  const narrowing = chapterNarrowing(access, requested)
  if (!narrowing) return null
  return narrowing.nationalChapterId === null
    ? Prisma.sql`national_chapter_id IS NULL`
    : Prisma.sql`national_chapter_id = ${narrowing.nationalChapterId}`
}

/** The live accounts of a chapter's lead and deputies. */
export async function chapterStaffIds(chapterId: number): Promise<number[]> {
  const chapter = await prisma.nationalChapter.findUnique({
    where: { id: chapterId },
    select: {
      lead: { select: { id: true, deletedAt: true } },
      deputies: { select: { volunteer: { select: { id: true, deletedAt: true } } } },
    },
  })
  const staff = [chapter?.lead, ...(chapter?.deputies.map((d) => d.volunteer) ?? [])]
  return staff.flatMap((s) => (s && !s.deletedAt ? [s.id] : []))
}

/** The live, confirmed accounts whose address is in ADMIN_EMAILS. */
export function globalAdminWhere(): Prisma.VolunteerWhereInput {
  return {
    deletedAt: null,
    emailConfirmed: true,
    OR: adminEmails().map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })),
  }
}
