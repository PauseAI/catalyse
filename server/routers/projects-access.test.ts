import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  ADMINS,
  PERSONAS,
  clientFor,
  expectAccess,
  makePeople,
  makeWorld,
  outcome,
  type Client,
  type People,
  type Persona,
  type World,
} from '@/test/access-matrix'

// Who may do what to a project, for every kind of person: see test/access-matrix.ts.

let people: People
beforeAll(async () => {
  people = await makePeople()
})

/** The status a project ends up in after `persona` asks for `status`, or the refusal. */
const statusChange = (status: string) => ({
  attempt: async (as: Client, world: World) => {
    await as.projects.update({ id: world.project.id, status: status as never })
    const after = await prisma.workItem.findUniqueOrThrow({ where: { id: world.project.id } })
    return after.status === status ? 'ok' : 'unchanged'
  },
})

describe('a running project', () => {
  it('is edited by its admins, owner and proposer', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner', 'proposer'],
      attempt: (as, w) => as.projects.update({ id: w.project.id, title: 'Renamed' }),
    }))

  it('changes hands only at its admins’ or owner’s say', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: (as, w, p) => as.projects.update({ id: w.project.id, assigneeId: p.newOwner.id }),
    }))

  it('has its deadline set by its admins or owner', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: (as, w) =>
        as.projects.update({ id: w.project.id, deadline: new Date('2030-01-01T00:00:00Z') }),
    }))

  it('is paused by its admins or owner; the proposer’s ask is ignored', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      others: { proposer: 'unchanged' },
      ...statusChange('on_hold'),
    }))

  it('is archived only by its admins', () =>
    expectAccess(people, {
      allowed: ADMINS,
      others: { owner: 'unchanged', proposer: 'unchanged' },
      ...statusChange('archived'),
    }))

  it('is deleted only by its admins', () =>
    expectAccess(people, {
      allowed: ADMINS,
      attempt: (as, w) => as.projects.delete({ id: w.project.id }),
    }))

  it('is re-baselined by its admins or owner', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: (as, w) => as.projects.setBaseline({ projectId: w.project.id }),
    }))

  it('is exported by its admins or owner', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: (as, w) => as.projects.exportPlan({ projectId: w.project.id }),
    }))

  it('is rescheduled by its admins or owner', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: (as, w) =>
        as.schedule.rescheduleItems({
          items: [{ id: w.project.id, startDate: new Date('2030-01-01T00:00:00Z') }],
        }),
    }))
})

describe('the people on a running project', () => {
  it('are invited by its admins or owner', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: (as, w, p) =>
        as.projects.invite({ projectId: w.project.id, volunteerId: p.newcomer.id }),
    }))

  it('have their applications answered by its admins or owner', async () => {
    await expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: async (as, w, p) => {
        const interest = await prisma.workItemInterest.findFirstOrThrow({
          where: { workItemId: w.project.id, volunteerId: p.applicant.id },
        })
        return as.projects.respondToInterest({
          projectId: w.project.id,
          interestId: interest.id,
          status: 'accepted',
        })
      },
    })
  })

  it('have invites taken back by its admins or owner', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: async (as, w, p) => {
        const interest = await prisma.workItemInterest.findFirstOrThrow({
          where: { workItemId: w.project.id, volunteerId: p.invitee.id },
        })
        return as.projects.cancelInvite({ projectId: w.project.id, interestId: interest.id })
      },
    }))

  it('are added unasked only by its admins', () =>
    expectAccess(people, {
      allowed: ADMINS,
      attempt: (as, w, p) =>
        as.projects.assign({ projectId: w.project.id, volunteerId: p.newcomer.id }),
    }))

  it('are made deputies by its admins or owner', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: (as, w, p) =>
        as.projects.appointDeputy({ projectId: w.project.id, volunteerId: p.member.id }),
    }))

  it('stop being deputies at its admins’ or owner’s say', () =>
    expectAccess(people, {
      allowed: [...ADMINS, 'owner'],
      attempt: (as, w, p) =>
        as.projects.removeDeputy({ projectId: w.project.id, volunteerId: p.projectDeputy.id }),
    }))
})

