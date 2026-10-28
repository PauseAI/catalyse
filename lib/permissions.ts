import { ProjectStatus } from '@/generated/prisma/enums'
import { staffRoleIn, type ChapterAccess } from './chapter-access'

/**
 * Who may do what, as data. A permission names one thing a person may do; a role is a standing
 * someone holds over a resource (the platform, a chapter, a project, a task) and grants a set of
 * permissions there. `can` asks whether any role the viewer holds over a resource grants the
 * permission, so a new role or a change to what one may do is an edit to `ROLES`, not to the
 * routers.
 *
 * Roles decide who. What state a resource must be in (a locked project takes no edits, an owner
 * picks only some statuses) stays with the code that changes it.
 *
 * Pure, so a page can ask the same question the server does.
 */

export type Scope = 'global' | 'chapter' | 'project' | 'task'

type PermissionInfo = { scope: Scope; summary: string }

export const PERMISSIONS = {
  'project.unlimitedDrafts': {
    scope: 'chapter',
    summary: 'Keep any number of project drafts',
  },
  'project.edit': {
    scope: 'project',
    summary: 'Edit its title, description, skills, place and other details',
  },
  'project.manage': {
    scope: 'project',
    summary:
      'Run it: change its owner, team, deadline, timeline and review rule; plan its schedule, baseline and dependencies; set the key date; export and import it',
  },
  'project.changeStatus': {
    scope: 'project',
    summary: 'Move it between In progress, On hold and Completed once it is live',
  },
  'project.changeAnyStatus': {
    scope: 'project',
    summary: 'Give it any status, Archived included, and move a proposal before it is triaged',
  },
  'project.delete': { scope: 'project', summary: 'Delete it outright' },
  'project.publishDraft': {
    scope: 'project',
    summary: 'Submit or publish a draft, or delete it',
  },
  'project.resubmit': {
    scope: 'project',
    summary: 'Send it back for review once the changes asked for are made',
  },
  'project.seeChangeRequests': {
    scope: 'project',
    summary: 'Read the changes admins have asked for',
  },
  'project.recruit': {
    scope: 'project',
    summary: 'See and answer applications, invite volunteers and take people off it',
  },
  'project.addMember': {
    scope: 'project',
    summary: 'Put a volunteer on it without asking them',
  },
  'project.appointDeputies': {
    scope: 'project',
    summary: 'Make a member a deputy, or stop them being one',
  },
  'task.create': { scope: 'project', summary: 'Add a task' },
  'task.manage': {
    scope: 'project',
    summary:
      'Edit, reorder, link and reschedule its tasks, review and reopen them, add helpers, and see a hidden timeline',
  },
  'task.assign': {
    scope: 'project',
    summary: 'Give a task to anyone, themselves included, without asking',
  },
  'task.delete': { scope: 'task', summary: 'Delete the task' },
  'task.work': { scope: 'task', summary: 'Start the task and hand in the work' },
  'task.removeHelper': { scope: 'task', summary: 'Take a helper off the task' },
} as const satisfies Record<string, PermissionInfo>

export type Permission = keyof typeof PERMISSIONS

type RoleInfo = {
  scope: Scope
  name: string
  /** Who holds it, said as the admin view says it. */
  heldBy: string
  grants: readonly Permission[]
}

/** What an admin may do to a project in their care. */
const PROJECT_ADMIN: readonly Permission[] = [
  'project.unlimitedDrafts',
  'project.edit',
  'project.manage',
  'project.changeStatus',
  'project.changeAnyStatus',
  'project.delete',
  'project.publishDraft',
  'project.seeChangeRequests',
  'project.recruit',
  'project.addMember',
  'project.appointDeputies',
  'task.create',
  'task.manage',
  'task.assign',
  'task.delete',
  'task.removeHelper',
]

