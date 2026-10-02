import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'

import { CRON_JOBS, CRON_JOB_NAMES, cronJobRunners, setCronJobRunners } from './cron-jobs'
import { runBackupJob } from '@/jobs/backup'
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
    expect(cronJobRunners().backup).toBe(runBackupJob)
    expect(setCronJobRunners(cronJobs.runners).backup).toBe(runBackupJob)
  })
})
