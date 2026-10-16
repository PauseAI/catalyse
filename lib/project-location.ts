import { ORPCError } from '@orpc/server'
import { ProjectReach } from '@/generated/prisma/enums'
import type { ChapterAccess } from './chapter-access'
import { prisma } from './prisma'

type Location = {
  nationalChapterId: number | null
  reach: ProjectReach
  localGroupId: number | null
}

/**
 * Where a project goes, from what was asked and where it is now. It stays in its chapter (a new
 * one goes in its creator's), which only a global admin changes. A local project names one of
 * its chapter's groups; a move to another chapter leaves its old group behind, so a local
 * project moved without a new group becomes country-wide.
 */
export async function projectLocation(
  access: ChapterAccess,
  input: { chapterId?: number | null; reach?: ProjectReach | null; localGroupId?: number | null },
  current?: Location,
): Promise<Location & { chapterChanged: boolean }> {
  const from = current ? current.nationalChapterId : access.chapterId
  const nationalChapterId = input.chapterId === undefined ? from : input.chapterId
  const chapterChanged = current !== undefined && nationalChapterId !== from
  if (nationalChapterId !== from && !access.globalAdmin) {
    throw new ORPCError('FORBIDDEN', {
      message: 'Only a global admin moves a project to another chapter',
    })
  }
  if (nationalChapterId !== null && nationalChapterId !== from) {
    const exists = await prisma.nationalChapter.findUnique({ where: { id: nationalChapterId } })
    if (!exists) throw new ORPCError('NOT_FOUND', { message: 'Chapter not found' })
  }

  const keptReach =
    chapterChanged && current?.reach === ProjectReach.LOCAL
      ? ProjectReach.COUNTRY_WIDE
      : current?.reach
  const reach = input.reach ?? keptReach ?? ProjectReach.COUNTRY_WIDE
  if (reach !== ProjectReach.LOCAL) {
    return { nationalChapterId, reach, localGroupId: null, chapterChanged }
  }

  const localGroupId =
    input.localGroupId !== undefined
      ? input.localGroupId
      : chapterChanged
        ? null
        : (current?.localGroupId ?? null)
  const group =
    localGroupId === null
      ? null
      : await prisma.localGroup.findUnique({ where: { id: localGroupId } })
  if (!group || group.nationalChapterId === null || group.nationalChapterId !== nationalChapterId) {
    throw new ORPCError('BAD_REQUEST', {
      message: "A local project needs one of its chapter's local groups",
    })
  }
  return { nationalChapterId, reach, localGroupId, chapterChanged }
}
