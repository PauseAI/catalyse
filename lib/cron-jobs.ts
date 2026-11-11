import { recordCronRun, type CronTriggerSource } from '@/lib/cron-audit'
import { runBackupJob } from '@/jobs/backup'
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
  backup: runBackupJob,
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

/** A run started this long ago and still marked running is taken to have died. */
const STALE_RUN_MS = 60 * 60 * 1000

/**
 * Whether daily job `name` is due at `now`: from {@link DAILY_JOBS_HOUR_UTC}, until a run of it
 * succeeds that UTC day. A run still going counts, so overlapping triggers don't start a second;
 * a failed run doesn't, so the next trigger tries again.
 */
export async function dailyJobDue(name: CronJobName, now: Date): Promise<boolean> {
  if (now.getUTCHours() < DAILY_JOBS_HOUR_UTC) return false
  const done = await prisma.cronJobRun.findFirst({
    where: {
      jobName: name,
      startedAt: { gte: startOfUtcDay(now) },
      OR: [
        { status: 'success' },
        { status: 'running', startedAt: { gte: new Date(now.getTime() - STALE_RUN_MS) } },
      ],
    },
    select: { id: true },
  })
  return !done
}

/**
 * What one trigger of the hourly cron runs: every hourly job, and each daily job that is due.
 * Each result is the job's own, its error, or `{ skipped: 'not due' }`.
 */
export async function runScheduledJobs(now: Date = new Date()): Promise<Record<string, unknown>> {
  const results = await Promise.allSettled(
    CRON_JOB_NAMES.map(async (name) =>
      CRON_JOB_INFO[name].every === 'hour' || (await dailyJobDue(name, now))
        ? CRON_JOBS[name]()
        : { skipped: 'not due' },
    ),
  )
  return Object.fromEntries(
    CRON_JOB_NAMES.map((name, i) => {
      const r = results[i]
      return [name, r.status === 'fulfilled' ? r.value : { error: String(r.reason) }]
    }),
  )
}
