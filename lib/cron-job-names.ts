export const CRON_JOB_NAMES = [
  'backup',
  'digest',
  'nudges',
  'applications-summary',
  'applications-anonymisation',
  'csp-summary',
  'deadline-reminders',
  'notification-digest',
] as const

export type CronJobName = (typeof CRON_JOB_NAMES)[number]

/** The UTC hour from which each daily job is due; the cron trigger itself fires hourly. */
export const DAILY_JOBS_HOUR_UTC = 8

/**
 * `every: 'hour'` jobs run on every trigger; `every: 'day'` ones on the first trigger at or
 * after {@link DAILY_JOBS_HOUR_UTC} each UTC day that has no successful run yet.
 */
export type CronJobInfo = { description: string; idempotent: boolean; every: 'hour' | 'day' }

export const CRON_JOB_INFO: Record<CronJobName, CronJobInfo> = {
  backup: {
    description: 'Snapshots the database locally and uploads it to B2, then prunes old backups.',
    idempotent: false,
    every: 'day',
  },
  digest: {
    description: 'Emails volunteers a fortnightly digest of new matching projects.',
    idempotent: true,
    every: 'day',
  },
  nudges: {
    description:
      'Emails nudges/warnings for stale in-progress tasks, and surrenders tasks inactive 28+ days.',
    idempotent: true,
    every: 'day',
  },
  'applications-summary': {
    description: 'Emails superadmins a count of pending volunteer applications.',
    idempotent: true,
    every: 'day',
  },
  'applications-anonymisation': {
    description: 'Anonymises rejected applications past the retention period.',
    idempotent: true,
    every: 'day',
  },
  'csp-summary': {
    description: 'Emails technical admins a daily count of CSP violations, if any were reported.',
    idempotent: true,
    every: 'day',
  },
  'deadline-reminders': {
    description:
      'Deadline check-ins and overdue reminders, past-plan decisions for owners, and one daily summary email per person.',
    idempotent: true,
    every: 'day',
  },
  'notification-digest': {
    description:
      'Emails each person whose local digest hour it is, and whose period has passed, everything they chose to get in their digest.',
    idempotent: true,
    every: 'hour',
  },
}
