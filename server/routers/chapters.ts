import { prisma } from '@/lib/prisma'
import { publicProcedure } from '../procedures'

export const chaptersRouter = {
  /** The countries that have a chapter. Public, so signup can say when someone's has none. */
  list: publicProcedure.handler(() =>
    prisma.nationalChapter.findMany({
      select: { id: true, country: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ),
}
