import { recordCronRun, type CronTriggerSource } from '@/lib/cron-audit'
import { runBackupJob } from '@/jobs/backup'
import { runDigestJob } from '@/jobs/digest'
import { runNudgesJob } from '@/jobs/nudges'
import { runApplicationsSummaryJob, runApplicationsAnonymisationJob } from '@/jobs/applications'
import { runCspSummaryJob } from '@/jobs/csp-summary'
import { runDeadlineRemindersJob } from '@/jobs/deadline-reminders'
import { CRON_JOB_NAMES, type CronJobName } from '@/lib/cron-job-names'

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
