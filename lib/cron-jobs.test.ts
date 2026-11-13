import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'

import {
  CRON_JOBS,
  CRON_JOB_NAMES,
  cronJobRunners,
  runScheduledJobs,
  setCronJobRunners,
} from './cron-jobs'
import { CRON_JOB_INFO, DAILY_JOBS_HOUR_UTC } from './cron-job-names'
import { runBackupJobOrFail } from '@/jobs/backup'
import { cronJobs } from '@/test/fakes/cron-jobs'

describe('CRON_JOBS', () => {
  it('wraps every named job in an audited run', async () => {
    const expected: Record<string, string> = {
      backup: 'backup-ran',
      digest: 'digest-ran',
      nudges: 'nudges-ran',
      'applications-summary': 'summary-ran',
      'applications-anonymisation': 'anon-ran',
      'csp-summary': 'csp-ran',
      'deadline-reminders': 'reminders-ran',
    }
    for (const name of CRON_JOB_NAMES) cronJobs.returns(name, expected[name])
    for (const name of CRON_JOB_NAMES) {
      expect(await CRON_JOBS[name]('admin')).toBe(expected[name])
      const run = await prisma.cronJobRun.findFirstOrThrow({ orderBy: { id: 'desc' } })
      expect(run).toMatchObject({ jobName: name, status: 'success', triggeredBy: 'admin' })
    }
    expect(cronJobs.runs).toEqual([...CRON_JOB_NAMES])
  })

  it('runs the real jobs unless swapped', () => {
    expect(setCronJobRunners(undefined)).toBe(cronJobs.runners)
    expect(cronJobRunners().backup).toBe(runBackupJobOrFail)
    expect(setCronJobRunners(cronJobs.runners).backup).toBe(runBackupJobOrFail)
  })
})

describe('runScheduledJobs (the hourly trigger)', () => {
  afterEach(() => vi.useRealTimers())

  const DAILY = CRON_JOB_NAMES.filter((n) => CRON_JOB_INFO[n].every === 'day')

  /** Runs the trigger at `iso`, with the clock there too; the jobs it ran. */
  async function trigger(iso: string) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
    const before = cronJobs.runs.length
    const body = await runScheduledJobs()
    return { ran: cronJobs.runs.slice(before), body }
  }
  const hour = (day: string, h: number) => `${day}T${String(h).padStart(2, '0')}:05:00Z`

  it('runs each daily job once a day from its hour, and the digest every hour', async () => {
    const ran: string[] = []
    for (let h = 0; h < 24; h++) ran.push(...(await trigger(hour('2026-12-01', h))).ran)
    for (const name of DAILY)
      expect(
        ran.filter((n) => n === name),
        name,
      ).toHaveLength(1)
    expect(ran.filter((n) => n === 'notification-digest')).toHaveLength(24)
    // Not before the hour.
    expect((await trigger(hour('2026-12-02', DAILY_JOBS_HOUR_UTC - 1))).ran).toEqual([
      'notification-digest',
    ])
    expect((await trigger(hour('2026-12-02', DAILY_JOBS_HOUR_UTC))).ran).toContain('backup')
  })

  it('catches up when the hour was missed, and reports what it skipped', async () => {
    const { ran } = await trigger(hour('2026-12-03', 13))
    expect([...ran].sort()).toEqual([...CRON_JOB_NAMES].sort())
    const again = await trigger(hour('2026-12-03', 14))
    expect(again.ran).toEqual(['notification-digest'])
    expect(again.body).toMatchObject({ backup: { skipped: 'not due' } })
  })

  it('tries a failed job again next hour, but not one that succeeded or is still running', async () => {
    cronJobs.fails('nudges', 'smtp down')
    const first = await trigger(hour('2026-12-04', 8))
    expect(first.body.nudges).toEqual({ error: 'Error: smtp down' })
    cronJobs.returns('nudges', { nudged: 0 })
    expect((await trigger(hour('2026-12-04', 9))).ran.sort()).toEqual([
      'notification-digest',
      'nudges',
    ])
    expect((await trigger(hour('2026-12-04', 10))).ran).toEqual(['notification-digest'])

    // A run started an hour ago and still going holds the day; one six hours old has died.
    await prisma.cronJobRun.create({
      data: { jobName: 'backup', status: 'running', startedAt: new Date('2026-12-05T08:00:00Z') },
    })
    expect((await trigger('2026-12-05T09:30:00Z')).ran).not.toContain('backup')
    expect((await trigger('2026-12-05T14:30:00Z')).ran).toContain('backup')
  })

  it('gives a failing job three tries a day, then waits for the next day', async () => {
    cronJobs.fails('applications-summary', 'still broken')
    const tries: number[] = []
    for (let h = 8; h < 24; h++) {
      const { ran } = await trigger(hour('2026-12-06', h))
      if (ran.includes('applications-summary')) tries.push(h)
    }
    expect(tries).toEqual([8, 9, 10])
    cronJobs.returns('applications-summary', 'fixed')
    expect((await trigger(hour('2026-12-07', 8))).ran).toContain('applications-summary')
  })

  it('starts a daily job once when two triggers arrive together', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(hour('2026-12-08', 8)))
    const before = cronJobs.runs.length
    await Promise.all([runScheduledJobs(), runScheduledJobs()])
    const ran = cronJobs.runs.slice(before)
    for (const name of DAILY)
      expect(
        ran.filter((n) => n === name),
        name,
      ).toHaveLength(1)
    expect(ran.filter((n) => n === 'notification-digest')).toHaveLength(2)
  })

  it('keeps an hourly digest run in the history only when someone was due', async () => {
    const digestRuns = () => prisma.cronJobRun.count({ where: { jobName: 'notification-digest' } })
    const before = await digestRuns()
    cronJobs.returns('notification-digest', { candidates: 3, due: 0, sent: 0 })
    await trigger(hour('2026-12-10', 3))
    expect(await digestRuns()).toBe(before)
    cronJobs.returns('notification-digest', { candidates: 3, due: 1, sent: 1 })
    await trigger(hour('2026-12-10', 4))
    expect(await digestRuns()).toBe(before + 1)
  })

  it("leaves an admin's Run now out of the day's tries", async () => {
    for (const status of ['success', 'error', 'error', 'error'] as const) {
      await prisma.cronJobRun.create({
        data: {
          jobName: 'nudges',
          status,
          triggeredBy: 'admin',
          startedAt: new Date('2026-12-09T07:30:00Z'),
        },
      })
    }
    expect((await trigger(hour('2026-12-09', 8))).ran).toContain('nudges')
  })
})
