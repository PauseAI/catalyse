import { finishCronRun, recordCronRun, type CronTriggerSource } from '@/lib/cron-audit'
import { runBackupJobOrFail } from '@/jobs/backup'
import { runDigestJob } from '@/jobs/digest'
import { runNudgesJob } from '@/jobs/nudges'
import { runApplicationsSummaryJob, runApplicationsAnonymisationJob } from '@/jobs/applications'
import { runCspSummaryJob } from '@/jobs/csp-summary'
import { runDeadlineRemindersJob } from '@/jobs/deadline-reminders'
import { runNotificationDigestJob } from '@/jobs/notification-digest'
import {
  CRON_JOB_INFO,
  CRON_JOB_NAMES,
  DAILY_JOBS_HOUR_UTC,
  type CronJobName,
} from '@/lib/cron-job-names'
import { prisma } from '@/lib/prisma'
import { startOfUtcDay } from '@/lib/schedule'

export { CRON_JOB_NAMES, type CronJobName } from '@/lib/cron-job-names'

export type CronJobRunners = Record<CronJobName, () => Promise<unknown>>

const realRunners: CronJobRunners = {
  backup: runBackupJobOrFail,
  digest: runDigestJob,
  nudges: runNudgesJob,
  'applications-summary': runApplicationsSummaryJob,
  'applications-anonymisation': runApplicationsAnonymisationJob,
  'csp-summary': runCspSummaryJob,
  'deadline-reminders': runDeadlineRemindersJob,
  'notification-digest': runNotificationDigestJob,
}

let current: CronJobRunners = realRunners

/** The implementations behind CRON_JOBS; tests swap them with `setCronJobRunners`. */
export function cronJobRunners(): CronJobRunners {
  return current
}

/** Replaces the job implementations; `undefined` restores the real ones. Returns the previous set. */
export function setCronJobRunners(runners: CronJobRunners | undefined): CronJobRunners {
  const previous = current
  current = runners ?? realRunners
  return previous
}

/** Each job by name, wrapped so every run is recorded in the cron audit table. */
export const CRON_JOBS = Object.fromEntries(
  CRON_JOB_NAMES.map((name) => [
    name,
    (triggeredBy?: CronTriggerSource) => recordCronRun(name, () => current[name](), triggeredBy),
  ]),
) as Record<CronJobName, (triggeredBy?: CronTriggerSource) => Promise<unknown>>

/** A run still marked running after this long is taken to have died. */
const STALE_RUN_MS = 6 * 60 * 60 * 1000

/** Failed tries of a daily job in one UTC day before it waits for the next day. */
const MAX_DAILY_ATTEMPTS = 3

type Db = Pick<typeof prisma, 'cronJobRun'>

/**
 * Whether daily job `name` is due at `now`: from {@link DAILY_JOBS_HOUR_UTC}, until a run of it
 * succeeds that UTC day. A run still going holds the day; a failed or dead one is tried again
 * on the next trigger, up to {@link MAX_DAILY_ATTEMPTS} tries a day.
 */
export async function dailyJobDue(name: CronJobName, now: Date, db: Db = prisma): Promise<boolean> {
  if (now.getUTCHours() < DAILY_JOBS_HOUR_UTC) return false
  const runs = await db.cronJobRun.findMany({
    where: { jobName: name, startedAt: { gte: startOfUtcDay(now) } },
    select: { status: true, startedAt: true },
  })
  const live = (r: { startedAt: Date }) => now.getTime() - r.startedAt.getTime() < STALE_RUN_MS
  if (runs.some((r) => r.status === 'success' || (r.status === 'running' && live(r)))) return false
  return runs.length < MAX_DAILY_ATTEMPTS
}

/**
 * Starts today's run of daily job `name` if it is due, and returns its audit row; null if not.
 * The check and the start share a transaction under a lock on the job's name, so two triggers
 * at once start it only once.
 */
async function claimDailyRun(name: CronJobName, now: Date): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cron:${name}`}))`
    if (!(await dailyJobDue(name, now, tx))) return null
    const run = await tx.cronJobRun.create({
      data: { jobName: name, status: 'running', triggeredBy: 'cron', startedAt: now },
      select: { id: true },
    })
    return run.id
  })
}

/**
 * One call of the hourly cron trigger at `now`: every hourly job, and each daily job that is
 * due. Each result is the job's own, its error, or `{ skipped: 'not due' }`.
 */
export async function runScheduledJobs(now: Date = new Date()): Promise<Record<string, unknown>> {
  const results = await Promise.allSettled(
    CRON_JOB_NAMES.map(async (name) => {
      if (CRON_JOB_INFO[name].every === 'hour') return CRON_JOBS[name]()
      const runId = await claimDailyRun(name, now)
      return runId === null ? { skipped: 'not due' } : finishCronRun(runId, () => current[name]())
    }),
  )
  return Object.fromEntries(
    CRON_JOB_NAMES.map((name, i) => {
      const r = results[i]
      return [name, r.status === 'fulfilled' ? r.value : { error: String(r.reason) }]
    }),
  )
}
