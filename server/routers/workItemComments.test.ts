import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createTask,
  createQuickTask,
  createTeam,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

describe('workItemComments.list', () => {
  it('follows work-item visibility, and reports whether the viewer may post', async () => {
    const owner = await createVolunteer()
    const helper = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: helper.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await expect(
      clientAs(other).workItemComments.list({ workItemId: 999_999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await clientAs(owner).workItemComments.list({ workItemId: project.id })).canPost).toBe(
      true,
    )
    expect((await clientAs(helper).workItemComments.list({ workItemId: project.id })).canPost).toBe(
      true,
    )
    expect((await clientAs(other).workItemComments.list({ workItemId: project.id })).canPost).toBe(
      false,
    )

    const hidden = await createProject({ status: 'pending_review', creatorId: owner.id })
    await expect(
      clientAs(other).workItemComments.list({ workItemId: hidden.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // A task follows its parent; a team project restricts non-members.
    const team = await createTeam()
    const teamProject = await createProject({ teamId: team.id, assigneeId: owner.id })
    const task = await createTask(teamProject.id)
    await expect(
      clientAs(other).workItemComments.list({ workItemId: task.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: other.id } })
    expect((await clientAs(other).workItemComments.list({ workItemId: task.id })).canPost).toBe(
      false,
    )
    expect((await clientAs(owner).workItemComments.list({ workItemId: task.id })).canPost).toBe(
      true,
    )

    // A quick task with no project context: only its assignee may post.
    const qt = await createQuickTask({ assigneeId: helper.id, status: 'in_progress' })
    expect((await clientAs(helper).workItemComments.list({ workItemId: qt.id })).canPost).toBe(true)
    expect(
      (await clientAs(await createAdmin()).workItemComments.list({ workItemId: qt.id })).canPost,
    ).toBe(true)
  })
})

describe('workItemComments.add', () => {
  it('posts for participants and notifies the other participants', async () => {
    const creator = await createVolunteer()
    const owner = await createVolunteer()
    const assignee = await createVolunteer()
    const other = await createVolunteer()
    const project = await createProject({ creatorId: creator.id, assigneeId: owner.id })
    const task = await createTask(project.id, { assigneeId: assignee.id, creatorId: owner.id })

    await expect(
      clientAs(other).workItemComments.add({ workItemId: 999_999, content: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      clientAs(other).workItemComments.add({ workItemId: task.id, content: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const res = await clientAs(assignee).workItemComments.add({
      workItemId: task.id,
      content: '  done  ',
    })
    expect(res).toMatchObject({ message: 'Comment added' })
    await vi.waitFor(async () => {
      const notes = await prisma.notification.findMany({ where: { type: 'work_item_comment' } })
      expect(notes.map((n) => n.volunteerId).sort()).toEqual([owner.id].sort())
      expect(notes[0].link).toBe(`/projects/${project.id}`)
    })
    const { comments } = await clientAs(owner).workItemComments.list({ workItemId: task.id })
    expect(comments[0]).toMatchObject({ content: 'done', authorName: assignee.name })

    // Project comment by the owner notifies the creator; quick-task link points at the task.
    await clientAs(owner).workItemComments.add({ workItemId: project.id, content: 'update' })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { type: 'work_item_comment', volunteerId: creator.id },
        }),
      ).toBe(1),
    )
    // A task with no parent (data corruption) still gets a link, to the dashboard.
    const admin = await createAdmin()
    const orphan = await prisma.workItem.create({
      data: {
        type: 'TASK',
        status: 'open',
        title: 'orphan',
        assigneeId: admin.id,
        creatorId: owner.id,
      },
    })
    await clientAs(admin).workItemComments.add({ workItemId: orphan.id, content: 'o' })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findFirst({
          where: { type: 'work_item_comment', volunteerId: owner.id, link: '/dashboard' },
        }),
      ).not.toBeNull(),
    )
    const qt = await createQuickTask({
      assigneeId: assignee.id,
      creatorId: owner.id,
      status: 'in_progress',
    })
    await clientAs(assignee).workItemComments.add({ workItemId: qt.id, content: 'q' })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findFirst({
          where: { type: 'work_item_comment', link: `/quick-tasks/${qt.id}` },
        }),
      ).not.toBeNull(),
    )
  })
})

/** A project with an owner, two accepted helpers and an outsider who can see but not post. */
async function discussion() {
  const owner = await createVolunteer({ name: 'Olive Owner' })
  const helper = await createVolunteer({ name: 'Hal Helper' })
  const other = await createVolunteer({ name: 'Hana Helper' })
  const outsider = await createVolunteer({ name: 'Otto Outsider' })
  const project = await createProject({ assigneeId: owner.id, title: 'Westminster' })
  for (const v of [helper, other]) {
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: v.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
  }
  const people = [owner.id, helper.id, other.id, outsider.id]
  /** Recipients of `type` among this discussion's people, sorted. */
  const notesOf = async (type: string) => {
    const notes = await prisma.notification.findMany({
      where: { type, volunteerId: { in: people } },
    })
    return notes.map((n) => n.volunteerId).sort()
  }
  return { owner, helper, other, outsider, project, notesOf }
}

describe('workItemComments replies', () => {
  it('nests replies one level deep, oldest first, and tells the thread starter', async () => {
    const { owner, helper, other, project, notesOf } = await discussion()
    const top = await clientAs(helper).workItemComments.add({
      workItemId: project.id,
      content: 'Who has banners?',
    })
    const reply = await clientAs(owner).workItemComments.add({
      workItemId: project.id,
      content: 'I do',
      parentId: top.id,
    })
    // Replying to a reply joins the same thread.
    await clientAs(other).workItemComments.add({
      workItemId: project.id,
      content: 'Me too',
      parentId: reply.id,
    })
    await clientAs(owner).workItemComments.add({ workItemId: project.id, content: 'Later' })

    const { comments } = await clientAs(helper).workItemComments.list({ workItemId: project.id })
    expect(comments.map((c) => c.content)).toEqual(['Later', 'Who has banners?'])
    expect(comments[1].replies.map((r) => [r.content, r.parentId])).toEqual([
      ['I do', top.id],
      ['Me too', top.id],
    ])
    // The thread starter hears about each reply; the owner hears about the helper's post.
    await vi.waitFor(async () =>
      expect(await notesOf('work_item_comment')).toEqual(
        [owner.id, helper.id, helper.id, owner.id].sort(),
      ),
    )
  })

  it('refuses a reply to a missing, deleted or foreign comment', async () => {
    const { owner, project } = await discussion()
    const elsewhere = await createProject({ assigneeId: owner.id })
    const foreign = await clientAs(owner).workItemComments.add({
      workItemId: elsewhere.id,
      content: 'x',
    })
    const gone = await clientAs(owner).workItemComments.add({
      workItemId: project.id,
      content: 'y',
    })
    await clientAs(owner).workItemComments.delete({ id: gone.id })
    for (const parentId of [999_999, foreign.id, gone.id]) {
      await expect(
        clientAs(owner).workItemComments.add({ workItemId: project.id, content: 'r', parentId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
  })
})

describe('workItemComments mentions', () => {
  it('lists who can be mentioned, only to people who can post', async () => {
    const { owner, helper, other, outsider, project } = await discussion()
    const admin = await createAdmin({ name: 'Ada Admin' })
    const quietAdmin = await createAdmin()
    const gone = await createVolunteer({ name: 'Gone', deletedAt: new Date() })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: gone.id,
        interestType: 'want_to_contribute',
        status: 'accepted',
      },
    })
    await clientAs(admin).workItemComments.add({ workItemId: project.id, content: 'hi' })

    const asHelper = await clientAs(helper).workItemComments.list({ workItemId: project.id })
    expect(asHelper.mentionable.map((m) => m.name)).toEqual([admin.name, other.name, owner.name])
    expect(
      (await clientAs(outsider).workItemComments.list({ workItemId: project.id })).mentionable,
    ).toEqual([])
    const asQuiet = await clientAs(quietAdmin).workItemComments.list({ workItemId: project.id })
    expect(asQuiet.mentionable.map((m) => m.id)).not.toContain(quietAdmin.id)

    // A task thread offers its project's members too.
    const task = await createTask(project.id, { assigneeId: other.id })
    const onTask = await clientAs(other).workItemComments.list({ workItemId: task.id })
    expect(onTask.mentionable.map((m) => m.id).sort()).toEqual([owner.id, helper.id].sort())
  })

  it('notifies each mentioned member exactly once, and nobody outside the project', async () => {
    const { owner, helper, other, outsider, project, notesOf } = await discussion()
    const task = await createTask(project.id, { assigneeId: helper.id })
    const { id } = await clientAs(helper).workItemComments.add({
      workItemId: task.id,
      content: `@[Olive Owner](${owner.id}) @[Hana Helper](${other.id}) @[Olive Owner](${owner.id}) @[Otto](${outsider.id}) @[Me](${helper.id})`,
    })
    await vi.waitFor(async () =>
      expect(await notesOf('mention')).toEqual([owner.id, other.id].sort()),
    )
    const note = await prisma.notification.findFirstOrThrow({
      where: { type: 'mention', volunteerId: owner.id },
    })
    expect(note).toMatchObject({
      title: 'Hal Helper mentioned you on "' + task.title + '"',
      body: '@Olive Owner @Hana Helper @Olive Owner @Otto @Me',
      link: `/projects/${project.id}/tasks/${task.id}#comment-${id}`,
      entityId: id,
    })
    // The owner was mentioned, so the plain comment notice is not sent to them as well.
    expect(await notesOf('work_item_comment')).toEqual([])
  })

  it('on edit, notifies only members newly mentioned', async () => {
    const { owner, helper, other, project, notesOf } = await discussion()
    const { id } = await clientAs(helper).workItemComments.add({
      workItemId: project.id,
      content: `hi @[Olive Owner](${owner.id})`,
    })
    await vi.waitFor(async () => expect(await notesOf('mention')).toEqual([owner.id]))
    await clientAs(helper).workItemComments.edit({
      id,
      content: `hi @[Olive Owner](${owner.id}) and @[Hana Helper](${other.id})`,
    })
    await vi.waitFor(async () =>
      expect(await notesOf('mention')).toEqual([owner.id, other.id].sort()),
    )
    // An edit that adds no one sends nothing.
    await clientAs(helper).workItemComments.edit({ id, content: 'plain' })
    expect(await notesOf('mention')).toEqual([owner.id, other.id].sort())
  })
})

describe('workItemComments edit and delete', () => {
  it('lets only the author edit, while they can still post', async () => {
    const { owner, helper, project } = await discussion()
    const admin = await createAdmin()
    const { id } = await clientAs(helper).workItemComments.add({
      workItemId: project.id,
      content: 'first',
    })
    for (const who of [owner, admin]) {
      await expect(
        clientAs(who).workItemComments.edit({ id, content: 'hijack' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    await expect(
      clientAs(helper).workItemComments.edit({ id: 999_999, content: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    expect(
      await clientAs(helper).workItemComments.edit({ id, content: '  second  ' }),
    ).toMatchObject({ message: 'Comment updated' })
    const [c] = (await clientAs(helper).workItemComments.list({ workItemId: project.id })).comments
    expect(c).toMatchObject({ content: 'second', canEdit: true, canDelete: true })
    expect(c.editedAt).not.toBeNull()
    const asOwner = (await clientAs(owner).workItemComments.list({ workItemId: project.id }))
      .comments[0]
    expect(asOwner).toMatchObject({ canEdit: false, canDelete: false })

    // Once they have left the project they can no longer edit, but can still delete.
    await prisma.workItemInterest.updateMany({
      where: { workItemId: project.id, volunteerId: helper.id },
      data: { status: 'withdrawn' },
    })
    await expect(
      clientAs(helper).workItemComments.edit({ id, content: 'third' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await clientAs(helper).workItemComments.delete({ id })).toMatchObject({
      message: 'Comment deleted',
    })
  })

  it('soft-deletes for the author or an admin, keeping replies in place', async () => {
    const { owner, helper, project } = await discussion()
    const admin = await createAdmin()
    const top = await clientAs(helper).workItemComments.add({
      workItemId: project.id,
      content: 'secret plan',
    })
    const reply = await clientAs(owner).workItemComments.add({
      workItemId: project.id,
      content: 'nice',
      parentId: top.id,
    })
    await expect(clientAs(owner).workItemComments.delete({ id: top.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await clientAs(helper).workItemComments.delete({ id: top.id })
    await clientAs(admin).workItemComments.delete({ id: reply.id })
    await expect(clientAs(helper).workItemComments.delete({ id: top.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      clientAs(helper).workItemComments.edit({ id: top.id, content: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const [c] = (await clientAs(owner).workItemComments.list({ workItemId: project.id })).comments
    expect(c).toMatchObject({ deleted: true, content: '', canEdit: false, canDelete: false })
    expect(c.replies).toMatchObject([{ deleted: true, content: '' }])
    expect(await prisma.workItemComment.count({ where: { workItemId: project.id } })).toBe(2)
  })
})