describe('a project sent back for changes', () => {
  it('is resubmitted by its owner or proposer, not its admins', () =>
    expectAccess(people, {
      world: { status: 'needs_discussion' },
      allowed: ['owner', 'proposer'],
      attempt: (as, w) => as.projects.resubmit({ id: w.project.id }),
    }))
})

describe('a draft', () => {
  const draft = { status: 'draft' }

  it('is edited by its admins and proposer', () =>
    expectAccess(people, {
      world: draft,
      allowed: [...ADMINS, 'proposer'],
      attempt: (as, w) => as.projects.update({ id: w.project.id, title: 'Renamed' }),
    }))

  it('is taken on by its proposer, or given to them by its admins', () =>
    expectAccess(people, {
      world: draft,
      allowed: [...ADMINS, 'proposer'],
      attempt: (as, w, p) => as.projects.update({ id: w.project.id, assigneeId: p.proposer.id }),
    }))

  it('is seen by its admins and proposer, and by nobody else', () =>
    expectAccess(people, {
      world: draft,
      allowed: [...ADMINS, 'proposer'],
      denied: 'NOT_FOUND',
      attempt: (as, w) => as.projects.getById({ id: w.project.id }),
    }))

  it('is published or deleted by its proposer, or by its admins when the proposer is gone', async () => {
    await expectAccess(people, {
      world: draft,
      allowed: [...ADMINS, 'proposer'],
      attempt: (as, w) => as.projects.publishDraft({ id: w.project.id }),
    })
    await expectAccess(people, {
      world: draft,
      allowed: [...ADMINS, 'proposer'],
      attempt: (as, w) => as.projects.deleteDraft({ id: w.project.id }),
    })
  })

  it('stops being one once published, so its admins cannot publish or delete it as a draft', async () => {
    const notADraft = {
      globalAdmin: 'BAD_REQUEST',
      chapterLead: 'BAD_REQUEST',
      chapterDeputy: 'BAD_REQUEST',
    } as const
    await expectAccess(people, {
      world: { status: 'in_progress' },
      allowed: [],
      others: notADraft,
      attempt: (as, w) => as.projects.publishDraft({ id: w.project.id }),
    })
    await expectAccess(people, {
      world: { status: 'in_progress' },
      allowed: [],
      others: notADraft,
      attempt: (as, w) => as.projects.deleteDraft({ id: w.project.id }),
    })
  })

  it('is re-baselined by its admins and proposer', () =>
    expectAccess(people, {
      world: draft,
      allowed: [...ADMINS, 'proposer'],
      attempt: (as, w) => as.projects.setBaseline({ projectId: w.project.id }),
    }))
})

describe('what the project page tells each person they may do', () => {
  it('matches what the server lets them do', async () => {
    const seen: Partial<Record<Persona, unknown>> = {}
    for (const persona of PERSONAS) {
      const world = await makeWorld(people)
      const found = await outcome(async () => {
        const p = await clientFor(people, persona).projects.getById({ id: world.project.id })
        seen[persona] = {
          viewerCanAdmin: p.viewerCanAdmin,
          canManageTasks: p.canManageTasks,
          canCreateTasks: p.canCreateTasks,
          canClaimTasks: p.canClaimTasks,
          seesApplications: p.interests !== undefined,
          seesChangeRequests: p.reviewRequests.length > 0,
        }
      })
      if (found !== 'ok') seen[persona] = found
    }
    const page = (
      viewerCanAdmin: boolean,
      canManageTasks: boolean,
      canCreateTasks: boolean,
      seesApplications: boolean,
      seesChangeRequests: boolean,
    ) => ({
      viewerCanAdmin,
      canManageTasks,
      canCreateTasks,
      canClaimTasks: true,
      seesApplications,
      seesChangeRequests,
    })
    const admin = page(true, true, true, true, true)
    expect(seen).toEqual({
      globalAdmin: admin,
      adminViewingAsVolunteer: 'NOT_FOUND',
      chapterLead: admin,
      chapterDeputy: admin,
      otherChapterLead: 'NOT_FOUND',
      owner: page(false, true, true, true, true),
      proposer: page(false, false, false, false, true),
      projectDeputy: page(false, true, true, false, false),
      member: page(false, false, true, false, false),
      taskAssignee: page(false, false, true, false, false),
      stranger: page(false, false, false, false, false),
    })
  })
})
