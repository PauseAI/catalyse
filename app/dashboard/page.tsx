'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ResendConfirmation from '@/components/ResendConfirmation'
import ApplicantWelcome from '@/components/ApplicantWelcome'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireAuth } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import Button from '@/components/Button'
import { DueChip, ProjectStatusBadge, WorkStatusBadge } from '@/components/StatusBadges'
import { handedIn } from '@/lib/overdue'
import WorkRow, { PersonAvatar, STRETCHED_LINK } from '@/components/WorkRow'
import Modal from '@/components/ui/Modal'
import Skeleton from '@/components/Skeleton'
import { Badge } from '@/components/Badge'
import { BLEED } from '@/lib/ui-classes'
import { H1, H2, H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import { ApprovalStatus, WorkItemType } from '@/generated/prisma/enums'
import type { AppRouter } from '@/server/router'
import type { InferRouterOutputs } from '@orpc/server'

type Home = InferRouterOutputs<AppRouter>['dashboard']['get']
type FindRow = NonNullable<Home['find']>['quickTasks']
type Work = Home['work'][number]
type Attention = Home['attention'][number]

// The whole row is its title link, so it highlights as one.
const ROW_CLASSES =
  'p-4 wrap-break-word transition-colors hover:bg-accent/40 dark:hover:bg-white/[0.06]'
const ROW_META_CLASSES = 'text-sm text-text-light mt-1 flex flex-wrap items-center gap-x-2 gap-y-1'

const MANAGING_ROLES: Work['role'][] = ['Lead', 'Deputy']

// Links into the old tabbed dashboard scroll to the first of their sections that is showing.
const MANAGED_FIRST = ['managed', 'other-projects']
const OTHER_FIRST = ['other-projects', 'managed']
const LEGACY_HASHES: Record<string, string[]> = {
  '#tab-projects': OTHER_FIRST,
  '#tab-owned': MANAGED_FIRST,
  '#tab-interests': OTHER_FIRST,
  '#tab-proposed': OTHER_FIRST,
  '#tab-applications': OTHER_FIRST,
  '#tab-suggested': ['find'],
}

function Count({ n }: { n: number }) {
  if (n === 0) return null
  return (
    <span className="bg-chip text-chip-text text-xs px-2 py-0.5 rounded-full ml-2 align-middle">
      {n}
    </span>
  )
}

function GettingStarted({
  steps,
  email,
}: {
  steps: NonNullable<Home['gettingStarted']>
  email: string | null
}) {
  const items = [
    {
      done: steps.approved,
      label: 'Application approved',
      todo: 'Application under review',
      href: null,
    },
    {
      done: steps.emailConfirmed,
      label: 'Email confirmed',
      todo: 'Confirm your email',
      href: '/verify-email',
    },
    {
      done: steps.firstTask,
      label: 'First task claimed',
      todo: 'Pick a first task',
      href: steps.approved ? '/quick-tasks' : null,
    },
  ]
  return (
    <section
      aria-labelledby="getting-started"
      className={`bg-surface shadow p-4 sm:p-5 mb-6 wrap-break-word ${BLEED}`}
    >
      <H2 id="getting-started" className="text-lg mt-0 mb-3">
        Getting started
      </H2>
      {!steps.approved && (
        <P className="text-sm text-text-light mt-0 mb-3">
          Your account is pending approval. You&apos;ll be able to browse and join projects once an
          admin reviews your application.
        </P>
      )}
      <ol className="list-none p-0 m-0 flex flex-col gap-2 sm:flex-row sm:gap-6">
        {items.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={s.done ? 'text-success font-bold' : 'text-text-light'}
            >
              {s.done ? '✔' : '○'}
            </span>
            {s.done ? (
              <span>{s.label}</span>
            ) : s.href ? (
              <Link className="text-primary-text underline" href={s.href}>
                {s.todo}
              </Link>
            ) : (
              <span className="text-text-light">{s.todo}</span>
            )}
            <span className="sr-only">{s.done ? '(done)' : '(to do)'}</span>
          </li>
        ))}
      </ol>
      {!steps.emailConfirmed && email && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-text-light">No confirmation email from us yet?</span>
          <ResendConfirmation email={email} />
        </div>
      )}
    </section>
  )
}

