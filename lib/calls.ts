import type { Prisma } from '@/generated/prisma/client'
import { ApprovalStatus } from '@/generated/prisma/enums'

export const CALL_POSTED = 'call_posted'
export const CALL_ANSWERED = 'call_answered'

type Addressing = { senderId: number | null; chapterIds: number[]; skillId: number | null }

/** The accounts any call may reach: approved, confirmed, live and not marked a duplicate. */
export const ADDRESSABLE = {
  deletedAt: null,
  duplicateOfId: null,
  approvalStatus: ApprovalStatus.approved,
  emailConfirmed: true,
} satisfies Prisma.VolunteerWhereInput

/**
 * Who may see and answer a call: addressable accounts other than its sender, in its chapters (or
 * anywhere, the holding pool included, when it names none). Its skill does not narrow this.
 */
export function audienceWhere(call: Addressing): Prisma.VolunteerWhereInput {
  return {
    ...ADDRESSABLE,
    ...(call.senderId !== null && { NOT: { id: call.senderId } }),
    ...(call.chapterIds.length > 0 && { nationalChapterId: { in: call.chapterIds } }),
  }
}

/**
 * Who a call is delivered to: its audience, narrowed to those with its skill if it asks for one.
 */
export function addresseeWhere(call: Addressing): Prisma.VolunteerWhereInput {
  return {
    ...audienceWhere(call),
    ...(call.skillId !== null && { skills: { some: { skillId: call.skillId } } }),
  }
}

/**
 * `audienceWhere` turned round: the calls whose chapters take in `volunteer`, who must also be
 * ADDRESSABLE.
 */
export function visibleToWhere(volunteer: {
  id: number
  nationalChapterId: number | null
}): Prisma.CallWhereInput {
  return {
    OR: [{ senderId: null }, { senderId: { not: volunteer.id } }],
    AND: [
      volunteer.nationalChapterId === null
        ? { chapterIds: { isEmpty: true } }
        : {
            OR: [
              { chapterIds: { isEmpty: true } },
              { chapterIds: { has: volunteer.nationalChapterId } },
            ],
          },
    ],
  }
}

/** `addresseeWhere` turned round: the visible calls whose skill, if any, `volunteer` has. */
export function addressedToWhere(volunteer: {
  id: number
  nationalChapterId: number | null
}): Prisma.CallWhereInput {
  return {
    AND: [
      visibleToWhere(volunteer),
      {
        OR: [
          { skillId: null },
          { skill: { volunteerSkills: { some: { volunteerId: volunteer.id } } } },
        ],
      },
    ],
  }
}
