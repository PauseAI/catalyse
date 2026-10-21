import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { listCountries } from '@/lib/countries-server'
import { canAdminChapter, canAppointDeputies, type ChapterAccess } from '@/lib/chapter-access'
import {
  appointDeputy,
  appointLead,
  audit,
  moveToChapter,
  removeDeputy,
  removeLead,
} from '@/lib/chapter-roles'
import { sendAdminInviteEmail } from '@/lib/email'
import { InviteChapterStaffSchema } from '@/lib/schemas'
import { ChapterAuditAction, ChapterRoleKind, InviteStatus } from '@/generated/prisma/enums'
import { adminProcedure, staffProcedure } from '../../procedures'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const idInput = z.object({ chapterId: z.number().int() })
const memberInput = idInput.extend({ volunteerId: z.number().int() })

/** A chapter the caller runs; any other is not found, so its existence is not given away. */
async function chapterRunBy(access: ChapterAccess, chapterId: number) {
  const chapter = canAdminChapter(access, chapterId)
    ? await prisma.nationalChapter.findUnique({ where: { id: chapterId } })
    : null
  if (!chapter) throw new ORPCError('NOT_FOUND', { message: 'Chapter not found' })
  return chapter
}

/** A duplicate account is never given a chapter role; the account it duplicates is. */
async function assertNotDuplicate(volunteerId: number) {
  const volunteer = await prisma.volunteer.findUnique({
    where: { id: volunteerId },
    select: { name: true, duplicateOf: { select: { name: true } } },
  })
  if (volunteer?.duplicateOf) {
    throw new ORPCError('BAD_REQUEST', {
      message: `${volunteer.name} is a duplicate account. Appoint ${volunteer.duplicateOf.name} instead.`,
    })
  }
}

function assertCanAppointDeputies(access: ChapterAccess, chapterId: number) {
  if (!canAppointDeputies(access, chapterId)) {
    throw new ORPCError('FORBIDDEN', { message: 'Only the chapter lead appoints deputies' })
  }
}

