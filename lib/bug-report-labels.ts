import type { BadgeVariant } from '@/components/Badge'

export const BUG_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'wont_fix', label: "Won't Fix" },
] as const

export const BUG_CATEGORY_OPTIONS = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'ux', label: 'UX Issue' },
] as const

export const BUG_STATUS_VARIANT: Record<string, BadgeVariant> = {
  open: 'neutral',
  in_progress: 'info',
  resolved: 'success',
  wont_fix: 'neutral',
}

export function bugStatusLabel(status: string): string {
  return BUG_STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status
}

/**
 * A report's `pageUrl` is caller-supplied and unvalidated — it can carry any origin or
 * scheme. Never link it as-is: reduce it to its same-origin path, and return null when it
 * doesn't reduce to one so the caller renders it as plain text instead.
 */
export function bugReportPagePath(pageUrl: string): string | null {
  try {
    const { pathname, search } = new URL(pageUrl, 'http://bug-report.invalid')
    const path = pathname + search
    return path.startsWith('/') ? path : null
  } catch {
    return null
  }
}
