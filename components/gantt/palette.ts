/**
 * Bar colours for the timeline. Status drives the fill and nothing else does — the critical
 * path, deadline breaches and pin conflicts are all drawn as outlines or markers on top, so
 * two facts about the same bar never have to fight over one colour.
 */

import { projectStatusLabel } from '@/lib/project-status'
import { TASK_STATUS_LABELS } from '@/lib/status-labels'

export type BarTone = 'todo' | 'progress' | 'done' | 'hold'

/** A row's status in words: a task's shown status, or a project's lifecycle status. */
export function statusLabel(status: string): string {
  return TASK_STATUS_LABELS[status] ?? projectStatusLabel(status)
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
  return `var(--gantt-bar-${tone})`
}

export function barFill(status: string): string {
  return toneFill(barTone(status))
}

export const TONE_LABELS: Record<BarTone, string> = {
  todo: 'Not started',
  progress: 'In progress',
  done: 'Completed',
  hold: 'On hold',
}
