import { prisma } from '@/lib/prisma'
import { staffProcedure } from '../../procedures'
import { chapterFilter } from '@/lib/chapter-access-server'
import { ProjectStatus, WorkItemType, ApprovalStatus } from '@/generated/prisma/enums'
import { ADMIN_NOTIFICATION_TYPES } from '@/lib/admin-notifications'

export const adminOverviewRouter = {
  /** What waits on the caller: their chapter's, or for a global admin, everyone's. */
  counts: staffProcedure.handler(async ({ context }) => {
    const nationalChapterId = chapterFilter(context.access)
    const [pendingTriage, pendingApplications, openBugReports, unreadNotifications] =
      await Promise.all([
        prisma.workItem.count({
          where: {
            type: WorkItemType.PROJECT,
            status: { in: [ProjectStatus.pending_review, ProjectStatus.needs_discussion] },
            nationalChapterId,
          },
        }),
        prisma.volunteer.count({
          where: {
            approvalStatus: { in: [ApprovalStatus.pending, ApprovalStatus.under_review] },
            deletedAt: null,
            nationalChapterId,
          },
        }),
        // Bug reports are the global admins'.
        context.access.globalAdmin
          ? prisma.bugReport.count({ where: { status: { in: ['open', 'in_progress'] } } })
          : 0,
        prisma.notification.count({
          where: {
            volunteerId: context.volunteer.id,
            readAt: null,
            type: { in: ADMIN_NOTIFICATION_TYPES },
          },
        }),
      ])

    return { pendingTriage, pendingApplications, openBugReports, unreadNotifications }
  }),
}
