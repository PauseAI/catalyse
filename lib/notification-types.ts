import { categoryOf, type NotificationCategory } from './notification-categories'

/**
 * Every notification type a person can be sent, in the words the settings panel shows, with how
 * it reaches them unless they choose otherwise. A notification always lands in the Inbox; the
 * choice is only whether it is also emailed, at once or in the daily digest.
 */

export const EMAIL_DELIVERIES = ['in_app', 'email', 'digest'] as const
export type Delivery = (typeof EMAIL_DELIVERIES)[number]

/** Who a type is for: everyone, chapter staff and global admins, or technical admins. */
export type Audience = 'everyone' | 'staff' | 'technical'

export type Recipient = { isTechnicalAdmin: boolean }

/** A type with no choice: how it arrives, in the panel's words, and why. */
export type Fixed = { shows: string; why: string }

type TypeInfo = {
  label: string
  audience?: Audience
  /** How it reaches someone who never chose; a function when it differs by person. */
  default: Delivery | ((who: Recipient) => Delivery)
  /** Not a choice: what the panel shows instead, and why. */
  fixed?: Fixed
}

const DAILY_SUMMARY: Fixed = { shows: 'Daily summary', why: 'Set under Daily summary above.' }

const TYPES: Record<string, TypeInfo> = {
  // Needs action
  new_interest: { label: 'Someone offers to help on a project you run', default: 'email' },
  team_join_request: { label: 'Someone asks to join a team you lead', default: 'email' },
  project_needs_discussion: { label: 'Your project proposal needs discussion', default: 'email' },
  project_resubmitted: {
    label: 'A project you asked to be changed is resubmitted',
    default: 'in_app',
  },
  project_invite: { label: "You're invited to join a project", default: 'email' },
  project_ready_to_complete: {
    label: 'Every task on your project is done, ready to complete',
    default: 'in_app',
  },
  task_submitted: { label: 'A task is submitted for you to review', default: 'email' },
  task_changes_requested: { label: 'Changes are requested on your task', default: 'in_app' },
  quick_task_submitted: { label: 'A Quick Task you posted is submitted', default: 'in_app' },
  mention: { label: 'Someone mentions you in a comment', default: 'in_app' },
  contact_request: { label: 'Someone asks for your contact details', default: 'email' },
  call_answered: { label: 'Someone answers your coordinator call', default: 'in_app' },
  finish_by_today: {
    label: 'A task of yours is due today',
    default: 'in_app',
    fixed: DAILY_SUMMARY,
  },
  finish_by_overdue: {
    label: 'A task of yours is overdue',
    default: 'in_app',
    fixed: DAILY_SUMMARY,
  },
  no_update_warning: {
    label: 'A task on your project has had no update',
    default: 'in_app',
    fixed: DAILY_SUMMARY,
  },
  task_needs_decision: {
    label: 'A task on your project is past its plan and needs a decision',
    default: 'in_app',
    fixed: DAILY_SUMMARY,
  },
  new_volunteer_signup: {
    label: 'A new volunteer signs up',
    audience: 'staff',
    default: 'email',
  },
  new_project_proposal: {
    label: 'A new project is proposed',
    audience: 'staff',
    default: 'email',
  },
  project_lead_offer: {
    label: 'Someone offers to lead a project',
    audience: 'staff',
    default: 'email',
  },
  team_suggestion: { label: 'Someone suggests a team', audience: 'staff', default: 'email' },
  local_group_suggestion: {
    label: 'Someone suggests a local group',
    audience: 'staff',
    default: 'in_app',
  },
  chapter_transfer_request: {
    label: 'Someone asks to move to your chapter',
    audience: 'staff',
    default: 'in_app',
  },
  new_bug_report: {
    label: 'A bug is reported',
    audience: 'staff',
    default: (who) => (who.isTechnicalAdmin ? 'email' : 'in_app'),
  },
  bug_report_comment: {
    label: 'A reporter comments on a bug report',
    audience: 'staff',
    default: 'in_app',
  },

  // Updates
  project_approved: { label: 'Your project proposal is approved', default: 'email' },
  draft_submitted_by_admin: {
    label: 'An admin submits your draft project for review',
    default: 'email',
  },
  project_status_changed: { label: "A project you're on changes status", default: 'email' },
  interest_accepted: { label: 'Your offer to help on a project is accepted', default: 'email' },
  interest_declined: { label: 'Your offer to help on a project is declined', default: 'email' },
  interest_removed: { label: "You're taken off a project", default: 'email' },
  invite_accepted: { label: 'Someone accepts your invite to a project', default: 'in_app' },
  invite_declined: { label: 'Someone declines your invite to a project', default: 'in_app' },
  assigned_to_project: { label: "You're assigned to a project", default: 'email' },
  team_project_assigned: { label: 'Your team is given a new project', default: 'in_app' },
  deputy_appointed: { label: "You're made deputy on a project", default: 'in_app' },
  deputy_removed: { label: 'A deputy role on your project ends', default: 'in_app' },
  task_assigned: { label: "You're assigned a task", default: 'email' },
  task_reassigned: { label: 'A task you held goes to someone else', default: 'in_app' },
  task_released: { label: 'A task you held is released', default: 'in_app' },
  task_done: { label: "A task you're helping on or reviewing is done", default: 'in_app' },
  task_accepted: { label: 'Your submitted work is accepted', default: 'in_app' },
  task_reopened: { label: "A task you're on is reopened", default: 'in_app' },
  task_replanned: { label: "A task you're on is replanned", default: 'in_app' },
  plan_moved: { label: 'Your task moves because another was replanned', default: 'in_app' },
  task_helpers_changed: { label: 'Helpers on your task change', default: 'in_app' },
  helper_added: { label: "You're added as a helper on a task", default: 'in_app' },
  helper_removed: { label: "You're removed as a helper on a task", default: 'in_app' },
  comment_reply: { label: 'Someone replies to your comment', default: 'email' },
  work_item_comment: {
    label: "Someone comments on a project or task you're on",
    default: 'in_app',
  },
  quick_task_assigned: { label: "You're assigned a Quick Task", default: 'in_app' },
  quick_task_reviewed: { label: 'Your Quick Task is reviewed', default: 'in_app' },
  finish_by_check_in: {
    label: 'A check-in on a task with a deadline',
    default: 'in_app',
    fixed: DAILY_SUMMARY,
  },
  finish_by_soon: {
    label: 'A task deadline is coming up',
    default: 'in_app',
    fixed: DAILY_SUMMARY,
  },
  plan_slip: {
    label: 'Your project is slipping past its plan',
    default: 'in_app',
    fixed: DAILY_SUMMARY,
  },
  contact_request_accepted: {
    label: 'Someone shares their contact details with you',
    default: 'in_app',
  },
  call_posted: {
    label: 'A coordinator posts a call',
    default: 'in_app',
    // Opens up once Action Hub sends its email through Amazon SES with a send cap.
    fixed: {
      shows: 'In app only',
      why: 'For now, while call emails move to a mail service with a send cap.',
    },
  },
  team_join_request_reviewed: {
    label: 'Your request to join a team is answered',
    default: 'in_app',
  },
  team_suggestion_reviewed: { label: 'Your team suggestion is reviewed', default: 'in_app' },
  local_group_suggestion_reviewed: {
    label: 'Your local group suggestion is reviewed',
    default: 'email',
  },
  chapter_transfer_decided: { label: 'Your chapter transfer is decided', default: 'in_app' },
  account_deleted_impact: {
    label: 'Someone on your project deletes their account',
    default: 'email',
  },
  bug_report_submitted: { label: 'Your bug report is received', default: 'in_app' },
  bug_report_comment_reply: { label: 'An admin replies on your bug report', default: 'in_app' },
  bug_report_resolved: { label: 'Your bug report is resolved', default: 'email' },
  chapter_joined: { label: 'Someone joins your chapter', audience: 'staff', default: 'in_app' },
  csp_violation_summary: {
    label: 'Daily count of blocked scripts (CSP violations)',
    audience: 'technical',
    default: 'email',
    fixed: { shows: 'Email', why: 'An operational alert, always emailed.' },
  },

  // Messages
  message_received: {
    label: 'A volunteer sends you a message',
    default: 'email',
    fixed: {
      shows: 'Email',
      why: 'Always emailed: the email carries the message, so you can read and reply to it.',
    },
  },
}

