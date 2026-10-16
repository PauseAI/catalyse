/**
 * What a signed-in person may do across national chapters. A global admin (an address in
 * ADMIN_EMAILS) runs every chapter and the holding pool. A chapter's lead and deputies run
 * their own chapter: everything an admin does there, except that only the lead appoints
 * deputies and only a global admin appoints the lead. Everyone else is a member of one chapter,
 * or of the pool when `chapterId` is null, and sees only that.
 *
 * Pure, so the client can make the same decisions the server does.
 */
export type ChapterRole = 'LEAD' | 'DEPUTY'

export type ChapterAccess = {
  globalAdmin: boolean
  chapterId: number | null
  role: ChapterRole | null
}

export const NO_ACCESS: ChapterAccess = { globalAdmin: false, chapterId: null, role: null }

export const isStaff = (access: ChapterAccess) => access.role !== null

/** Whether `access` holds admin powers over things in `chapterId` (null: the holding pool). */
export function canAdminChapter(access: ChapterAccess, chapterId: number | null): boolean {
  if (access.globalAdmin) return true
  return access.role !== null && chapterId !== null && access.chapterId === chapterId
}

export function canAppointDeputies(access: ChapterAccess, chapterId: number | null): boolean {
  if (access.globalAdmin) return true
  return access.role === 'LEAD' && chapterId !== null && access.chapterId === chapterId
}

/** Whether something in `chapterId` is visible to `access`; pool members see the pool. */
export function inChapter(access: ChapterAccess, chapterId: number | null): boolean {
  return access.globalAdmin || access.chapterId === chapterId
}

/**
 * The volunteer as the many `isAdmin` checks should see them when acting on something in
 * `chapterId`: an admin there, whether as global admin or as that chapter's staff.
 */
export function actingOn<V extends { isAdmin: boolean | null }>(
  volunteer: V,
  access: ChapterAccess,
  chapterId: number | null,
): V {
  return { ...volunteer, isAdmin: canAdminChapter(access, chapterId) }
}

/** What the admin area is called for someone who has one: global, or their own chapter's. */
export function adminAreaName(
  access: ChapterAccess,
  chapter: { name: string } | null,
): string | null {
  if (access.globalAdmin) return 'Global admin'
  return access.role !== null && chapter ? `${chapter.name} chapter admin` : null
}
