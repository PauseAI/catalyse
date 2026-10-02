import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { createNotification, notifyUser } from '@/lib/notify'
import { checkRateLimit } from '@/lib/rate-limit'
import { canViewBugReport } from '@/lib/bug-report-access'
import { CreateBugReportSchema } from '@/lib/schemas'
import { authedProcedure } from '../procedures'

export const bugReportsRouter = {
  listMine: authedProcedure.handler(async ({ context }) => {
    const reports = await prisma.bugReport.findMany({
      where: { reporterId: context.volunteer.id },
      include: { assignee: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return reports.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      severity: r.severity,
      status: r.status,
      resolutionNotes: r.resolutionNotes,
      assigneeName: r.assignee?.name ?? null,
      createdAt: r.createdAt,
    }))
  }),

  getById: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const report = await prisma.bugReport.findUnique({
        where: { id: input.id },
        include: {
          reporter: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      })
      if (!report) throw new ORPCError('NOT_FOUND', { message: 'Bug report not found' })

      const viewer = { id: context.volunteer.id, isAdmin: Boolean(context.volunteer.isAdmin) }
      if (!canViewBugReport(report, viewer)) {
        throw new ORPCError('NOT_FOUND', { message: 'Bug report not found' })
      }

      return {
        id: report.id,
        reporterId: report.reporterId,
        reporterEmail: report.reporterEmail,
        reporterName: report.reporter?.name ?? null,
        title: report.title,
        description: report.description,
        pageUrl: report.pageUrl,
        category: report.category,
        severity: report.severity,
        status: report.status,
        resolutionNotes: report.resolutionNotes,
        resolvedById: report.resolvedById,
        resolvedAt: report.resolvedAt,
        assigneeId: report.assigneeId,
        assigneeName: report.assignee?.name ?? null,
        createdAt: report.createdAt,
        isMine: report.reporterId === viewer.id,
      }
    }),

  create: authedProcedure.input(CreateBugReportSchema).handler(async ({ input, context }) => {
    const { allowed, retryAfterMs } = checkRateLimit(context.request, 'bug-reports', {
      limit: 5,
      windowMs: 60_000,
    })
    if (!allowed) throw new ORPCError('TOO_MANY_REQUESTS', { cause: { retryAfterMs } })

    const volunteer = context.volunteer

    const report = await prisma.bugReport.create({
      data: {
        reporterId: volunteer.id,
        reporterEmail: volunteer.email,
        title: input.title.trim(),
        description: input.description,
        pageUrl: input.pageUrl ?? null,
        category: input.category ?? 'bug',
        severity: input.severity ?? 'medium',
      },
    })

    const admins = await prisma.volunteer.findMany({
      where: { isAdmin: true, id: { not: volunteer.id } },
      select: { id: true, isTechnicalAdmin: true },
    })
    const notifyTitle = `New ${input.category ?? 'bug'}: ${input.title.trim()}`
    const notifyBody = `Severity: ${input.severity ?? 'medium'}`
    await createNotification(
      volunteer.id,
      'bug_report_submitted',
      'Bug report submitted',
      `We've received your report: ${input.title.trim()}`,
      `/bugs/${report.id}`,
    ).catch((e) => console.error('[NOTIFY ERROR]', e))
    await Promise.all(
      admins.map((admin) =>
        admin.isTechnicalAdmin
          ? notifyUser(
              admin.id,
              'new_bug_report',
              notifyTitle,
              notifyBody,
              '/admin/bugs',
              {
                subject: notifyTitle,
                message: notifyBody,
                ctaLabel: 'View Bug Report',
                ctaUrl: '/admin/bugs',
              },
              report.id,
            ).catch((e) => console.error('[NOTIFY ERROR]', e))
          : createNotification(
              admin.id,
              'new_bug_report',
              notifyTitle,
              notifyBody,
              '/admin/bugs',
              report.id,
            ).catch((e) => console.error('[NOTIFY ERROR]', e)),
      ),
    )

    return { id: report.id, message: 'Thank you for your feedback!' }
  }),
}
