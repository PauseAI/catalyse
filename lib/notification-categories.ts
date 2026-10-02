// Every notification type falls in one Inbox category. A type not listed is an update, so a
// new type shows up somewhere sensible before anyone classifies it.

export const NOTIFICATION_CATEGORIES = ['needs_action', 'update', 'message'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  needs_action: 'Needs action',
  update: 'Updates',
  message: 'Messages',
}

const NEEDS_ACTION_TYPES = [
  'new_interest',
  'team_join_request',
  'project_needs_discussion',
  'project_resubmitted',
  'mention',
  'quick_task_submitted',
  'task_submitted',
  'task_changes_requested',
  'task_needs_decision',
  'finish_by_today',
  'finish_by_overdue',
  'no_update_warning',
  'project_invite',
  'contact_request',
  // Admin-only (hidden from the Inbox, but their emails follow this category).
  'new_volunteer_signup',
  'new_project_proposal',
  'local_group_suggestion',
  'team_suggestion',
  'new_bug_report',
  'bug_report_comment',
]

const MESSAGE_TYPES = ['message_received']

export function categoryOf(type: string): NotificationCategory {
  if (NEEDS_ACTION_TYPES.includes(type)) return 'needs_action'
  if (MESSAGE_TYPES.includes(type)) return 'message'
  return 'update'
}

/** The types in a category, for filtering in the database. */
export function typesIn(category: Exclude<NotificationCategory, 'update'>): string[] {
  return category === 'needs_action' ? NEEDS_ACTION_TYPES : MESSAGE_TYPES
}

/** Every type that is not an update, for excluding them in the database. */
export const NON_UPDATE_TYPES = [...NEEDS_ACTION_TYPES, ...MESSAGE_TYPES]

/**
 * Categories whose email a volunteer may turn off. A message is delivered by email, so it
 * always sends.
 */
export const MUTABLE_EMAIL_CATEGORIES = ['needs_action', 'update'] as const
export type MutableEmailCategory = (typeof MUTABLE_EMAIL_CATEGORIES)[number]

export const EMAIL_CATEGORY_LABELS: Record<MutableEmailCategory, string> = {
  needs_action:
    'Things that need me: applicants, invites, contact and join requests, mentions, changes requested',
  update: 'Updates: approvals, status changes, comments and replies',
}
