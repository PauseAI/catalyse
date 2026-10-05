import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { notifyUser, notifyAdmins } from '@/lib/notify'
import { canViewBugReport, canPostBugReportComment } from '@/lib/bug-report-access'
import { authedProcedure } from '../procedures'

/** Loads a comment and its report, or NOT_FOUND if the comment is gone or deleted. */
async function loadComment(id: number) {
  const comment = await prisma.bugReportComment.findUnique({
    where: { id },
    include: { bugReport: { select: { reporterId: true } } },
  })
  if (!comment || comment.deletedAt) {
    throw new ORPCError('NOT_FOUND', { message: 'Comment not found' })
  }
  return comment
}

export const bugReportCommentsRouter = {
  list: authedProcedure
    .input(z.object({ bugReportId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const report = await prisma.bugReport.findUnique({
        where: { id: input.bugReportId },
        select: { id: true, reporterId: true, title: true },
      })
      if (!report) throw new ORPCError('NOT_FOUND', { message: 'Bug report not found' })

      const viewer = { id: context.volunteer.id, isAdmin: Boolean(context.volunteer.isAdmin) }
      if (!canViewBugReport(report, viewer)) {
        throw new ORPCError('NOT_FOUND', { message: 'Bug report not found' })
      }

      const comments = await prisma.bugReportComment.findMany({
        where: { bugReportId: input.bugReportId },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      })
      const canPost = canPostBugReportComment(report, viewer)

      return {
        canPost,
        comments: comments.map((c) => {
          const deleted = c.deletedAt !== null
          const isAuthor = c.authorId === viewer.id
          return {
            id: c.id,
            bugReportId: c.bugReportId,
            authorId: c.authorId,
            authorName: c.author?.name ?? null,
            content: deleted ? '' : c.content,
            createdAt: c.createdAt,
            editedAt: c.editedAt,
            deleted,
            canEdit: !deleted && isAuthor && canPost,
            canDelete: !deleted && (isAuthor || viewer.isAdmin),
          }
        }),
      }
    }),

  add: authedProcedure
    .input(z.object({ bugReportId: z.number().int(), content: z.string().min(1) }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const report = await prisma.bugReport.findUnique({
        where: { id: input.bugReportId },
        select: { id: true, reporterId: true, title: true },
      })
      if (!report) throw new ORPCError('NOT_FOUND', { message: 'Bug report not found' })

      const viewer = { id: volunteer.id, isAdmin: Boolean(volunteer.isAdmin) }
      if (!canPostBugReportComment(report, viewer)) {
        throw new ORPCError('FORBIDDEN', { message: 'Not authorized to comment here' })
      }

      const comment = await prisma.bugReportComment.create({
        data: {
          bugReportId: input.bugReportId,
          authorId: volunteer.id,
          content: input.content.trim(),
        },
      })

      const link = `/bugs/${report.id}`
      if (viewer.isAdmin) {
        if (report.reporterId && report.reporterId !== volunteer.id) {
          await notifyUser(
            report.reporterId,
            'bug_report_comment_reply',
            `New reply on your bug report: ${report.title}`,
            input.content.slice(0, 200),
            link,
          )
        }
      } else {
        await notifyAdmins(
          'bug_report_comment',
          `New comment on bug report: ${report.title}`,
          input.content.slice(0, 200),
          link,
        )
      }

      return { id: comment.id, message: 'Comment added' }
    }),

  edit: authedProcedure
    .input(z.object({ id: z.number().int(), content: z.string().min(1) }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const comment = await loadComment(input.id)
      const viewer = { id: volunteer.id, isAdmin: Boolean(volunteer.isAdmin) }
      if (
        comment.authorId !== volunteer.id ||
        !canPostBugReportComment(comment.bugReport, viewer)
      ) {
        throw new ORPCError('FORBIDDEN', { message: 'You can only edit your own comments' })
      }
      await prisma.bugReportComment.update({
        where: { id: comment.id },
        data: { content: input.content.trim(), editedAt: new Date() },
      })
      return { message: 'Comment updated' }
    }),

  delete: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const comment = await loadComment(input.id)
      if (comment.authorId !== volunteer.id && !volunteer.isAdmin) {
        throw new ORPCError('FORBIDDEN', { message: 'You can only delete your own comments' })
      }
      await prisma.bugReportComment.update({
        where: { id: comment.id },
        data: { deletedAt: new Date() },
      })
      return { message: 'Comment deleted' }
    }),
}
