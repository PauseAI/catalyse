import { prisma } from './prisma'
import { ContactRequestStatus, InterestStatus, WorkItemType } from '@/generated/prisma/enums'

/**
 * Who may see whose contact details and message whom.
 *
 * People who work together may: a project's owner and everyone on it (accepted helpers and
 * task holders), including those helpers with each other. So may two people once one has
 * accepted the other's contact request. Admins may reach anyone, and everyone sees their own.
 * Anyone else in the directory can be sent a contact request instead.
 */

type Viewer = { id: number; isAdmin: boolean | null }

/** The projects a volunteer owns or is on. */
async function projectIdsOf(volunteerIds: number[]): Promise<Map<number, Set<number>>> {
  const [owned, interests, tasks] = await Promise.all([
    prisma.workItem.findMany({
      where: { type: WorkItemType.PROJECT, assigneeId: { in: volunteerIds } },
      select: { id: true, assigneeId: true },
    }),
    prisma.workItemInterest.findMany({
      where: { volunteerId: { in: volunteerIds }, status: InterestStatus.accepted },
      select: { workItemId: true, volunteerId: true },
    }),
    prisma.workItem.findMany({
      where: {
        type: WorkItemType.TASK,
        assigneeId: { in: volunteerIds },
        parentId: { not: null },
      },
      select: { parentId: true, assigneeId: true },
    }),
  ])
  const byVolunteer = new Map<number, Set<number>>(volunteerIds.map((id) => [id, new Set()]))
  const add = (volunteerId: number | null, projectId: number | null) => {
    if (volunteerId !== null && projectId !== null) byVolunteer.get(volunteerId)?.add(projectId)
  }
  for (const p of owned) add(p.assigneeId, p.id)
  for (const i of interests) add(i.volunteerId, i.workItemId)
  for (const t of tasks) add(t.assigneeId, t.parentId)
  return byVolunteer
}

export interface ContactRelations {
  /** People the viewer may message and whose details they see. */
  reachable: Set<number>
  /** People the viewer has asked to connect with, still unanswered. */
  requested: Set<number>
}

/** The viewer's relation to each of `targetIds`, in a few queries for a whole list. */
export async function contactRelations(
  viewer: Viewer,
  targetIds: number[],
): Promise<ContactRelations> {
  const others = targetIds.filter((id) => id !== viewer.id)
  const reachable = new Set<number>(targetIds.includes(viewer.id) ? [viewer.id] : [])
  const requested = new Set<number>()
  if (others.length === 0) return { reachable, requested }
  if (viewer.isAdmin) {
    for (const id of others) reachable.add(id)
    return { reachable, requested }
  }

  const [projects, requests] = await Promise.all([
    projectIdsOf([viewer.id, ...others]),
    prisma.contactRequest.findMany({
      where: {
        status: { in: [ContactRequestStatus.accepted, ContactRequestStatus.pending] },
        OR: [
          { fromVolunteerId: viewer.id, toVolunteerId: { in: others } },
          { toVolunteerId: viewer.id, fromVolunteerId: { in: others } },
        ],
      },
      select: { fromVolunteerId: true, toVolunteerId: true, status: true },
    }),
  ])
  const mine = projects.get(viewer.id) as Set<number>
  for (const id of others) {
    const theirs = projects.get(id) as Set<number>
    if ([...theirs].some((p) => mine.has(p))) reachable.add(id)
  }
  for (const r of requests) {
    const other = r.fromVolunteerId === viewer.id ? r.toVolunteerId : r.fromVolunteerId
    if (r.status === ContactRequestStatus.accepted) reachable.add(other)
    else if (r.fromVolunteerId === viewer.id) requested.add(other)
  }
  for (const id of reachable) requested.delete(id)
  return { reachable, requested }
}

/** May the viewer see this volunteer's contact details and message them? */
export async function canReach(viewer: Viewer, targetId: number): Promise<boolean> {
  return (await contactRelations(viewer, [targetId])).reachable.has(targetId)
}
