'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ResendConfirmation from '@/components/ResendConfirmation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireAuth } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import Button from '@/components/Button'
import { DueChip, ProjectStatusBadge, WorkStatusBadge } from '@/components/StatusBadges'
import { handedIn } from '@/lib/overdue'
import WorkRow, { PersonAvatar, STRETCHED_LINK } from '@/components/WorkRow'
import Modal from '@/components/ui/Modal'
import Skeleton from '@/components/Skeleton'
import { BLEED } from '@/lib/ui-classes'
import { H1, H2, H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import { ApprovalStatus, WorkItemType } from '@/generated/prisma/enums'
import type { AppRouter } from '@/server/router'
import type { InferRouterOutputs } from '@orpc/server'

type Home = InferRouterOutputs<AppRouter>['dashboard']['get']
type FindRow = NonNullable<Home['find']>['quickTasks']

const WORK_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'project', label: 'Projects' },
  { key: 'task', label: 'Tasks' },
  { key: 'team', label: 'Teams' },
] as const
type WorkFilter = (typeof WORK_FILTERS)[number]['key']

// My work's buckets are small grey labels, so they never read as a section like "Needs your
// attention" above them.
const SUB_HEADING = 'text-sm font-semibold text-text-light mb-2'
// The whole row is its title link, so it highlights as one.
const ROW_CLASSES =
  'p-4 wrap-break-word transition-colors hover:bg-accent/40 dark:hover:bg-white/[0.06]'
const ROW_META_CLASSES = 'text-sm text-text-light mt-1 flex flex-wrap items-center gap-x-2 gap-y-1'

// Links into the old tabbed dashboard still land somewhere sensible.
const PROJECT_HASHES = ['#tab-projects', '#tab-owned', '#tab-interests', '#tab-proposed']
const LEGACY_HASHES: Record<string, { section: string; filter?: WorkFilter }> = {
  ...Object.fromEntries(PROJECT_HASHES.map((h) => [h, { section: 'my-work', filter: 'project' }])),
  '#tab-applications': { section: 'my-work', filter: 'project' },
  '#tab-suggested': { section: 'find' },
}

function Count({ n }: { n: number }) {
  if (n === 0) return null
  return (
    <span className="bg-accent text-secondary-dark text-xs px-2 py-0.5 rounded-full ml-2 align-middle dark:bg-gray-700 dark:text-gray-300">
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
  const [filter, setFilter] = useState<WorkFilter>('all')
  const [findOpen, setFindOpen] = useState<boolean | null>(null)
  const [finishedOpen, setFinishedOpen] = useState(false)
  const [emailBannerDismissed, setEmailBannerDismissed] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)

  const { data, isPending: loadingData } = useQuery({
    ...orpc.dashboard.get.queryOptions(),
    enabled: !!user,
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

  // Old `#tab-…` links pick a filter or open a section, then scroll to it once it exists;
  // the notifications tab is the Inbox now.
  useEffect(() => {
    if (window.location.hash === '#tab-notifications') router.replace('/inbox')
  }, [router])
  useEffect(() => {
    if (loadingData) return
    function follow() {
      const target = LEGACY_HASHES[window.location.hash]
      if (!target) return
      if (target.filter) setFilter(target.filter)
      if (target.section === 'find') setFindOpen(true)
      document.getElementById(target.section)?.scrollIntoView({ block: 'start' })
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
  const work = current.filter((w) => filter === 'all' || w.kind === filter)
  // Discovery waits until someone has nothing of their own to get on with.
  const showFind = findOpen ?? current.length === 0

  const urgent = work.filter((w) => w.needsAttention)
  const rest = work.filter((w) => !w.needsAttention)

  const today = new Date()
  // `[status] Title … person`, the whole row one link.
  const workRow = (w: (typeof work)[number]) => {
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
  const workList = (rows: typeof work) => (
    <ul className={`list-none p-0 my-0 bg-surface shadow ${BLEED}`}>{rows.map(workRow)}</ul>
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

        {isMember && (
          <section aria-labelledby="attention" className="mb-8">
            <H2 id="attention">
              Needs your attention
              <Count n={data.attention.length} />
            </H2>
            {data.attention.length === 0 ? (
              <P className="text-text-light">Nothing is waiting on you right now.</P>
            ) : (
              <ul className={`list-none p-0 my-0 bg-surface shadow ${BLEED}`}>
                {data.attention.map((a) => (
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
            )}
          </section>
        )}

        {isMember && (
          <section id="my-work" aria-labelledby="my-work-heading" className="mb-8 scroll-mt-20">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <H2 id="my-work-heading" className="m-0">
                My work
              </H2>
              <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
                {WORK_FILTERS.map((f) => (
                  <Button
                    key={f.key}
                    size="sm"
                    variant={filter === f.key ? 'primary' : 'outline'}
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </div>
            {work.length === 0 ? (
              <P className="text-text-light">
                {current.length === 0 ? (
                  <>
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
                  </>
                ) : (
                  'Nothing here. Try another filter.'
                )}
              </P>
            ) : urgent.length === 0 ? (
              workList(rest)
            ) : (
              <>
                <H3 className={`${SUB_HEADING} mt-0`}>Needs attention now</H3>
                {workList(urgent)}
                {rest.length > 0 && (
                  <>
                    <H3 className={`${SUB_HEADING} mt-5`}>Everything else</H3>
                    {workList(rest)}
                  </>
                )}
              </>
            )}
          </section>
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
