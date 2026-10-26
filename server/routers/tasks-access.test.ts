import { beforeAll, describe, expect, it } from 'vitest'
import {
  ADMINS,
  PERSONAS,
  clientFor,
  expectAccess,
  makePeople,
  makeWorld,
  outcome,
  type People,
  type Persona,
} from '@/test/access-matrix'

// Who may do what to a project's tasks, for every kind of person: see test/access-matrix.ts.

let people: People
beforeAll(async () => {
  people = await makePeople()
})

const RUNNERS = [...ADMINS, 'owner', 'projectDeputy'] as const
const MEMBERS = ['projectDeputy', 'member', 'taskAssignee'] as const
const draft = { status: 'draft' }

describe('the tasks of a running project', () => {
  it('are added by its admins, owner and members', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner', ...MEMBERS],
      attempt: (as, w) => as.projects.createTask({ projectId: w.project.id, title: 'More' }),
    }))

  it('are edited by its admins, owner and deputies', () =>
    expectAccess(people, {
      allowed: RUNNERS,
      attempt: (as, w) =>
        as.projects.updateTask({
          projectId: w.project.id,
          taskId: w.tasks.open.id,
          data: { title: 'Renamed' },
        }),
    }))

  it('are made the key date by its admins or owner, not a deputy', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: (as, w) =>
        as.projects.updateTask({
          projectId: w.project.id,
          taskId: w.tasks.open.id,
          data: { isAnchor: true },
        }),
    }))

  it('are handed to someone by its admins, owner and deputies', () =>
    expectAccess(people, {
      allowed: RUNNERS,
      attempt: (as, w, p) =>
        as.projects.assignTask({
          projectId: w.project.id,
          taskId: w.tasks.open.id,
          assigneeId: p.member.id,
        }),
    }))

  it('are taken by anyone who can see them: members at once, others by asking', () =>
    expectAccess(people, {
      allowed: [...RUNNERS, 'member', 'taskAssignee'],
      others: {
        adminViewingAsVolunteer: 'NOT_FOUND',
        otherChapterLead: 'NOT_FOUND',
        proposer: 'requested',
        stranger: 'requested',
      },
      attempt: async (as, w) => {
        const me = await as.auth.me()
        const result = await as.projects.updateTask({
          projectId: w.project.id,
          taskId: w.tasks.open.id,
          data: { assigneeId: me.id },
        })
        return result.requested ? 'requested' : 'ok'
      },
    }))

  it('are reordered by its admins, owner and deputies', () =>
    expectAccess(people, {
      allowed: RUNNERS,
      attempt: (as, w) =>
        as.projects.reorderTasks({
          projectId: w.project.id,
          items: [{ id: w.tasks.open.id, sortOrder: 9 }],
        }),
    }))

  it('are linked by its admins, owner and deputies', () =>
    expectAccess(people, {
      allowed: RUNNERS,
      attempt: (as, w) =>
        as.dependencies.add({ predecessorId: w.tasks.open.id, successorId: w.tasks.mine.id }),
    }))

  it('are rescheduled by a global admin, its owner and deputies', () =>
    expectAccess(people, {
      allowed: ['globalAdmin', 'owner', 'projectDeputy'],
      attempt: (as, w) =>
        as.schedule.rescheduleItems({
          items: [{ id: w.tasks.open.id, startDate: new Date('2030-01-01T00:00:00Z') }],
        }),
    }))

  it('are reviewed by its admins, owner and deputies', async () => {
    await expectAccess(people, {
      allowed: RUNNERS,
      attempt: (as, w) =>
        as.projects.acceptTask({ projectId: w.project.id, taskId: w.tasks.submitted.id }),
    })
    await expectAccess(people, {
      allowed: RUNNERS,
      attempt: (as, w) =>
        as.projects.requestTaskChanges({
          projectId: w.project.id,
          taskId: w.tasks.submitted.id,
          message: 'Once more',
        }),
    })
    await expectAccess(people, {
      allowed: RUNNERS,
      attempt: (as, w) =>
        as.projects.reopenTask({ projectId: w.project.id, taskId: w.tasks.done.id }),
    })
  })

  it('are deleted by its admins, owner and deputies, and by whoever added them', async () => {
    await expectAccess(people, {
      allowed: RUNNERS,
      attempt: (as, w) =>
        as.projects.deleteTask({ projectId: w.project.id, taskId: w.tasks.open.id }),
    })
    await expectAccess(people, {
      allowed: [...RUNNERS, 'member'],
      attempt: (as, w) =>
        as.projects.deleteTask({ projectId: w.project.id, taskId: w.tasks.mine.id }),
    })
  })

  it('are started and handed in only by whoever holds them', async () => {
    await expectAccess(people, {
      allowed: ['taskAssignee'],
      attempt: (as, w) =>
        as.projects.startTask({ projectId: w.project.id, taskId: w.tasks.held.id }),
    })
    await expectAccess(people, {
      allowed: ['taskAssignee'],
      attempt: (as, w) =>
        as.projects.submitTask({ projectId: w.project.id, taskId: w.tasks.held.id, note: 'Done' }),
    })
  })

  it('gain helpers from its admins, owner and deputies', () =>
    expectAccess(people, {
      allowed: RUNNERS,
      attempt: (as, w, p) =>
        as.projects.addTaskHelper({
          projectId: w.project.id,
          taskId: w.tasks.helping.id,
          volunteerId: p.projectDeputy.id,
        }),
    }))

  it('lose helpers at the say of their lead, or its admins, owner and deputies', () =>
    expectAccess(people, {
      allowed: [...RUNNERS, 'taskAssignee'],
      attempt: (as, w) =>
        as.projects.respondToInterest({
          projectId: w.project.id,
          taskId: w.tasks.helping.id,
          interestId: w.helperInterestId,
          status: 'declined',
        }),
    }))

  it('keep a hidden timeline to its admins, owner and deputies', () =>
    expectAccess(people, {
      world: { showTimeline: false },
      allowed: RUNNERS,
      others: { adminViewingAsVolunteer: 'NOT_FOUND', otherChapterLead: 'NOT_FOUND' },
      attempt: (as, w) => as.projects.listTasks({ projectId: w.project.id }),
    }))
})

