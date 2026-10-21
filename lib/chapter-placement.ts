import { ORPCError } from '@orpc/server'
import { prisma } from './prisma'
import { OTHER_COUNTRY } from './countries'
import { isEnabledCountry } from './countries-server'

/** A country someone may say they live in: an enabled one, or Other. */
export async function assertKnownCountry(country: string): Promise<void> {
  if (country !== OTHER_COUNTRY && !(await isEnabledCountry(country))) {
    throw new ORPCError('BAD_REQUEST', { message: 'Choose your country from the list' })
  }
}

/**
 * Where someone who lives in `country` belongs: that country's chapter, or the holding pool
 * when it has none. A local group, given by name, must be one of that chapter's.
 */
export async function placement(country: string, localGroup?: string | null) {
  await assertKnownCountry(country)
  const chapter = await prisma.nationalChapter.findUnique({ where: { country } })
  return {
    country,
    nationalChapterId: chapter?.id ?? null,
    ...(await groupIn(chapter?.id ?? null, localGroup)),
  }
}

/** The `localGroupId` for a group named in `chapterId`; no name clears it. */
export async function groupIn(chapterId: number | null, localGroup?: string | null) {
  if (!localGroup) return { localGroupId: null }
  const group =
    chapterId === null
      ? null
      : await prisma.localGroup.findUnique({
          where: { nationalChapterId_name: { nationalChapterId: chapterId, name: localGroup } },
        })
  if (!group) {
    throw new ORPCError('BAD_REQUEST', { message: "Choose one of your country's local groups" })
  }
  return { localGroupId: group.id }
}
