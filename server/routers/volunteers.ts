import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { groupIn, placement } from '@/lib/chapter-placement'
import { redactVolunteer } from '@/lib/auth'
import { UpdateVolunteerSchema } from '@/lib/schemas'
import { projectScopeWhere } from '@/lib/work-item'
import { historySelect, historyWhere, projectHistory } from '@/lib/volunteer-history'
import { contactRelations } from '@/lib/contact'
import { canAdminChapter } from '@/lib/chapter-access'
import { peopleInfo, viewableVolunteers } from '@/lib/people'
import { chapterFilter } from '@/lib/chapter-access-server'
import { isActiveRecently } from '@/lib/activity'
import { approvedProcedure, authedProcedure } from '../procedures'
import {
  ApprovalStatus,
  ContactRequestStatus,
  ProjectStatus,
  QuickTaskStatus,
  WorkItemType,
} from '@/generated/prisma/enums'

export const volunteersRouter = {
  list: approvedProcedure
    .input(
      z.object({
        skillIds: z.array(z.number().int()).optional(),
        search: z.string().optional(),
        /** A global admin's choice of chapter; everyone else sees their own. */
        chapter: z.union([z.number().int(), z.literal('pool')]).optional(),
        localGroup: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().default(50),
        offset: z.number().int().min(0).optional().default(0),
      }),
    )
    .handler(async ({ input, context }) => {
      const currentVolunteer = context.volunteer
      // The directory is the viewer's chapter's, and its staff see profiles hidden from it.
      const isAdmin = canAdminChapter(context.access, context.access.chapterId)

      // A global admin sees, and searches by, each volunteer's login address, and sees which
      // accounts are marked as another's duplicate.
      const { globalAdmin } = context.access

      const textConditions: Prisma.Sql[] = []
      if (input.search) {
        const like = `%${input.search}%`
        const byEmail = globalAdmin ? Prisma.sql` OR email ILIKE ${like}` : Prisma.empty
        textConditions.push(
          Prisma.sql`(public.unaccent(name) ILIKE public.unaccent(${like}) OR public.unaccent(COALESCE(bio, '')) ILIKE public.unaccent(${like})${byEmail})`,
        )
      }
      if (input.localGroup) {
        const like = `%${input.localGroup}%`
        textConditions.push(
          Prisma.sql`(local_group_id IN (SELECT id FROM local_groups WHERE name = ${input.localGroup}) OR (local_group_id IS NULL AND public.unaccent(COALESCE(location, '')) ILIKE public.unaccent(${like})))`,
        )
      }
      const matchingIds = textConditions.length
        ? (
            await prisma.$queryRaw<{ id: number }[]>`
              SELECT id FROM volunteers WHERE ${Prisma.join(textConditions, ' AND ')}
            `
          ).map((row) => row.id)
        : null

      const where: Record<string, unknown> = {
        deletedAt: null,
        nationalChapterId: chapterFilter(context.access, input.chapter),
        ...(isAdmin ? {} : { consentMakeProfileVisibleInDirectory: true }),
        approvalStatus: ApprovalStatus.approved,
        ...(input.skillIds && input.skillIds.length > 0
          ? { skills: { some: { skillId: { in: input.skillIds } } } }
          : {}),
        ...(matchingIds !== null ? { id: { in: matchingIds } } : {}),
      }

      const [volunteers, total] = await Promise.all([
        prisma.volunteer.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            bio: true,
            availabilityHoursPerWeek: true,
            location: true,
            country: true,
            otherSkills: true,
            group: { select: { name: true } },
            duplicateOf: { select: { id: true, name: true } },
            createdAt: true,
            lastActiveAt: true,
            consentMakeProfileVisibleInDirectory: true,
            skills: {
              include: { skill: { include: { category: true } } },
              orderBy: [
                { skill: { category: { sortOrder: 'asc' } } },
                { skill: { sortOrder: 'asc' } },
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        prisma.volunteer.count({ where }),
      ])

      const relations = await contactRelations(
        currentVolunteer,
        context.access,
        volunteers.map((v) => v.id),
      )
      return {
        volunteers: volunteers.map((v) => ({
          id: v.id,
          canMessage: v.id !== currentVolunteer.id && relations.reachable.has(v.id),
          contactRequested: relations.requested.has(v.id),
          activeRecently: isActiveRecently(v.lastActiveAt),
          name: v.name,
          ...(globalAdmin ? { email: v.email, duplicateOf: v.duplicateOf } : {}),
          bio: v.bio,
          availabilityHoursPerWeek: v.availabilityHoursPerWeek,
          location: v.location,
          country: v.country,
          otherSkills: v.otherSkills,
          localGroup: v.group?.name ?? null,
          createdAt: v.createdAt,
          hiddenFromDirectory: isAdmin ? !v.consentMakeProfileVisibleInDirectory : false,
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
        })),
        total,
      }
    }),

  /**
   * For names shown on a page: whether each links to a profile the viewer can open, and the
   * role it is badged with. Someone still awaiting approval can open only their own.
   */
  lookup: authedProcedure
    .input(z.object({ ids: z.array(z.number().int()).max(200) }))
    .handler(async ({ input, context }) => {
      const people = await peopleInfo(context.volunteer, context.access, input.ids)
      const approved =
        context.volunteer.approvalStatus === ApprovalStatus.approved || context.volunteer.isAdmin
      return approved
        ? people
        : people.map((p) => ({ ...p, canView: p.id === context.volunteer.id }))
    }),

  getById: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const currentVolunteer = context.volunteer

      const vol = await prisma.volunteer.findFirst({
        where: { id: input.id, deletedAt: null },
        include: {
          group: { select: { name: true } },
          chapter: { select: { name: true, country: true } },
          skills: {
            include: { skill: { include: { category: true } } },
            orderBy: [
              { skill: { category: { sortOrder: 'asc' } } },
              { skill: { sortOrder: 'asc' } },
            ],
          },
          skillEndorsementsReceived: {
            include: { skill: true },
          },
          duplicateOf: { select: { id: true, name: true } },
        },
      })

      if (
        !vol ||
        !(await viewableVolunteers(currentVolunteer, context.access, [vol.id])).has(vol.id)
      ) {
        throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
      }
      const isAdmin = canAdminChapter(context.access, vol.nationalChapterId)

      // Contact details go only to people who work with the volunteer, or whom they have
      // accepted a contact request from (lib/contact.ts); their chapter's staff see them too.
      const [relations, incoming] = await Promise.all([
        contactRelations(currentVolunteer, context.access, [vol.id]),
        prisma.contactRequest.findFirst({
          where: {
            fromVolunteerId: vol.id,
            toVolunteerId: currentVolunteer.id,
            status: ContactRequestStatus.pending,
          },
          select: { id: true, message: true },
        }),
      ])
      const showContact = isAdmin || relations.reachable.has(vol.id)

      const skills = vol.skills.map((vs) => ({
        id: vs.skill.id,
        categoryId: vs.skill.categoryId,
        name: vs.skill.name,
        description: vs.skill.description,
        sortOrder: vs.skill.sortOrder,
        createdAt: vs.skill.createdAt,
        categoryName: vs.skill.category.name,
        proficiencyLevel: vs.proficiencyLevel,
      }))
      const endorsements = vol.skillEndorsementsReceived.map((se) => ({
        skillId: se.skillId,
        rating: se.rating,
        skillName: se.skill.name,
      }))

      const [projects, completedTasks] = await Promise.all([
        prisma.workItem.findMany({
          where: {
            ...historyWhere(input.id),
            AND: [projectScopeWhere(currentVolunteer)],
            status: {
              notIn: [
                ProjectStatus.archived,
                ProjectStatus.pending_review,
                ProjectStatus.needs_discussion,
              ],
            },
          },
          select: historySelect(input.id),
        }),
        prisma.workItem.findMany({
          where: {
            type: WorkItemType.QUICK_TASK,
            assigneeId: input.id,
            status: QuickTaskStatus.completed,
            reviewRating: { in: ['excellent', 'good'] },
          },
          orderBy: { reviewedAt: 'desc' },
          select: {
            title: true,
            reviewRating: true,
            reviewedAt: true,
            skill: { select: { name: true } },
          },
        }),
      ])

      // Only a global admin sees the login address on a profile, and which account this one
      // duplicates: everyone else reaches the volunteer through the message relay.
      const { email, ...profile } = redactVolunteer(vol, {
        showContact,
        skills,
        endorsements,
      })
      return {
        ...profile,
        ...(context.access.globalAdmin ? { email, duplicateOf: vol.duplicateOf } : {}),
        canMessage: vol.id !== currentVolunteer.id && showContact,
        contactRequested: relations.requested.has(vol.id),
        incomingContactRequest: incoming,
        canRequestContact:
          !showContact &&
          vol.id !== currentVolunteer.id &&
          Boolean(vol.consentMakeProfileVisibleInDirectory),
        activeRecently: isActiveRecently(vol.lastActiveAt),
        chapter: vol.chapter,
        projects: projectHistory(projects, input.id),
        completedTasks: completedTasks.map((t) => ({
          title: t.title,
          reviewRating: t.reviewRating,
          reviewedAt: t.reviewedAt,
          skillName: t.skill?.name ?? null,
        })),
      }
    }),

  myApplication: authedProcedure.handler(async ({ context }) => {
    const volunteer = context.volunteer
    return {
      approvalStatus: volunteer.approvalStatus,
      applicationMessage: volunteer.applicationMessage,
      applicationApplicantNotes: volunteer.applicationApplicantNotes,
    }
  }),

  resubmitApplication: authedProcedure.handler(async ({ context }) => {
    const volunteer = context.volunteer
    if (
      volunteer.approvalStatus !== ApprovalStatus.pending &&
      volunteer.approvalStatus !== ApprovalStatus.needs_info
    ) {
      throw new ORPCError('BAD_REQUEST', {
        message: `Cannot resubmit a ${volunteer.approvalStatus} application`,
      })
    }
    await prisma.volunteer.update({
      where: { id: volunteer.id },
      data: { approvalStatus: ApprovalStatus.under_review, updatedAt: new Date() },
    })
    return { message: 'Application resubmitted for review' }
  }),

  updateMe: authedProcedure.input(UpdateVolunteerSchema).handler(async ({ input, context }) => {
    const volunteer = context.volunteer
    const data: Record<string, unknown> = { updatedAt: new Date() }

    const scalarFields = [
      'name',
      'bio',
      'discordHandle',
      'signalNumber',
      'whatsappNumber',
      'contactPreference',
      'contactNotes',
      'availabilityHoursPerWeek',
      'location',
      'otherSkills',
      'emailDigest',
      'emailMutedCategories',
      'dailySummary',
      'applicationMessage',
    ] as const
    for (const field of scalarFields) {
      if (Object.prototype.hasOwnProperty.call(input, field)) {
        data[field] = input[field]
      }
    }

    // Country decides chapter, so changing it is a transfer request. Only someone who never
    // gave one (an account from before signup asked) names it here, as signup would.
    const hasCountry = Object.prototype.hasOwnProperty.call(input, 'country')
    const hasLocalGroup = Object.prototype.hasOwnProperty.call(input, 'localGroup')
    if (hasCountry && input.country && input.country !== volunteer.country) {
      if (volunteer.country || volunteer.nationalChapterId !== null) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'To move to another country, ask to transfer chapter from your settings',
        })
      }
      Object.assign(data, await placement(input.country, input.localGroup))
    } else if (hasLocalGroup) {
      Object.assign(data, await groupIn(volunteer.nationalChapterId, input.localGroup))
    }
    if (Object.prototype.hasOwnProperty.call(input, 'location') || hasCountry || hasLocalGroup) {
      data.locationConfirmedAt = new Date()
    }

    if (input.consentMakeProfileVisibleInDirectory !== undefined) {
      data.consentMakeProfileVisibleInDirectory = input.consentMakeProfileVisibleInDirectory
      if (input.consentMakeProfileVisibleInDirectory) data.consentGivenAt = new Date()
    }
    if (input.consentContactableByProjectOwners !== undefined) {
      data.consentContactableByProjectOwners = input.consentContactableByProjectOwners
      if (input.consentContactableByProjectOwners) data.consentGivenAt = new Date()
    }
    if (input.consentShareContactInfoWithProjectOwner !== undefined) {
      data.consentShareContactInfoWithProjectOwner = input.consentShareContactInfoWithProjectOwner
      if (input.consentShareContactInfoWithProjectOwner) data.consentGivenAt = new Date()
    }
    if (Object.prototype.hasOwnProperty.call(input, 'cookieConsentAnalytics')) {
      data.cookieConsentAnalytics = input.cookieConsentAnalytics ?? null
    }

    const skillIds = input.skillIds

    const [vol] = await prisma.$transaction(async (tx) => {
      const updated = await tx.volunteer.update({
        where: { id: volunteer.id },
        data,
        include: {
          group: { select: { name: true } },
          skills: {
            include: { skill: { include: { category: true } } },
            orderBy: [
              { skill: { category: { sortOrder: 'asc' } } },
              { skill: { sortOrder: 'asc' } },
            ],
          },
          skillEndorsementsReceived: {
            include: { skill: true },
          },
        },
      })

      if (skillIds !== undefined) {
        await tx.volunteerSkill.deleteMany({ where: { volunteerId: volunteer.id } })
        if (skillIds.length > 0) {
          await tx.volunteerSkill.createMany({
            data: skillIds.map((skillId) => ({ volunteerId: volunteer.id, skillId })),
          })
        }
        const fresh = await tx.volunteer.findUnique({
          where: { id: volunteer.id },
          include: {
            group: { select: { name: true } },
            skills: {
              include: { skill: { include: { category: true } } },
              orderBy: [
                { skill: { category: { sortOrder: 'asc' } } },
                { skill: { sortOrder: 'asc' } },
              ],
            },
            skillEndorsementsReceived: {
              include: { skill: true },
            },
          },
        })
        return [fresh!]
      }

      return [updated]
    })

    const skills = vol.skills.map((vs) => ({
      id: vs.skill.id,
      categoryId: vs.skill.categoryId,
      name: vs.skill.name,
      description: vs.skill.description,
      sortOrder: vs.skill.sortOrder,
      createdAt: vs.skill.createdAt,
      categoryName: vs.skill.category.name,
      proficiencyLevel: vs.proficiencyLevel,
    }))
    const endorsements = vol.skillEndorsementsReceived.map((se) => ({
      skillId: se.skillId,
      rating: se.rating,
      skillName: se.skill.name,
    }))

    return redactVolunteer(vol, {
      showContact: true,
      skills,
      endorsements,
    })
  }),
}