function FindRowView({
  label,
  row,
  seeAll,
  empty,
}: {
  label: string
  row: FindRow
  seeAll: string
  empty: React.ReactNode
}) {
  return (
    <div className="py-3 border-b border-brand-border last:border-0">
      <div className="flex items-center justify-between gap-3 mb-1">
        <H3 className="text-base m-0">
          {label}
          <Count n={row.count} />
        </H3>
        {row.count > 0 && (
          <Link href={seeAll} className="text-sm">
            See all →
          </Link>
        )}
      </div>
      {row.items.length === 0 ? (
        <P className="text-sm text-text-light m-0">{empty}</P>
      ) : (
        <ul className="list-none p-0 m-0">
          {row.items.map((item) => (
            <li key={item.id} className="text-sm py-1">
              <Link className="text-primary-text underline" href={item.href}>
                {item.title}
              </Link>
              {item.reason && <span className="text-text-light"> · {item.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function HomePage() {
  const { user, loading } = useRequireAuth()
  const queryClient = useQueryClient()
  const router = useRouter()
  const [findOpen, setFindOpen] = useState<boolean | null>(null)
  const [finishedOpen, setFinishedOpen] = useState(false)
  const [emailBannerDismissed, setEmailBannerDismissed] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)

  const { data, isPending: loadingData } = useQuery({
    ...orpc.dashboard.get.queryOptions(),
    enabled: !!user,
  })

  const isStaff = Boolean(user?.access.globalAdmin || user?.access.role)
  // The same counts as the admin area's landing page, so the two never disagree.
  const { data: adminCounts } = useQuery({
    ...orpc.admin.overview.counts.queryOptions(),
    enabled: isStaff,
  })

  const markReadMutation = useMutation({
    ...orpc.notifications.markRead.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.notifications.list.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.dashboard.get.key() })
    },
  })

  useEffect(() => {
    document.title = 'Catalyse | Home'
  }, [])

  // Old `#tab-…` links open a section, then scroll to it once it exists; the notifications tab
  // is the Inbox now.
  useEffect(() => {
    if (window.location.hash === '#tab-notifications') router.replace('/inbox')
  }, [router])
  useEffect(() => {
    if (loadingData) return
    function follow() {
      const sections = LEGACY_HASHES[window.location.hash]
      if (!sections) return
      if (sections.includes('find')) setFindOpen(true)
      const shown = sections.map((id) => document.getElementById(id)).find(Boolean)
      shown?.scrollIntoView({ block: 'start' })
    }
    follow()
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [loadingData])

  if (loading || !user) return null

  if (loadingData || !data) {
    return (
      <main className="container py-5 pb-15">
        <Skeleton label="Loading your home page…" />
      </main>
    )
  }

  const isMember = user.approvalStatus === ApprovalStatus.approved || Boolean(user.isAdmin)
  const welcome = welcomeDismissed ? null : data.approvalWelcome
  const current = data.work.filter((w) => !w.done)
  const finished = data.work.filter((w) => w.done)
  // Discovery waits until someone has nothing of their own to get on with.
  const showFind = findOpen ?? current.length === 0

  // Work that needs acting on now sits with the rest of what is waiting on them.
  const urgent = current.filter((w) => w.needsAttention)
  const calm = current.filter((w) => !w.needsAttention)
  const tasks = calm.filter((w) => w.kind === 'task')
  const managed = calm.filter((w) => w.kind === 'project' && MANAGING_ROLES.includes(w.role))
  const otherProjects = calm.filter((w) => w.kind === 'project' && !MANAGING_ROLES.includes(w.role))
  const teams = calm.filter((w) => w.kind === 'team')
  const ownAttention = data.attention.filter((a) => !a.asStaff)
  const staffAttention = data.attention.filter((a) => a.asStaff)

  const adminLinks = [
    {
      href: '/admin/applications',
      label: 'Applications to review',
      count: adminCounts?.pendingApplications,
    },
    { href: '/admin/triage', label: 'Proposals to triage', count: adminCounts?.pendingTriage },
    { href: '/admin/bugs', label: 'Open bug reports', count: adminCounts?.openBugReports },
    {
      href: '/admin/duplicates',
      label: 'Possible duplicate accounts',
      count: adminCounts?.possibleDuplicates,
    },
    {
      href: '/admin',
      label: 'Unread admin notifications',
      count: adminCounts?.unreadNotifications,
    },
  ].filter((l): l is typeof l & { count: number } => Boolean(l.count))
  const adminCount = adminLinks.reduce((n, l) => n + l.count, 0) + staffAttention.length

  const today = new Date()
  // `[status] Title … person`, the whole row one link.
  const workRow = (w: Work) => {
    const title = (
      <Link href={w.href} className={`font-semibold ${STRETCHED_LINK}`}>
        {w.title}
      </Link>
    )
    if (w.item) {
      const item = w.item
      return (
        <WorkRow
          key={w.key}
          className={ROW_CLASSES}
          status={
            <WorkStatusBadge
              status={item.displayStatus}
              quick={item.type === WorkItemType.QUICK_TASK}
              viewer={item.viewer}
            />
          }
          title={title}
          below={
            <>
              <div className={ROW_META_CLASSES}>
                <DueChip
                  deadline={item.deadline}
                  done={handedIn(item.displayStatus)}
                  viewer={item.viewer}
                  pastPlanDays={w.pastPlanDays}
                  noDeadline="No deadline"
                  today={today}
                />
                {w.context && <span>in {w.context}</span>}
              </div>
              {w.attention && <div className="text-sm font-semibold mt-1">{w.attention}</div>}
            </>
          }
          person={<PersonAvatar name={item.assigneeName} />}
        />
      )
    }
    return (
      <WorkRow
        key={w.key}
        className={ROW_CLASSES}
        status={
          w.statusKey && (
            <ProjectStatusBadge
              status={w.statusKey}
              viewerIsAdmin={Boolean(user.isAdmin || user.access.role)}
            />
          )
        }
        title={title}
        below={
          <div className={ROW_META_CLASSES}>
            <span>{w.role}</span>
            <DueChip
              deadline={w.deadline}
              done={w.done}
              viewer={{ isAssignee: false, canReview: Boolean(w.leads) }}
              pastPlanDays={w.daysLate}
              today={today}
            />
          </div>
        }
        person={
          w.kind === 'project' && (
            <PersonAvatar name={w.ownerName ?? null} label="Owner" emptyLabel="No owner yet" />
          )
        }
      />
    )
  }
  const workList = (rows: Work[]) => (
    <ul className={`list-none p-0 my-0 bg-surface shadow ${BLEED}`}>{rows.map(workRow)}</ul>
  )
  const attentionList = (items: Attention[]) => (
    <ul className={`list-none p-0 my-0 bg-surface shadow ${BLEED}`}>
      {items.map((a) => (
        <li
          key={a.key}
          className="flex items-start justify-between gap-3 p-4 border-b border-brand-border last:border-0 wrap-break-word"
        >
          <div className="min-w-0">
            <span className="text-primary mr-2" aria-hidden="true">
              ●
            </span>
            <strong>{a.title}</strong>
            {a.detail && (
              <P className="text-sm text-text-light m-0 mt-1 line-clamp-2">{a.detail}</P>
            )}
          </div>
          <Button
            href={a.href}
            size="sm"
            variant="secondary"
            aria-label={`${a.action}: ${a.title}`}
            onClick={() => {
              if (a.notificationId !== null) {
                markReadMutation.mutate({ id: a.notificationId })
              }
            }}
          >
            {a.action}
          </Button>
        </li>
      ))}
    </ul>
  )
  // A section of My work, left out while it has nothing in it.
  const workSection = (id: string, title: string, rows: Work[]) =>
    rows.length > 0 && (
      <section id={id} aria-labelledby={`${id}-heading`} className="mb-8 scroll-mt-20">
        <H2 id={`${id}-heading`}>
          {title}
          <Count n={rows.length} />
        </H2>
        {workList(rows)}
      </section>
    )

  function dismissWelcome(notificationId: number) {
    setWelcomeDismissed(true)
    // Clear the cached welcome now, so coming back to the page before the read has
    // been confirmed does not show it again.
    queryClient.setQueryData(orpc.dashboard.get.queryOptions().queryKey, (old) =>
      old ? { ...old, approvalWelcome: null } : old,
    )
    markReadMutation.mutate({ id: notificationId })
  }

  return (
    <>
      {welcome && (
        <Modal
          id="approval-welcome"
          title="You're approved. Welcome to Catalyse!"
          isOpen
          onClose={() => dismissWelcome(welcome.notificationId)}
        >
          <P>
            {welcome.emailConfirmed
              ? 'Your application has been approved. Browse projects to find something you can help with, or pick up a quick task to get started.'
              : 'Your application has been approved. One last step: confirm your email address, then you can browse projects and pick a first task.'}
          </P>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => dismissWelcome(welcome.notificationId)}>
              Not now
            </Button>
            <Button
              href={welcome.emailConfirmed ? '/projects' : '/verify-email'}
              onClick={() => dismissWelcome(welcome.notificationId)}
            >
              {welcome.emailConfirmed ? 'Browse projects' : 'Confirm your email'}
            </Button>
          </div>
        </Modal>
      )}
      <main className="container py-5 pb-15">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <H1 role="heading" className="mb-0">
            Home
          </H1>
          {isMember && <Button href="/suggest">Propose a project</Button>}
        </div>

        {user.approvalStatus === ApprovalStatus.needs_info && (
          <div className="flex items-center justify-between gap-3 p-4 rounded-lg mb-5 bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
            <span>We need a bit more information before we can review your application.</span>
            <Button href="/settings" size="sm">
              Update application
            </Button>
          </div>
        )}

        {!user.emailDigest && !emailBannerDismissed && (
          <div className="flex items-center justify-between gap-3 p-4 rounded-lg mb-5 bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-600">
            <span>
              Stay in the loop: set your email notification preference in your{' '}
              <Link href="/profile" className="underline font-semibold">
                profile
              </Link>
              .
            </span>
            <Button
              variant="ghost"
              icon
              onClick={() => setEmailBannerDismissed(true)}
              aria-label="Dismiss"
            >
              ×
            </Button>
          </div>
        )}

        {data.gettingStarted && (
          <GettingStarted steps={data.gettingStarted} email={user.email ?? null} />
        )}

        {data.waiting && (
          <ApplicantWelcome
            name={user.name}
            chapterName={user.chapter?.name ?? null}
            waiting={data.waiting}
            hasSkills={data.hasSkills}
          />
        )}

        {isMember && (
          <>
            {ownAttention.length + urgent.length > 0 && (
              <section aria-labelledby="attention" className="mb-8">
                <H2 id="attention">
                  Needs your attention
                  <Count n={ownAttention.length + urgent.length} />
                </H2>
                <div className="flex flex-col gap-3">
                  {ownAttention.length > 0 && attentionList(ownAttention)}
                  {urgent.length > 0 && workList(urgent)}
                </div>
              </section>
            )}

            {current.length === 0 && (
              <P className="text-text-light mb-8">
                {finished.length > 0
                  ? 'Nothing on the go right now.'
                  : "You're not working on anything yet."}{' '}
                <Link className="text-primary-text underline" href="/quick-tasks">
                  Pick up a quick task
                </Link>{' '}
                or{' '}
                <Link className="text-primary-text underline" href="/projects">
                  browse projects
                </Link>
                .
              </P>
            )}
            {workSection('tasks', 'Your tasks', tasks)}
            {workSection('managed', 'Projects you manage', managed)}
            {workSection('other-projects', "Other projects you're part of", otherProjects)}
            {workSection('teams', 'Your teams', teams)}

            {isStaff && adminCount > 0 && (
              <section id="admin" aria-labelledby="admin-heading" className="mb-8 scroll-mt-20">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <H2 id="admin-heading">
                    Admin
                    <Count n={adminCount} />
                  </H2>
                  <Link href="/admin" className="text-sm">
                    Admin area →
                  </Link>
                </div>
                <div className="flex flex-col gap-3">
                  {staffAttention.length > 0 && attentionList(staffAttention)}
                  {adminLinks.length > 0 && (
                    <ul className={`list-none p-0 my-0 bg-surface shadow ${BLEED}`}>
                      {adminLinks.map((l) => (
                        <li
                          key={l.href}
                          className="flex items-center justify-between gap-3 p-4 border-b border-brand-border last:border-0"
                        >
                          <Link href={l.href} className="font-semibold">
                            {l.label}
                          </Link>
                          <Badge variant="info">{l.count}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {isMember && data.find && (
          <section id="find" aria-labelledby="find-heading" className="mb-8 scroll-mt-20">
            <H2 id="find-heading">
              <button
                type="button"
                aria-expanded={showFind}
                aria-controls="find-body"
                onClick={() => setFindOpen(!showFind)}
                className="cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit"
              >
                <span aria-hidden="true" className="inline-block w-5">
                  {showFind ? '▾' : '▸'}
                </span>
                Find something to do
              </button>
            </H2>
            {showFind && (
              <div id="find-body" className={`bg-surface shadow px-4 sm:px-5 py-2 ${BLEED}`}>
                <FindRowView
                  label="Quick tasks"
                  row={data.find.quickTasks}
                  seeAll="/quick-tasks"
                  empty="No open quick tasks right now."
                />
                <FindRowView
                  label="Matches your skills"
                  row={data.find.matches}
                  seeAll="/projects?sort=match"
                  empty={
                    data.hasSkills ? (
                      'No projects match your skills right now.'
                    ) : (
                      <>
                        <Link className="text-primary-text underline" href="/settings">
                          Add skills
                        </Link>{' '}
                        to see projects that match them.
                      </>
                    )
                  }
                />
                <FindRowView
                  label="Near you"
                  row={data.find.nearYou}
                  seeAll="/projects"
                  empty={
                    user.country ? (
                      'No projects in your country right now.'
                    ) : (
                      <>
                        <Link className="text-primary-text underline" href="/settings">
                          Add your country
                        </Link>{' '}
                        to see projects near you.
                      </>
                    )
                  }
                />
              </div>
            )}
          </section>
        )}

        {isMember && finished.length > 0 && (
          <section id="finished" aria-labelledby="finished-heading" className="mb-8 scroll-mt-20">
            <H2 id="finished-heading">
              <button
                type="button"
                aria-expanded={finishedOpen}
                aria-controls="finished-body"
                onClick={() => setFinishedOpen(!finishedOpen)}
                className="cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit"
              >
                <span aria-hidden="true" className="inline-block w-5">
                  {finishedOpen ? '▾' : '▸'}
                </span>
                Finished ({finished.length})
              </button>
            </H2>
            {finishedOpen && <div id="finished-body">{workList(finished)}</div>}
          </section>
        )}
      </main>
    </>
  )
}
