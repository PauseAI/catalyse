import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { createApiToken } from '@/lib/api-tokens'
import { ApiTokenScopeSchema } from '@/lib/api-token-scopes'
import { adminProcedure } from '../../procedures'

const DAY_MS = 24 * 60 * 60 * 1000

/** A global admin's own API tokens: each acts as the admin who made it. */
export const adminApiTokensRouter = {
  list: adminProcedure.handler(async ({ context }) => {
    const tokens = await prisma.apiToken.findMany({
      where: { volunteerId: context.volunteer.id },
      orderBy: { createdAt: 'desc' },
    })
    return tokens.map((t) => ({
      id: t.id,
      name: t.name,
      scopes: t.scopes,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      expiresAt: t.expiresAt,
    }))
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, { message: 'Name is required' })
          .max(100, { message: 'Name must be 100 characters or fewer' }),
        scopes: z.array(ApiTokenScopeSchema).min(1, { message: 'Choose at least one permission' }),
        /** Null: never expires. */
        expiresInDays: z.number().int().positive().max(365).nullable(),
      }),
    )
    .handler(async ({ input, context }) => {
      const { token } = await createApiToken(context.volunteer.id, {
        name: input.name,
        scopes: [...new Set(input.scopes)],
        expiresAt:
          input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * DAY_MS),
      })
      return { token }
    }),

  revoke: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { count } = await prisma.apiToken.deleteMany({
        where: { id: input.id, volunteerId: context.volunteer.id },
      })
      if (count === 0) throw new ORPCError('NOT_FOUND', { message: 'Token not found' })
      return { message: 'Token revoked' }
    }),
}
