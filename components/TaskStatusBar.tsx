import { plural } from '@/lib/plural'
import { relativeDue, shortDay } from '@/lib/relative-date'
import type { TaskCounts, TaskFilter } from '@/lib/task-list-order'
import { BLEED } from '@/lib/ui-classes'

/** The `#tasks=…` hash that opens the Tasks tab under one filter. */
export function taskFilterHash(filter: TaskFilter | null): string {
  return filter ? `#tasks=${filter}` : '#tasks'
}

/**
 * A project's work at a glance, one row on the Overview: how many tasks, done, overdue, blocked
 * and unclaimed, each linking to the Tasks tab under that filter, then the countdown to the key
 * date or, without one, the project deadline. Counts at zero are left out, except tasks and done.
 */
export default function TaskStatusBar({
  counts,
  keyDate,
  deadline,
}: {
  counts: TaskCounts
  keyDate: Date | null
  deadline: Date | null
}) {
  const items: { href: string; label: string }[] = [
    { href: taskFilterHash(null), label: plural(counts.total, 'task') },
    { href: taskFilterHash('done'), label: `${counts.done} done` },
    ...(['overdue', 'blocked', 'unclaimed'] as const)
      .filter((f) => counts[f] > 0)
      .map((f) => ({ href: taskFilterHash(f), label: `${counts[f]} ${f}` })),
  ]
  const countdown = keyDate
    ? { label: 'Key date', date: keyDate }
    : deadline
      ? { label: 'Deadline', date: deadline }
      : null

  return (
    <nav
      aria-label="Task summary"
      className={`bg-surface ${BLEED} shadow px-4 sm:px-6 py-3 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm`}
    >
      {items.map((item, i) => (
        <span key={item.href} className="whitespace-nowrap">
          {i > 0 && (
            <span aria-hidden="true" className="text-text-light mr-2">
              ·
            </span>
          )}
          <a href={item.href} className="text-primary-text hover:underline">
            {item.label}
          </a>
        </span>
      ))}
      {countdown && (
        <span className="whitespace-nowrap text-text-light sm:ml-auto">
          {countdown.label} {shortDay(countdown.date)} · {relativeDue(countdown.date)}
        </span>
      )}
    </nav>
  )
}
