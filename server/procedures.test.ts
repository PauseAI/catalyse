import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createSuperAdmin,
  createChapter,
  createChapterLead,
  createChapterDeputy,
} from '@/test/factories'
import { clientAs, anon } from '@/test/rpc'

/**
 * The four procedure tiers, exercised through one representative procedure each. The
 * per-router tests then only need to cover their own logic, not the gate.
 */
describe('procedure gates', () => {
  it('refuses oversized input before the procedure sees it, signed in or not', async () => {
    await expect(
      anon().auth.login({ email: 'a@example.com', password: 'x'.repeat(2001) }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'password must be 2000 characters or fewer',
    })
  })

  it('authedProcedure needs a session', async () => {
    await expect(anon().my.quickTasks()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    const vol = await createVolunteer({ approvalStatus: 'pending' })
    expect(await clientAs(vol).my.quickTasks()).toEqual([])
  })

  it('approvedProcedure additionally needs approval, unless admin', async () => {
    await expect(anon().localGroups.getById({ id: 1 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    const pending = await createVolunteer({ approvalStatus: 'pending' })
    await expect(clientAs(pending).localGroups.getById({ id: 1 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Your account is pending approval',
    })
    const pendingAdmin = await createAdmin({ approvalStatus: 'pending' })
    expect(await clientAs(pendingAdmin).localGroups.getById({ id: 1 })).toMatchObject({ id: 1 })
  })

  it('adminProcedure needs the admin flag', async () => {
    await expect(anon().admin.overview.counts()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(clientAs(await createVolunteer()).admin.overview.counts()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await clientAs(await createAdmin()).admin.overview.counts()).toMatchObject({
      pendingTriage: 0,
    })
  })

  it('adminProcedure needs an address listed in ADMIN_EMAILS, not just the flag or a chapter role', async () => {
    const forbidden = { code: 'FORBIDDEN' }
    const stale = await createVolunteer({ isAdmin: true })
    await expect(clientAs(stale).admin.platformSettings.get()).rejects.toMatchObject(forbidden)
    const lead = await createChapterLead(await createChapter())
    await expect(clientAs(lead).admin.platformSettings.get()).rejects.toMatchObject(forbidden)
    expect(await clientAs(await createSuperAdmin()).admin.platformSettings.get()).toEqual({
      requireApplicationApproval: true,
      maintenanceMode: false,
    })
  })

  it('staffProcedure needs a chapter role or global admin', async () => {
    const chapter = await createChapter()
    const deputy = await createChapterDeputy(chapter)
    await expect(anon().admin.chapters.get({ chapterId: chapter.id })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    await expect(
      clientAs(await createVolunteer()).admin.chapters.get({ chapterId: chapter.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await clientAs(deputy).admin.chapters.get({ chapterId: chapter.id })).toMatchObject({
      id: chapter.id,
    })
    expect(
      await clientAs(await createAdmin()).admin.chapters.get({ chapterId: chapter.id }),
    ).toMatchObject({ id: chapter.id })
  })

  it('adminProcedure refuses an admin who changed to a listed address without confirming it', async () => {
    const squatter = await createSuperAdmin({ emailConfirmed: false })
    await expect(clientAs(squatter).admin.platformSettings.get()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})

describe('maintenance mode', () => {
  const setMaintenance = (maintenanceMode: boolean) =>
    prisma.platformSettings.update({ where: { id: 1 }, data: { maintenanceMode } })
  const withMaintenance = async (fn: () => Promise<void>) => {
    await setMaintenance(true)
    try {
      await fn()
    } finally {
      await setMaintenance(false)
    }
  }

  it('is off by default', async () => {
    expect(await anon().maintenance.status()).toEqual({ active: false })
    expect(await anon().skills.list()).toEqual(expect.any(Array))
  })

  it('refuses every procedure but the sign-in set for anyone but a global admin', () =>
    withMaintenance(async () => {
      const down = { code: 'SERVICE_UNAVAILABLE', message: expect.stringContaining('maintenance') }
      expect(await anon().maintenance.status()).toEqual({ active: true })
      await expect(anon().skills.list()).rejects.toMatchObject(down)
      const admin = await createChapterLead(await createChapter())
      await expect(clientAs(admin).skills.list()).rejects.toMatchObject(down)
      await expect(
        anon().auth.signup({
          name: 'New',
          email: 'new@example.com',
          password: 'password123',
          applicationMessage: 'Keen',
          bio: 'Bio',
          country: 'GB',
          availabilityHoursPerWeek: 2,
        }),
      ).rejects.toMatchObject(down)
      await expect(clientAs(admin).my.quickTasks()).rejects.toMatchObject(down)
      // The sign-in set still answers, so the client can learn who is asking.
      expect(await clientAs(admin).auth.me()).toMatchObject({ id: admin.id })
      expect(await anon().version.get()).toMatchObject({ sha: expect.any(String) })
      expect(await anon().auth.googleClientId()).toEqual(expect.any(Object))
      // Being open to maintenance does not waive a procedure's own gate.
      await expect(anon().auth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    }))

  it('lets super admins through everywhere, including to switch it off', () =>
    withMaintenance(async () => {
      const sa = await createSuperAdmin()
      expect(await clientAs(sa).skills.list()).toEqual(expect.any(Array))
      expect(await clientAs(sa).admin.overview.counts()).toMatchObject({ pendingTriage: 0 })
      expect(
        await clientAs(sa).admin.platformSettings.update({ maintenanceMode: false }),
      ).toMatchObject({ maintenanceMode: false })
      expect(await anon().maintenance.status()).toEqual({ active: false })
    }))
})
