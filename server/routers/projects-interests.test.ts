import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createTeam,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

const interestRow = (volunteerId: number, workItemId: number) =>
  prisma.workItemInterest.findUniqueOrThrow({
    where: { volunteerId_workItemId: { volunteerId, workItemId } },
  })
const notified = (volunteerId: number, type: string, expected: object = {}) =>
  vi.waitFor(async () =>
    expect(await prisma.notification.findFirst({ where: { volunteerId, type } })).toMatchObject(
      expected,
    ),
  )

describe('projects.expressInterest / withdrawInterest', () => {
  it('records interest on a seeking project and notifies the owner', async () => {
    const owner = await createVolunteer()
    const me = await createVolunteer()
    const c = clientAs(me)
    const closed = await createProject({
      assigneeId: owner.id,
      isSeekingHelp: false,
      status: 'in_progress',
    })
    await expect(
      c.projects.expressInterest({ projectId: closed.id, interestType: 'want_to_contribute' }),
    ).rejects.toMatchObject({ message: 'This project is not currently seeking volunteers' })
    const team = await createTeam()
    const teamP = await createProject({ teamId: team.id })
    await expect(
      c.projects.expressInterest({ projectId: teamP.id, interestType: 'want_to_own' }),
    ).rejects.toMatchObject({ message: 'Project not found' })
    // A team member can reach the team's project.
    const member = await createVolunteer()
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: member.id } })
    expect(
      await clientAs(member).projects.expressInterest({
        projectId: teamP.id,
        interestType: 'want_to_own',
      }),
    ).toEqual({ message: 'Interest expressed successfully' })
    // ...as can its proposer, without being on the team.
    const proposed = await createProject({ teamId: team.id, creatorId: me.id })
    expect(
      await c.projects.expressInterest({ projectId: proposed.id, interestType: 'want_to_own' }),
    ).toEqual({ message: 'Interest expressed successfully' })

    const p = await createProject({
      assigneeId: owner.id,
      isSeekingHelp: true,
      status: 'in_progress',
    })
    expect(
      await c.projects.expressInterest({
        projectId: p.id,
        interestType: 'want_to_contribute',
        message: 'pick me',
      }),
    ).toEqual({ message: 'Interest expressed successfully' })
    await notified(owner.id, 'new_interest', {
      body: `${me.name} asked to help out on the project`,
    })
    await expect(
      c.projects.expressInterest({ projectId: p.id, interestType: 'want_to_contribute' }),
    ).rejects.toMatchObject({ message: "You've already expressed interest" })

    await expect(
      clientAs(owner).projects.withdrawInterest({ projectId: p.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const task = await createTask(p.id, { assigneeId: me.id, status: 'in_progress' })
    const doneTask = await createTask(p.id, { assigneeId: me.id, status: 'completed' })
    expect(await c.projects.withdrawInterest({ projectId: p.id })).toEqual({
      message: 'Interest withdrawn',
    })
    expect((await interestRow(me.id, p.id)).status).toBe('withdrawn')
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      assigneeId: null,
      status: 'open',
    })
    expect(
      (await prisma.workItem.findUniqueOrThrow({ where: { id: doneTask.id } })).assigneeId,
    ).toBe(me.id)

    // Re-expressing after withdrawal reuses the row; an unowned project notifies nobody.
    await c.projects.expressInterest({ projectId: p.id, interestType: 'want_to_own' })
    expect(await interestRow(me.id, p.id)).toMatchObject({
      status: 'pending',
      interestType: 'want_to_own',
    })
    const unowned = await createProject()
    await c.projects.expressInterest({ projectId: unowned.id, interestType: 'want_to_own' })
    await vi.waitFor(async () =>
      expect(await prisma.notification.count({ where: { type: 'new_interest' } })).toBe(2),
    )
  })
})