describe('the tasks of a draft', () => {
  it('are added and edited by its admins and proposer', async () => {
    await expectAccess(people, {
      world: draft,
      allowed: [...ADMINS, 'proposer'],
      attempt: (as, w) => as.projects.createTask({ projectId: w.project.id, title: 'More' }),
    })
    await expectAccess(people, {
      world: draft,
      allowed: [...ADMINS, 'proposer'],
      attempt: (as, w) =>
        as.projects.updateTask({
          projectId: w.project.id,
          taskId: w.tasks.open.id,
          data: { title: 'Renamed' },
        }),
    })
  })

  it('are handed to someone by its admins', () =>
    expectAccess(people, {
      world: draft,
      allowed: ADMINS,
      attempt: (as, w, p) =>
        as.projects.assignTask({
          projectId: w.project.id,
          taskId: w.tasks.open.id,
          assigneeId: p.proposer.id,
        }),
    }))
})

describe('what a task page tells each person they may do', () => {
  it('matches what the server lets them do', async () => {
    const seen: Partial<Record<Persona, unknown>> = {}
    for (const persona of PERSONAS) {
      const world = await makeWorld(people)
      const found = await outcome(async () => {
        const t = await clientFor(people, persona).projects.getTask({
          projectId: world.project.id,
          taskId: world.tasks.helping.id,
        })
        seen[persona] = {
          viewerCanAdmin: t.viewerCanAdmin,
          canManage: t.canManage,
          canSetKeyDate: t.canSetKeyDate,
          canRemoveHelpers: t.canRemoveHelpers,
          canClaim: t.canClaim,
        }
      })
      if (found !== 'ok') seen[persona] = found
    }
    const page = (
      viewerCanAdmin: boolean,
      canManage: boolean,
      canSetKeyDate: boolean,
      canRemoveHelpers: boolean,
    ) => ({ viewerCanAdmin, canManage, canSetKeyDate, canRemoveHelpers, canClaim: true })
    const admin = page(true, true, true, true)
    expect(seen).toEqual({
      globalAdmin: admin,
      adminViewingAsVolunteer: 'NOT_FOUND',
      chapterLead: admin,
      chapterDeputy: admin,
      otherChapterLead: 'NOT_FOUND',
      owner: page(false, true, true, true),
      proposer: page(false, false, false, false),
      projectDeputy: page(false, true, false, true),
      member: page(false, false, false, false),
      taskAssignee: page(false, false, false, true),
      stranger: page(false, false, false, false),
    })
  })
})
