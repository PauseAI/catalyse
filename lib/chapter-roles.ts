import { ORPCError } from '@orpc/server'
import type { Prisma } from '@/generated/prisma/client'
import {
  ApprovalStatus,
  ChapterAuditAction,
  ChapterRoleKind,
  ChapterTransferStatus,
  InviteStatus,
} from '@/generated/prisma/enums'

type Tx = Prisma.TransactionClient

/**
 * Changes to who runs a chapter and who belongs to it. Each keeps the two rules the schema
 * cannot: a lead is not also a deputy, and staff are members of the chapter they serve. Every
 * change is written to the chapter audit log.
 */

export function audit(
  tx: Tx,
  action: ChapterAuditAction,
  data: {
    actorId: number | null
    chapterId: number | null
    targetVolunteerId?: number
    workItemId?: number
    details?: Prisma.InputJsonValue
  },
) {
  return tx.chapterAuditEvent.create({
    data: {
      action,
      actorId: data.actorId,
      nationalChapterId: data.chapterId,
      targetVolunteerId: data.targetVolunteerId,
      workItemId: data.workItemId,
      details: data.details,
    },
  })
}

async function memberOf(tx: Tx, chapterId: number, volunteerId: number) {
  const volunteer = await tx.volunteer.findFirst({
    where: { id: volunteerId, deletedAt: null },
    select: { id: true, name: true, nationalChapterId: true },
  })
  if (!volunteer) throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
  if (volunteer.nationalChapterId !== chapterId) {
    throw new ORPCError('BAD_REQUEST', {
      message: `${volunteer.name} is not a member of this chapter`,
    })
  }
  return volunteer
}

/** Makes a member the chapter's lead; the lead before them stays on as a member. */
export async function appointLead(
  tx: Tx,
  chapterId: number,
  volunteerId: number,
  actorId: number | null,
) {
  const volunteer = await memberOf(tx, chapterId, volunteerId)
  const chapter = await tx.nationalChapter.findUniqueOrThrow({ where: { id: chapterId } })
  if (chapter.leadId === volunteerId) return volunteer
  if (chapter.leadId !== null) {
    await audit(tx, ChapterAuditAction.LEAD_REMOVED, {
      actorId,
      chapterId,
      targetVolunteerId: chapter.leadId,
    })
  }
  await tx.chapterDeputy.deleteMany({ where: { volunteerId } })
  await tx.nationalChapter.update({ where: { id: chapterId }, data: { leadId: volunteerId } })
  await audit(tx, ChapterAuditAction.LEAD_APPOINTED, {
    actorId,
    chapterId,
    targetVolunteerId: volunteerId,
  })
  return volunteer
}

export async function removeLead(tx: Tx, chapterId: number, actorId: number | null) {
  const chapter = await tx.nationalChapter.findUniqueOrThrow({ where: { id: chapterId } })
  if (chapter.leadId === null) {
    throw new ORPCError('BAD_REQUEST', { message: 'This chapter has no lead' })
  }
  await tx.nationalChapter.update({ where: { id: chapterId }, data: { leadId: null } })
  await audit(tx, ChapterAuditAction.LEAD_REMOVED, {
    actorId,
    chapterId,
    targetVolunteerId: chapter.leadId,
  })
}

export async function appointDeputy(
  tx: Tx,
  chapterId: number,
  volunteerId: number,
  actorId: number | null,
) {
  const volunteer = await memberOf(tx, chapterId, volunteerId)
  const chapter = await tx.nationalChapter.findUniqueOrThrow({ where: { id: chapterId } })
  if (chapter.leadId === volunteerId) {
    throw new ORPCError('BAD_REQUEST', { message: `${volunteer.name} already leads this chapter` })
  }
  const existing = await tx.chapterDeputy.findUnique({ where: { volunteerId } })
  if (existing) {
    throw new ORPCError('BAD_REQUEST', { message: `${volunteer.name} is already a deputy` })
  }
  await tx.chapterDeputy.create({
    data: { nationalChapterId: chapterId, volunteerId, appointedById: actorId },
  })
  await audit(tx, ChapterAuditAction.DEPUTY_APPOINTED, {
    actorId,
    chapterId,
    targetVolunteerId: volunteerId,
  })
  return volunteer
}