export const adminChaptersRouter = {
  list: adminProcedure.handler(async () => {
    const chapters = await prisma.nationalChapter.findMany({
      orderBy: { name: 'asc' },
      include: {
        lead: { select: { id: true, name: true } },
        _count: { select: { members: { where: { deletedAt: null } }, deputies: true } },
      },
    })
    const poolCount = await prisma.volunteer.count({
      where: { nationalChapterId: null, deletedAt: null },
    })
    const taken = new Set(chapters.map((c) => c.country))
    return {
      chapters: chapters.map((c) => ({
        id: c.id,
        name: c.name,
        country: c.country,
        lead: c.lead,
        memberCount: c._count.members,
        deputyCount: c._count.deputies,
      })),
      poolCount,
      // Disabled ones too: opening a chapter enables its country.
      availableCountries: (await listCountries())
        .filter((c) => !taken.has(c.code))
        .map((c) => ({ value: c.code, label: c.name })),
    }
  }),

  /**
   * Opens a chapter for a listed country, enabling it. Everyone in the holding pool who said
   * they live there, and the local group suggestions they made, move into it.
   */
  create: adminProcedure
    .input(z.object({ country: z.string() }))
    .handler(async ({ input, context }) => {
      const { country } = input
      const listed = await prisma.country.findUnique({ where: { code: country } })
      if (!listed) throw new ORPCError('BAD_REQUEST', { message: 'Unknown country' })
      if (await prisma.nationalChapter.findUnique({ where: { country } })) {
        throw new ORPCError('BAD_REQUEST', { message: 'That country already has a chapter' })
      }
      const { name } = listed
      return prisma.$transaction(async (tx) => {
        const chapter = await tx.nationalChapter.create({ data: { country, name } })
        await tx.country.update({ where: { code: country }, data: { enabled: true } })
        const placed = await tx.volunteer.updateMany({
          where: { nationalChapterId: null, country, deletedAt: null },
          data: { nationalChapterId: chapter.id },
        })
        await tx.localGroupSuggestion.updateMany({
          where: { nationalChapterId: null, country },
          data: { nationalChapterId: chapter.id },
        })
        await audit(tx, ChapterAuditAction.CHAPTER_CREATED, {
          actorId: context.volunteer.id,
          chapterId: chapter.id,
          details: { placedFromPool: placed.count },
        })
        return { id: chapter.id, name, placedFromPool: placed.count }
      })
    }),

  /** The holding pool, for a global admin to place people from. */
  pool: adminProcedure.handler(() =>
    prisma.volunteer.findMany({
      where: { nationalChapterId: null, deletedAt: null },
      select: { id: true, name: true, email: true, country: true, approvalStatus: true },
      orderBy: { name: 'asc' },
    }),
  ),

  /** A chapter as its staff see it: who runs it, who belongs, and who has been invited. */
  get: staffProcedure.input(idInput).handler(async ({ input, context }) => {
    const chapter = await chapterRunBy(context.access, input.chapterId)
    const deputies = await prisma.chapterDeputy.findMany({
      where: { nationalChapterId: chapter.id },
      select: { volunteerId: true },
    })
    const deputyIds = new Set(deputies.map((d) => d.volunteerId))
    const members = await prisma.volunteer.findMany({
      where: { nationalChapterId: chapter.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        approvalStatus: true,
        duplicateOf: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })
    const invites = await prisma.adminInvite.findMany({
      where: {
        nationalChapterId: chapter.id,
        status: InviteStatus.pending,
        expiresAt: { gt: new Date() },
      },
      include: { invitedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return {
      id: chapter.id,
      name: chapter.name,
      country: chapter.country,
      leadId: chapter.leadId,
      canAppointDeputies: canAppointDeputies(context.access, chapter.id),
      members: members.map((m) => ({
        ...m,
        role:
          m.id === chapter.leadId
            ? ChapterRoleKind.LEAD
            : deputyIds.has(m.id)
              ? ChapterRoleKind.DEPUTY
              : null,
      })),
      // The token stays server-side: it is the credential in the invite link.
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt,
        invitedByName: i.invitedBy.name,
      })),
    }
  }),

  appointLead: adminProcedure.input(memberInput).handler(async ({ input, context }) => {
    await assertNotDuplicate(input.volunteerId)
    const lead = await prisma.$transaction((tx) =>
      appointLead(tx, input.chapterId, input.volunteerId, context.volunteer.id),
    )
    return { message: `${lead.name} now leads the chapter` }
  }),

  removeLead: adminProcedure.input(idInput).handler(async ({ input, context }) => {
    await prisma.$transaction((tx) => removeLead(tx, input.chapterId, context.volunteer.id))
    return { message: 'The chapter has no lead now' }
  }),

  appointDeputy: staffProcedure.input(memberInput).handler(async ({ input, context }) => {
    await chapterRunBy(context.access, input.chapterId)
    assertCanAppointDeputies(context.access, input.chapterId)
    await assertNotDuplicate(input.volunteerId)
    const deputy = await prisma.$transaction((tx) =>
      appointDeputy(tx, input.chapterId, input.volunteerId, context.volunteer.id),
    )
    return { message: `${deputy.name} is now a deputy` }
  }),

  removeDeputy: staffProcedure.input(memberInput).handler(async ({ input, context }) => {
    await chapterRunBy(context.access, input.chapterId)
    assertCanAppointDeputies(context.access, input.chapterId)
    await prisma.$transaction((tx) =>
      removeDeputy(tx, input.chapterId, input.volunteerId, context.volunteer.id),
    )
    return { message: 'Deputy removed' }
  }),

  /** Moves someone to another chapter, or to the holding pool with `chapterId: null`. */
  reassign: adminProcedure
    .input(z.object({ volunteerId: z.number().int(), chapterId: z.number().int().nullable() }))
    .handler(async ({ input, context }) => {
      await prisma.$transaction((tx) =>
        moveToChapter(tx, input.volunteerId, input.chapterId, context.volunteer.id),
      )
      return { message: 'Moved' }
    }),

  audit: staffProcedure
    .input(z.object({ chapterId: z.number().int().optional() }))
    .handler(async ({ input, context }) => {
      const { access } = context
      // Staff see their own chapter's log whatever they ask for; a global admin sees any, or all.
      const chapterId = access.globalAdmin ? input.chapterId : access.chapterId
      const events = await prisma.chapterAuditEvent.findMany({
        where: chapterId === undefined ? {} : { nationalChapterId: chapterId },
        include: {
          actor: { select: { name: true } },
          targetVolunteer: { select: { name: true } },
          chapter: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      })
      return events.map((e) => ({
        id: e.id,
        action: e.action,
        createdAt: e.createdAt,
        actorName: e.actor?.name ?? null,
        targetName: e.targetVolunteer?.name ?? null,
        chapterName: e.chapter?.name ?? null,
      }))
    }),

  /**
   * Invites someone by email to lead or be a deputy of a chapter. A global admin invites to
   * either role anywhere; a lead invites deputies to their own chapter.
   */
  invite: staffProcedure.input(InviteChapterStaffSchema).handler(async ({ input, context }) => {
    const chapter = await chapterRunBy(context.access, input.chapterId)
    if (input.role === ChapterRoleKind.LEAD && !context.access.globalAdmin) {
      throw new ORPCError('FORBIDDEN', { message: 'Only a global admin appoints a lead' })
    }
    assertCanAppointDeputies(context.access, chapter.id)
    const email = input.email.trim().toLowerCase()
    const pending = await prisma.adminInvite.findFirst({
      where: { email, status: InviteStatus.pending, expiresAt: { gt: new Date() } },
      select: { id: true },
    })
    if (pending) {
      throw new ORPCError('BAD_REQUEST', { message: 'An invite is already pending for this email' })
    }

    const inviteToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
    await prisma.$transaction(async (tx) => {
      await tx.adminInvite.create({
        data: {
          email,
          inviteToken,
          invitedById: context.volunteer.id,
          expiresAt,
          nationalChapterId: chapter.id,
          role: input.role,
        },
      })
      await audit(tx, ChapterAuditAction.ROLE_INVITE_SENT, {
        actorId: context.volunteer.id,
        chapterId: chapter.id,
        details: { role: input.role },
      })
    })
    const emailSent = await sendAdminInviteEmail({
      to: email,
      inviteToken,
      invitedBy: context.volunteer.name,
      invite: { role: input.role, chapterName: chapter.name },
    })
    return {
      message: `Invite ${emailSent ? 'sent' : 'created'} for ${email}`,
      expiresAt: expiresAt.toISOString(),
      ...(env.STUB_EMAIL && {
        _dev_invite_url: `${env.APP_URL}/accept-invite?token=${inviteToken}`,
      }),
    }
  }),

  revokeInvite: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const invite = await prisma.adminInvite.findFirst({
        where: { id: input.id, status: InviteStatus.pending },
      })
      if (!invite || !canAppointDeputies(context.access, invite.nationalChapterId)) {
        throw new ORPCError('NOT_FOUND', { message: 'Invite not found or already used' })
      }
      await prisma.adminInvite.update({
        where: { id: input.id },
        data: { status: InviteStatus.revoked },
      })
      return { message: 'Invite revoked' }
    }),
}
