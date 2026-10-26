import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { clientAs } from '@/test/rpc'
import {
  connect,
  createAdmin,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createMember,
  createProject,
  createTask,
  createTeam,
  createVolunteer,
} from '@/test/factories'

type Person = Awaited<ReturnType<typeof createVolunteer>>

const canView = async (viewer: Person, ids: number[]) =>
  Object.fromEntries(
    (await clientAs(viewer).volunteers.lookup({ ids })).map((p) => [p.id, p.canView]),
  )

const hidden = (overrides = {}) =>
  createVolunteer({ consentMakeProfileVisibleInDirectory: false, ...overrides })

describe('volunteers.lookup', () => {
  it('links profiles in the directory, and one’s own, but not the deleted or unknown', async () => {
    const viewer = await createVolunteer()
    const listed = await createVolunteer()
    const deleted = await createVolunteer({ deletedAt: new Date() })
    const unlisted = await hidden()
    expect(await canView(viewer, [viewer.id, listed.id, deleted.id, unlisted.id, 0])).toEqual({
      [viewer.id]: true,
      [listed.id]: true,
      [deleted.id]: false,
      [unlisted.id]: false,
      0: false,
    })
  })

  it('keeps another chapter out of sight, unless the two already work together', async () => {
    const [here, there] = [await createChapter(), await createChapter()]
    const viewer = await createMember(here)
    const stranger = await createMember(there)
    const colleague = await createMember(there)
    const project = await createProject({ assigneeId: viewer.id })
    await createTask(project.id, { assigneeId: colleague.id })
    expect(await canView(viewer, [stranger.id, colleague.id])).toEqual({
      [stranger.id]: false,
      [colleague.id]: true,
    })
  })

  it('shows a profile hidden from the directory to those who must assess it', async () => {
    const chapter = await createChapter()
    const member = await createMember(chapter, { consentMakeProfileVisibleInDirectory: false })
    const deputy = await createChapterDeputy(chapter)
    const owner = await createMember(chapter)
    const bystander = await createMember(chapter)
    const contact = await createMember(chapter)
    const project = await createProject({ assigneeId: owner.id, nationalChapterId: chapter.id })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: member.id,
        interestType: 'want_to_contribute',
        status: 'pending',
      },
    })
    await connect(member, contact)
    for (const [viewer, expected] of [
      [deputy, true],
      [owner, true],
      [contact, true],
      [bystander, false],
    ] as const) {
      expect((await canView(viewer, [member.id]))[member.id]).toBe(expected)
    }
  })

  it('shows a team’s leader the hidden profiles of its members and applicants', async () => {
    const team = await createTeam()
    const leader = await createVolunteer()
    const member = await hidden()
    const applicant = await hidden()
    const declined = await hidden()
    const elsewhere = await hidden()
    await prisma.teamMembership.createMany({
      data: [
        { teamId: team.id, volunteerId: leader.id, role: 'leader' },
        { teamId: team.id, volunteerId: member.id },
        { teamId: (await createTeam()).id, volunteerId: elsewhere.id },
      ],
    })
    await prisma.teamJoinRequest.createMany({
      data: [
        { teamId: team.id, volunteerId: applicant.id },
        { teamId: team.id, volunteerId: declined.id, status: 'declined' },
      ],
    })
    expect(await canView(leader, [member.id, applicant.id, declined.id, elsewhere.id])).toEqual({
      [member.id]: true,
      [applicant.id]: true,
      [declined.id]: false,
      [elsewhere.id]: false,
    })
    const profile = await clientAs(leader).volunteers.getById({ id: applicant.id })
    expect(profile.id).toBe(applicant.id)
  })

  it('opens only one’s own profile while awaiting approval', async () => {
    const pending = await createVolunteer({ approvalStatus: 'pending' })
    const listed = await createVolunteer()
    expect(await canView(pending, [pending.id, listed.id])).toEqual({
      [pending.id]: true,
      [listed.id]: false,
    })
  })

  it('badges global admins and the staff of the chapter they belong to', async () => {
    const chapter = await createChapter()
    const elsewhere = await createChapter()
    const viewer = await createVolunteer()
    const admin = await createAdmin()
    const lead = await createChapterLead(chapter)
    const deputy = await createChapterDeputy(chapter)
    const member = await createMember(chapter)
    const moved = await createChapterDeputy(chapter)
    await prisma.volunteer.update({
      where: { id: moved.id },
      data: { nationalChapterId: elsewhere.id },
    })
    const people = await clientAs(viewer).volunteers.lookup({
      ids: [admin.id, lead.id, deputy.id, member.id, moved.id],
    })
    expect(people.map((p) => [p.role, p.chapter])).toEqual([
      ['admin', null],
      ['lead', chapter.name],
      ['deputy', chapter.name],
      [null, null],
      [null, null],
    ])
  })
})
