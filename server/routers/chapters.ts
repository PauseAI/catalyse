import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { moveToChapter } from '@/lib/chapter-roles'
import { countryName } from '@/lib/countries-server'
import { notifyChapterStaff } from '@/lib/notify'
import { ApprovalStatus, ChapterAuditAction } from '@/generated/prisma/enums'
import { authedProcedure, publicProcedure } from '../procedures'

export const chaptersRouter = {
  /** The countries that have a chapter. Public, so signup can say when someone's has none. */
  list: publicProcedure.handler(() =>
    prisma.nationalChapter.findMany({
      select: { id: true, country: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ),

  /**
   * An approved volunteer in the holding pool joins the chapter they choose, whatever country
   * they gave, and its staff hear of it. Their country becomes the chapter's, as on any move.
   */
  join: authedProcedure
    .input(z.object({ chapterId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      if (
        volunteer.nationalChapterId !== null ||
        volunteer.approvalStatus !== ApprovalStatus.approved
      ) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Only an approved volunteer with no chapter can join one',
        })
      }
      const chapter = await prisma.nationalChapter.findUnique({ where: { id: input.chapterId } })
      if (!chapter) throw new ORPCError('NOT_FOUND', { message: 'Chapter not found' })
      await prisma.$transaction((tx) =>
        moveToChapter(
          tx,
          volunteer.id,
          chapter.id,
          volunteer.id,
          ChapterAuditAction.JOINED_FROM_POOL,
        ),
      )
      await notifyChapterStaff(
        chapter.id,
        'chapter_joined',
        `${volunteer.name} joined ${chapter.name} from the holding pool`,
        volunteer.country
          ? `They gave their country as ${await countryName(volunteer.country)}.`
          : 'They gave no country.',
        `/admin/volunteers/${volunteer.id}`,
      )
      return { message: `You joined ${chapter.name}` }
    }),
}