export const ROLES = {
  globalAdmin: {
    scope: 'global',
    name: 'Global admin',
    heldBy: 'An address listed in ADMIN_EMAILS, over every chapter and the holding pool',
    grants: PROJECT_ADMIN,
  },
  chapterLead: {
    scope: 'chapter',
    name: 'Chapter lead',
    heldBy: 'The lead of a national chapter, over its projects',
    grants: PROJECT_ADMIN,
  },
  chapterDeputy: {
    scope: 'chapter',
    name: 'Chapter deputy',
    heldBy: 'A deputy of a national chapter, over its projects',
    grants: PROJECT_ADMIN,
  },
  projectOwner: {
    scope: 'project',
    name: 'Project owner',
    heldBy: 'The volunteer who leads the project',
    grants: [
      'project.edit',
      'project.manage',
      'project.changeStatus',
      'project.resubmit',
      'project.seeChangeRequests',
      'project.recruit',
      'project.appointDeputies',
      'task.create',
      'task.manage',
      'task.assign',
      'task.delete',
      'task.removeHelper',
    ],
  },
  draftProposer: {
    scope: 'project',
    name: 'Draft proposer',
    heldBy: 'Whoever created a project still in draft, which has no owner yet',
    grants: [
      'project.edit',
      'project.manage',
      'project.publishDraft',
      'project.resubmit',
      'project.seeChangeRequests',
      'task.create',
      'task.manage',
      'task.delete',
      'task.removeHelper',
    ],
  },
  proposer: {
    scope: 'project',
    name: 'Proposer',
    heldBy: 'Whoever created the project',
    grants: ['project.edit', 'project.resubmit', 'project.seeChangeRequests'],
  },
  projectDeputy: {
    scope: 'project',
    name: 'Project deputy',
    heldBy: 'A member the owner has made a deputy',
    grants: ['task.create', 'task.manage', 'task.assign', 'task.delete', 'task.removeHelper'],
  },
  projectMember: {
    scope: 'project',
    name: 'Project member',
    heldBy: 'A volunteer accepted onto the project, or a member of its team',
    grants: ['task.create'],
  },
  taskHolder: {
    scope: 'task',
    name: 'Task holder',
    heldBy: 'Whoever the task is assigned to',
    grants: ['task.work', 'task.removeHelper'],
  },
  taskCreator: {
    scope: 'task',
    name: 'Task creator',
    heldBy: 'Whoever added the task',
    grants: ['task.delete'],
  },
} as const satisfies Record<string, RoleInfo>

export type Role = keyof typeof ROLES

/** The person asking: who they are, and which chapter powers they hold. */
export type Viewer = { id: number; access: ChapterAccess }

export type ProjectFacts = {
  nationalChapterId: number | null
  assigneeId: number | null
  creatorId: number | null
  status: string
}

/** What the database says about the viewer on a project; `loadStanding` reads it. */
export type Standing = { deputy: boolean; member: boolean }

/** For a question that no role resting on standing could answer yes to. */
export const NO_STANDING: Standing = { deputy: false, member: false }

/** Whether a role held by standing grants `permission`; when none does, standing need not be read. */
export const restsOnStanding = (permission: Permission) =>
  (['projectDeputy', 'projectMember'] as const).some((role) =>
    (ROLES[role].grants as readonly Permission[]).includes(permission),
  )

export type Resource =
  | { type: 'global' }
  | { type: 'chapter'; chapterId: number | null }
  | { type: 'project'; project: ProjectFacts; standing: Standing }
  | {
      type: 'task'
      task: { assigneeId: number | null; creatorId: number | null }
      project: ProjectFacts
      standing: Standing
    }

function chapterRoles(access: ChapterAccess, chapterId: number | null): Role[] {
  const roles: Role[] = access.globalAdmin ? ['globalAdmin'] : []
  const staff = staffRoleIn(access, chapterId)
  if (staff === 'LEAD') roles.push('chapterLead')
  if (staff === 'DEPUTY') roles.push('chapterDeputy')
  return roles
}

function projectRoles(viewer: Viewer, project: ProjectFacts, standing: Standing): Role[] {
  const roles = chapterRoles(viewer.access, project.nationalChapterId)
  if (project.assigneeId === viewer.id) roles.push('projectOwner')
  if (project.creatorId === viewer.id) {
    roles.push(project.status === ProjectStatus.draft ? 'draftProposer' : 'proposer')
  }
  if (standing.deputy) roles.push('projectDeputy')
  if (standing.member) roles.push('projectMember')
  return roles
}

/** Every role `viewer` holds over `resource`, including those over what contains it. */
export function rolesOn(viewer: Viewer, resource: Resource): Role[] {
  switch (resource.type) {
    case 'global':
      return viewer.access.globalAdmin ? ['globalAdmin'] : []
    case 'chapter':
      return chapterRoles(viewer.access, resource.chapterId)
    case 'project':
      return projectRoles(viewer, resource.project, resource.standing)
    case 'task': {
      const roles = projectRoles(viewer, resource.project, resource.standing)
      if (resource.task.assigneeId === viewer.id) roles.push('taskHolder')
      if (resource.task.creatorId === viewer.id) roles.push('taskCreator')
      return roles
    }
  }
}

export function can(viewer: Viewer, permission: Permission, resource: Resource): boolean {
  return rolesOn(viewer, resource).some((role) =>
    (ROLES[role].grants as readonly Permission[]).includes(permission),
  )
}

/** Everything `viewer` may do to `resource`, for a page to show only what will work. */
export function permissionsOn(viewer: Viewer, resource: Resource): Permission[] {
  const held = new Set(rolesOn(viewer, resource).flatMap((role) => ROLES[role].grants))
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => held.has(p))
}