export async function removeDeputy(
  tx: Tx,
  chapterId: number,
  volunteerId: number,
  actorId: number | null,
) {
  const { count } = await tx.chapterDeputy.deleteMany({
    where: { nationalChapterId: chapterId, volunteerId },
  })
  if (!count) throw new ORPCError('NOT_FOUND', { message: 'Deputy not found' })
  await audit(tx, ChapterAuditAction.DEPUTY_REMOVED, {
    actorId,
    chapterId,
    targetVolunteerId: volunteerId,
  })
}

/**
 * Gives `volunteerId` the chapter role an invite offers, moving them into its chapter first if
 * they belong elsewhere, and approves their account. A role they already hold there stands.
 */
export async function acceptChapterInvite(
  tx: Tx,
  volunteerId: number,
  invite: {
    id: number
    invitedById: number
    nationalChapterId: number | null
    role: ChapterRoleKind | null
  },
) {
  const { nationalChapterId: chapterId, role } = invite
  if (chapterId === null || role === null) {
    throw new ORPCError('BAD_REQUEST', { message: 'This invite has been withdrawn.' })
  }
  const actorId = invite.invitedById
  await moveToChapter(tx, volunteerId, chapterId, actorId)
  const chapter = await tx.nationalChapter.findUniqueOrThrow({ where: { id: chapterId } })
  const isDeputy = await tx.chapterDeputy.findUnique({ where: { volunteerId } })
  if (role === ChapterRoleKind.LEAD) await appointLead(tx, chapterId, volunteerId, actorId)
  else if (chapter.leadId !== volunteerId && !isDeputy) {
    await appointDeputy(tx, chapterId, volunteerId, actorId)
  }
  await tx.volunteer.update({
    where: { id: volunteerId },
    data: { approvalStatus: ApprovalStatus.approved },
  })
  await tx.adminInvite.update({
    where: { id: invite.id },
    data: { status: InviteStatus.accepted, acceptedById: volunteerId, acceptedAt: new Date() },
  })
  await audit(tx, ChapterAuditAction.ROLE_INVITE_ACCEPTED, {
    actorId: volunteerId,
    chapterId,
    targetVolunteerId: volunteerId,
    details: { role },
  })
}

/** Takes away any staff role `volunteerId` holds, recording each removal. */
async function dropRoles(tx: Tx, volunteerId: number, actorId: number | null) {
  const led = await tx.nationalChapter.findUnique({ where: { leadId: volunteerId } })
  if (led) await removeLead(tx, led.id, actorId)
  const deputy = await tx.chapterDeputy.findUnique({ where: { volunteerId } })
  if (deputy) await removeDeputy(tx, deputy.nationalChapterId, volunteerId, actorId)
}

/**
 * Moves a volunteer into `chapterId` (null: the holding pool). Their country follows the
 * chapter's, their local group belonged to the old chapter so it goes, and so do any staff role
 * and pending transfer request. The projects and teams they are on are left alone.
 */
export async function moveToChapter(
  tx: Tx,
  volunteerId: number,
  chapterId: number | null,
  actorId: number | null,
  action: ChapterAuditAction = ChapterAuditAction.VOLUNTEER_REASSIGNED,
) {
  const volunteer = await tx.volunteer.findFirst({
    where: { id: volunteerId, deletedAt: null },
    select: { id: true, nationalChapterId: true },
  })
  if (!volunteer) throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
  if (volunteer.nationalChapterId === chapterId) return
  const chapter = chapterId
    ? await tx.nationalChapter.findUnique({ where: { id: chapterId } })
    : null
  if (chapterId && !chapter) throw new ORPCError('NOT_FOUND', { message: 'Chapter not found' })

  await dropRoles(tx, volunteerId, actorId)
  await tx.chapterTransferRequest.updateMany({
    where: { volunteerId, status: ChapterTransferStatus.pending },
    data: { status: ChapterTransferStatus.cancelled },
  })
  await tx.volunteer.update({
    where: { id: volunteerId },
    data: {
      nationalChapterId: chapterId,
      localGroupId: null,
      ...(chapter && { country: chapter.country }),
    },
  })
  await audit(tx, action, {
    actorId,
    chapterId,
    targetVolunteerId: volunteerId,
    details: { fromChapterId: volunteer.nationalChapterId },
  })
}
