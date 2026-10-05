'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApproved } from '@/lib/hooks/auth'
import { useOneTimeNotice } from '@/lib/hooks/useOneTimeNotice'
import { useUrlParam, useUrlSearchInput } from '@/lib/hooks/url-filters'
import { DIRECTORY_PAGE_SIZE as PAGE_SIZE } from '@/lib/pagination'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Button from '@/components/Button'
import FilterDropdown from '@/components/FilterDropdown'
import { buildLocationOptions, type LocalGroupOption } from '@/lib/filter-options'
import { InferRouterInputs } from '@orpc/server'
import { orpc } from '@/lib/orpc'
import { AppRouter } from '@/server/router'
import { type Project, ProjectList, statusBadgeClasses } from '@/components/ProjectCard'
import { badgeClasses } from '@/components/Badge'
import PageLoading from '@/components/PageLoading'
import ResendConfirmation from '@/components/ResendConfirmation'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import ViewSwitch, { PROJECT_VIEWS } from '@/components/ViewSwitch'

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
] as const

const NEEDS_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'looking_for_people', label: 'Looking for People' },
  { value: 'seeking_help', label: 'Seeking Help', indent: true },
  { value: 'seeking_owner', label: 'Seeking Owner', indent: true },
  { value: 'not_seeking', label: 'Not Seeking' },
] as const

