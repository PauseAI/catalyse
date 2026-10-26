import { prisma } from './prisma'
import { isSuperAdmin } from './auth'
import { canAdminChapter, inChapter, type ChapterAccess } from './chapter-access'
import { contactRelations, projectIdsOf } from './contact'
import {
  InterestStatus,
  TeamJoinRequestStatus,
  TeamMembershipRole,
  WorkItemType,
} from '@/generated/prisma/enums'

/** The interests that still tie a volunteer to a project. */
const LIVE_INTEREST = {
  notIn: [
    InterestStatus.declined,
    InterestStatus.withdrawn,
    InterestStatus.removed,
    InterestStatus.cancelled,
  ],
}

/**
 * Which of `targetIds` the viewer may open the profile of, in a few queries for a whole list.
 *
 * Someone in another chapter is out of sight, unless the two already work together on a project
 * from before chapters. A profile hidden from the public directory is still visible to:
 *  - the volunteer themselves
 *  - a global admin, or the staff of the volunteer's chapter
 *  - the owner of a project the volunteer holds a task on or has a live interest in, and the
 *    leader of a team the volunteer is in or has applied to, so they can assess the volunteer's
 *    skills before accepting them
 *  - anyone who may contact them (lib/contact.ts)
 */
export async function viewableVolunteers(
  viewer: { id: number },
  access: ChapterAccess,
  targetIds: number[],
): Promise<Set<number>> {
  const ids = [...new Set(targetIds)]
  const rows = await prisma.volunteer.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, nationalChapterId: true, consentMakeProfileVisibleInDirectory: true },
  })
  const viewable = new Set<number>()
  const others = rows.filter((v) => {
    if (v.id === viewer.id) viewable.add(v.id)
    return v.id !== viewer.id
  })
  if (others.length === 0) return viewable

  const outside = others.filter((v) => !inChapter(access, v.nationalChapterId)).map((v) => v.id)
  const projects = outside.length > 0 ? await projectIdsOf([viewer.id, ...outside]) : null
  const inSight = others.filter((v) => {
    if (inChapter(access, v.nationalChapterId)) return true
    const mine = projects?.get(viewer.id) as Set<number>
    return [...(projects?.get(v.id) as Set<number>)].some((p) => mine.has(p))
  })

  const hidden: number[] = []
  for (const v of inSight) {
    if (v.consentMakeProfileVisibleInDirectory || canAdminChapter(access, v.nationalChapterId)) {
      viewable.add(v.id)
    } else hidden.push(v.id)
  }
  if (hidden.length === 0) return viewable

  const ownedProject = { type: WorkItemType.PROJECT, assigneeId: viewer.id }
  const ledTeam = {
    members: { some: { volunteerId: viewer.id, role: TeamMembershipRole.leader } },
  }
  const [tasks, interests, memberships, joinRequests, relations] = await Promise.all([
    prisma.workItem.findMany({
      where: { type: WorkItemType.TASK, assigneeId: { in: hidden }, parent: ownedProject },
      select: { assigneeId: true },
    }),
    prisma.workItemInterest.findMany({
      where: { volunteerId: { in: hidden }, status: LIVE_INTEREST, workItem: ownedProject },
      select: { volunteerId: true },
    }),
    prisma.teamMembership.findMany({
      where: { volunteerId: { in: hidden }, team: ledTeam },
      select: { volunteerId: true },
    }),
    prisma.teamJoinRequest.findMany({
      where: {
        volunteerId: { in: hidden },
        status: { not: TeamJoinRequestStatus.declined },
        team: ledTeam,
      },
      select: { volunteerId: true },
    }),
    contactRelations(viewer, access, hidden),
  ])
  for (const t of tasks) viewable.add(t.assigneeId as number)
  for (const row of [...interests, ...memberships, ...joinRequests]) viewable.add(row.volunteerId)
  for (const id of hidden) if (relations.reachable.has(id)) viewable.add(id)
  return viewable
}

/** The badge a person carries for running something: the whole platform, or a chapter. */
export type StaffRole = 'admin' | 'lead' | 'deputy'

export type PersonInfo = {
  id: number
  canView: boolean
  role: StaffRole | null
  /** The chapter a lead or deputy runs. */
  chapter: string | null
}

/** What a name shown to the viewer links to and is badged with, for each of `targetIds`. */
export async function peopleInfo(
  viewer: { id: number },
  access: ChapterAccess,
  targetIds: number[],
): Promise<PersonInfo[]> {
  const ids = [...new Set(targetIds)]
  const [viewable, rows] = await Promise.all([
    viewableVolunteers(viewer, access, ids),
    prisma.volunteer.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        email: true,
        emailConfirmed: true,
        isAdmin: true,
        nationalChapterId: true,
        ledChapter: { select: { id: true, name: true } },
        chapterDeputyRole: { select: { chapter: { select: { id: true, name: true } } } },
      },
    }),
  ])
  const byId = new Map(rows.map((v) => [v.id, v]))
  return ids.map((id) => {
    const v = byId.get(id)
    const info: PersonInfo = { id, canView: viewable.has(id), role: null, chapter: null }
    if (!v) return info
    // As in loadAccess, a staff role counts only in the chapter the person belongs to.
    const deputyOf = v.chapterDeputyRole?.chapter
    if (v.isAdmin && isSuperAdmin(v)) info.role = 'admin'
    else if (v.ledChapter && v.ledChapter.id === v.nationalChapterId) {
      info.role = 'lead'
      info.chapter = v.ledChapter.name
    } else if (deputyOf && deputyOf.id === v.nationalChapterId) {
      info.role = 'deputy'
      info.chapter = deputyOf.name
    }
    return info
  })
}
