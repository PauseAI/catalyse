import { ORPCError } from '@orpc/server'
import { InterestStatus } from '@/generated/prisma/enums'
import type { ChapterAccess } from './chapter-access'
import {
  can,
  type Permission,
  type ProjectFacts,
  type Resource,
  type Standing,
} from './permissions'
import { prisma } from './prisma'

/**
 * The database half of `can` (lib/permissions.ts): reading where a viewer stands on a project,
 * and refusing a request the viewer has no role for.
 */

/** The `Viewer` a request acts as. */
export const viewerOf = (context: { volunteer: { id: number }; access: ChapterAccess }) => ({
  id: context.volunteer.id,
  access: context.access,
})

/**
 * Is `volunteerId` a member of the project (accepted onto it, or in its team), and a deputy
 * (made one by the owner, and still on it)?
 */
export async function loadStanding(
  project: { id: number; teamId: number | null },
  volunteerId: number,
): Promise<Standing> {
  const [accepted, inTeam, deputy] = await Promise.all([
    prisma.workItemInterest.findFirst({
      where: { workItemId: project.id, volunteerId, status: InterestStatus.accepted },
      select: { id: true },
    }),
    project.teamId === null
      ? null
      : prisma.teamMembership.findUnique({
          where: { teamId_volunteerId: { teamId: project.teamId, volunteerId } },
          select: { id: true },
        }),
    prisma.projectDeputy.findFirst({
      where: { projectId: project.id, volunteerId },
      select: { id: true },
    }),
  ])
  return { member: Boolean(accepted || inTeam), deputy: Boolean(deputy && accepted) }
}

type ProjectRow = ProjectFacts & { id: number; teamId: number | null }

export async function projectResource(
  project: ProjectRow,
  volunteerId: number,
): Promise<Extract<Resource, { type: 'project' }>> {
  return { type: 'project', project, standing: await loadStanding(project, volunteerId) }
}

export async function taskResource(
  project: ProjectRow,
  task: { assigneeId: number | null; creatorId: number | null },
  volunteerId: number,
): Promise<Extract<Resource, { type: 'task' }>> {
  return { type: 'task', project, task, standing: await loadStanding(project, volunteerId) }
}

/** Throws FORBIDDEN with `message` unless `viewer` may. */
export function assertCan(
  viewer: Parameters<typeof can>[0],
  permission: Permission,
  resource: Resource,
  message: string,
): void {
  if (!can(viewer, permission, resource)) throw new ORPCError('FORBIDDEN', { message })
}
