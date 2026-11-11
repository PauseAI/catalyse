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
 * The volunteers a call is addressed to: addressable accounts in its chapters (or anywhere, the
 * holding pool included, when it names none) with its skill if it asks for one. The one rule
 * both for delivering a call and for who may see and answer it.
 */
export function addresseeWhere(call: Addressing): Prisma.VolunteerWhereInput {
  return {
    ...ADDRESSABLE,
    ...(call.senderId !== null && { NOT: { id: call.senderId } }),
    ...(call.chapterIds.length > 0 && { nationalChapterId: { in: call.chapterIds } }),
    ...(call.skillId !== null && { skills: { some: { skillId: call.skillId } } }),
  }
}

/**
 * `addresseeWhere` turned round: the calls whose chapters and skill take in `volunteer`, who must
 * also be ADDRESSABLE.
 */
export function addressedToWhere(volunteer: {
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
      {
        OR: [
          { skillId: null },
          { skill: { volunteerSkills: { some: { volunteerId: volunteer.id } } } },
        ],
      },
    ],
  }
}
