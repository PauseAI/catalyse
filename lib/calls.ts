import type { Prisma } from '@/generated/prisma/client'
import { ApprovalStatus } from '@/generated/prisma/enums'

export const CALL_POSTED = 'call_posted'
export const CALL_ANSWERED = 'call_answered'

type Audience = { senderId: number | null; chapterIds: number[] }

/** The accounts any call may reach: approved, confirmed, live and not marked a duplicate. */
export const ADDRESSABLE = {
  deletedAt: null,
  duplicateOfId: null,
  approvalStatus: ApprovalStatus.approved,
  emailConfirmed: true,
} satisfies Prisma.VolunteerWhereInput

/**
 * Who may see and answer a call: addressable accounts other than its sender, in its chapters (or
 * anywhere, the holding pool included, when it names none). Its skills do not narrow this.
 */
export function audienceWhere(call: Audience): Prisma.VolunteerWhereInput {
  return {
    ...ADDRESSABLE,
    ...(call.senderId !== null && { NOT: { id: call.senderId } }),
    ...(call.chapterIds.length > 0 && { nationalChapterId: { in: call.chapterIds } }),
  }
}

/**
 * Who a call is delivered to: its audience, narrowed to those with any of its skills when it asks
 * for some.
 */
export function addresseeWhere(
  call: Audience & { skillIds: number[] },
): Prisma.VolunteerWhereInput {
  return {
    ...audienceWhere(call),
    ...(call.skillIds.length > 0 && { skills: { some: { skillId: { in: call.skillIds } } } }),
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

/** `addresseeWhere` turned round: the visible calls asking for no skill or one `volunteer` has. */
export function addressedToWhere(volunteer: {
  id: number
  nationalChapterId: number | null
}): Prisma.CallWhereInput {
  return {
    AND: [
      visibleToWhere(volunteer),
      {
        OR: [
          { skills: { none: {} } },
          {
            skills: {
              some: { skill: { volunteerSkills: { some: { volunteerId: volunteer.id } } } },
            },
          },
        ],
      },
    ],
  }
}

/** The skills a call asks for, read as the choice they are: "Film, Photography or Video". */
export const anyOfSkills = (names: string[]) =>
  new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(names)
