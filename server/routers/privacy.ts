import { ORPCError } from '@orpc/server'
import { exportProfile, linkedRecords } from '@/lib/data-export'
import { authedProcedure } from '../procedures'

export const privacyRouter = {
  /** Everything held about the caller; lib/data-export.ts decides what that is from the schema. */
  export: authedProcedure.handler(async ({ context }) => {
    const [own, records] = await Promise.all([
      exportProfile(context.volunteer.id),
      linkedRecords(context.volunteer),
    ])
    if (!own) throw new ORPCError('NOT_FOUND')
    return { exportedAt: new Date().toISOString(), ...own, records }
  }),
}
