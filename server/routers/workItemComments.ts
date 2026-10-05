import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { notifyUser } from '@/lib/notify'
import { canViewWorkItem, canPostComment, resolveProjectPrivy } from '@/lib/work-item'
import { mentionedIds, mentionsToPlain, type MentionMember } from '@/lib/mentions'
import { authedProcedure } from '../procedures'
import { ApprovalStatus, InterestStatus, WorkItemType } from '@/generated/prisma/enums'

const WORK_ITEM_SELECT = {
  id: true,
  type: true,
  status: true,
  title: true,
  parentId: true,
  creatorId: true,
  assigneeId: true,
  teamId: true,
  country: true,
  remoteEligibility: true,
} as const

type LoadedWorkItem = {
  id: number
  type: string
  status: string
  title: string
  parentId: number | null
  creatorId: number | null
  assigneeId: number | null
  teamId: number | null
  country: string | null
  remoteEligibility: string
}

type Viewer = { id: number; isAdmin: boolean }

async function loadWithParent(id: number) {
  const item = (await prisma.workItem.findUnique({
    where: { id },
    select: WORK_ITEM_SELECT,
  })) as LoadedWorkItem | null
  if (!item) return null
  return withParent(item)
}

async function withParent(item: LoadedWorkItem) {
  const parent =
    item.type === WorkItemType.TASK && item.parentId
      ? ((await prisma.workItem.findUnique({
          where: { id: item.parentId },
          select: WORK_ITEM_SELECT,
        })) as LoadedWorkItem | null)
      : null
  return { item, parent }
}

function commentLink(item: LoadedWorkItem): string {
  if (item.type === WorkItemType.PROJECT) return `/projects/${item.id}`
  if (item.type === WorkItemType.TASK && item.parentId) return `/projects/${item.parentId}`
  if (item.type === WorkItemType.QUICK_TASK) return `/quick-tasks/${item.id}`
  return '/dashboard'
}

/** Where the thread itself is shown, so a mention's link lands on the comment. */
function threadLink(item: LoadedWorkItem): string {
  if (item.type === WorkItemType.TASK && item.parentId) {
    return `/projects/${item.parentId}/tasks/${item.id}`
  }
  return commentLink(item)
}

function projectIdOf(item: LoadedWorkItem): number | null {
  if (item.type === WorkItemType.PROJECT) return item.id
  if (item.type === WorkItemType.TASK) return item.parentId
  return null
}

// Whether `viewer` may post on this item. Resolves the accepted-helper lookup
// for PROJECT/TASK.
async function resolveCanPost(
  item: LoadedWorkItem,
  parent: LoadedWorkItem | null,
  viewer: Viewer,
): Promise<boolean> {
  let isAcceptedHelper = false
  if (!viewer.isAdmin) {
    const projectId = projectIdOf(item)
    if (projectId) {
      const interest = await prisma.workItemInterest.findFirst({
        where: { workItemId: projectId, volunteerId: viewer.id, status: InterestStatus.accepted },
        select: { id: true },
      })
      isAcceptedHelper = Boolean(interest)
    }
  }
  return canPostComment(item, viewer, { parent, isAcceptedHelper })
}

