import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { ApprovalStatus } from '@/generated/prisma/enums'
import { UpdateBugReportSchema } from '@/lib/schemas'
import { adminProcedure } from '../../procedures'
import { clearNotifications, notifyUser } from '@/lib/notify'

/** Tells a report's author, in the app and by email, that it was resolved or won't be fixed. */
async function notifyReporterOfOutcome(
  report: { id: number; reporterId: number; title: string; resolutionNotes: string | null },
  status: 'resolved' | 'wont_fix',
) {
  const title =
    status === 'resolved'
      ? `Your bug report was resolved: ${report.title}`
      : `Your bug report won't be fixed: ${report.title}`
  const link = `/bugs/${report.id}`
  await notifyUser(
    report.reporterId,
    'bug_report_resolved',
    title,
    report.resolutionNotes,
    link,
    {
      message:
        report.resolutionNotes ??
        (status === 'resolved'
          ? 'Thank you for reporting it.'
          : 'Thank you for reporting it. We have decided not to change this.'),
      ctaLabel: 'View your report',
      ctaUrl: link,
    },
    report.id,
  )
}

export const adminBugReportsRouter = {
  list: adminProcedure
    .input(z.object({ status: z.string().optional(), category: z.string().optional() }))
    .handler(async ({ input }) => {
      const reports = await prisma.bugReport.findMany({
        where: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.category ? { category: input.category } : {}),
        },
        include: {
          reporter: { select: { name: true } },
          assignee: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      return reports.map((r) => ({
        id: r.id,
        reporterId: r.reporterId,
        reporterEmail: r.reporterEmail,
        title: r.title,
        description: r.description,
        pageUrl: r.pageUrl,
        category: r.category,
        severity: r.severity,
        status: r.status,
        resolutionNotes: r.resolutionNotes,
        resolvedById: r.resolvedById,
        resolvedAt: r.resolvedAt,
        assigneeId: r.assigneeId,
        assigneeName: r.assignee?.name ?? null,
        createdAt: r.createdAt,
        reporterName: r.reporter?.name ?? null,
      }))
    }),

  assign: adminProcedure
    .input(z.object({ id: z.number().int(), volunteerId: z.number().int() }))
    .handler(async ({ input }) => {
      const report = await prisma.bugReport.findUnique({ where: { id: input.id } })
      if (!report) throw new ORPCError('NOT_FOUND', { message: 'Bug report not found' })

      const assignee = await prisma.volunteer.findFirst({
        where: { id: input.volunteerId, deletedAt: null },
      })
      if (!assignee) throw new ORPCError('BAD_REQUEST', { message: 'Volunteer not found' })
      if (assignee.approvalStatus !== ApprovalStatus.approved) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Cannot assign a bug report to a volunteer who is not yet approved',
        })
      }

      await prisma.bugReport.update({ where: { id: input.id }, data: { assigneeId: assignee.id } })

      return { message: 'Bug report assigned' }
    }),

  update: adminProcedure
    .input(z.object({ id: z.number().int() }).merge(UpdateBugReportSchema))
    .handler(async ({ input, context }) => {
      const report = await prisma.bugReport.findUnique({ where: { id: input.id } })
      if (!report) throw new ORPCError('NOT_FOUND', { message: 'Bug report not found' })

      const data: Record<string, unknown> = {}

      if (input.status) {
        data.status = input.status
        if (input.status === 'resolved' || input.status === 'wont_fix') {
          data.resolvedById = context.volunteer.id
          data.resolvedAt = new Date()
        }
      }

      if (input.resolutionNotes !== undefined) {
        data.resolutionNotes = input.resolutionNotes
      }

      if (Object.keys(data).length > 0) {
        await prisma.bugReport.update({ where: { id: input.id }, data })
      }

      if (input.status === 'resolved' || input.status === 'wont_fix') {
        await clearNotifications('new_bug_report', input.id)
        if (
          input.status !== report.status &&
          report.reporterId &&
          report.reporterId !== context.volunteer.id
        ) {
          await notifyReporterOfOutcome(
            {
              id: report.id,
              reporterId: report.reporterId,
              title: report.title,
              resolutionNotes: input.resolutionNotes ?? report.resolutionNotes,
            },
            input.status,
          )
        }
      }

      return { message: 'Bug report updated' }
    }),
}
