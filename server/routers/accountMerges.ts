import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { generateAuthToken } from '@/lib/auth'
import { mergeAccounts, sameMailbox } from '@/lib/account-merge'
import { MERGE_FIELDS, type MergeConflict } from '@/lib/account-merge-fields'
import { dismissDuplicatePair } from '@/lib/duplicate-accounts'
import { sendAccountMergeEmail } from '@/lib/email'
import { env } from '@/lib/env'
import { maskEmail } from '@/lib/mask-email'
import { checkRateLimit } from '@/lib/rate-limit'
import { authedProcedure, publicProcedure } from '../procedures'

const LINK_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The live account marked as one person's with `volunteerId`, and which of the two a global
 * admin chose to keep. Throws unless the mark is there.
 */
async function markedPair(volunteerId: number, otherId: number) {
  const accounts = await prisma.volunteer.findMany({
    where: { id: { in: [volunteerId, otherId] }, deletedAt: null },
    select: { id: true, name: true, email: true, duplicateOfId: true },
  })
  const me = accounts.find((a) => a.id === volunteerId)
  const other = accounts.find((a) => a.id === otherId)
  if (!me || !other || (me.duplicateOfId !== other.id && other.duplicateOfId !== me.id)) {
    throw new ORPCError('NOT_FOUND', { message: 'Those accounts are not marked as yours' })
  }
  const [kept, merged] = other.duplicateOfId === me.id ? [me, other] : [other, me]
  return { me, other, kept, merged }
}

async function claimableRequest(token: string) {
  const request = await prisma.accountMergeRequest.findUnique({ where: { token } })
  if (!request || request.usedAt || request.expiresAt < new Date()) {
    throw new ORPCError('BAD_REQUEST', { message: 'This link has expired or was already used' })
  }
  return { request, ...(await markedPair(request.requesterId, request.otherId)) }
}

/**
 * A person settling two accounts a global admin marked as theirs. Signed in to one, they ask
 * for a link to the other's address; following it merges the two into the account the admin
 * chose to keep, signing in with whichever address they pick. Or they say the two are different people, which clears the mark.
 */
export const accountMergesRouter = {
  request: authedProcedure
    .input(z.object({ otherId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { allowed } = checkRateLimit(context.request, 'account-merge', {
        limit: 5,
        windowMs: 60 * 60 * 1000,
      })
      if (!allowed) {
        throw new ORPCError('TOO_MANY_REQUESTS', { message: 'Too many links sent; try later' })
      }
      const { me, other } = await markedPair(context.volunteer.id, input.otherId)
      if (!other.email) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'That account has no address to confirm with. Ask a global admin to merge it.',
        })
      }
      await prisma.accountMergeRequest.updateMany({
        where: { requesterId: me.id, otherId: other.id, usedAt: null },
        data: { expiresAt: new Date() },
      })
      const { token } = await prisma.accountMergeRequest.create({
        data: {
          requesterId: me.id,
          otherId: other.id,
          token: generateAuthToken(),
          expiresAt: new Date(Date.now() + LINK_TTL_MS),
        },
      })
      await sendAccountMergeEmail({ to: other.email, name: other.name, token })
      return {
        message: `We sent a link to ${maskEmail(other.email)}`,
        ...(env.STUB_EMAIL ? { _devMergeUrl: `/merge-accounts?token=${token}` } : {}),
      }
    }),

  /** What following the link would do, for the page that asks to go ahead. */
  preview: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .handler(async ({ input }) => {
      const { kept, merged } = await claimableRequest(input.token)
      return {
        keptName: kept.name,
        keptEmail: kept.email && maskEmail(kept.email),
        mergedName: merged.name,
        mergedEmail: merged.email && maskEmail(merged.email),
        /** Whether the two addresses give a choice of how to sign in. */
        chooseAddress: !!kept.email && !!merged.email && !sameMailbox(kept.email, merged.email),
      }
    }),

  /** Merges, signing in from then on with the address and password of `signInWith`. */
  confirm: publicProcedure
    .input(z.object({ token: z.string().min(1), signInWith: z.enum(['kept', 'merged']) }))
    .handler(async ({ input, context }) => {
      const { request, kept, merged } = await claimableRequest(input.token)
      const claimed = await prisma.accountMergeRequest.updateMany({
        where: { id: request.id, usedAt: null },
        data: { usedAt: new Date() },
      })
      if (!claimed.count) {
        throw new ORPCError('BAD_REQUEST', { message: 'This link has expired or was already used' })
      }
      let signInEmail: string | null
      try {
        ;({ signInEmail } = await mergeAccounts(
          kept.id,
          merged.id,
          request.requesterId,
          input.signInWith,
        ))
      } catch (e) {
        // A refused merge leaves the link good for when its cause is settled.
        await prisma.accountMergeRequest.update({
          where: { id: request.id },
          data: { usedAt: null },
        })
        throw e
      }
      return {
        email: signInEmail && maskEmail(signInEmail),
        signedOut: context.volunteer?.id === merged.id,
      }
    }),

  notSamePerson: authedProcedure
    .input(z.object({ otherId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { me, other, merged } = await markedPair(context.volunteer.id, input.otherId)
      const content = `${me.name} said accounts #${me.id} and #${other.id} belong to different people, so they are no longer marked as one.`
      await prisma.$transaction([
        prisma.volunteer.update({ where: { id: merged.id }, data: { duplicateOfId: null } }),
        prisma.adminNote.createMany({
          data: [me, other].map((v) => ({ volunteerId: v.id, authorId: me.id, content })),
        }),
      ])
      await dismissDuplicatePair([me.id, other.id], me.id)
      return { message: 'Thanks, we will treat them as two people' }
    }),

  /** Applies the person's pick for each field a merge left in conflict. */
  resolveConflicts: authedProcedure
    .input(
      z.object({
        mergeId: z.number().int(),
        choices: z.partialRecord(z.enum(MERGE_FIELDS), z.enum(['kept', 'merged'])),
      }),
    )
    .handler(async ({ input, context }) => {
      const merge = await prisma.accountMerge.findFirst({
        where: { id: input.mergeId, keptId: context.volunteer.id, conflictsResolvedAt: null },
      })
      if (!merge) throw new ORPCError('NOT_FOUND', { message: 'Nothing left to settle' })
      const conflicts = merge.conflicts as MergeConflict[]
      const missing = conflicts.filter((c) => !input.choices[c.field])
      if (missing.length) {
        throw new ORPCError('BAD_REQUEST', {
          message: `Choose a value for ${missing.map((c) => c.field).join(', ')}`,
        })
      }
      const data = Object.fromEntries(
        conflicts.map((c) => [c.field, input.choices[c.field] === 'merged' ? c.merged : c.kept]),
      )
      await prisma.$transaction([
        prisma.volunteer.update({ where: { id: context.volunteer.id }, data }),
        prisma.accountMerge.update({
          where: { id: merge.id },
          data: { conflictsResolvedAt: new Date() },
        }),
      ])
      return { message: 'Profile updated' }
    }),
}