// Who can be @mentioned: the item's creator, owner and assignee, the project's accepted
// helpers, and any admin already in the thread.
async function mentionableMembers(
  item: LoadedWorkItem,
  parent: LoadedWorkItem | null,
): Promise<MentionMember[]> {
  const ids = new Set<number>()
  for (const id of [item.creatorId, item.assigneeId, parent?.assigneeId ?? null]) {
    if (id) ids.add(id)
  }
  const projectId = projectIdOf(item)
  if (projectId) {
    const helpers = await prisma.workItemInterest.findMany({
      where: { workItemId: projectId, status: InterestStatus.accepted },
      select: { volunteerId: true },
    })
    for (const h of helpers) ids.add(h.volunteerId)
  }
  const adminAuthors = await prisma.workItemComment.findMany({
    where: { workItemId: item.id, author: { isAdmin: true } },
    select: { authorId: true },
    distinct: ['authorId'],
  })
  for (const a of adminAuthors) if (a.authorId) ids.add(a.authorId)

  return prisma.volunteer.findMany({
    where: { id: { in: [...ids] }, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

/** Notifies each member mentioned in `content` (and not in `already`) once; returns their ids. */
async function notifyMentions(
  loaded: { item: LoadedWorkItem; parent: LoadedWorkItem | null },
  author: { id: number; name: string },
  commentId: number,
  content: string,
  already: number[] = [],
): Promise<Set<number>> {
  const wanted = mentionedIds(content).filter((id) => id !== author.id && !already.includes(id))
  if (wanted.length === 0) return new Set()
  const members = new Set((await mentionableMembers(loaded.item, loaded.parent)).map((m) => m.id))
  const recipients = new Set(wanted.filter((id) => members.has(id)))
  const link = `${threadLink(loaded.item)}#comment-${commentId}`
  for (const rid of recipients) {
    await notifyUser(
      rid,
      'mention',
      `${author.name} mentioned you on "${loaded.item.title}"`,
      mentionsToPlain(content).slice(0, 200),
      link,
      undefined,
      commentId,
    )
  }
  return recipients
}

/** Loads a comment and its work item, or NOT_FOUND if either is gone or the comment is deleted. */
async function loadComment(id: number) {
  const comment = await prisma.workItemComment.findUnique({
    where: { id },
    include: { workItem: { select: WORK_ITEM_SELECT } },
  })
  if (!comment || comment.deletedAt) {
    throw new ORPCError('NOT_FOUND', { message: 'Comment not found' })
  }
  return { comment, loaded: await withParent(comment.workItem as LoadedWorkItem) }
}

export const workItemCommentsRouter = {
  list: authedProcedure
    .input(z.object({ workItemId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const loaded = await loadWithParent(input.workItemId)
      if (!loaded) throw new ORPCError('NOT_FOUND', { message: 'Work item not found' })

      const viewer = {
        id: context.volunteer.id,
        isAdmin: Boolean(context.volunteer.isAdmin),
        isApproved: context.volunteer.approvalStatus === ApprovalStatus.approved,
        country: context.volunteer.country,
      }
      // Only a project, and a task through its project, has a scope to be exempt from.
      const project =
        loaded.item.type === WorkItemType.PROJECT
          ? loaded.item
          : loaded.item.type === WorkItemType.TASK
            ? loaded.parent
            : null
      const privy = project ? await resolveProjectPrivy(project, viewer) : undefined
      if (!canViewWorkItem(loaded.item, viewer, loaded.parent, privy)) {
        throw new ORPCError('NOT_FOUND', { message: 'Work item not found' })
      }

      const rows = await prisma.workItemComment.findMany({
        where: { workItemId: input.workItemId },
        include: { author: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      const canPost = await resolveCanPost(loaded.item, loaded.parent, viewer)

      const shape = (c: (typeof rows)[number]) => {
        const deleted = c.deletedAt !== null
        const isAuthor = c.authorId === viewer.id
        return {
          id: c.id,
          parentId: c.parentId,
          workItemId: c.workItemId,
          authorId: c.authorId,
          authorName: c.author?.name ?? null,
          content: deleted ? '' : c.content,
          createdAt: c.createdAt,
          editedAt: c.editedAt,
          deleted,
          canEdit: !deleted && isAuthor && canPost,
          canDelete: !deleted && (isAuthor || viewer.isAdmin),
        }
      }
      // Top-level comments newest first; each one's replies oldest first beneath it.
      const replies = new Map<number, ReturnType<typeof shape>[]>()
      for (const c of [...rows].reverse()) {
        if (c.parentId === null) continue
        replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), shape(c)])
      }
      const comments = rows
        .filter((c) => c.parentId === null)
        .map((c) => ({ ...shape(c), replies: replies.get(c.id) ?? [] }))

      return {
        canPost,
        mentionable: canPost
          ? (await mentionableMembers(loaded.item, loaded.parent)).filter((m) => m.id !== viewer.id)
          : [],
        comments,
      }
    }),

  add: authedProcedure
    .input(
      z.object({
        workItemId: z.number().int(),
        content: z.string().min(1),
        parentId: z.number().int().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const loaded = await loadWithParent(input.workItemId)
      if (!loaded) throw new ORPCError('NOT_FOUND', { message: 'Work item not found' })

      const viewer = { id: volunteer.id, isAdmin: Boolean(volunteer.isAdmin) }
      if (!(await resolveCanPost(loaded.item, loaded.parent, viewer))) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized to comment here' })
      }

      // A reply to a reply joins the same top-level thread.
      let parent: { id: number; authorId: number | null } | null = null
      if (input.parentId !== undefined) {
        const target = await prisma.workItemComment.findUnique({
          where: { id: input.parentId },
          include: { parent: { select: { id: true, authorId: true } } },
        })
        if (!target || target.workItemId !== input.workItemId || target.deletedAt) {
          throw new ORPCError('NOT_FOUND', { message: 'Comment not found' })
        }
        parent = target.parent ?? target
      }

      const content = input.content.trim()
      const comment = await prisma.workItemComment.create({
        data: {
          workItemId: input.workItemId,
          authorId: volunteer.id,
          content,
          parentId: parent?.id ?? null,
        },
      })

      // The assignee's comment on their project task is the update the inactivity job
      // waits for, so it restarts the clock.
      if (loaded.item.type === WorkItemType.TASK && loaded.item.assigneeId === volunteer.id) {
        await prisma.workItem.update({
          where: { id: loaded.item.id },
          data: { updatedAt: new Date(), nudgeSentAt: null, finalWarningSentAt: null },
        })
      }

      const mentioned = await notifyMentions(loaded, volunteer, comment.id, content)

      // Notify the other participants (in-app only); a mention already told its recipient.
      const recipientIds = new Set<number>()
      for (const id of [
        loaded.item.creatorId,
        loaded.item.assigneeId,
        loaded.parent?.assigneeId ?? null,
        parent?.authorId ?? null,
      ]) {
        if (id && id !== volunteer.id && !mentioned.has(id)) recipientIds.add(id)
      }
      const link = commentLink(loaded.item)
      for (const rid of recipientIds) {
        await notifyUser(
          rid,
          'work_item_comment',
          `New comment on "${loaded.item.title}"`,
          mentionsToPlain(content).slice(0, 200),
          link,
        )
      }

      return { id: comment.id, message: 'Comment added' }
    }),

  edit: authedProcedure
    .input(z.object({ id: z.number().int(), content: z.string().min(1) }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const { comment, loaded } = await loadComment(input.id)
      const viewer = { id: volunteer.id, isAdmin: Boolean(volunteer.isAdmin) }
      if (
        comment.authorId !== volunteer.id ||
        !(await resolveCanPost(loaded.item, loaded.parent, viewer))
      ) {
        throw new ORPCError('FORBIDDEN', { message: 'You can only edit your own comments' })
      }

      const content = input.content.trim()
      await prisma.workItemComment.update({
        where: { id: comment.id },
        data: { content, editedAt: new Date() },
      })
      await notifyMentions(loaded, volunteer, comment.id, content, mentionedIds(comment.content))
      return { message: 'Comment updated' }
    }),

  delete: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const { comment } = await loadComment(input.id)
      if (comment.authorId !== volunteer.id && !volunteer.isAdmin) {
        throw new ORPCError('FORBIDDEN', { message: 'You can only delete your own comments' })
      }
      await prisma.workItemComment.update({
        where: { id: comment.id },
        data: { deletedAt: new Date() },
      })
      return { message: 'Comment deleted' }
    }),
}
