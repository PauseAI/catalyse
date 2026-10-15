import { prisma } from '@/lib/prisma'
import { adminProcedure } from '../../procedures'
import { ADVERTISABLE_STATUSES } from '@/lib/project-status'
import {
  ApprovalStatus,
  InterestStatus,
  ProjectStatus,
  WorkItemType,
} from '@/generated/prisma/enums'

export const adminStatsRouter = {
  get: adminProcedure.handler(async () => {
    // Excludes rejected applicants; those never became volunteers.
    const NON_REJECTED_STATUSES = [
      ApprovalStatus.approved,
      ApprovalStatus.pending,
      ApprovalStatus.under_review,
      ApprovalStatus.needs_info,
    ] as const

    const [
      volunteersByStatus,
      volunteersLast30Days,
      totalProjects,
      pendingReviewProjects,
      seekingProjects,
      inProgressProjects,
      completedProjects,
      totalInterests,
      pendingInterests,
    ] = await Promise.all([
      prisma.volunteer.groupBy({
        by: ['approvalStatus'],
        where: { deletedAt: null, approvalStatus: { in: [...NON_REJECTED_STATUSES] } },
        _count: true,
      }),
      prisma.volunteer.count({
        where: {
          deletedAt: null,
          approvalStatus: { in: [...NON_REJECTED_STATUSES] },
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.workItem.count({ where: { type: WorkItemType.PROJECT } }),
      prisma.workItem.count({
        where: { type: WorkItemType.PROJECT, status: ProjectStatus.pending_review },
      }),
      prisma.workItem.count({
        where: {
          type: WorkItemType.PROJECT,
          // Approved and unfinished only — this used to count pending-review proposals
          // and completed projects carrying stale flags.
          status: { in: ADVERTISABLE_STATUSES },
          OR: [{ isSeekingHelp: true }, { assigneeId: null }],
        },
      }),
      prisma.workItem.count({
        where: { type: WorkItemType.PROJECT, status: ProjectStatus.in_progress },
      }),
      prisma.workItem.count({
        where: { type: WorkItemType.PROJECT, status: ProjectStatus.completed },
      }),
      prisma.workItemInterest.count({ where: { workItem: { type: WorkItemType.PROJECT } } }),
      prisma.workItemInterest.count({
        where: { status: InterestStatus.pending, workItem: { type: WorkItemType.PROJECT } },
      }),
    ])

    const countFor = (status: ApprovalStatus) =>
      volunteersByStatus.find((row) => row.approvalStatus === status)?._count ?? 0

    const approved = countFor(ApprovalStatus.approved)
    const pending = countFor(ApprovalStatus.pending)
    const underReview = countFor(ApprovalStatus.under_review)
    const needsInfo = countFor(ApprovalStatus.needs_info)

    return {
      volunteers: {
        total: approved + pending + underReview + needsInfo,
        approved,
        pending,
        underReview,
        needsInfo,
        last30Days: volunteersLast30Days,
      },
      projects: {
        total: totalProjects,
        pendingReview: pendingReviewProjects,
        seekingHelp: seekingProjects,
        inProgress: inProgressProjects,
        completed: completedProjects,
      },
      interests: { total: totalInterests, pending: pendingInterests },
    }
  }),
}
