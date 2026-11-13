import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createAdmin } from '@/test/factories'
import { runCspSummaryJob } from './csp-summary'

afterEach(() => vi.useRealTimers())

const settings = (data: { cspViolationCount: number; cspSummaryLastSentAt: Date | null }) =>
  prisma.platformSettings.update({ where: { id: 1 }, data })

describe('runCspSummaryJob', () => {
  it('sends once per UTC day, however close to a day apart the runs land', async () => {
    const admin = await createAdmin({ isTechnicalAdmin: true })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-02T08:00:10Z'))
    // Yesterday's went out 23h59m ago.
    await settings({ cspViolationCount: 3, cspSummaryLastSentAt: new Date('2026-12-01T08:00:40Z') })
    expect(await runCspSummaryJob()).toMatchObject({ sent: 1 })
    expect(
      await prisma.notification.count({
        where: { volunteerId: admin.id, type: 'csp_violation_summary' },
      }),
    ).toBe(1)

    await settings({ cspViolationCount: 2, cspSummaryLastSentAt: new Date('2026-12-02T08:00:10Z') })
    expect(await runCspSummaryJob()).toEqual({ skipped: true, reason: 'sent today' })
  })
})