export const NOTIFICATION_TYPES: readonly string[] = Object.keys(TYPES)

export function isKnownType(type: string): boolean {
  return Object.hasOwn(TYPES, type)
}

/** How `type` reaches `who` when they have not chosen; null for a type not in the list. */
export function defaultDelivery(type: string, who: Recipient): Delivery | null {
  const info = TYPES[type]
  if (!info) return null
  return typeof info.default === 'function' ? info.default(who) : info.default
}

export function isFixed(type: string): boolean {
  return !!TYPES[type]?.fixed
}

/**
 * How one notification reaches its recipient. A stored choice wins, unless the type is fixed.
 * A type not in the list follows its call site: emailed when the caller wrote an email for it,
 * as every notification was before there were choices, so a new type never emails by surprise.
 */
export function resolveDelivery(
  type: string,
  who: Recipient,
  chosen: Delivery | undefined,
  hasEmail: boolean,
): Delivery {
  const fallback = defaultDelivery(type, who) ?? (hasEmail ? 'email' : 'in_app')
  if (isFixed(type)) return fallback
  return chosen ?? fallback
}

export type Viewer = Recipient & { isStaff: boolean }

function shownTo(audience: Audience, viewer: Viewer): boolean {
  if (audience === 'technical') return viewer.isTechnicalAdmin
  if (audience === 'staff') return viewer.isStaff || viewer.isTechnicalAdmin
  return true
}

export type PreferenceRow = {
  type: string
  label: string
  category: NotificationCategory
  default: Delivery
  delivery: Delivery
  /** Why the delivery is set, for a type with no choice. */
  fixed: Fixed | null
}

/** The settings panel's rows for `viewer`, in the order above, with their current choices. */
export function preferenceRows(
  viewer: Viewer,
  chosen: ReadonlyMap<string, Delivery>,
): PreferenceRow[] {
  return Object.entries(TYPES)
    .filter(([, info]) => shownTo(info.audience ?? 'everyone', viewer))
    .map(([type, info]) => {
      const def = defaultDelivery(type, viewer) as Delivery
      return {
        type,
        label: info.label,
        category: categoryOf(type),
        default: def,
        delivery: info.fixed ? def : (chosen.get(type) ?? def),
        fixed: info.fixed ?? null,
      }
    })
}