const URGENCY_OPTIONS = [
  { value: '', label: 'Any urgency' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
] as const

const SORT_OPTIONS = [
  { value: '', label: 'Default sort' },
  { value: 'created_at', label: 'Newest first' },
  { value: 'match', label: 'Best match' },
  { value: 'urgency', label: 'Most urgent' },
] as const

type ApprovedUser = NonNullable<ReturnType<typeof useRequireApproved>['user']>

function ProjectsPageContent({ user }: { user: ApprovedUser }) {
  const userSkillIds = new Set(user.skills.map((s) => s.id))

  const [searchInput, setSearchInput, urlSearch] = useUrlSearchInput('q')
  const [statusFilter, setStatusFilter] = useUrlParam('status')
  const [needsFilter, setNeedsFilter] = useUrlParam('needs')
  const [urgencyFilter, setUrgencyFilter] = useUrlParam('urgency')
  const [locationFilter, setLocationFilter] = useUrlParam('location')
  const [teamFilter, setTeamFilter] = useUrlParam('team')
  const [sortBy, setSortBy] = useUrlParam('sort')
  // Set when an admin page turned the viewer away (NO_ACCESS_NOTICE_URL).
  const [adminOnlyNotice, dismissAdminOnlyNotice] = useOneTimeNotice('no-access')
  const [superAdminOnlyNotice, dismissSuperAdminOnlyNotice] = useOneTimeNotice('super-admin-only')
  const turnedAway = superAdminOnlyNotice
    ? { text: 'That page is for super admins.', dismiss: dismissSuperAdminOnlyNotice }
    : adminOnlyNotice
      ? { text: 'That page is for admins.', dismiss: dismissAdminOnlyNotice }
      : null
  const [pageParam, setPageParam] = useUrlParam('page')
  const page = Math.max(1, parseInt(pageParam, 10) || 1)
  const router = useRouter()
  function clearFilters() {
    setSearchInput('')
    router.replace('?', { scroll: false })
  }

  const [completedOpen, setCompletedOpen] = useState(false)

  // A chosen sort needs one ordered list; the grouped overview has its own order.
  const isFlatView = Boolean(statusFilter || needsFilter || sortBy)

  // Reset to page 1 whenever a filter changes, but not on the initial mount
  // (which would clobber a deep-linked ?page=N&status=... URL).
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setPageParam('')
  }, [
    urlSearch,
    statusFilter,
    needsFilter,
    urgencyFilter,
    locationFilter,
    teamFilter,
    sortBy,
    setPageParam,
  ])

  const { data: pendingTriageList = [] } = useQuery({
    ...orpc.admin.triage.list.queryOptions(),
    enabled: !!user?.isAdmin,
  })
  const pendingCount = pendingTriageList.length

  const { data: pendingApplicationsList = [] } = useQuery({
    ...orpc.admin.applications.list.queryOptions({ input: { filter: 'mine' } }),
    enabled: !!user?.isSuperAdmin,
  })
  const pendingApplicationsCount = pendingApplicationsList.length

  const { data: localGroupsData } = useQuery({
    ...orpc.localGroups.list.queryOptions({ input: {} }),
    enabled: true,
  })
  const localGroups: LocalGroupOption[] = localGroupsData?.groups ?? []

  const { data: teamsData } = useQuery({ ...orpc.teams.list.queryOptions(), enabled: !!user })
  // The template button only shows once there is a template to start from.
  const { data: templates = [] } = useQuery({
    ...orpc.templates.list.queryOptions({ input: {} }),
    enabled: !!user,
  })
  const hasTemplates = templates.length > 0
  const allTeamsList = teamsData?.teams ?? []
  const myTeams = allTeamsList.filter((t) => t.viewerRole !== null)
  const teamOptions = user.isAdmin
    ? [
        { value: '', label: 'All teams' },
        ...allTeamsList.map((t) => ({ value: String(t.id), label: t.name })),
      ]
    : [
        { value: '', label: 'All my teams' },
        ...myTeams.map((t) => ({ value: String(t.id), label: t.name })),
      ]

  const projectsInput: InferRouterInputs<AppRouter>['projects']['list'] = {}
  if (urlSearch) projectsInput.search = urlSearch
  if (statusFilter) projectsInput.status = statusFilter
  if (needsFilter === 'looking_for_people') projectsInput.isSeekingAny = true
  else if (needsFilter === 'seeking_help') projectsInput.isSeekingHelp = true
  else if (needsFilter === 'seeking_owner') projectsInput.isSeekingOwner = true
  else if (needsFilter === 'not_seeking') projectsInput.notSeeking = true
  if (urgencyFilter) projectsInput.urgency = urgencyFilter
  if (locationFilter) {
    const [country, localGroup] = locationFilter.split(':')
    projectsInput.country = country
    if (localGroup) projectsInput.localGroup = localGroup
  }
  if (teamFilter) projectsInput.teamId = Number(teamFilter)
  if (sortBy) projectsInput.sortBy = sortBy
  if (isFlatView) {
    projectsInput.limit = PAGE_SIZE
    projectsInput.offset = (page - 1) * PAGE_SIZE
  }

  const {
    data: projectsData,
    isPending: loadingFlatProjects,
    error: projectsError,
  } = useQuery({
    ...orpc.projects.list.queryOptions({ input: projectsInput }),
    // Kept running even while the grouped overview is showing (not gated on isFlatView), so
    // switching into a status/needs filter has a previous result to hold onto via
    // placeholderData instead of flashing a loading spinner on the very first fetch.
    enabled: !!user,
    // Keep showing the previous result set while a filter change refetches, instead of
    // swapping the whole list to a loading spinner. Without this, isPending flips true on
    // every debounced search commit and unmounts the list mid-render — if a user's click on
    // a result lands right as that swap happens (more likely when the debounce timer itself
    // is delayed under load), the click's navigation is lost.
    placeholderData: keepPreviousData,
  })
  const projects = projectsData?.projects ?? []
  const flatTotal = projectsData?.total ?? 0
  const flatTotalPages = Math.max(1, Math.ceil(flatTotal / PAGE_SIZE))

  // Filters shared with the grouped-overview query — everything except status/needs, which
  // define the sections rather than filtering within them.
  const groupedInput: InferRouterInputs<AppRouter>['projects']['listGrouped'] = {}
  if (urlSearch) groupedInput.search = urlSearch
  if (urgencyFilter) groupedInput.urgency = urgencyFilter
  if (locationFilter) {
    const [country, localGroup] = locationFilter.split(':')
    groupedInput.country = country
    if (localGroup) groupedInput.localGroup = localGroup
  }
  if (teamFilter) groupedInput.teamId = Number(teamFilter)

  const { data: groupedData, isPending: loadingGroupedProjects } = useQuery({
    ...orpc.projects.listGrouped.queryOptions({ input: groupedInput }),
    // Same reasoning as the `list` query above, in the other direction.
    enabled: !!user,
    placeholderData: keepPreviousData,
  })

  const loadingProjects = isFlatView ? loadingFlatProjects : loadingGroupedProjects

  const hasFilters =
    searchInput ||
    statusFilter ||
    needsFilter ||
    urgencyFilter ||
    locationFilter ||
    teamFilter ||
    sortBy

  function byMatchScore(a: Project, b: Project) {
    const scoreA = a.match?.matchedRequiredCount ?? 0
    const scoreB = b.match?.matchedRequiredCount ?? 0
    return scoreB - scoreA
  }
  const sortGroup = (list: Project[]) =>
    userSkillIds.size > 0 ? [...list].sort(byMatchScore) : list

  const GROUP_META: Record<
    string,
    { label: string; desc: string; color: string; viewAllHref?: string }
  > = {
    your_team: {
      label: 'Your Team Projects',
      desc: 'Tagged to a team you belong to',
      color: 'text-primary',
    },
    seeking: {
      label: 'Looking for People',
      desc: 'These projects need your help',
      color: 'text-orange-600 dark:text-orange-400',
      viewAllHref: '/projects?needs=looking_for_people',
    },
    in_progress: {
      label: 'In Progress',
      desc: 'Actively being worked on',
      color: 'text-blue-600 dark:text-blue-400',
      viewAllHref: '/projects?status=in_progress',
    },
    other: { label: 'Other Active', desc: '', color: 'text-text-light' },
    on_hold: {
      label: 'On Hold',
      desc: '',
      color: 'text-red-600 dark:text-red-400',
      viewAllHref: '/projects?status=on_hold',
    },
    completed: {
      label: 'Completed',
      desc: '',
      color: 'text-green-600 dark:text-green-400',
      viewAllHref: '/projects?status=completed',
    },
  }
  const GROUP_ORDER = ['your_team', 'seeking', 'in_progress', 'other', 'on_hold', 'completed']

  const groups = GROUP_ORDER.map((key) => groupedData?.groups.find((g) => g.key === key))
    .filter((g): g is NonNullable<typeof g> => g !== undefined)
    .map((g) => ({
      key: g.key,
      total: g.total,
      projects: sortGroup(g.projects),
      ...GROUP_META[g.key],
    }))
  const seeking = groups.find((g) => g.key === 'seeking')?.projects ?? []
  const inProgress = groups.find((g) => g.key === 'in_progress')?.projects ?? []

  // Nothing to search or filter until the email is confirmed; the card below says what to do.
  const needsConfirmation = !user.emailConfirmed && !user.isAdmin

  return (
    <>
      <main className="container py-5 pb-15">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 role="heading">Projects</h1>
          <div className="flex flex-wrap items-center gap-2">
            {!needsConfirmation && hasTemplates && (
              <Button href="/templates" variant="secondary">
                Start from a template
              </Button>
            )}
            <Button href="/suggest">Propose a project</Button>
          </div>
        </div>
        {!needsConfirmation && (
          <ViewSwitch label="Project views" views={PROJECT_VIEWS} current="/projects" />
        )}

        {turnedAway && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 p-4 rounded-lg mb-5 bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-600"
          >
            <span>{turnedAway.text}</span>
            <Button variant="ghost" icon onClick={turnedAway.dismiss} aria-label="Dismiss">
              ×
            </Button>
          </div>
        )}

        {user.isAdmin && pendingCount > 0 && (
          <div className="flex items-center gap-3 p-4 rounded-lg mb-4 bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900 dark:text-amber-200 dark:border-amber-600">
            <strong>
              {pendingCount} project{pendingCount !== 1 ? 's' : ''} pending review.
            </strong>{' '}
            <Link href="/admin/triage" className="underline">
              Go to triage →
            </Link>
          </div>
        )}
        {user.isSuperAdmin && pendingApplicationsCount > 0 && (
          <div className="flex items-center gap-3 p-4 rounded-lg mb-4 bg-violet-100 text-violet-800 border border-violet-300 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-600">
            <strong>
              {pendingApplicationsCount} application{pendingApplicationsCount !== 1 ? 's' : ''}{' '}
              pending review.
            </strong>{' '}
            <Link href="/admin/applications" className="underline">
              Review applications →
            </Link>
          </div>
        )}

        {!needsConfirmation && (
          <>
            {/* Filters */}
            <div className="mb-5">
              <div className="mb-3">
                <label htmlFor="search-projects">Search</label>
                <input
                  id="search-projects"
                  type="search"
                  aria-label="Search"
                  placeholder="Search projects…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <div className="flex gap-3 flex-wrap items-end">
                <FilterDropdown
                  id="status-filter"
                  label="Status"
                  ariaLabel="Status filter"
                  value={statusFilter}
                  options={STATUS_OPTIONS}
                  onChange={setStatusFilter}
                />
                <FilterDropdown
                  id="needs-filter"
                  label="Needs"
                  ariaLabel="Needs filter"
                  value={needsFilter}
                  options={NEEDS_OPTIONS}
                  onChange={setNeedsFilter}
                />
                <FilterDropdown
                  id="urgency-filter"
                  label="Priority"
                  ariaLabel="Priority filter"
                  value={urgencyFilter}
                  options={URGENCY_OPTIONS}
                  onChange={setUrgencyFilter}
                />

                <FilterDropdown
                  id="location-filter"
                  label="Country/Group"
                  ariaLabel="Country/Group filter"
                  value={locationFilter}
                  options={buildLocationOptions(localGroups)}
                  onChange={setLocationFilter}
                  searchable
                />

                {(user.isAdmin || myTeams.length > 0) && (
                  <FilterDropdown
                    id="team-filter"
                    label="Team"
                    ariaLabel="Team filter"
                    value={teamFilter}
                    options={teamOptions}
                    onChange={setTeamFilter}
                    searchable
                  />
                )}

                <FilterDropdown
                  id="sort-filter"
                  label="Sort by"
                  ariaLabel="Sort filter"
                  value={sortBy}
                  options={SORT_OPTIONS}
                  onChange={setSortBy}
                />

                {hasFilters && (
                  <Button variant="outline" size="lg" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {needsConfirmation ? (
          // An unconfirmed email is a step to take, not a failure.
          <div className="bg-surface rounded-xl shadow p-8 text-center max-w-lg mx-auto">
            <h3>Confirm your email to browse projects</h3>
            <p className="text-text-light">We sent a link to {user.email}.</p>
            <ResendConfirmation email={user.email} />
            <p className="text-sm mt-4 mb-0">
              <Link href="/settings">Change email</Link>
            </p>
          </div>
        ) : loadingProjects ? (
          <Skeleton label="Loading projects…" />
        ) : projectsError ? (
          <div className="text-center py-15 px-5 text-text-light">
            <h3>Couldn&#39;t load projects</h3>
            <p>
              {projectsError instanceof Error
                ? projectsError.message
                : 'Something went wrong loading projects.'}
            </p>
          </div>
        ) : (isFlatView ? projects.length : groups.length) === 0 ? (
          <EmptyState
            title="No projects found"
            body="Try adjusting your filters, or propose a project of your own."
            action={<Button href="/suggest">Propose a project</Button>}
          />
        ) : (
          <>
            {/* Status summary bar */}
            {!isFlatView && groups.length > 1 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {seeking.length > 0 && (
                  <span className={badgeClasses('caution')}>
                    Looking for People: {groups.find((g) => g.key === 'seeking')?.total ?? 0}
                  </span>
                )}
                {inProgress.length > 0 && (
                  <span className={statusBadgeClasses('in_progress')}>
                    In Progress: {groups.find((g) => g.key === 'in_progress')?.total ?? 0}
                  </span>
                )}
              </div>
            )}

            {/* Grouped project cards */}
            {isFlatView ? (
              <>
                <ProjectList projects={projects} userSkillIds={userSkillIds} />
                {flatTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-4 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPageParam(page - 1 === 1 ? '' : String(page - 1))}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-text-light">
                      Page {page} of {flatTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= flatTotalPages}
                      onClick={() => setPageParam(String(page + 1))}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            ) : (
              groups
                .filter((g) => g.projects.length > 0)
                .map((g) => {
                  const isCompleted = g.key === 'completed'
                  const isOpen = !isCompleted || completedOpen
                  const overflow = g.total - g.projects.length
                  return (
                    <div key={g.key} className="mb-8">
                      {isCompleted ? (
                        <h2
                          className="text-lg mb-1 flex items-center gap-2 cursor-pointer select-none"
                          onClick={() => setCompletedOpen((o) => !o)}
                          role="button"
                          aria-expanded={completedOpen}
                          tabIndex={0}
                          onKeyDown={(e) => e.key === 'Enter' && setCompletedOpen((o) => !o)}
                        >
                          {g.label}: {g.total} project
                          {g.total !== 1 ? 's' : ''}
                          <svg
                            className={`text-text-light shrink-0 transition-transform ${completedOpen ? 'rotate-180' : 'rotate-0'}`}
                            width="32"
                            height="32"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </h2>
                      ) : (
                        <h2 className={`text-lg mb-1 ${g.color}`}>
                          {g.label}: {g.total} project
                          {g.total !== 1 ? 's' : ''}
                        </h2>
                      )}
                      {g.desc && <p className="text-text-light text-sm mb-3">{g.desc}</p>}
                      {isOpen && (
                        <div
                          key={String(completedOpen)}
                          className={isCompleted ? 'animate-fade-slide-in' : undefined}
                        >
                          <ProjectList projects={g.projects} userSkillIds={userSkillIds} />
                          {overflow > 0 && g.viewAllHref && (
                            <div className="mt-3">
                              <Link href={g.viewAllHref} className="text-sm underline">
                                View all {g.total} →
                              </Link>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
            )}
          </>
        )}
      </main>
    </>
  )
}

export default function ProjectsPage() {
  const { user, loading } = useRequireApproved()

  if (loading || !user) return <PageLoading />

  return (
    <Suspense>
      <ProjectsPageContent user={user} />
    </Suspense>
  )
}
