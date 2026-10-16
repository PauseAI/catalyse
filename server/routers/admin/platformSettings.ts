import { prisma } from '@/lib/prisma'
import { PlatformSettingsSchema } from '@/lib/schemas'
import { adminProcedure } from '../../procedures'

const SINGLETON_ID = 1

const pick = (s: { requireApplicationApproval: boolean; maintenanceMode: boolean }) => ({
  requireApplicationApproval: s.requireApplicationApproval,
  maintenanceMode: s.maintenanceMode,
})

export const adminPlatformSettingsRouter = {
  get: adminProcedure.handler(async () => {
    const settings = await prisma.platformSettings.findUniqueOrThrow({
      where: { id: SINGLETON_ID },
    })
    return pick(settings)
  }),

  update: adminProcedure.input(PlatformSettingsSchema).handler(async ({ input }) => {
    const settings = await prisma.platformSettings.update({
      where: { id: SINGLETON_ID },
      data: input,
    })
    return pick(settings)
  }),
}
