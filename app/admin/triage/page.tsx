'use client'

import { useState } from 'react'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import Button from '@/components/Button'
import FilterDropdown, { useFilterOptions } from '@/components/FilterDropdown'
import {
  ProjectCard,
  type Project as CardProject,
  statusBadgeClasses,
  STATUS_LABELS,
  CARD_GRID_CLASSES,
} from '@/components/ProjectCard'
import Tabs from '@/components/Tabs'
import { badgeClasses } from '@/components/Badge'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { InterestStatus, ProjectStatus } from '@/generated/prisma/enums'

export default function TriagePage() {
  const { user, loading } = useRequireAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<
    'pending_review' | 'needs_discussion' | 'stale_in_progress' | 'drafts' | 'interests'
  >('pending_review')

  const {
    value: interestStatusFilter,
    onChange: setInterestStatusFilter,
    options: interestStatusOptions,
  } = useFilterOptions(
    [
      { value: 'pending', label: 'Pending' },
      { value: 'accepted', label: 'Accepted' },
      { value: 'declined', label: 'Declined' },
      { value: 'withdrawn', label: 'Withdrawn' },
      { value: '', label: 'All' },
    ],
    'pending',
  )

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    ...orpc.admin.triage.list.queryOptions(),
    enabled: !!user?.isAdmin,
  })

  const { data: staleProjects = [], isLoading: loadingStale } = useQuery({
    ...orpc.admin.projects.staleInProgress.queryOptions(),
    enabled: !!user?.isAdmin,
  })

  const { data: draftProjects = [], isLoading: loadingDrafts } = useQuery({
    ...orpc.admin.triage.drafts.queryOptions(),
    enabled: !!user?.isAdmin,
  })

  const { data: interests = [], isLoading: loadingInterests } = useQuery({
    ...orpc.admin.interests.list.queryOptions({
      input: interestStatusFilter ? { status: interestStatusFilter } : {},
    }),
    enabled: !!user?.isAdmin,
  })

  const respondInterestMutation = useMutation({
    ...orpc.projects.respondToInterest.mutationOptions(),
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to respond to interest', 'error')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.admin.interests.list.key() })
    },
  })

  const submitDraftMutation = useMutation({
    ...orpc.admin.triage.submitDraft.mutationOptions(),
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to submit draft', 'error')
    },
    onSuccess: () => {
      showToast('Draft submitted for review', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.admin.triage.drafts.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.admin.triage.list.key() })
    },
  })

  if (loading || !user) return null

  const pending = (projects as unknown as CardProject[]).filter(
    (p) => p.status === ProjectStatus.pending_review,
  )
  const discussion = (projects as unknown as CardProject[]).filter(
    (p) => p.status === ProjectStatus.needs_discussion,
  )
  const pendingInterests = interests.filter((i) => i.status === InterestStatus.pending)
  const stale = staleProjects as unknown as CardProject[]
  const drafts = draftProjects as unknown as CardProject[]
  const visible =
    tab === 'pending_review'
      ? pending
      : tab === 'needs_discussion'
        ? discussion
        : tab === 'drafts'
          ? drafts
          : stale

  return (
    <>
      <main className="container py-5 pb-15">
        <h1>Project Triage</h1>

        <Tabs
          tabs={[
            {
              key: 'pending_review',
              label: (
                <>
                  {`Pending Review`}
                  {pending.length > 0 && (
                    <span className="bg-primary text-gray-900 text-xs px-2 py-0.5 rounded-full ml-2">
                      {pending.length}
                    </span>
                  )}
                </>
              ),
            },
            {
              key: 'needs_discussion',
              label: (
                <>
                  {`Needs Changes`}
                  {discussion.length > 0 && (
                    <span className="bg-primary text-gray-900 text-xs px-2 py-0.5 rounded-full ml-2">
                      {discussion.length}
                    </span>
                  )}
                </>
              ),
            },
            {
              key: 'stale_in_progress',
              label: (
                <>
                  {`No Open Tasks`}
                  {stale.length > 0 && (
                    <span className="bg-primary text-gray-900 text-xs px-2 py-0.5 rounded-full ml-2">
                      {stale.length}
                    </span>
                  )}
                </>
              ),
            },
            {
              key: 'drafts',
              label: (
                <>
                  {`Drafts`}
                  {drafts.length > 0 && (
                    <span className="bg-primary text-gray-900 text-xs px-2 py-0.5 rounded-full ml-2">
                      {drafts.length}
                    </span>
                  )}
                </>
              ),
            },
            {
              key: 'interests',
              label: (
                <>
                  Volunteer Interests
                  {pendingInterests.length > 0 && (
                    <span className="bg-primary text-gray-900 text-xs px-2 py-0.5 rounded-full ml-2">
                      {pendingInterests.length}
                    </span>
                  )}
                </>
              ),
            },
          ]}
          activeTab={tab}
          onChange={setTab}
        />

        {tab === 'interests' ? (
          <>
            <div className="mb-5 flex items-end gap-3">
              <FilterDropdown
                id="interest-status-filter"
                label="Status"
                ariaLabel="Status"
                value={interestStatusFilter}
                options={interestStatusOptions}
                onChange={setInterestStatusFilter}
              />
            </div>

            {loadingInterests ? (
              <div className="text-center py-10 text-text-light">Loading…</div>
            ) : interests.length === 0 ? (
              <p>No {interestStatusFilter || ''} interests found.</p>
            ) : (
              <div className={CARD_GRID_CLASSES}>
                {interests.map((i) => (
                  <div
                    key={i.id}
                    className="card bg-surface rounded-xl shadow px-5 py-4 overflow-hidden wrap-break-word"
                  >
                    <div className="flex justify-between items-start gap-4 mb-2">
                      <div>
                        <p className="font-semibold m-0">
                          <Link
                            href={`/admin/volunteers/${i.volunteerId}`}
                            className="text-brand-text no-underline hover:text-primary"
                          >
                            {i.volunteerName}
                          </Link>
                          <span className="font-normal text-sm text-text-light">
                            {' '}
                            wants to{' '}
                            {i.interestType === 'want_to_own' ? 'own' : 'contribute to'}{' '}
                          </span>
                          <Link
                            href={`/projects/${i.projectId}`}
                            className="text-primary no-underline hover:underline"
                          >
                            {i.projectTitle}
                          </Link>
                        </p>
                        <p className="text-xs text-text-light m-0 mt-1">
                          {i.createdAt ? formatDate(i.createdAt) : ''}
                          {' · '}Owner: {i.ownerName ?? 'None'}
                          {' · '}Project:{' '}
                          <span className={statusBadgeClasses(i.projectStatus)}>
                            {STATUS_LABELS[i.projectStatus] ?? i.projectStatus}
                          </span>
                        </p>
                      </div>
                      <span
                        className={badgeClasses(
                          i.status === InterestStatus.pending
                            ? 'caution'
                            : i.status === InterestStatus.accepted
                              ? 'success'
                              : 'neutral',
                        )}
                      >
                        {i.status}
                      </span>
                    </div>

                    {i.message && (
                      <p className="text-sm text-text-light italic my-2">
                        &ldquo;{i.message}&rdquo;
                      </p>
                    )}

                    {i.volunteerSkills.length > 0 && (
                      <div className="flex flex-wrap gap-1 my-2">
                        {i.volunteerSkills.map((s: { id: number; name: string }) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center px-2 py-0.5 bg-accent text-secondary-dark rounded-full text-xs font-medium dark:bg-gray-700 dark:text-gray-300"
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {i.status === InterestStatus.pending && (
                      <div className="flex gap-2 mt-3">
                        <Button
                          size="sm"
                          onClick={() =>
                            respondInterestMutation.mutate({
                              projectId: i.projectId,
                              interestId: i.id,
                              status: InterestStatus.accepted,
                            })
                          }
                          disabled={respondInterestMutation.isPending}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            respondInterestMutation.mutate({
                              projectId: i.projectId,
                              interestId: i.id,
                              status: 'declined',
                            })
                          }
                          disabled={respondInterestMutation.isPending}
                        >
                          Decline
                        </Button>
                        <Button size="sm" variant="ghost" href={`/projects/${i.projectId}`}>
                          View Project
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {(
              tab === 'stale_in_progress'
                ? loadingStale
                : tab === 'drafts'
                  ? loadingDrafts
                  : loadingProjects
            ) ? (
              <div className="text-center py-10 text-text-light">Loading…</div>
            ) : visible.length === 0 ? (
              <p>
                {tab === 'pending_review'
                  ? 'No projects awaiting review.'
                  : tab === 'needs_discussion'
                    ? 'No projects awaiting discussion.'
                    : tab === 'drafts'
                      ? 'No volunteer drafts in progress.'
                      : 'No in-progress projects with all tasks completed.'}
              </p>
            ) : (
              <div className={CARD_GRID_CLASSES}>
                {visible.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    action={
                      tab === 'drafts' ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" href={`/projects/${p.id}`}>
                            View
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => submitDraftMutation.mutate({ id: p.id })}
                            disabled={submitDraftMutation.isPending}
                          >
                            Submit for Review
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" href={`/projects/${p.id}`}>
                          Review
                        </Button>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  )
}
