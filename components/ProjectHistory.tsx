import Link from 'next/link'
import { H2, H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import { ProjectStatusBadge, WorkStatusBadge } from '@/components/StatusBadges'
import { formatDateShort } from '@/lib/format-date'
import type { ProjectHistoryEntry, ProjectRole, RoleStint, TaskRole } from '@/lib/volunteer-history'
import { SECTION_CARD } from '@/lib/ui-classes'

const ROLE_LABELS: Record<ProjectRole | TaskRole, string> = {
  creator: 'Creator',
  owner: 'Owner',
  deputy: 'Deputy',
  member: 'Member',
  assignee: 'Assignee',
  helper: 'Helper',
}

// The history is read by someone else, so nothing in it is the viewer's move.
const ONLOOKER = { isAssignee: false, canReview: false }

function stintText({ role, since, ended }: RoleStint<ProjectRole | TaskRole>): string {
  const from = since ? ` from ${formatDateShort(since)}` : ''
  return `${ROLE_LABELS[role]}${from}${ended ? ', left' : ''}`
}

function ProjectRow({
  entry,
  viewerIsAdmin,
}: {
  entry: ProjectHistoryEntry
  viewerIsAdmin: boolean
}) {
  const details = entry.roles.map(stintText)
  if (entry.completedAt) details.push(`Finished ${formatDateShort(entry.completedAt)}`)
  return (
    <li className="py-3 border-b border-brand-border last:border-b-0">
      <div className="flex justify-between items-center gap-2">
        <Link href={`/projects/${entry.id}`} className="font-semibold text-primary-dark">
          {entry.title}
        </Link>
        <span className="shrink-0">
          <ProjectStatusBadge status={entry.status} viewerIsAdmin={viewerIsAdmin} />
        </span>
      </div>
      {details.length > 0 && (
        <P className="text-sm text-text-light mt-1 mb-0">{details.join(' · ')}</P>
      )}
      {entry.tasks.length > 0 && (
        <ul
          aria-label={`Tasks on ${entry.title}`}
          className="mt-2 ml-4 pl-3 border-l-2 border-brand-border"
        >
          {entry.tasks.map((t) => (
            <li key={t.id} className="py-1.5 flex justify-between items-center gap-2">
              <div className="min-w-0">
                <Link href={`/projects/${entry.id}/tasks/${t.id}`} className="text-primary-dark">
                  {t.title}
                </Link>
                <div className="text-sm text-text-light">
                  {stintText(t)}
                  {t.completedAt && ` · finished ${formatDateShort(t.completedAt)}`}
                </div>
              </div>
              <WorkStatusBadge status={t.status} viewer={ONLOOKER} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** What a volunteer has worked on and in what role, split into current and past work. */
export default function ProjectHistory({
  entries,
  viewerIsAdmin,
}: {
  entries: ProjectHistoryEntry[]
  viewerIsAdmin: boolean
}) {
  if (entries.length === 0) return null
  const groups = [
    { title: 'Current', items: entries.filter((e) => e.current) },
    { title: 'Past', items: entries.filter((e) => !e.current) },
  ]
  return (
    <section
      id="projectHistory"
      aria-labelledby="projectHistoryHeading"
      className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word`}
    >
      <H2 id="projectHistoryHeading">Project history</H2>
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.title} className="mt-4 first-of-type:mt-0">
              <H3 className="text-text-light text-base uppercase tracking-wide">{g.title}</H3>
              <ul aria-label={`${g.title} projects`}>
                {g.items.map((e) => (
                  <ProjectRow key={e.id} entry={e} viewerIsAdmin={viewerIsAdmin} />
                ))}
              </ul>
            </div>
          ),
      )}
    </section>
  )
}
