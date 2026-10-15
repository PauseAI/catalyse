import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createAdmin,
  createProject,
  createQuickTask,
  createTask,
  createVolunteer,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

/** Every event recorded on a work item, oldest first. */
const eventsOf = (workItemId: number) =>
  prisma.workItemEvent.findMany({ where: { workItemId }, orderBy: { id: 'asc' } })

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** A live project with its owner, an accepted helper who is also a deputy, and an admin. */
async function setup() {
  const owner = await createVolunteer({ name: 'Olive' })
  const helper = await createVolunteer({ name: 'Hal' })
  const admin = await createAdmin({ name: 'Ada' })
  const project = await createProject({
    assigneeId: owner.id,
    status: 'in_progress',
    title: 'March',
  })
  await prisma.workItemInterest.create({
    data: {
      workItemId: project.id,
      volunteerId: helper.id,
      interestType: 'want_to_contribute',
      status: 'accepted',
    },
  })
  return { owner, helper, admin, project }
}

async function pendingInterest(projectId: number, volunteerId: number, interestType: string) {
  return prisma.workItemInterest.create({
    data: { workItemId: projectId, volunteerId, interestType, status: 'pending' },
  })
}

describe('project writes record an event', () => {
  it('update: an edit, a status change and a reopening, and nothing for no change', async () => {
    const { owner, project } = await setup()
    const as = clientAs(owner).projects
    await as.update({ id: project.id, title: 'March', description: project.description })
    await as.update({ id: project.id, title: 'Rally' })
    await as.update({ id: project.id, status: 'completed' })
    await as.update({ id: project.id, status: 'in_progress' })
    expect(await eventsOf(project.id)).toMatchObject([
      { actorId: owner.id, kind: 'edited', before: { title: 'March' }, after: { title: 'Rally' } },
      { kind: 'status', after: { status: 'completed' } },
      { kind: 'reopened', before: { status: 'completed' }, after: { status: 'in_progress' } },
    ])
    expect(await prisma.workItemComment.count({ where: { workItemId: project.id } })).toBe(0)
  })

  it('publishDraft, resubmit and the admin review record each status change', async () => {
    const proposer = await createVolunteer()
    const admin = await createAdmin()
    const draft = await createProject({ status: 'draft', creatorId: proposer.id })
    await createTask(draft.id)
    await clientAs(proposer).projects.publishDraft({ id: draft.id })
    await clientAs(admin).admin.projects.review({ id: draft.id, status: 'needs_discussion' })
    await clientAs(proposer).projects.resubmit({ id: draft.id })
    await clientAs(admin).admin.projects.review({ id: draft.id, status: 'approved' })
    expect(
      (await eventsOf(draft.id)).map((e) => [
        e.actorId,
        e.kind,
        (e.after as { status: string }).status,
      ]),
    ).toEqual([
      [proposer.id, 'status', 'pending_review'],
      [admin.id, 'status', 'needs_discussion'],
      [proposer.id, 'status', 'pending_review'],
      [admin.id, 'status', 'ready'],
    ])

    const org = await createProject({ status: 'draft', creatorId: admin.id, isOrgProposed: true })
    await createTask(org.id)
    await clientAs(admin).projects.publishDraft({ id: org.id })
    expect(await eventsOf(org.id)).toMatchObject([{ kind: 'status', after: { status: 'ready' } }])
  })

  it('admin triage submitDraft and setOutcome record theirs', async () => {
    const proposer = await createVolunteer()
    const admin = await createAdmin()
    const draft = await createProject({ status: 'draft', creatorId: proposer.id })
    await createTask(draft.id)
    await clientAs(admin).admin.triage.submitDraft({ id: draft.id })
    const done = await createProject({ status: 'in_progress' })
    await clientAs(admin).admin.projects.setOutcome({ id: done.id, outcome: 'successful' })
    expect(await eventsOf(draft.id)).toMatchObject([
      { actorId: admin.id, kind: 'status', after: { status: 'pending_review' } },
    ])
    expect(await eventsOf(done.id)).toMatchObject([
      { kind: 'edited', after: { outcome: 'successful', status: 'completed' } },
    ])
  })

  it('a new owner through respondToInterest or assign is an assignment', async () => {
    const admin = await createAdmin()
    const lead = await createVolunteer()
    const ownerless = await createProject({ status: 'ready' })
    const interest = await pendingInterest(ownerless.id, lead.id, 'want_to_own')
    await clientAs(admin).projects.respondToInterest({
      projectId: ownerless.id,
      interestId: interest.id,
      status: 'accepted',
    })
    const other = await createProject({ status: 'ready' })
    await clientAs(admin).projects.assign({
      projectId: other.id,
      volunteerId: lead.id,
      interestType: 'want_to_own',
    })
    for (const p of [ownerless, other]) {
      expect(await eventsOf(p.id)).toMatchObject([
        {
          actorId: admin.id,
          kind: 'assigned',
          before: { assigneeId: null, status: 'ready' },
          after: { assigneeId: lead.id, status: 'in_progress' },
        },
      ])
    }
  })

  it('setBaseline records each item it re-baselines', async () => {
    const { owner, project } = await setup()
    const dated = await createTask(project.id, {
      startDate: day('2026-10-01'),
      deadline: day('2026-10-03'),
    })
    const undated = await createTask(project.id)
    await clientAs(owner).projects.setBaseline({ projectId: project.id })
    expect(await eventsOf(dated.id)).toMatchObject([
      {
        kind: 'baseline',
        after: { baselineStartDate: day('2026-10-01').toISOString(), baselineDurationDays: 3 },
      },
    ])
    expect(await eventsOf(undated.id)).toEqual([])
  })
})

