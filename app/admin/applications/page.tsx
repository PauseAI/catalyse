'use client'

import { useState, Suspense } from 'react'
import { useRequireStaff } from '@/lib/hooks/auth'
import { useUrlParam } from '@/lib/hooks/url-filters'
import ChapterFilter, { chapterSelection } from '@/components/ChapterFilter'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { useCountries } from '@/lib/hooks/countries'
import { SECTION_CARD } from '@/lib/ui-classes'
import { InferRouterOutputs } from '@orpc/server'
import { AppRouter } from '@/server/router'
import { ApprovalStatus } from '@/generated/prisma/enums'
import { H1, H2, H3, H4 } from '@/components/Heading'
import { P } from '@/components/Text'

type Filter = 'mine' | 'others' | 'approved' | 'needs_info' | 'rejected'

const SECTIONS: { key: Filter; label: string; color: string; collapsedByDefault?: boolean }[] = [
  { key: 'mine', label: 'Pending & under review by me', color: 'text-primary' },
  { key: 'others', label: 'Under review by others', color: 'text-text-light' },
  {
    key: 'needs_info',
    label: 'Needs info',
    color: 'text-amber-600 dark:text-amber-400',
  },
  { key: 'rejected', label: 'Rejected', color: 'text-red-600 dark:text-red-400' },
  {
    key: 'approved',
    label: 'Approved',
    color: 'text-green-600 dark:text-green-400',
    collapsedByDefault: true,
  },
]

