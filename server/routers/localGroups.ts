import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { inChapter } from '@/lib/chapter-access'
import { publicProcedure, approvedProcedure } from '../procedures'

export const localGroupsRouter = {
  /** Public, so signup can offer the groups of the country someone picks. */
  list: publicProcedure
    .input(z.object({ country: z.string().optional(), chapterId: z.number().int().optional() }))
    .handler(async ({ input }) => {
      const groups = await prisma.localGroup.findMany({
        where: { country: input.country, nationalChapterId: input.chapterId },
        orderBy: [{ country: 'asc' }, { name: 'asc' }],
      })
      return { groups }
    }),

  /** A group in the viewer's own chapter, for them to join. */
  getById: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const group = await prisma.localGroup.findUnique({ where: { id: input.id } })
      if (!group || !inChapter(context.access, group.nationalChapterId)) {
        throw new ORPCError('NOT_FOUND', { message: 'Local group not found' })
      }
      return { id: group.id, name: group.name, country: group.country }
    }),
}
