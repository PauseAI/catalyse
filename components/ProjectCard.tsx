import React from 'react'
import Link from 'next/link'
import Button from '@/components/Button'
import { Badge, badgeClasses, type BadgeVariant } from '@/components/Badge'
import { matchGradeLabel } from '@/lib/matching'
import { plural } from '@/lib/plural'
import { projectLocationParts } from '@/lib/filter-options'
import { PROJECT_STATUS_CONFIG as PROJECT_LIFECYCLE_CONFIG } from '@/lib/project-status'

export interface Project {
  id: number
  title: string
  status: string
  description: string | null
  updatedAt?: string | Date | null
  pendingInterestCount?: number
  isSeekingHelp?: boolean | null
  /** Derived server-side: live but ownerless. */
  isSeekingOwner?: boolean | null
  /** Derived server-side: owned, but no open tasks. */
  needsTasks?: boolean | null
  /** Derived server-side: days the plan runs past the project's deadline, when it does. */
  daysLate?: number | null
  isOrgProposed?: boolean | null
  projectType?: string | null
  country?: string | null
  localGroup?: string | null
  remoteEligibility?: string | null
  team?: { id: number; name: string } | null
  /** Derived server-side: is the viewer a member of this project's team? */
  isMyTeam?: boolean
  timeCommitmentHoursPerWeek?: number | null
  urgency?: string | null
  owner?: { name: string } | null
  proposedBy?: { id?: number; name: string } | string | null
  skills?: Array<{ id: number; name: string; isRequired: boolean | null }>
  match?: {
    requiredMatchPercent: number
    matchedRequiredCount: number
    totalRequired: number
    overallScore: number
  } | null
}

// Project lifecycle statuses come from lib/project-status.ts (shared with the server and
// e2e helpers); the interest statuses below are badged by the same helpers, so they're
// merged in here rather than kept in the lifecycle map.
export const PROJECT_STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  ...PROJECT_LIFECYCLE_CONFIG,
  accepted: { label: 'Accepted', variant: 'success' },
  declined: { label: 'Declined', variant: 'neutral' },
  withdrawn: { label: 'Withdrawn', variant: 'neutral' },
  removed: { label: 'Removed', variant: 'neutral' },
}

export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.label]),
)

const PROJECT_TYPE_LABELS: Record<string, string> = {
  sprint: 'Sprint',
  container: 'Time-boxed',
  ongoing: 'Ongoing',
  one_off: 'One-off',
}

export function projectStatusVariant(status: string): BadgeVariant {
  return PROJECT_STATUS_CONFIG[status]?.variant ?? 'neutral'
}

export function statusBadgeClasses(status: string) {
  return badgeClasses(projectStatusVariant(status))
}