describe('projects.respondToInterest', () => {
  it('lets the owner or an admin accept/decline, with the side effects of each', async () => {
    const owner = await createVolunteer()
    const helper = await createVolunteer()
    const other = await createVolunteer()
    const p = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
    })
    await clientAs(helper).projects.expressInterest({
      projectId: p.id,
      interestType: 'want_to_contribute',
    })
    const interest = await interestRow(helper.id, p.id)
    const c = clientAs(owner)
    await expect(
      clientAs(other).projects.respondToInterest({
        projectId: p.id,
        interestId: interest.id,
        status: 'accepted',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      c.projects.respondToInterest({
        projectId: 999_999,
        interestId: interest.id,
        status: 'accepted',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      c.projects.respondToInterest({ projectId: p.id, interestId: 999_999, status: 'accepted' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    expect(
      await c.projects.respondToInterest({
        projectId: p.id,
        interestId: interest.id,
        status: 'accepted',
        responseMessage: 'welcome',
      }),
    ).toEqual({ message: 'Interest accepted' })
    expect(await interestRow(helper.id, p.id)).toMatchObject({
      status: 'accepted',
      responseMessage: 'welcome',
    })
    await notified(helper.id, 'interest_accepted', {
      title: `Accepted: your interest in '${p.title}'`,
      link: `/projects/${p.id}`,
    })

    const task = await createTask(p.id, { assigneeId: helper.id, status: 'in_progress' })
    // Turning down someone already on the project removes them.
    expect(
      await c.projects.respondToInterest({
        projectId: p.id,
        interestId: interest.id,
        status: 'declined',
      }),
    ).toEqual({ message: 'Interest removed' })
    expect((await interestRow(helper.id, p.id)).status).toBe('removed')
    expect(
      (await prisma.workItem.findUniqueOrThrow({ where: { id: task.id } })).assigneeId,
    ).toBeNull()
    await notified(helper.id, 'interest_removed', {
      title: `Removed: you're no longer on '${p.title}'`,
      link: `/projects/${p.id}`,
    })

    const pending = await createVolunteer({ approvalStatus: 'pending' })
    const pi = await prisma.workItemInterest.create({
      data: { workItemId: p.id, volunteerId: pending.id, interestType: 'want_to_contribute' },
    })
    await expect(
      c.projects.respondToInterest({ projectId: p.id, interestId: pi.id, status: 'accepted' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('not yet approved') })

    // Accepting a want_to_own interest hands over the project.
    const unowned = await createProject()
    await clientAs(helper).projects.expressInterest({
      projectId: unowned.id,
      interestType: 'want_to_own',
    })
    const oi = await interestRow(helper.id, unowned.id)
    await clientAs(await createAdmin()).projects.respondToInterest({
      projectId: unowned.id,
      interestId: oi.id,
      status: 'accepted',
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: unowned.id } })).toMatchObject({
      assigneeId: helper.id,
      status: 'in_progress',
    })

    // A project that already has an owner keeps them: the would-be lead joins as a helper.
    await clientAs(other).projects.expressInterest({ projectId: p.id, interestType: 'want_to_own' })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: owner.id, body: `${other.name} asked to lead the project` },
        }),
      ).toBe(1),
    )
    await c.projects.respondToInterest({
      projectId: p.id,
      interestId: (await interestRow(other.id, p.id)).id,
      status: 'accepted',
    })
    expect((await interestRow(other.id, p.id)).status).toBe('accepted')
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: p.id } })).assigneeId).toBe(
      owner.id,
    )
  })
})

