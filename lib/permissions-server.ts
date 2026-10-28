import { ORPCError } from '@orpc/server'
import type { ChapterAccess } from './chapter-access'
import {
  can,
  NO_STANDING,
  restsOnStanding,
  type Permission,
  type ProjectFacts,
  type Resource,
  type Standing,
} from './permissions'
import { isProjectDeputy, resolveProjectMembership } from './work-item'

/**
 * The database half of `can` (lib/permissions.ts): reading where a viewer stands on a project,
 * and refusing a request the viewer has no role for.
 */

/** The `Viewer` a request acts as. */
export const viewerOf = (context: { volunteer: { id: number }; access: ChapterAccess }) => ({
  id: context.volunteer.id,
  access: context.access,
})

/** Where `volunteerId` stands on the project: a member, and a deputy the owner appointed. */
export async function loadStanding(
  project: { id: number; teamId: number | null },
  volunteerId: number,
): Promise<Standing> {
  const [member, deputy] = await Promise.all([
    resolveProjectMembership(project.teamId, project.id, volunteerId),
    isProjectDeputy(project.id, volunteerId),
  ])
  return { member, deputy }
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

type Viewer = Parameters<typeof can>[0]

/** Throws FORBIDDEN with `message` unless `viewer` may. */
export function assertCan(
  viewer: Viewer,
  permission: Permission,
  resource: Resource,
  message: string,
): void {
  if (!can(viewer, permission, resource)) throw new ORPCError('FORBIDDEN', { message })
}

/** `can` for one permission on a project, reading standing only when it could matter. */
export async function canOnProject(
  viewer: Viewer,
  permission: Permission,
  project: ProjectRow,
): Promise<boolean> {
  const standing = restsOnStanding(permission)
    ? await loadStanding(project, viewer.id)
    : NO_STANDING
  return can(viewer, permission, { type: 'project', project, standing })
}

/** `assertCan` for one permission on a project, refusing a missing project the same way. */
export async function assertCanOnProject<P extends ProjectRow>(
  viewer: Viewer,
  permission: Permission,
  project: P | null,
  message: string,
): Promise<P> {
  if (!project || !(await canOnProject(viewer, permission, project))) {
    throw new ORPCError('FORBIDDEN', { message })
  }
  return project
}