export function ProjectCard({
  project: p,
  userSkillIds = new Set(),
  action,
  badge,
}: {
  project: Project
  userSkillIds?: Set<number>
  action?: React.ReactNode
  /** An extra badge beside the status, such as where the viewer's application stands. */
  badge?: React.ReactNode
}) {
  // The grade says how well the viewer fits; these say why.
  const matchedRequired = (p.skills ?? [])
    .filter((s) => s.isRequired && userSkillIds.has(s.id))
    .slice(0, 3)
    .map((s) => s.name)
  return (
    <div
      className={`card bg-surface rounded-xl shadow px-5 pt-5 pb-4 overflow-hidden wrap-break-word grid grid-rows-subgrid row-span-6 gap-y-2 relative min-w-0 ${p.isMyTeam ? 'border-l-4 border-primary' : ''}`}
    >
      <div className="card-header row-start-1">
        <Link
          role="link"
          href={`/projects/${p.id}`}
          className="font-heading text-lg font-bold text-brand-text no-underline hover:text-primary transition-colors"
        >
          {p.title}
        </Link>
      </div>
      {/* Status is the lifecycle position; Seeking Owner/Help/Tasks are separate,
          independently-derived facts and can co-occur with any status, including Ready. */}
      <div className="row-start-2 flex gap-1 flex-wrap self-start">
        <Badge variant={projectStatusVariant(p.status)}>
          {STATUS_LABELS[p.status] ?? p.status.replace(/_/g, ' ')}
        </Badge>
        {p.isSeekingOwner && <Badge variant="caution">Seeking Owner</Badge>}
        {p.isSeekingHelp && <Badge variant="caution">Seeking Help</Badge>}
        {p.needsTasks && <Badge variant="warning">Needs Tasks</Badge>}
        {p.daysLate ? <Badge variant="danger">{plural(p.daysLate, 'day')} late</Badge> : null}
        {badge}
      </div>
      <div className="row-start-3 flex items-center gap-3 flex-wrap text-xs text-text-light self-start">
        <span title="Owner">👤 {p.owner ? p.owner.name : 'Seeking owner'}</span>
        {(() => {
          const parts = projectLocationParts(p.country, p.localGroup, p.remoteEligibility)
          return parts.length > 0 && <span title="Location">📍 {parts.join(' · ')}</span>
        })()}
        {p.team && <span title="Team">🧑‍🤝‍🧑 {p.team.name}</span>}
        {p.projectType && (
          <span title="Type">📋 {PROJECT_TYPE_LABELS[p.projectType] ?? p.projectType}</span>
        )}
        {p.timeCommitmentHoursPerWeek && (
          <span title="Hours per week">🕐 {p.timeCommitmentHoursPerWeek}h/week</span>
        )}
        {p.urgency && <span title="Priority">⚡ {p.urgency} priority</span>}
      </div>
      <p className="row-start-4 min-w-0 text-text-light text-sm m-0 wrap-break-word">
        {p.description
          ? `${p.description.slice(0, 150)}${p.description.length > 150 ? '…' : ''}`
          : ''}
      </p>
      {(() => {
        const allSkills = p.skills ?? []
        const matched =
          userSkillIds.size > 0 ? allSkills.filter((s) => userSkillIds.has(s.id)) : allSkills
        if (matched.length === 0) return null
        const shown = matched.slice(0, 4)
        const overflow = matched.length - 4
        return (
          <div className="row-start-5 flex items-center gap-2 flex-wrap">
            {shown.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center px-2 py-0.5 bg-accent text-secondary-dark rounded-full text-xs font-medium dark:bg-gray-700 dark:text-gray-300"
              >
                {s.name}
              </span>
            ))}
            {overflow > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-text-light rounded-full text-xs font-medium dark:bg-gray-700 dark:text-gray-400">
                and {overflow} more
              </span>
            )}
          </div>
        )
      })()}
      <div className="row-start-6 flex justify-between items-center pt-2">
        {p.match &&
        (p.skills?.length ?? 0) > 0 &&
        userSkillIds.size > 0 &&
        matchGradeLabel(p.match.matchedRequiredCount) ? (
          <div className="text-xs">
            <span className="font-semibold text-primary-text">
              {matchGradeLabel(p.match.matchedRequiredCount)}
            </span>
            {matchedRequired.length > 0 && (
              <div className="text-text-light">Matches: {matchedRequired.join(', ')}</div>
            )}
          </div>
        ) : (
          <div />
        )}
        {action ?? (
          <Link href={`/projects/${p.id}`}>
            <Button variant="secondary" size="sm">
              View Details
            </Button>
          </Link>
        )}
      </div>
    </div>
  )
}

export const CARD_GRID_CLASSES = 'grid grid-cols-2 gap-x-5 gap-y-5 max-[600px]:grid-cols-1'
export const CARD_GRID_SINGLE_CLASSES = 'flex flex-col gap-5'

export function ProjectList<P extends Project>({
  projects,
  userSkillIds = new Set(),
  single = false,
  badgeFor,
}: {
  projects: P[]
  userSkillIds?: Set<number>
  single?: boolean
  badgeFor?: (project: P) => React.ReactNode
}) {
  return (
    <div className={single ? CARD_GRID_SINGLE_CLASSES : CARD_GRID_CLASSES}>
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} userSkillIds={userSkillIds} badge={badgeFor?.(p)} />
      ))}
    </div>
  )
}
