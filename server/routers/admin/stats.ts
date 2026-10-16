import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { staffProcedure } from '../../procedures'
import { chapterFilter } from '@/lib/chapter-access-server'
import { ADVERTISABLE_STATUSES } from '@/lib/project-status'
import {
  ApprovalStatus,
  InterestStatus,
  ProjectStatus,
  WorkItemType,
} from '@/generated/prisma/enums'

export const adminStatsRouter = {
  /** The caller's chapter in numbers; a global admin's are everyone's, or one chapter's or the pool's. */
  get: staffProcedure
    .input(
      z.object({ chapter: z.union([z.number().int(), z.literal('pool')]).optional() }).optional(),
    )
    .handler(async ({ input, context }) => {
      const nationalChapterId = chapterFilter(context.access, input?.chapter)
      const project = { type: WorkItemType.PROJECT, nationalChapterId }
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
          where: {
            deletedAt: null,
            nationalChapterId,
            approvalStatus: { in: [...NON_REJECTED_STATUSES] },
          },
          _count: true,
        }),
        prisma.volunteer.count({
          where: {
            deletedAt: null,
            nationalChapterId,
            approvalStatus: { in: [...NON_REJECTED_STATUSES] },
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.workItem.count({ where: project }),
        prisma.workItem.count({
          where: { ...project, status: ProjectStatus.pending_review },
        }),
        prisma.workItem.count({
          where: {
            ...project,
            // Approved and unfinished only — this used to count pending-review proposals
            // and completed projects carrying stale flags.
            status: { in: ADVERTISABLE_STATUSES },
            OR: [{ isSeekingHelp: true }, { assigneeId: null }],
          },
        }),
        prisma.workItem.count({
          where: { ...project, status: ProjectStatus.in_progress },
        }),
        prisma.workItem.count({
          where: { ...project, status: ProjectStatus.completed },
        }),
        prisma.workItemInterest.count({ where: { workItem: project } }),
        prisma.workItemInterest.count({
          where: { status: InterestStatus.pending, workItem: project },
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
