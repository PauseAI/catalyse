import { describe, expect, it } from 'vitest'
import { NO_ACCESS, type ChapterAccess } from './chapter-access'
import {
  NO_STANDING,
  PERMISSIONS,
  ROLES,
  can,
  permissionsOn,
  rolesOn,
  type Permission,
  type ProjectFacts,
  type Resource,
} from './permissions'

const UK = 1
const FRANCE = 2
const project: ProjectFacts = {
  nationalChapterId: UK,
  assigneeId: 2,
  creatorId: 3,
  status: 'in_progress',
}
const on = (overrides: Partial<ProjectFacts> = {}, standing = NO_STANDING): Resource => ({
  type: 'project',
  project: { ...project, ...overrides },
  standing,
})
const volunteer = (id: number, access: Partial<ChapterAccess> = {}) => ({
  id,
  access: { ...NO_ACCESS, chapterId: UK, ...access },
})

describe('rolesOn', () => {
  it('gives a global admin their role everywhere', () => {
    const admin = volunteer(9, { globalAdmin: true, chapterId: null })
    expect(rolesOn(admin, { type: 'global' })).toEqual(['globalAdmin'])
    expect(rolesOn(admin, { type: 'chapter', chapterId: FRANCE })).toEqual(['globalAdmin'])
    expect(rolesOn(admin, on())).toEqual(['globalAdmin'])
  })

  it('gives chapter staff their role in their own chapter only, never in the pool', () => {
    const lead = volunteer(9, { role: 'LEAD' })
    const deputy = volunteer(8, { role: 'DEPUTY' })
    expect(rolesOn(lead, on())).toEqual(['chapterLead'])
    expect(rolesOn(deputy, on())).toEqual(['chapterDeputy'])
    expect(rolesOn(lead, on({ nationalChapterId: FRANCE }))).toEqual([])
    expect(rolesOn(lead, on({ nationalChapterId: null }))).toEqual([])
    expect(
      rolesOn(volunteer(9, { role: 'LEAD', chapterId: null }), on({ nationalChapterId: null })),
    ).toEqual([])
    expect(rolesOn(lead, { type: 'global' })).toEqual([])
  })

  it('reads the project roles from the project and the viewer’s standing on it', () => {
    expect(rolesOn(volunteer(2), on())).toEqual(['projectOwner'])
    expect(rolesOn(volunteer(3), on())).toEqual(['proposer'])
    expect(rolesOn(volunteer(3), on({ status: 'draft' }))).toEqual(['draftProposer'])
    expect(rolesOn(volunteer(5), on({}, { deputy: true, member: true }))).toEqual([
      'projectDeputy',
      'projectMember',
    ])
    expect(rolesOn(volunteer(5), on())).toEqual([])
  })

  it('adds the task roles to the project roles', () => {
    const task: Resource = {
      type: 'task',
      project,
      standing: { deputy: false, member: true },
      task: { assigneeId: 5, creatorId: 5 },
    }
    expect(rolesOn(volunteer(5), task)).toEqual(['projectMember', 'taskHolder', 'taskCreator'])
    expect(rolesOn(volunteer(2), { ...task, standing: NO_STANDING })).toEqual(['projectOwner'])
  })
})

describe('can', () => {
  it('lets the owner, an admin or a draft’s proposer run a project, and nobody else', () => {
    expect(can(volunteer(2), 'project.manage', on())).toBe(true)
    expect(can(volunteer(9, { role: 'DEPUTY' }), 'project.manage', on())).toBe(true)
    expect(can(volunteer(3), 'project.manage', on())).toBe(false)
    expect(can(volunteer(3), 'project.manage', on({ status: 'draft' }))).toBe(true)
    expect(can(volunteer(5), 'project.manage', on({}, { deputy: true, member: true }))).toBe(false)
  })

  it('lets a deputy run the tasks, and a member only add them', () => {
    const deputy = on({}, { deputy: true, member: true })
    const member = on({}, { deputy: false, member: true })
    expect(can(volunteer(5), 'task.manage', deputy)).toBe(true)
    expect(can(volunteer(5), 'task.manage', member)).toBe(false)
    expect(can(volunteer(5), 'task.create', member)).toBe(true)
    expect(can(volunteer(5), 'task.create', on())).toBe(false)
  })

  it('lets a draft’s proposer publish it, and not even an admin', () => {
    const draft = on({ status: 'draft' })
    expect(can(volunteer(3), 'project.publishDraft', draft)).toBe(true)
    expect(can(volunteer(9, { globalAdmin: true }), 'project.publishDraft', draft)).toBe(false)
  })

  it('lets staff keep any number of drafts in their own chapter', () => {
    const ownChapter = { type: 'chapter', chapterId: UK } as const
    expect(can(volunteer(9, { role: 'LEAD' }), 'project.unlimitedDrafts', ownChapter)).toBe(true)
    expect(can(volunteer(5), 'project.unlimitedDrafts', ownChapter)).toBe(false)
  })
})

describe('permissionsOn', () => {
  it('lists what the viewer may do in catalogue order', () => {
    expect(permissionsOn(volunteer(3), on())).toEqual([
      'project.edit',
      'project.resubmit',
      'project.seeChangeRequests',
    ])
    expect(permissionsOn(volunteer(5), on())).toEqual([])
  })
})

describe('the catalogue', () => {
  it('grants only permissions it defines, and every permission to some role', () => {
    const granted = new Set<Permission>(Object.values(ROLES).flatMap((r) => r.grants))
    expect([...granted].filter((p) => !(p in PERMISSIONS))).toEqual([])
    expect(Object.keys(PERMISSIONS).filter((p) => !granted.has(p as Permission))).toEqual([])
  })
})
