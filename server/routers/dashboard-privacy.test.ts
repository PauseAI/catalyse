import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createAdmin,
  createProject,
  createQuickTask,
  createSkill,
  createTask,
  createTeam,
  createVolunteer,
  createChapter,
  createMember,
  createLocalGroup,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

const DAY = 24 * 60 * 60 * 1000

describe('dashboard.get', () => {
  it('lists my work once each, under the closest tie, with tasks and teams', async () => {
    const me = await createVolunteer()
    const other = await createVolunteer()
    const lead = await createProject({ assigneeId: me.id, status: 'in_progress', title: 'Lead P' })
    const helping = await createProject({ assigneeId: other.id, title: 'Helping P' })
    const applied = await createProject({ assigneeId: other.id, title: 'Applied P' })
    const appliedToLead = await createProject({ title: 'Lead app P' })
    const draft = await createProject({ creatorId: me.id, status: 'draft', title: 'Draft P' })
    const done = await createProject({ assigneeId: me.id, status: 'completed', title: 'Done P' })
    // Proposed by me and also helping: shown once, as Helper.
    const both = await createProject({ creatorId: me.id, assigneeId: other.id, title: 'Both P' })
    await prisma.workItemInterest.createMany({
      data: [
        {
          workItemId: helping.id,
          volunteerId: me.id,
          interestType: 'want_to_contribute',
          status: 'accepted',
        },
        {
          workItemId: both.id,
          volunteerId: me.id,
          interestType: 'want_to_contribute',
          status: 'accepted',
        },
        { workItemId: applied.id, volunteerId: me.id, interestType: 'want_to_contribute' },
        { workItemId: appliedToLead.id, volunteerId: me.id, interestType: 'want_to_own' },
        // A withdrawn interest is history, not work.
        {
          workItemId: (await createProject()).id,
          volunteerId: me.id,
          interestType: 'want_to_contribute',
          status: 'withdrawn',
        },
      ],
    })
    const task = await createTask(lead.id, {
      assigneeId: me.id,
      status: 'in_progress',
      title: 'T1',
    })
    await prisma.workItem.create({
      data: { type: 'TASK', status: 'in_progress', title: 'Loose', assigneeId: me.id },
    })
    const qt = await createQuickTask({ assigneeId: me.id, status: 'under_review', title: 'QT1' })
    await createTask(lead.id, { assigneeId: me.id, status: 'under_review', title: 'T2' })
    // Claimed but not started is still my work, shown with what it waits on.
    const first = await createTask(lead.id, { title: 'Emergency thing' })
    const blocked = await createTask(lead.id, { assigneeId: me.id, title: 'T3' })
    await prisma.workItemDependency.create({
      data: { predecessorId: first.id, successorId: blocked.id },
    })
    const team = await createTeam({ name: 'Comms' })
    const ledTeam = await createTeam({ name: 'Leads' })
    await prisma.teamMembership.createMany({
      data: [
        { teamId: team.id, volunteerId: me.id },
        { teamId: ledTeam.id, volunteerId: me.id, role: 'leader' },
      ],
    })

    const { work } = await clientAs(me).dashboard.get()
    const byTitle = Object.fromEntries(work.map((w) => [w.title, w]))
    expect(work.filter((w) => w.kind === 'project').map((w) => w.title)).toHaveLength(7)
    expect(byTitle['Lead P']).toMatchObject({
      role: 'Lead',
      status: 'In progress',
      href: `/projects/${lead.id}`,
    })
    expect(byTitle['Helping P']).toMatchObject({ role: 'Helper' })
    expect(byTitle['Both P']).toMatchObject({ role: 'Helper' })
    // A request names what it asks, and the row's status is the project's.
    expect(byTitle['Applied P']).toMatchObject({
      role: 'Asked to help',
      status: 'To do',
      statusKey: 'ready',
      ownerName: other.name,
    })
    expect(byTitle['Lead app P']).toMatchObject({
      role: 'Asked to lead',
      statusKey: 'ready',
      ownerName: null,
    })
    expect(byTitle['Draft P']).toMatchObject({
      role: 'Proposed',
      href: `/projects/${draft.id}/edit`,
    })
    expect(byTitle['T1']).toMatchObject({
      kind: 'task',
      role: 'Task',
      context: 'Lead P',
      href: `/projects/${lead.id}/tasks/${task.id}`,
    })
    expect(byTitle['T1']).toMatchObject({ status: 'In progress', displayStatus: 'in_progress' })
    expect(byTitle['T2']).toMatchObject({ status: 'In review' })
    expect(byTitle['T3']).toMatchObject({
      status: 'To do',
      displayStatus: 'blocked',
      blockedBy: [{ id: first.id, title: 'Emergency thing' }],
    })
    expect(byTitle['Emergency thing']).toBeUndefined()
    expect(byTitle['Loose']).toMatchObject({
      context: null,
      href: '/dashboard',
    })
    expect(byTitle['QT1']).toMatchObject({
      href: `/quick-tasks/${qt.id}`,
      status: 'In review',
    })
    expect(byTitle['Comms']).toMatchObject({
      kind: 'team',
      role: 'Member',
      href: `/teams/${team.id}`,
    })
    expect(byTitle['Leads']).toMatchObject({ role: 'Lead' })
    // Finished work comes last.
    expect(work.at(-1)).toMatchObject({ title: 'Done P', done: true, href: `/projects/${done.id}` })
  })

  it('puts work that needs attention now first, with why, each part by deadline', async () => {
    const me = await createVolunteer()
    const project = await createProject({
      assigneeId: me.id,
      status: 'in_progress',
      title: 'Due P',
      deadline: new Date(Date.now() + 10 * DAY),
    })
    const mine = { assigneeId: me.id, status: 'in_progress' as const }
    await createTask(project.id, { ...mine, title: 'Someday' })
    await createTask(project.id, {
      ...mine,
      title: 'Far',
      deadline: new Date(Date.now() + 20 * DAY),
      estimatedHours: 2,
    })
    await createTask(project.id, {
      ...mine,
      title: 'Big',
      deadline: new Date(Date.now() + 6 * DAY),
      estimatedHours: 12,
    })
    await createTask(project.id, {
      ...mine,
      title: 'Soon',
      deadline: new Date(Date.now() + 2 * DAY),
    })
    await createTask(project.id, {
      ...mine,
      title: 'Late',
      deadline: new Date(Date.now() - 3 * DAY),
    })
    // Handed in, so off my clock however close its deadline.
    await createTask(project.id, {
      assigneeId: me.id,
      status: 'under_review',
      title: 'Handed in',
      deadline: new Date(Date.now() + DAY),
    })
    const team = await createTeam({ name: 'Crew' })
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: me.id } })

    const { work } = await clientAs(me).dashboard.get()
    expect(work.map((w) => [w.title, w.attention ?? null])).toEqual([
      ['Late', null],
      ['Soon', null],
      ['Big', 'About 12 hours of work, due in 6 days: start now'],
      ['Handed in', null],
      ['Due P', null],
      ['Far', null],
      ['Someday', null],
      ['Crew', null],
    ])
    const big = work.find((w) => w.title === 'Big')!
    expect(big).toMatchObject({ estimatedHours: 12, displayStatus: 'in_progress' })
    expect(big.item).toMatchObject({
      title: 'Big',
      type: 'TASK',
      displayStatus: 'in_progress',
      assigneeName: me.name,
      href: `/projects/${project.id}/tasks/${big.item!.id}`,
    })
    expect(work.find((w) => w.title === 'Due P')!.deadline).toEqual(project.deadline)
  })

  it('collects what is waiting on me, and nothing of anyone else’s', async () => {
    const me = await createVolunteer()
    const other = await createVolunteer()
    const applicantA = await createVolunteer({ name: 'Ann' })
    const applicantB = await createVolunteer()
    const mine = await createProject({ assigneeId: me.id, title: 'Mine' })
    const alsoMine = await createProject({ assigneeId: me.id, title: 'Solo' })
    const theirs = await createProject({ assigneeId: other.id, title: 'Theirs' })
    await prisma.workItemInterest.createMany({
      data: [
        { workItemId: mine.id, volunteerId: applicantA.id, interestType: 'want_to_contribute' },
        { workItemId: mine.id, volunteerId: applicantB.id, interestType: 'want_to_contribute' },
        { workItemId: alsoMine.id, volunteerId: applicantA.id, interestType: 'want_to_contribute' },
        { workItemId: theirs.id, volunteerId: applicantA.id, interestType: 'want_to_contribute' },
      ],
    })
    const proposal = await createProject({
      creatorId: me.id,
      status: 'needs_discussion',
      title: 'Prop',
    })
    await prisma.projectReviewRequest.create({
      data: { projectId: proposal.id, message: 'Add dates' },
    })
    const quiet = await createTask(mine.id, {
      assigneeId: me.id,
      status: 'in_progress',
      title: 'Slow',
    })
    const quietQt = await createQuickTask({
      assigneeId: me.id,
      status: 'in_progress',
      title: 'SlowQT',
    })
    await createTask(mine.id, { assigneeId: me.id, status: 'in_progress', title: 'Fresh' })
    const old = new Date(Date.now() - 10 * DAY)
    await prisma.workItem.updateMany({
      where: { id: { in: [quiet.id, quietQt.id] } },
      data: { updatedAt: old },
    })
    const mention = await prisma.notification.create({
      data: {
        volunteerId: me.id,
        type: 'mention',
        title: 'Hal mentioned you',
        body: 'hey',
        link: '/projects/1#comment-2',
      },
    })
    await prisma.notification.create({
      data: { volunteerId: me.id, type: 'mention', title: 'Linkless', readAt: null },
    })
    await prisma.notification.create({
      data: { volunteerId: other.id, type: 'mention', title: 'Not mine' },
    })
    const submitted = await createQuickTask({
      creatorId: me.id,
      status: 'under_review',
      title: 'Done QT',
    })

    const { attention } = await clientAs(me).dashboard.get()
    const byKind = (k: string) => attention.filter((a) => a.kind === k)
    expect(
      byKind('applicants')
        .map((a) => a.title)
        .sort(),
    ).toEqual(['2 people want to help on "Mine"', 'Ann wants to help on "Solo"'])
    expect(byKind('changes_requested')).toEqual([
      expect.objectContaining({
        title: 'Changes requested on "Prop"',
        detail: 'Add dates',
        href: `/projects/${proposal.id}`,
      }),
    ])
    expect(
      byKind('quiet_task')
        .map((a) => [a.title, a.href])
        .sort(),
    ).toEqual([
      ['"Slow": no update for 10 days', `/projects/${mine.id}/tasks/${quiet.id}`],
      ['"SlowQT": no update for 10 days', `/quick-tasks/${quietQt.id}`],
    ])
    expect(byKind('mention')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Hal mentioned you',
          href: '/projects/1#comment-2',
          notificationId: mention.id,
        }),
        expect.objectContaining({ title: 'Linkless', href: '/dashboard' }),
      ]),
    )
    expect(byKind('mention')).toHaveLength(2)
    expect(byKind('submission')).toEqual([
      expect.objectContaining({ href: `/quick-tasks/${submitted.id}`, action: 'Review' }),
    ])
    expect(attention.some((a) => a.title.includes('Theirs'))).toBe(false)
  })

  it('lists an open invite for the person invited', async () => {
    const owner = await createVolunteer({ name: 'Ola Owner' })
    const me = await createVolunteer()
    const p = await createProject({ assigneeId: owner.id, title: 'Invited P' })
    const orphan = await createProject({ title: 'Orphan P' })
    await prisma.workItemInterest.createMany({
      data: [
        {
          workItemId: p.id,
          volunteerId: me.id,
          interestType: 'want_to_contribute',
          status: 'invited',
          message: 'Leaflets?',
          invitedById: owner.id,
        },
        {
          workItemId: orphan.id,
          volunteerId: me.id,
          interestType: 'want_to_contribute',
          status: 'invited',
        },
      ],
    })
    const invites = (await clientAs(me).dashboard.get()).attention.filter(
      (a) => a.kind === 'invite',
    )
    expect(invites.map((a) => [a.title, a.detail, a.href, a.action]).sort()).toEqual([
      ['Ola Owner invited you to help on "Invited P"', 'Leaflets?', `/projects/${p.id}`, 'Answer'],
      ['The owner invited you to help on "Orphan P"', null, `/projects/${orphan.id}`, 'Answer'],
    ])
    // Not a member yet, so not in My work.
    const { work } = await clientAs(me).dashboard.get()
    expect(work.some((w) => w.title === 'Invited P')).toBe(false)
  })

  it('lists submitted work for its reviewer, and work sent back for its assignee', async () => {
    const me = await createVolunteer()
    const helper = await createVolunteer()
    const admin = await createAdmin()
    const mine = await createProject({ assigneeId: me.id, title: 'Mine' })
    const theirs = await createProject({ assigneeId: helper.id, title: 'Theirs' })
    const submittedAt = new Date(Date.now() - DAY)
    const toReview = await createTask(mine.id, {
      assigneeId: helper.id,
      status: 'under_review',
      title: 'Poster',
      submittedAt,
    })
    await createTask(theirs.id, { assigneeId: me.id, status: 'under_review', title: 'Not mine' })
    // Sent back to me: listed as a change request, not as a quiet task.
    const sentBack = await createTask(theirs.id, {
      assigneeId: me.id,
      status: 'in_progress',
      title: 'Flyer',
      changesRequestedNote: 'Bigger font',
      updatedAt: new Date(Date.now() - 10 * DAY),
    })
    const sentBackQt = await createQuickTask({
      assigneeId: me.id,
      status: 'in_progress',
      title: 'Tweet',
      changesRequestedNote: 'Shorter',
    })
    const unset = await createQuickTask({ status: 'under_review', title: 'Claimed QT' })

    const mineNow = (await clientAs(me).dashboard.get()).attention
    expect(mineNow.filter((a) => a.kind === 'submission')).toEqual([
      expect.objectContaining({
        title: '"Poster" is submitted for review',
        href: `/projects/${mine.id}/tasks/${toReview.id}`,
        at: submittedAt,
      }),
    ])
    expect(
      mineNow
        .filter((a) => a.kind === 'changes_requested')
        .map((a) => [a.title, a.detail, a.href])
        .sort(),
    ).toEqual([
      [
        'Changes requested on "Flyer"',
        'Bigger font',
        `/projects/${theirs.id}/tasks/${sentBack.id}`,
      ],
      ['Changes requested on "Tweet"', 'Shorter', `/quick-tasks/${sentBackQt.id}`],
    ])
    expect(mineNow.some((a) => a.kind === 'quiet_task')).toBe(false)

    expect(mineNow.some((a) => a.asStaff)).toBe(false)

    // A Quick Task nobody set is any admin's to review, as an admin.
    const adminNow = (await clientAs(admin).dashboard.get()).attention
    expect(adminNow).toContainEqual(
      expect.objectContaining({ href: `/quick-tasks/${unset.id}`, asStaff: true }),
    )
  })

  it('asks only the owner to complete a running project whose every task is done', async () => {
    const [me, helper, admin] = await Promise.all([
      createVolunteer(),
      createVolunteer(),
      createAdmin(),
    ])
    const lastDone = new Date(Date.now() - DAY)
    const ready = await createProject({ assigneeId: me.id, status: 'in_progress', title: 'Ready' })
    await createTask(ready.id, { status: 'completed', completedAt: new Date(Date.now() - 3 * DAY) })
    await createTask(ready.id, { status: 'completed', completedAt: lastDone })
    await createTask(ready.id, { status: 'completed', completedAt: null })
    await prisma.workItemInterest.create({
      data: {
        workItemId: ready.id,
        volunteerId: helper.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    // Not yet: a task still open, no tasks at all, or not running.
    const open = await createProject({ assigneeId: me.id, status: 'in_progress', title: 'Open' })
    await createTask(open.id, { status: 'completed' })
    await createTask(open.id, { status: 'under_review' })
    await createProject({ assigneeId: me.id, status: 'in_progress', title: 'Empty' })
    const held = await createProject({ assigneeId: me.id, status: 'on_hold', title: 'Held' })
    await createTask(held.id, { status: 'completed' })

    const kindOf = async (v: Parameters<typeof clientAs>[0]) =>
      (await clientAs(v).dashboard.get()).attention.filter((a) => a.kind === 'ready_to_complete')
    expect(await kindOf(me)).toEqual([
      expect.objectContaining({
        title: '"Ready": every task is done',
        href: `/projects/${ready.id}`,
        action: 'Complete',
        at: lastDone,
      }),
    ])
    expect(await kindOf(helper)).toEqual([])
    expect(await kindOf(admin)).toEqual([])
  })

  it('offers discovery by skill, by chapter and Quick Tasks, skipping my own', async () => {
    const [chapter, away] = [await createChapter(), await createChapter()]
    const leeds = await createLocalGroup({
      name: 'Leeds',
      country: chapter.country,
      nationalChapterId: chapter.id,
    })
    const me = await createMember(chapter, { localGroupId: leeds.id })
    const skill = await createSkill({ name: 'Design' })
    await prisma.volunteerSkill.create({ data: { volunteerId: me.id, skillId: skill.id } })
    const mine = { nationalChapterId: chapter.id }
    const wanted = { ...mine, skills: { create: [{ skillId: skill.id, isRequired: true }] } }
    const match = await createProject({ status: 'ready', title: 'Match', ...wanted })
    await createProject({ status: 'ready', title: 'Joined', ...wanted }).then((p) =>
      prisma.workItemInterest.create({
        data: {
          workItemId: p.id,
          volunteerId: me.id,
          interestType: 'want_to_contribute',
          status: 'declined',
        },
      }),
    )
    await createProject({ status: 'ready', creatorId: me.id, title: 'My own', ...wanted })
    await createProject({ status: 'pending_review', title: 'Unreviewed', ...wanted })
    await createProject({
      status: 'ready',
      teamId: (await createTeam()).id,
      title: 'Other team',
      ...wanted,
    })
    await createProject({
      status: 'ready',
      title: 'Abroad',
      nationalChapterId: away.id,
      skills: wanted.skills,
    })
    await createProject({ status: 'ready', title: 'Near 2', ...mine })
    await createProject({ status: 'ready', title: 'Near 3', reach: 'REMOTE', ...mine })
    const near = await createProject({
      status: 'ready',
      title: 'Near',
      reach: 'LOCAL',
      localGroupId: leeds.id,
      ...mine,
    })
    const qt = await createQuickTask({ skillId: skill.id, title: 'Open QT', ...mine })
    await createQuickTask({ title: 'Plain QT', ...mine })
    await createQuickTask({ title: 'Abroad QT', nationalChapterId: away.id })

    const { find, hasSkills } = await clientAs(me).dashboard.get()
    expect(hasSkills).toBe(true)
    expect(find?.matches.items.map((i) => i.title)).toContain('Match')
    expect(find?.matches.items.map((i) => i.title)).not.toEqual(
      expect.arrayContaining(['Joined', 'My own', 'Unreviewed', 'Other team', 'Abroad']),
    )
    expect(find?.matches.items.find((i) => i.id === match.id)?.reason).toBe(
      'Uses your skills: Design',
    )
    // My own local group's first, though it is the newest.
    expect(find?.nearYou.items[0]).toMatchObject({
      id: near.id,
      reason: `Leeds, ${chapter.name}`,
    })
    expect(find?.nearYou.items.find((i) => i.title === 'Near 2')).toMatchObject({
      reason: `Across ${chapter.name}`,
    })
    expect(find?.nearYou.items.find((i) => i.title === 'Near 3')).toMatchObject({
      reason: `Remote, ${chapter.name}`,
    })
    expect(find?.quickTasks.items.find((i) => i.id === qt.id)).toMatchObject({
      reason: 'Skill: Design',
    })
    expect(find?.quickTasks.items.find((i) => i.title === 'Plain QT')).toMatchObject({
      reason: null,
    })
    expect(find?.quickTasks.items.map((i) => i.title)).not.toContain('Abroad QT')
    expect(find?.quickTasks.count).toBe(2)
    expect(find?.quickTasks.items.length).toBeLessThanOrEqual(3)

    // No skills and the holding pool: those two rows are empty.
    const bare = await clientAs(await createVolunteer({ country: null })).dashboard.get()
    expect(bare.hasSkills).toBe(false)
    expect(bare.find?.matches).toEqual({ count: 0, items: [] })
    expect(bare.find?.nearYou).toEqual({ count: 0, items: [] })
  })

  it('shows getting started until done, and only notifications before approval', async () => {
    const pending = await createVolunteer({ approvalStatus: 'pending', emailConfirmed: false })
    const d = await clientAs(pending).dashboard.get()
    expect(d.gettingStarted).toEqual({ approved: false, emailConfirmed: false, firstTask: false })
    expect(d).toMatchObject({ attention: [], work: [], find: null })

    const fresh = await createVolunteer()
    expect((await clientAs(fresh).dashboard.get()).gettingStarted).toEqual({
      approved: true,
      emailConfirmed: true,
      firstTask: false,
    })
    await createQuickTask({ assigneeId: fresh.id, status: 'completed' })
    expect((await clientAs(fresh).dashboard.get()).gettingStarted).toBeNull()

    const admin = await createAdmin({ approvalStatus: 'pending' })
    const asAdmin = await clientAs(admin).dashboard.get()
    expect(asAdmin.gettingStarted).toBeNull()
    expect(asAdmin.find).not.toBeNull()
  })

  it('offers the approval welcome until its notification is read', async () => {
    const me = await createVolunteer({ emailConfirmed: false })
    const c = clientAs(me)
    expect((await c.dashboard.get()).approvalWelcome).toBeNull()
    const note = await prisma.notification.create({
      data: { volunteerId: me.id, type: 'application_approved', title: 'Approved' },
    })
    expect((await c.dashboard.get()).approvalWelcome).toEqual({
      notificationId: note.id,
      emailConfirmed: false,
    })
    await prisma.volunteer.update({ where: { id: me.id }, data: { emailConfirmed: true } })
    expect((await c.dashboard.get()).approvalWelcome).toMatchObject({ emailConfirmed: true })
    await c.notifications.markRead({ id: note.id })
    expect((await c.dashboard.get()).approvalWelcome).toBeNull()
  })
})

describe('privacy.export', () => {
  it('bundles everything held about the volunteer, with contact details', async () => {
    const me = await createVolunteer({ discordHandle: 'me#1' })
    const other = await createVolunteer()
    const skill = await createSkill()
    await prisma.volunteerSkill.create({
      data: { volunteerId: me.id, skillId: skill.id, proficiencyLevel: 'x' },
    })
    const p = await createProject({ creatorId: me.id })
    await prisma.workItemInterest.create({
      data: { workItemId: p.id, volunteerId: me.id, interestType: 'want_to_own' },
    })
    await prisma.message.createMany({
      data: [
        {
          fromVolunteerId: me.id,
          toVolunteerId: other.id,
          subject: 'out',
          message: 'm',
          relatedWorkItemId: p.id,
        },
        { fromVolunteerId: other.id, toVolunteerId: me.id, subject: 'in', message: 'm' },
      ],
    })
    const out = await clientAs(me).privacy.export()
    expect(out.profile).toMatchObject({ email: me.email, discordHandle: 'me#1' })
    expect(out.skills).toEqual([expect.objectContaining({ id: skill.id, proficiencyLevel: 'x' })])
    expect(out.projects).toEqual([expect.objectContaining({ id: p.id, proposedById: me.id })])
    expect(out.interests).toEqual([
      expect.objectContaining({ projectId: p.id, interestType: 'want_to_own' }),
    ])
    expect(out.messagesSent).toEqual([
      expect.objectContaining({ subject: 'out', relatedProjectId: p.id }),
    ])
    expect(out.messagesReceived).toEqual([
      expect.objectContaining({ subject: 'in', fromVolunteerId: other.id }),
    ])
    expect(typeof out.exportedAt).toBe('string')
  })

  it('is NOT_FOUND if the volunteer row has vanished', async () => {
    const me = await createVolunteer()
    const c = clientAs(me)
    await prisma.volunteer.delete({ where: { id: me.id } })
    await expect(c.privacy.export()).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