describe('task writes record an event', () => {
  it('updateTask: a claim, an edit and a release; a refused write records nothing', async () => {
    const { owner, helper, project } = await setup()
    const task = await createTask(project.id, { title: 'Banners' })
    const update = (who: typeof owner, data: object) =>
      clientAs(who).projects.updateTask({ projectId: project.id, taskId: task.id, data })

    await update(helper, { assigneeId: helper.id })
    await expect(update(helper, { title: 'Mine now' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await update(owner, { title: 'Flags', deadline: day('2026-10-20') })
    await update(owner, { status: 'not_started' })
    expect(await eventsOf(task.id)).toMatchObject([
      { actorId: helper.id, kind: 'claimed', after: { assigneeId: helper.id } },
      {
        actorId: owner.id,
        kind: 'edited',
        after: { title: 'Flags', deadline: day('2026-10-20').toISOString() },
      },
      { kind: 'released', before: { assigneeId: helper.id }, after: { assigneeId: null } },
    ])
  })

  it('updateTask: asking to take a task records the request', async () => {
    const { owner, project } = await setup()
    const newcomer = await createVolunteer()
    const task = await createTask(project.id)
    const res = await clientAs(newcomer).projects.updateTask({
      projectId: project.id,
      taskId: task.id,
      data: { assigneeId: newcomer.id },
    })
    expect(res.requested).toBe(true)
    // The owner turns them down, which ends the request.
    const interest = await prisma.workItemInterest.findFirstOrThrow({
      where: { workItemId: project.id, volunteerId: newcomer.id },
    })
    await clientAs(owner).projects.respondToInterest({
      projectId: project.id,
      interestId: interest.id,
      status: 'declined',
    })
    expect(await eventsOf(task.id)).toMatchObject([
      { actorId: newcomer.id, kind: 'requested', after: { requestedById: newcomer.id } },
      { actorId: owner.id, kind: 'released', before: { requestedById: newcomer.id } },
    ])
  })

  it('accepting someone, or inviting someone who applied, hands them their held tasks', async () => {
    const { owner, project } = await setup()
    for (const respond of ['accept', 'invite'] as const) {
      const newcomer = await createVolunteer()
      const task = await createTask(project.id, { requestedById: newcomer.id })
      const interest = await pendingInterest(project.id, newcomer.id, 'want_to_contribute')
      if (respond === 'accept') {
        await clientAs(owner).projects.respondToInterest({
          projectId: project.id,
          interestId: interest.id,
          status: 'accepted',
        })
      } else {
        await clientAs(owner).projects.invite({ projectId: project.id, volunteerId: newcomer.id })
      }
      expect(await eventsOf(task.id)).toMatchObject([
        {
          actorId: owner.id,
          kind: 'assigned',
          before: { assigneeId: null, requestedById: newcomer.id },
          after: { assigneeId: newcomer.id, requestedById: null },
        },
      ])
    }
  })

  it('an admin adding someone hands them their held tasks', async () => {
    const { admin, project } = await setup()
    const newcomer = await createVolunteer()
    const task = await createTask(project.id, { requestedById: newcomer.id })
    await clientAs(admin).projects.assign({ projectId: project.id, volunteerId: newcomer.id })
    expect(await eventsOf(task.id)).toMatchObject([
      { actorId: admin.id, kind: 'assigned', after: { assigneeId: newcomer.id } },
    ])
  })

  it('withdrawing from the project releases the tasks they held', async () => {
    const { helper, project } = await setup()
    const held = await createTask(project.id, { assigneeId: helper.id, status: 'in_progress' })
    const done = await createTask(project.id, { assigneeId: helper.id, status: 'completed' })
    await clientAs(helper).projects.withdrawInterest({ projectId: project.id })
    expect(await eventsOf(held.id)).toMatchObject([
      { actorId: helper.id, kind: 'released', after: { assigneeId: null, status: 'not_started' } },
    ])
    expect(await eventsOf(done.id)).toEqual([])
  })

  it('start, submit, changes requested, accept and reopen each record theirs', async () => {
    const { owner, helper, project } = await setup()
    await prisma.workItem.update({ where: { id: project.id }, data: { autoAcceptTasks: false } })
    await prisma.projectDeputy.create({ data: { projectId: project.id, volunteerId: helper.id } })
    const sam = await createVolunteer({ name: 'Sam' })
    await pendingInterest(project.id, sam.id, 'want_to_contribute')
    await prisma.workItemInterest.updateMany({
      where: { volunteerId: sam.id },
      data: { status: 'accepted' },
    })
    const task = await createTask(project.id, { assigneeId: sam.id })
    const ids = { projectId: project.id, taskId: task.id }

    await clientAs(sam).projects.startTask(ids)
    await clientAs(sam).projects.submitTask({ ...ids, note: 'Booked' })
    await clientAs(helper).projects.requestTaskChanges({ ...ids, message: 'Which room?' })
    await clientAs(sam).projects.submitTask({ ...ids, note: 'Room 2' })
    await clientAs(owner).projects.acceptTask(ids)
    await clientAs(helper).projects.reopenTask(ids)
    expect(
      (await eventsOf(task.id)).map((e) => [
        e.actorId,
        e.kind,
        (e.after as { status: string }).status,
      ]),
    ).toEqual([
      [sam.id, 'started', 'in_progress'],
      [sam.id, 'submitted', 'under_review'],
      [helper.id, 'changes_requested', 'in_progress'],
      [sam.id, 'submitted', 'under_review'],
      [owner.id, 'accepted', 'completed'],
      [helper.id, 'reopened', 'in_progress'],
    ])
    const [, , asked, , , reopened] = await eventsOf(task.id)
    expect(asked.after).toMatchObject({ changesRequestedNote: 'Which room?', asDeputy: true })
    expect(reopened.after).toMatchObject({ asDeputy: true })
  })

  it("assignTask records the hand-over, and nothing when it's the same person", async () => {
    const { owner, helper, project } = await setup()
    const task = await createTask(project.id)
    const assign = () =>
      clientAs(owner).projects.assignTask({
        projectId: project.id,
        taskId: task.id,
        assigneeId: helper.id,
      })
    await assign()
    await assign()
    expect(await eventsOf(task.id)).toMatchObject([
      { actorId: owner.id, kind: 'assigned', after: { assigneeId: helper.id } },
    ])
  })

  it('replanTask records the new dates and the reason, even when the dates stay put', async () => {
    const { owner, helper, project } = await setup()
    const task = await createTask(project.id, {
      status: 'in_progress',
      assigneeId: helper.id,
      startDate: day('2026-10-01'),
      deadline: day('2026-10-03'),
    })
    const replan = (newEnd: Date, reason: string) =>
      clientAs(owner).projects.replanTask({
        projectId: project.id,
        taskId: task.id,
        newEnd,
        reason,
      })
    await replan(day('2026-10-10'), 'venue moved')
    await replan(day('2026-10-10'), 'confirmed')
    expect(await eventsOf(task.id)).toMatchObject([
      {
        kind: 'replanned',
        before: { deadline: day('2026-10-03').toISOString() },
        after: { deadline: day('2026-10-10').toISOString(), reason: 'venue moved' },
      },
      { kind: 'replanned', before: {}, after: { reason: 'confirmed' } },
    ])
  })

  it("the assignee's first comment starts the work, and says so", async () => {
    const { helper, project } = await setup()
    const task = await createTask(project.id, { assigneeId: helper.id })
    await clientAs(helper).workItemComments.add({ workItemId: task.id, content: 'On it' })
    await clientAs(helper).workItemComments.add({ workItemId: task.id, content: 'Still on it' })
    expect(await eventsOf(task.id)).toMatchObject([
      { actorId: helper.id, kind: 'started', after: { status: 'in_progress' } },
    ])
  })
})

describe('schedule writes record an event', () => {
  it('dependencies: add, re-add, change the gap and remove', async () => {
    const { owner, project } = await setup()
    const venue = await createTask(project.id, { title: 'Venue' })
    const flyers = await createTask(project.id, { title: 'Flyers' })
    const as = clientAs(owner).dependencies
    const link = { predecessorId: venue.id, successorId: flyers.id }
    const dep = await as.add(link)
    await as.add(link)
    await as.add({ ...link, lagDays: 2 })
    await as.updateLag({ dependencyId: dep.id, lagDays: 2 })
    await as.updateLag({ dependencyId: dep.id, lagDays: -1 })
    await as.remove({ dependencyId: dep.id })
    const venueLink = (lagDays: number) => ({
      predecessorId: venue.id,
      predecessorTitle: 'Venue',
      lagDays,
    })
    expect(await eventsOf(flyers.id)).toMatchObject([
      { actorId: owner.id, kind: 'dependency_added', before: {}, after: venueLink(0) },
      { kind: 'dependency_lag', before: venueLink(0), after: venueLink(2) },
      { kind: 'dependency_lag', before: venueLink(2), after: venueLink(-1) },
      { kind: 'dependency_removed', before: venueLink(-1), after: {} },
    ])
    expect(await eventsOf(venue.id)).toEqual([])
  })

  it('rescheduleItems records each item it moves', async () => {
    const { owner, project } = await setup()
    const task = await createTask(project.id, { startDate: day('2026-10-01') })
    await clientAs(owner).schedule.rescheduleItems({
      items: [
        { id: task.id, startDate: day('2026-10-05'), deadline: day('2026-10-07') },
        { id: project.id, startDate: day('2026-10-01') },
      ],
    })
    expect(await eventsOf(task.id)).toMatchObject([
      {
        actorId: owner.id,
        kind: 'rescheduled',
        before: { startDate: day('2026-10-01').toISOString(), deadline: null },
        after: {
          startDate: day('2026-10-05').toISOString(),
          deadline: day('2026-10-07').toISOString(),
        },
      },
    ])
    expect(await eventsOf(project.id)).toMatchObject([{ kind: 'rescheduled' }])
  })
})

describe('Quick Task writes record an event', () => {
  it('update, assign, unassign, claim, submit, request changes and review', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer()
    const qt = await createQuickTask({ title: 'Leaflets' })
    const as = clientAs(admin).quickTasks
    await as.update({ id: qt.id, title: 'Posters' })
    await as.assign({ id: qt.id, volunteerId: vol.id })
    await as.unassign({ id: qt.id })
    await clientAs(vol).quickTasks.claim({ id: qt.id })
    await clientAs(vol).quickTasks.submit({ id: qt.id, note: 'Done' })
    await as.requestChanges({ id: qt.id, message: 'More colour' })
    await clientAs(vol).quickTasks.submit({ id: qt.id, note: 'Brighter' })
    await as.review({ id: qt.id, reviewRating: 'good' })
    expect((await eventsOf(qt.id)).map((e) => [e.actorId, e.kind])).toEqual([
      [admin.id, 'edited'],
      [admin.id, 'assigned'],
      [admin.id, 'released'],
      [vol.id, 'claimed'],
      [vol.id, 'submitted'],
      [admin.id, 'changes_requested'],
      [vol.id, 'submitted'],
      [admin.id, 'accepted'],
    ])
  })

  it('a lost claim records nothing', async () => {
    const vol = await createVolunteer()
    const qt = await createQuickTask({
      status: 'in_progress',
      assigneeId: (await createVolunteer()).id,
    })
    await expect(clientAs(vol).quickTasks.claim({ id: qt.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(await eventsOf(qt.id)).toEqual([])
  })
})