describe('interest history', () => {
  it('records how each person came and went, for the owner only', async () => {
    const owner = await createVolunteer()
    const p = await createProject({ assigneeId: owner.id, isSeekingHelp: true })
    const c = clientAs(owner)
    const admin = clientAs(await createAdmin())
    const apply = async () => {
      const v = await createVolunteer()
      await clientAs(v).projects.expressInterest({
        projectId: p.id,
        interestType: 'want_to_contribute',
      })
      return v
    }
    const add = async () => {
      const v = await createVolunteer()
      await admin.projects.assign({ projectId: p.id, volunteerId: v.id })
      return v
    }
    const turnDown = async (v: { id: number }) =>
      c.projects.respondToInterest({
        projectId: p.id,
        interestId: (await interestRow(v.id, p.id)).id,
        status: 'declined',
      })

    const declined = await apply()
    await turnDown(declined)
    const removed = await add()
    await turnDown(removed)
    const appliedThenLeft = await apply()
    await clientAs(appliedThenLeft).projects.withdrawInterest({ projectId: p.id })
    const addedThenLeft = await add()
    await clientAs(addedThenLeft).projects.withdrawInterest({ projectId: p.id })

    const history = (await c.projects.getById({ id: p.id })).interests!.map((i) => [
      i.volunteerId,
      i.origin,
      i.status,
    ])
    expect(history).toEqual(
      expect.arrayContaining([
        [declined.id, 'applied', 'declined'],
        [removed.id, 'added', 'removed'],
        [appliedThenLeft.id, 'applied', 'withdrawn'],
        [addedThenLeft.id, 'added', 'withdrawn'],
      ]),
    )
    await notified(removed.id, 'interest_removed', {
      title: `Removed: you're no longer on '${p.title}'`,
    })
    await notified(declined.id, 'interest_declined', {
      title: `Declined: your interest in '${p.title}'`,
    })

    // Anyone else sees current helpers only, and none of the history.
    const helper = await add()
    const view = await clientAs(await createVolunteer()).projects.getById({ id: p.id })
    expect(view.interests).toBeUndefined()
    expect(view.helpers?.map((h) => h.volunteerId)).toEqual([helper.id])
  })
})

describe('projects.assign', () => {
  it('lets an admin add an approved volunteer, accepting or creating their interest', async () => {
    const owner = await createVolunteer()
    const vol = await createVolunteer()
    const p = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
    })
    const c = clientAs(await createAdmin())
    await expect(
      c.projects.assign({ projectId: 999_999, volunteerId: vol.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // Owners invite; only an admin adds someone without asking.
    await expect(
      clientAs(owner).projects.assign({ projectId: p.id, volunteerId: vol.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      c.projects.assign({ projectId: p.id, volunteerId: 999_999 }),
    ).rejects.toMatchObject({ message: 'Volunteer not found' })
    const pending = await createVolunteer({ approvalStatus: 'pending' })
    await expect(
      c.projects.assign({ projectId: p.id, volunteerId: pending.id }),
    ).rejects.toMatchObject({ message: expect.stringContaining('not yet approved') })

    expect(await c.projects.assign({ projectId: p.id, volunteerId: vol.id })).toEqual({
      message: 'Volunteer assigned to project',
    })
    expect((await interestRow(vol.id, p.id)).status).toBe('accepted')
    await notified(vol.id, 'assigned_to_project', {
      title: `Assigned: you're on '${p.title}'`,
      link: `/projects/${p.id}`,
    })
    expect(await c.projects.assign({ projectId: p.id, volunteerId: vol.id })).toEqual({
      message: 'This volunteer is already assigned to this project',
    })

    const applicant = await createVolunteer()
    await clientAs(applicant).projects.expressInterest({
      projectId: p.id,
      interestType: 'want_to_contribute',
    })
    await c.projects.assign({ projectId: p.id, volunteerId: applicant.id })
    expect((await interestRow(applicant.id, p.id)).status).toBe('accepted')
    expect(await interestRow(applicant.id, p.id)).toMatchObject({
      status: 'accepted',
      origin: 'applied',
    })
    // Someone declined, removed, withdrawn or invited before is added this time.
    for (const status of ['declined', 'removed', 'withdrawn', 'invited'] as const) {
      const earlier = await createVolunteer()
      const row = await prisma.workItemInterest.create({
        data: { workItemId: p.id, volunteerId: earlier.id, interestType: 'x', status },
      })
      await prisma.notification.create({
        data: { volunteerId: earlier.id, type: 'project_invite', title: 'x', entityId: row.id },
      })
      await c.projects.assign({ projectId: p.id, volunteerId: earlier.id })
      expect(await interestRow(earlier.id, p.id)).toMatchObject({
        status: 'accepted',
        origin: 'added',
        interestType: 'want_to_contribute',
      })
      expect(
        await prisma.notification.count({
          where: { volunteerId: earlier.id, type: 'project_invite' },
        }),
      ).toBe(status === 'invited' ? 0 : 1)
    }
  })

  it('assigning as owner sets the assignee, unless the project is finished', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer()
    const unowned = await createProject()
    await clientAs(admin).projects.assign({
      projectId: unowned.id,
      volunteerId: vol.id,
      interestType: 'want_to_own',
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: unowned.id } })).toMatchObject({
      assigneeId: vol.id,
      status: 'in_progress',
    })
    const done = await createProject({ status: 'completed' })
    await clientAs(admin).projects.assign({
      projectId: done.id,
      volunteerId: vol.id,
      interestType: 'want_to_own',
    })
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({
      assigneeId: vol.id,
      status: 'completed',
    })
  })
})

