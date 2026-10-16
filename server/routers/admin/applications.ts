import { createHash } from 'crypto'
import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import {
  sendApplicationApprovedEmail,
  sendApplicationRejectedEmail,
  sendApplicationNeedsInfoEmail,
  sendApplicationReopenedEmail,
} from '@/lib/email'
import { APPLICATION_ANONYMISATION_MS } from '@/lib/applications'
import { ApplicationActionSchema } from '@/lib/schemas'
import { adminProcedure } from '../../procedures'
import { ApprovalStatus } from '@/generated/prisma/enums'
import { clearNotifications, createNotification } from '@/lib/notify'

export const adminApplicationsRouter = {
  list: adminProcedure
    .input(
      z.object({
        filter: z
          .enum(['mine', 'others', 'approved', 'rejected', 'needs_info'])
          .optional()
          .default('mine'),
      }),
    )
    .handler(async ({ input, context }) => {
      const admin = context.volunteer

      type WhereClause = NonNullable<Parameters<typeof prisma.volunteer.findMany>[0]>['where']
      const where: WhereClause = (() => {
        switch (input.filter) {
          case 'mine':
            return {
              deletedAt: null,
              approvalStatus: { in: [ApprovalStatus.pending, ApprovalStatus.under_review] },
              OR: [{ reviewerId: null }, { reviewerId: admin.id }],
            }
          case 'others':
            return {
              deletedAt: null,
              approvalStatus: ApprovalStatus.under_review,
              reviewerId: { not: admin.id },
            }
          case 'approved':
            return { deletedAt: null, approvalStatus: ApprovalStatus.approved }
          case 'rejected':
            return { deletedAt: null, approvalStatus: ApprovalStatus.rejected }
          case 'needs_info':
            return { deletedAt: null, approvalStatus: ApprovalStatus.needs_info }
        }
      })()

      const volunteers = await prisma.volunteer.findMany({
        where,
        include: {
          skills: {
            include: { skill: { include: { category: true } } },
            orderBy: [
              { skill: { category: { sortOrder: 'asc' } } },
              { skill: { sortOrder: 'asc' } },
            ],
          },
          reviewer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      })

      const emailHashes = volunteers
        .filter((v) => v.email)
        .map((v) => createHash('sha256').update(v.email!.toLowerCase().trim()).digest('hex'))

      const rejectionRows =
        emailHashes.length > 0
          ? await prisma.rejectedApplication.findMany({
              where: { emailHash: { in: emailHashes } },
              orderBy: { rejectedAt: 'desc' },
              select: {
                emailHash: true,
                rejectedAt: true,
                adminNotes: true,
                applicantNotes: true,
              },
            })
          : []

      const rejectionsByHash = new Map<string, typeof rejectionRows>()
      for (const row of rejectionRows) {
        const list = rejectionsByHash.get(row.emailHash) ?? []
        list.push(row)
        rejectionsByHash.set(row.emailHash, list)
      }

      return volunteers.map((v) => {
        const emailHash = v.email
          ? createHash('sha256').update(v.email.toLowerCase().trim()).digest('hex')
          : null
        const previousRejections = emailHash ? (rejectionsByHash.get(emailHash) ?? []) : []
        return {
          id: v.id,
          name: v.name,
          email: v.email,
          bio: v.bio,
          applicationMessage: v.applicationMessage,
          approvalStatus: v.approvalStatus,
          createdAt: v.createdAt,
          rejectedAt: v.rejectedAt,
          anonymiseAt: v.rejectedAt
            ? new Date(v.rejectedAt.getTime() + APPLICATION_ANONYMISATION_MS).toISOString()
            : null,
          adminNotes: v.applicationAdminNotes,
          applicantNotes: v.applicationApplicantNotes,
          reviewer: v.reviewer ? { id: v.reviewer.id, name: v.reviewer.name } : null,
          previousRejections: previousRejections.map((r) => ({
            rejectedAt: r.rejectedAt,
            adminNotes: r.adminNotes,
            applicantNotes: r.applicantNotes,
          })),
          availabilityHoursPerWeek: v.availabilityHoursPerWeek,
          location: v.location,
          country: v.country,
          localGroup: v.localGroup,
          signalNumber: v.signalNumber,
          whatsappNumber: v.whatsappNumber,
          discordHandle: v.discordHandle,
          contactNotes: v.contactNotes,
          skills: v.skills.map((vs) => ({
            id: vs.skill.id,
            categoryId: vs.skill.categoryId,
            name: vs.skill.name,
            description: vs.skill.description,
            sortOrder: vs.skill.sortOrder,
            createdAt: vs.skill.createdAt,
            categoryName: vs.skill.category.name,
            proficiencyLevel: vs.proficiencyLevel,
          })),
        }
      })
    }),

  getById: adminProcedure.input(z.object({ id: z.number().int() })).handler(async ({ input }) => {
    const v = await prisma.volunteer.findFirst({
      where: { id: input.id, deletedAt: null },
      include: {
        skills: {
          include: { skill: { include: { category: true } } },
          orderBy: [{ skill: { category: { sortOrder: 'asc' } } }, { skill: { sortOrder: 'asc' } }],
        },
        reviewer: { select: { id: true, name: true } },
      },
    })

    if (!v) throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })

    const emailHash = v.email
      ? createHash('sha256').update(v.email.toLowerCase().trim()).digest('hex')
      : null

    const previousRejections = emailHash
      ? await prisma.rejectedApplication.findMany({
          where: { emailHash },
          orderBy: { rejectedAt: 'desc' },
          select: { rejectedAt: true, adminNotes: true, applicantNotes: true },
        })
      : []

    return {
      id: v.id,
      name: v.name,
      email: v.email,
      bio: v.bio,
      applicationMessage: v.applicationMessage,
      approvalStatus: v.approvalStatus,
      createdAt: v.createdAt,
      rejectedAt: v.rejectedAt,
      anonymiseAt: v.rejectedAt
        ? new Date(v.rejectedAt.getTime() + APPLICATION_ANONYMISATION_MS).toISOString()
        : null,
      adminNotes: v.applicationAdminNotes,
      applicantNotes: v.applicationApplicantNotes,
      reviewer: v.reviewer ? { id: v.reviewer.id, name: v.reviewer.name } : null,
      previousRejections: previousRejections.map((r) => ({
        rejectedAt: r.rejectedAt,
        adminNotes: r.adminNotes,
        applicantNotes: r.applicantNotes,
      })),
      availabilityHoursPerWeek: v.availabilityHoursPerWeek,
      location: v.location,
      country: v.country,
      localGroup: v.localGroup,
      signalNumber: v.signalNumber,
      whatsappNumber: v.whatsappNumber,
      discordHandle: v.discordHandle,
      contactNotes: v.contactNotes,
      skills: v.skills.map((vs) => ({
        id: vs.skill.id,
        categoryId: vs.skill.categoryId,
        name: vs.skill.name,
        description: vs.skill.description,
        sortOrder: vs.skill.sortOrder,
        createdAt: vs.skill.createdAt,
        categoryName: vs.skill.category.name,
        proficiencyLevel: vs.proficiencyLevel,
      })),
    }
  }),

  action: adminProcedure
    .input(z.object({ id: z.number().int() }).merge(ApplicationActionSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const { action, adminNotes: rawAdminNotes, applicantNotes: rawApplicantNotes } = input

      const adminNotes = rawAdminNotes !== null ? (rawAdminNotes ?? undefined) : undefined
      const applicantNotes =
        rawApplicantNotes !== null ? (rawApplicantNotes ?? undefined) : undefined

      const volunteer = await prisma.volunteer.findFirst({
        where: { id: input.id, deletedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          emailConfirmed: true,
          approvalStatus: true,
          applicationAdminNotes: true,
          applicationApplicantNotes: true,
        },
      })

      if (!volunteer) throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })

      if (action === 'update_notes') {
        await prisma.volunteer.update({
          where: { id: input.id },
          data: {
            ...(adminNotes !== undefined && { applicationAdminNotes: adminNotes }),
            ...(applicantNotes !== undefined && { applicationApplicantNotes: applicantNotes }),
          },
        })
        return { message: 'Notes updated' }
      }

      if (action === 'start_review') {
        if (
          volunteer.approvalStatus !== ApprovalStatus.pending &&
          volunteer.approvalStatus !== ApprovalStatus.under_review
        ) {
          throw new ORPCError('BAD_REQUEST', {
            message: `Cannot start review on a ${volunteer.approvalStatus} application`,
          })
        }
        await prisma.volunteer.update({
          where: { id: input.id },
          data: {
            approvalStatus: ApprovalStatus.under_review,
            reviewerId: admin.id,
            ...(adminNotes !== undefined && { applicationAdminNotes: adminNotes }),
            ...(applicantNotes !== undefined && { applicationApplicantNotes: applicantNotes }),
          },
        })
        return { message: 'Review started' }
      }

      if (action === 'request_info') {
        if (
          volunteer.approvalStatus !== ApprovalStatus.pending &&
          volunteer.approvalStatus !== ApprovalStatus.under_review
        ) {
          throw new ORPCError('BAD_REQUEST', {
            message: `Cannot request info on a ${volunteer.approvalStatus} application`,
          })
        }
        await prisma.volunteer.update({
          where: { id: input.id },
          data: {
            approvalStatus: ApprovalStatus.needs_info,
            reviewerId: admin.id,
            ...(adminNotes !== undefined && { applicationAdminNotes: adminNotes }),
            ...(applicantNotes !== undefined && { applicationApplicantNotes: applicantNotes }),
          },
        })
        if (volunteer.email) {
          const resolvedApplicantNotes =
            applicantNotes ?? volunteer.applicationApplicantNotes ?? undefined
          sendApplicationNeedsInfoEmail({
            to: volunteer.email,
            name: volunteer.name,
            applicantNotes: resolvedApplicantNotes,
          }).catch((e) => console.error('[APPLICATIONS] Needs-info email failed:', e))
        }
        return { message: 'More information requested' }
      }

      if (action === 'reopen') {
        if (volunteer.approvalStatus !== ApprovalStatus.rejected) {
          throw new ORPCError('BAD_REQUEST', {
            message: `Cannot reopen a ${volunteer.approvalStatus} application`,
          })
        }
        await prisma.volunteer.update({
          where: { id: input.id },
          data: {
            approvalStatus: ApprovalStatus.needs_info,
            rejectedAt: null,
            reviewerId: admin.id,
            ...(adminNotes !== undefined && { applicationAdminNotes: adminNotes }),
            ...(applicantNotes !== undefined && { applicationApplicantNotes: applicantNotes }),
          },
        })
        if (volunteer.email) {
          const resolvedApplicantNotes =
            applicantNotes ?? volunteer.applicationApplicantNotes ?? undefined
          sendApplicationReopenedEmail({
            to: volunteer.email,
            name: volunteer.name,
            applicantNotes: resolvedApplicantNotes,
          }).catch((e) => console.error('[APPLICATIONS] Reopened email failed:', e))
        }
        return { message: 'Application reopened' }
      }

      if (
        volunteer.approvalStatus !== ApprovalStatus.pending &&
        volunteer.approvalStatus !== ApprovalStatus.under_review &&
        volunteer.approvalStatus !== ApprovalStatus.needs_info
      ) {
        throw new ORPCError('BAD_REQUEST', {
          message: `Application already ${volunteer.approvalStatus}`,
        })
      }

      const newStatus = action === 'approve' ? ApprovalStatus.approved : ApprovalStatus.rejected

      await prisma.volunteer.update({
        where: { id: input.id },
        data: {
          approvalStatus: newStatus,
          reviewerId: admin.id,
          ...(adminNotes !== undefined && { applicationAdminNotes: adminNotes }),
          ...(applicantNotes !== undefined && { applicationApplicantNotes: applicantNotes }),
          ...(action === 'reject' && { rejectedAt: new Date() }),
        },
      })

      if (volunteer.email) {
        const resolvedApplicantNotes =
          applicantNotes ?? volunteer.applicationApplicantNotes ?? undefined
        if (action === 'approve') {
          sendApplicationApprovedEmail({ to: volunteer.email, name: volunteer.name }).catch((e) =>
            console.error('[APPLICATIONS] Approved email failed:', e),
          )
        } else {
          sendApplicationRejectedEmail({
            to: volunteer.email,
            name: volunteer.name,
            applicantNotes: resolvedApplicantNotes,
          }).catch((e) => console.error('[APPLICATIONS] Rejected email failed:', e))
        }
      }

      if (action === 'approve') {
        await createNotification(
          volunteer.id,
          'application_approved',
          'Approved: welcome to Catalyse',
          'Next: confirm your email and pick a first task.',
          volunteer.emailConfirmed ? '/projects' : '/verify-email',
        )
      }

      await clearNotifications('new_volunteer_signup', input.id)

      const label = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'started'
      return { message: `Application ${label}` }
    }),
}
