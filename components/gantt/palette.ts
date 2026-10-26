/**
 * Bar colours for the timeline. Status drives the fill and nothing else does — the critical
 * path, deadline breaches and pin conflicts are all drawn as outlines or markers on top, so
 * two facts about the same bar never have to fight over one colour.
 */

import type { BadgeVariant } from '@/components/Badge'
import { PROJECT_STATUS_CONFIG, projectStatusLabel } from '@/lib/project-status'
import { TASK_STATUS_LABELS, workStatusBadge } from '@/lib/status-labels'

export type BarTone = 'todo' | 'progress' | 'done' | 'hold'

/** A row's status in words: a task's shown status, or a project's lifecycle status. */
export function statusLabel(status: string): string {
  return TASK_STATUS_LABELS[status] ?? projectStatusLabel(status)
}

/** A row's status badge: a task's by `workStatusBadge`, a project's by its lifecycle config. */
export function rowStatusBadge(status: string): { label: string; variant: BadgeVariant } {
  return TASK_STATUS_LABELS[status]
    ? workStatusBadge(status, false)
    : (PROJECT_STATUS_CONFIG[status] ?? { label: projectStatusLabel(status), variant: 'neutral' })
}

/**
 * Statuses that mean "parked", across ProjectStatus and a task's shown status (Blocked and Ready
 * are still to do).
 */
const HOLD_STATUSES = new Set(['on_hold', 'archived', 'cancelled', 'needs_discussion'])

export function barTone(status: string): BarTone {
  if (status === 'completed') return 'done'
  if (status === 'in_progress' || status === 'under_review') return 'progress'
  if (HOLD_STATUSES.has(status)) return 'hold'
  return 'todo'
}

export function toneFill(tone: BarTone): string {
  return `var(--color-gantt-bar-${tone})`
}

export function barFill(status: string): string {
  return toneFill(barTone(status))
}

export const TONE_LABELS: Record<BarTone, string> = {
  todo: 'To do',
  progress: 'In progress',
  done: 'Completed',
  hold: 'On hold',
}