describe('projects.invite / respondToInvite / cancelInvite', () => {
  it('invites a volunteer, who is not on the project until they accept', async () => {
    const owner = await createVolunteer({ name: 'Ola Owner' })
    const vol = await createVolunteer({ name: 'Ivy Invitee' })
    const other = await createVolunteer()
    const p = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
    })
    const o = clientAs(owner)

    await expect(
      o.projects.invite({ projectId: 999_999, volunteerId: vol.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      clientAs(other).projects.invite({ projectId: p.id, volunteerId: vol.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      o.projects.invite({ projectId: p.id, volunteerId: owner.id }),
    ).rejects.toMatchObject({ message: 'They already own this project' })
    await expect(
      o.projects.invite({ projectId: p.id, volunteerId: 999_999 }),
    ).rejects.toMatchObject({ message: 'Volunteer not found' })
    const unapproved = await createVolunteer({ approvalStatus: 'pending' })
    await expect(
      o.projects.invite({ projectId: p.id, volunteerId: unapproved.id }),
    ).rejects.toMatchObject({ message: 'Cannot invite a volunteer who is not yet approved' })

    expect(
      await o.projects.invite({ projectId: p.id, volunteerId: vol.id, message: 'The leaflets?' }),
    ).toEqual({ message: 'Invite sent' })
    const row = await interestRow(vol.id, p.id)
    expect(row).toMatchObject({
      status: 'invited',
      origin: 'invited',
      message: 'The leaflets?',
      invitedById: owner.id,
    })
    expect(
      await prisma.notification.findFirst({
        where: { volunteerId: vol.id, type: 'project_invite' },
      }),
    ).toMatchObject({
      title: `Invited: help on '${p.title}'`,
      body: 'The leaflets?',
      entityId: row.id,
    })
    await expect(o.projects.invite({ projectId: p.id, volunteerId: vol.id })).rejects.toMatchObject(
      { message: 'They have already been invited' },
    )

    // Not a member yet: the helpers list and the owner's view say so.
    const v = clientAs(vol)
    const seen = await v.projects.getById({ id: p.id })
    expect(seen.helpers).toEqual([])
    expect(seen.myInterest).toMatchObject({ status: 'invited', invitedByName: 'Ola Owner' })
    expect((await o.projects.getById({ id: p.id })).interests).toEqual([
      expect.objectContaining({ volunteerId: vol.id, invitedByName: 'Ola Owner' }),
    ])
    await expect(
      v.projects.expressInterest({ projectId: p.id, interestType: 'want_to_contribute' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('accept the invite instead') })
    // Nor can the owner answer on their behalf: an invite waits on the invitee.
    for (const status of ['accepted', 'declined'] as const) {
      await expect(
        o.projects.respondToInterest({ projectId: p.id, interestId: row.id, status }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('Cancel the invite instead'),
      })
    }
    expect((await interestRow(vol.id, p.id)).status).toBe('invited')

    await expect(
      clientAs(other).projects.respondToInvite({ projectId: p.id, accept: true }),
    ).rejects.toMatchObject({ message: 'No invite found' })
    expect(await v.projects.respondToInvite({ projectId: p.id, accept: true })).toEqual({
      message: "You're on the project",
    })
    expect((await interestRow(vol.id, p.id)).status).toBe('accepted')
    expect(
      await prisma.notification.count({ where: { volunteerId: vol.id, type: 'project_invite' } }),
    ).toBe(0)
    await notified(owner.id, 'invite_accepted', {
      title: `Accepted: Ivy Invitee joined '${p.title}'`,
    })
    await expect(o.projects.invite({ projectId: p.id, volunteerId: vol.id })).rejects.toMatchObject(
      { message: 'They are already on this project' },
    )
  })

  it('declines, re-invites, cancels, and lets the volunteer apply after either', async () => {
    const owner = await createVolunteer()
    const admin = await createAdmin({ name: 'Ada Admin' })
    const vol = await createVolunteer({ name: 'Dee Decliner' })
    const p = await createProject({
      assigneeId: owner.id,
      status: 'in_progress',
      isSeekingHelp: true,
    })
    const o = clientAs(owner)
    const v = clientAs(vol)

    // An admin can invite too, and is the one told of the answer.
    await clientAs(admin).projects.invite({ projectId: p.id, volunteerId: vol.id })
    expect(await v.projects.respondToInvite({ projectId: p.id, accept: false })).toEqual({
      message: 'Invite declined',
    })
    expect(await interestRow(vol.id, p.id)).toMatchObject({ status: 'declined', origin: 'invited' })
    await notified(admin.id, 'invite_declined', {
      title: `Declined: Dee Decliner won't join '${p.title}'`,
    })
    expect(
      (await o.projects.getById({ id: p.id })).interests?.find((i) => i.volunteerId === vol.id),
    ).toMatchObject({ origin: 'invited', status: 'declined' })

    // The owner may ask again, then take it back.
    await o.projects.invite({ projectId: p.id, volunteerId: vol.id })
    const row = await interestRow(vol.id, p.id)
    expect(row).toMatchObject({ status: 'invited', invitedById: owner.id, message: null })
    await expect(
      clientAs(await createVolunteer()).projects.cancelInvite({
        projectId: p.id,
        interestId: row.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await o.projects.cancelInvite({ projectId: p.id, interestId: row.id })).toEqual({
      message: 'Invite cancelled',
    })
    expect((await interestRow(vol.id, p.id)).status).toBe('cancelled')
    expect(
      await prisma.notification.count({ where: { volunteerId: vol.id, type: 'project_invite' } }),
    ).toBe(0)
    await expect(
      o.projects.cancelInvite({ projectId: p.id, interestId: row.id }),
    ).rejects.toMatchObject({ message: 'This invite has already been answered' })

    // After a declined or cancelled invite they can still apply.
    await v.projects.expressInterest({ projectId: p.id, interestType: 'want_to_contribute' })
    expect(await interestRow(vol.id, p.id)).toMatchObject({
      status: 'pending',
      origin: 'applied',
      invitedById: null,
    })

    // Inviting someone who already applied just accepts them.
    expect(await o.projects.invite({ projectId: p.id, volunteerId: vol.id })).toEqual({
      message: 'They had already applied, so they are now on the project',
    })
    expect((await interestRow(vol.id, p.id)).status).toBe('accepted')
    await notified(vol.id, 'interest_accepted', {
      title: `Accepted: your interest in '${p.title}'`,
    })
  })

  it("tells the owner of an answer when the inviter's account is gone", async () => {
    const owner = await createVolunteer()
    const vol = await createVolunteer()
    const p = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await prisma.workItemInterest.create({
      data: { workItemId: p.id, volunteerId: vol.id, interestType: 'x', status: 'invited' },
    })
    await clientAs(vol).projects.respondToInvite({ projectId: p.id, accept: true })
    await notified(owner.id, 'invite_accepted')

    // With no inviter and no owner, nobody is told.
    const orphan = await createProject({ status: 'ready' })
    await prisma.workItemInterest.create({
      data: { workItemId: orphan.id, volunteerId: vol.id, interestType: 'x', status: 'invited' },
    })
    await clientAs(vol).projects.respondToInvite({ projectId: orphan.id, accept: false })
    expect((await interestRow(vol.id, orphan.id)).status).toBe('declined')
  })
})
