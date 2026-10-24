import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { adminProcedure } from '../../procedures'

export const adminCountriesRouter = {
  /** A disabled country leaves every picker; whoever already gave it keeps it. */
  setEnabled: adminProcedure
    .input(z.object({ code: z.string(), enabled: z.boolean() }))
    .handler(async ({ input }) => {
      const country = await prisma.country.findUnique({ where: { code: input.code } })
      if (!country) throw new ORPCError('NOT_FOUND', { message: 'Unknown country' })
      return prisma.country.update({
        where: { code: input.code },
        data: { enabled: input.enabled },
        select: { code: true, name: true, enabled: true },
      })
    }),
}