function ApplicationsPageContent() {
  const router = useRouter()
  const { user, loading } = useRequireStaff()
  const showToast = useToast()
  const [startingReview, setStartingReview] = useState<number | null>(null)
  const [approvedOpen, setApprovedOpen] = useState(false)
  const [anonymisedOpen, setAnonymisedOpen] = useState(false)

  const enabled = !!user
  const [chapterParam, setChapterParam] = useUrlParam('chapter')
  const { loaded: countriesLoaded } = useCountries()
  const chapter = chapterSelection(chapterParam)

  const mine = useQuery({
    ...orpc.admin.applications.list.queryOptions({ input: { filter: 'mine', chapter } }),
    enabled,
  })
  const others = useQuery({
    ...orpc.admin.applications.list.queryOptions({ input: { filter: 'others', chapter } }),
    enabled,
  })
  const needsInfo = useQuery({
    ...orpc.admin.applications.list.queryOptions({ input: { filter: 'needs_info', chapter } }),
    enabled,
  })
  const rejected = useQuery({
    ...orpc.admin.applications.list.queryOptions({ input: { filter: 'rejected', chapter } }),
    enabled,
  })
  const approved = useQuery({
    ...orpc.admin.applications.list.queryOptions({ input: { filter: 'approved', chapter } }),
    enabled,
  })
  const anonymised = useQuery({
    ...orpc.admin.rejectedApplications.list.queryOptions(),
    // Anonymised rejections belong to no chapter, so they are the global admins'.
    enabled: !!user?.isAdmin,
  })

  const queriesByKey: Record<Filter, typeof mine> = {
    mine,
    others,
    needs_info: needsInfo,
    rejected,
    approved,
  }

  const actionMutation = useMutation({
    ...orpc.admin.applications.action.mutationOptions(),
    onError: () => showToast('Failed to start review', 'error'),
  })

  async function handleStartReview(id: number) {
    setStartingReview(id)
    try {
      await actionMutation.mutateAsync({ id, action: 'start_review' })
    } catch {
      // ignore — navigate anyway, page will show current status
    } finally {
      setStartingReview(null)
      router.push(`/admin/applications/${id}`)
    }
  }

  if (loading || !user) return null

  const anyLoading = SECTIONS.some((s) => queriesByKey[s.key].isLoading) || anonymised.isLoading
  const totalCount =
    SECTIONS.reduce((sum, s) => sum + (queriesByKey[s.key].data?.length ?? 0), 0) +
    (anonymised.data?.length ?? 0)

  return (
    <main className="container py-5 pb-15">
      <H1>Applications</H1>
      <P className="text-text-light mb-6">Review new volunteer applications.</P>
      {user.isAdmin && (
        <div className="mb-6">
          <ChapterFilter value={chapterParam} onChange={setChapterParam} />
        </div>
      )}

      {(anyLoading && totalCount === 0) || !countriesLoaded ? (
        <P className="text-text-light mt-6">Loading…</P>
      ) : totalCount === 0 ? (
        <P className="text-text-light mt-6">No applications to review.</P>
      ) : (
        <>
          {SECTIONS.map((section) => {
            const query = queriesByKey[section.key]
            const applications = query.data ?? []
            if (applications.length === 0) return null

            const isCollapsible = Boolean(section.collapsedByDefault)
            const isOpen = !isCollapsible || approvedOpen

            return (
              <div
                key={section.key}
                className="mb-8"
                data-testid={`applications-section-${section.key}`}
              >
                {isCollapsible ? (
                  <H2
                    className="text-lg mb-3 flex items-center gap-2 cursor-pointer select-none"
                    onClick={() => setApprovedOpen((o) => !o)}
                    role="button"
                    aria-expanded={approvedOpen}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setApprovedOpen((o) => !o)}
                  >
                    {section.label}: {applications.length}
                    <svg
                      className={`text-text-light shrink-0 transition-transform ${approvedOpen ? 'rotate-180' : 'rotate-0'}`}
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
                  </H2>
                ) : (
                  <H2 className={`text-lg mb-3 ${section.color}`}>
                    {section.label}: {applications.length}
                  </H2>
                )}
                {isOpen && (
                  <div
                    key={String(approvedOpen)}
                    className={`flex flex-col gap-4 ${isCollapsible ? 'animate-fade-slide-in' : ''}`}
                  >
                    {applications.map((app) => (
                      <ApplicationCard
                        key={app.id}
                        app={app}
                        startingReview={startingReview}
                        onStartReview={handleStartReview}
                        onNavigate={(id) => router.push(`/admin/applications/${id}`)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {(anonymised.data?.length ?? 0) > 0 && (
            <div className="mb-8">
              <H2
                className="text-lg mb-3 flex items-center gap-2 cursor-pointer select-none text-text-light"
                onClick={() => setAnonymisedOpen((o) => !o)}
                role="button"
                aria-expanded={anonymisedOpen}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setAnonymisedOpen((o) => !o)}
              >
                Rejected – anonymised: {anonymised.data?.length ?? 0}
                <svg
                  className={`text-text-light shrink-0 transition-transform ${anonymisedOpen ? 'rotate-180' : 'rotate-0'}`}
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
              </H2>
              {anonymisedOpen && (
                <div
                  key={String(anonymisedOpen)}
                  className="flex flex-col gap-4 animate-fade-slide-in"
                >
                  {(anonymised.data ?? []).map((a) => (
                    <AnonymisedCard key={a.id} app={a} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </main>
  )
}

type Application = InferRouterOutputs<AppRouter>['admin']['applications']['list'][number]

function ApplicationCard({
  app,
  startingReview,
  onStartReview,
  onNavigate,
}: {
  app: Application
  startingReview: number | null
  onStartReview: (id: number) => void
  onNavigate: (id: number) => void
}) {
  const { label: countryLabel } = useCountries()
  const anonymiseDate = app.anonymiseAt ? new Date(app.anonymiseAt) : null
  // Date.now() is intentionally impure here — we want the current wall-clock
  // time to compute days remaining. Alternatives (prop drilling, context, ref)
  // would be disproportionate for a read-only display calculation.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const daysUntilAnonymise = anonymiseDate
    ? Math.ceil((anonymiseDate.getTime() - now) / (1000 * 60 * 60 * 24))
    : null

  const locationParts = [app.localGroup, countryLabel(app.country) || app.location].filter(Boolean)
  const meta = [
    locationParts.length ? locationParts.join(' · ') : null,
    `Applied ${formatDate(app.createdAt!)}`,
    app.reviewer ? `Reviewer: ${app.reviewer.name}` : null,
  ].filter(Boolean)

  return (
    <div role="article" className={SECTION_CARD}>
      <H3 className="m-0 mb-1">{app.name}</H3>
      <P className="text-sm text-text-light mb-4">{meta.join(' · ')}</P>

      {app.approvalStatus === ApprovalStatus.rejected && anonymiseDate && (
        <P
          className={`text-sm mb-3 ${daysUntilAnonymise !== null && daysUntilAnonymise <= 1 ? 'text-red-500' : 'text-amber-500'}`}
        >
          Personally Identifiable Information will be anonymised on {formatDate(anonymiseDate)}
          {daysUntilAnonymise !== null && daysUntilAnonymise >= 0
            ? ` (${daysUntilAnonymise === 0 ? 'today' : `${daysUntilAnonymise} day${daysUntilAnonymise === 1 ? '' : 's'}`})`
            : ''}
        </P>
      )}

      {app.bio && <P className="text-sm whitespace-pre-wrap mb-4">{app.bio}</P>}

      {app.skills.length > 0 && (
        <div className="mb-4">
          <H4 className="text-text-light">Skills</H4>
          <div className="flex flex-wrap gap-1.5">
            {app.skills.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center px-3 py-1 bg-accent text-secondary-dark rounded-full text-sm font-medium dark:bg-gray-700 dark:text-gray-300"
              >
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {(app.availabilityHoursPerWeek ||
        app.email ||
        app.signalNumber ||
        app.whatsappNumber ||
        app.discordHandle ||
        app.contactNotes) && (
        <div className="grid grid-cols-2 gap-4 mb-4 max-[600px]:grid-cols-1">
          {app.availabilityHoursPerWeek && (
            <div>
              <H4 className="text-text-light">Availability</H4>
              <P className="text-sm">{app.availabilityHoursPerWeek} hours/week</P>
            </div>
          )}
          {(app.email ||
            app.signalNumber ||
            app.whatsappNumber ||
            app.discordHandle ||
            app.contactNotes) && (
            <div>
              <H4 className="text-text-light">Contact</H4>
              <div className="text-sm">
                {app.email && <div>Email: {app.email}</div>}
                {app.discordHandle && <div>Discord: {app.discordHandle}</div>}
                {app.signalNumber && <div>Signal: {app.signalNumber}</div>}
                {app.whatsappNumber && <div>WhatsApp: {app.whatsappNumber}</div>}
                {app.contactNotes && (
                  <div className="text-text-light mt-1 italic">{app.contactNotes}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {app.applicationMessage && (
        <div className="border-t border-brand-border pt-4 mb-4">
          <H4 className="text-text-light">Application</H4>
          <P className="text-sm whitespace-pre-wrap">{app.applicationMessage}</P>
        </div>
      )}

      {app.adminNotes && (
        <div className="mb-4">
          <H4 className="text-text-light">Admin notes</H4>
          <P className="text-sm whitespace-pre-wrap">{app.adminNotes}</P>
        </div>
      )}

      {app.applicantNotes && (
        <div className="mb-4">
          <H4 className="text-text-light">
            Message to applicant{' '}
            <span className="font-normal normal-case text-xs">(sent on rejection only)</span>
          </H4>
          <P className="text-sm whitespace-pre-wrap">{app.applicantNotes}</P>
        </div>
      )}

      {app.previousRejections.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
          <P className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-3">
            {app.previousRejections.length === 1
              ? 'Previously rejected'
              : `Previously rejected ${app.previousRejections.length} times`}
          </P>
          {app.previousRejections.map((r, i) => (
            <div
              key={i}
              className={i > 0 ? 'mt-3 pt-3 border-t border-amber-200 dark:border-amber-700' : ''}
            >
              <P className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">
                {formatDate(r.rejectedAt)}
              </P>
              {r.adminNotes && (
                <div className="mb-1">
                  <P className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-0.5">
                    Admin notes
                  </P>
                  <P className="text-sm text-amber-700 dark:text-amber-400 whitespace-pre-wrap">
                    {r.adminNotes}
                  </P>
                </div>
              )}
              {r.applicantNotes && (
                <div>
                  <P className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-0.5">
                    Message sent to applicant
                  </P>
                  <P className="text-sm text-amber-700 dark:text-amber-400 whitespace-pre-wrap">
                    {r.applicantNotes}
                  </P>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 justify-end border-t border-brand-border pt-4 mt-2">
        {app.approvalStatus === ApprovalStatus.pending ? (
          <Button onClick={() => onStartReview(app.id)} disabled={startingReview === app.id}>
            Start review
          </Button>
        ) : app.approvalStatus === ApprovalStatus.under_review ? (
          <Button onClick={() => onNavigate(app.id)}>Continue review</Button>
        ) : (
          <Button variant="secondary" onClick={() => onNavigate(app.id)}>
            View
          </Button>
        )}
      </div>
    </div>
  )
}

type AnonymisedApplication =
  InferRouterOutputs<AppRouter>['admin']['rejectedApplications']['list'][number]

function AnonymisedCard({ app }: { app: AnonymisedApplication }) {
  const showToast = useToast()
  const queryClient = useQueryClient()

  const allowReapplyMutation = useMutation({
    ...orpc.admin.rejectedApplications.allowReapply.mutationOptions(),
    onSuccess: () => {
      showToast('Reapplication allowed', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.admin.rejectedApplications.list.key() })
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to allow reapply', 'error')
    },
  })

  return (
    <div role="article" className={`${SECTION_CARD} opacity-75`}>
      <P className="text-sm text-text-light mb-4">
        [Identity anonymised] · Rejected {formatDate(app.rejectedAt)}
      </P>
      {app.adminNotes && (
        <div className="mb-4">
          <H4 className="text-text-light">Admin notes</H4>
          <P className="text-sm whitespace-pre-wrap">{app.adminNotes}</P>
        </div>
      )}
      {app.applicantNotes && (
        <div className="mb-4">
          <H4 className="text-text-light">
            Message to applicant{' '}
            <span className="font-normal normal-case text-xs">(sent on rejection only)</span>
          </H4>
          <P className="text-sm whitespace-pre-wrap">{app.applicantNotes}</P>
        </div>
      )}
      <div className="flex justify-end border-t border-brand-border pt-4 mt-2">
        {app.reapplyAllowedAt ? (
          <P className="text-sm text-text-light">
            Reapplication allowed since {formatDate(app.reapplyAllowedAt)}
          </P>
        ) : (
          <Button
            variant="secondary"
            onClick={() => allowReapplyMutation.mutate({ emailHash: app.emailHash })}
            disabled={allowReapplyMutation.isPending}
          >
            Allow reapply
          </Button>
        )}
      </div>
    </div>
  )
}

// The chapter filter lives in the URL, which needs a Suspense boundary to read.
export default function ApplicationsPage() {
  return (
    <Suspense>
      <ApplicationsPageContent />
    </Suspense>
  )
}
