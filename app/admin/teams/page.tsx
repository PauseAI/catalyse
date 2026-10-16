'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireStaff } from '@/lib/hooks/auth'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient, useQueries } from '@tanstack/react-query'
import Button from '@/components/Button'
import { Badge } from '@/components/Badge'
import { suggestionStatusVariant } from '@/lib/status-labels'
import Radio from '@/components/Radio'
import FilterDropdown, { FilterOption, useFilterOptions } from '@/components/FilterDropdown'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { TeamSuggestionStatus } from '@/generated/prisma/enums'

type StatusFilter = 'all' | 'active' | 'pending' | 'on_hold' | 'declined'
type ReviewAction = 'accept' | 'merge' | 'on_hold' | 'decline'

interface TeamMember {
  id: number
  name: string
  email: string | null
  role: 'member' | 'leader'
}

interface Team {
  id: number
  name: string
  description: string | null
  lumaUrl: string | null
  docUrl: string | null
  members: TeamMember[]
}

interface Suggestion {
  id: number
  name: string
  description: string | null
  status: 'pending' | 'on_hold' | 'declined'
  adminNotes: string | null
  createdAt: string
  suggestedBy: { id: number; name: string; email: string }
  mergedInto: { id: number; name: string } | null
}

type DisplayTeam = { kind: 'team' } & Team
type DisplaySuggestion = { kind: 'suggestion' } & Suggestion
type DisplayItem = DisplayTeam | DisplaySuggestion

const STATUS_FILTER_OPTIONS: FilterOption<StatusFilter>[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'declined', label: 'Declined' },
]

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  pending: 'Pending',
  on_hold: 'On hold',
  declined: 'Declined',
}

export default function AdminTeamsPage() {
  const { user, loading } = useRequireStaff()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const { value: statusFilter, onChange: setStatusFilter } = useFilterOptions(
    STATUS_FILTER_OPTIONS,
    'all',
  )
  const [deleteTarget, setDeleteTarget] = useState<DisplayItem | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addDescription, setAddDescription] = useState('')
  const [addLumaUrl, setAddLumaUrl] = useState('')
  const [addDocUrl, setAddDocUrl] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)

  const [reviewSuggestion, setReviewSuggestion] = useState<Suggestion | null>(null)
  const [reviewAction, setReviewAction] = useState<ReviewAction>('accept')
  const [reviewEditName, setReviewEditName] = useState('')
  const [reviewEditDescription, setReviewEditDescription] = useState('')
  const [reviewLeaderId, setReviewLeaderId] = useState('')
  const [mergeTargetId, setMergeTargetId] = useState<number | ''>('')
  const [adminNotes, setAdminNotes] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  // Volunteer picker (assign-member / review-leader) searches server-side rather than
  // filtering a client-side page — the org can have far more volunteers than fit in one
  // page, so typing has to actually query rather than filter what's already loaded.
  const [volunteerSearchInput, setVolunteerSearchInput] = useState('')
  const [volunteerSearch, setVolunteerSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setVolunteerSearch(volunteerSearchInput), 300)
    return () => clearTimeout(t)
  }, [volunteerSearchInput])

  const { data: volunteersData } = useQuery({
    ...orpc.volunteers.list.queryOptions({
      input: { limit: 20, search: volunteerSearch || undefined },
    }),
    enabled: !!user,
  })
  const volunteers = volunteersData?.volunteers ?? []
  const volunteerOptions = volunteers.map((v) => ({ value: String(v.id), label: v.name }))

  const fetchTeams = statusFilter === 'all' || statusFilter === 'active'
  const fetchPending = statusFilter === 'all' || statusFilter === TeamSuggestionStatus.pending
  const fetchOnHold = statusFilter === 'all' || statusFilter === TeamSuggestionStatus.on_hold
  const fetchDeclined = statusFilter === 'all' || statusFilter === 'declined'

  const [teamsResult, pendingResult, onHoldResult, declinedResult] = useQueries({
    queries: [
      { ...orpc.admin.teams.list.queryOptions(), enabled: !!user && fetchTeams },
      {
        ...orpc.admin.teams.listSuggestions.queryOptions({
          input: { status: TeamSuggestionStatus.pending },
        }),
        enabled: !!user && fetchPending,
      },
      {
        ...orpc.admin.teams.listSuggestions.queryOptions({
          input: { status: TeamSuggestionStatus.on_hold },
        }),
        enabled: !!user && fetchOnHold,
      },
      {
        ...orpc.admin.teams.listSuggestions.queryOptions({ input: { status: 'declined' } }),
        enabled: !!user && fetchDeclined,
      },
    ],
  })

  const allTeams: Team[] = useMemo(
    () => (teamsResult.data?.teams ?? []) as Team[],
    [teamsResult.data],
  )

  const loadingItems =
    (fetchTeams && teamsResult.isFetching) ||
    (fetchPending && pendingResult.isFetching) ||
    (fetchOnHold && onHoldResult.isFetching) ||
    (fetchDeclined && declinedResult.isFetching)

  const items = useMemo<DisplayItem[]>(() => {
    const teams: DisplayTeam[] = fetchTeams
      ? allTeams.map((t) => ({ kind: 'team' as const, ...t }))
      : []
    const suggestions: DisplaySuggestion[] = [
      ...(fetchPending && pendingResult.data
        ? (pendingResult.data.suggestions as unknown as Suggestion[]).map((sg) => ({
            kind: 'suggestion' as const,
            ...sg,
          }))
        : []),
      ...(fetchOnHold && onHoldResult.data
        ? (onHoldResult.data.suggestions as unknown as Suggestion[]).map((sg) => ({
            kind: 'suggestion' as const,
            ...sg,
          }))
        : []),
      ...(fetchDeclined && declinedResult.data
        ? (declinedResult.data.suggestions as unknown as Suggestion[]).map((sg) => ({
            kind: 'suggestion' as const,
            ...sg,
          }))
        : []),
    ]
    return [...teams, ...suggestions].sort((a, b) => a.name.localeCompare(b.name))
  }, [
    fetchTeams,
    fetchPending,
    fetchOnHold,
    fetchDeclined,
    allTeams,
    pendingResult.data,
    onHoldResult.data,
    declinedResult.data,
  ])

  const invalidateItems = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.teams.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.teams.listSuggestions.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.teams.list.key() }),
    ])

  const createTeamMutation = useMutation({ ...orpc.admin.teams.create.mutationOptions() })
  const reviewSuggestionMutation = useMutation({
    ...orpc.admin.teams.reviewSuggestion.mutationOptions(),
  })
  const deleteTeamMutation = useMutation({ ...orpc.admin.teams.delete.mutationOptions() })
  const deleteSuggestionMutation = useMutation({
    ...orpc.admin.teams.deleteSuggestion.mutationOptions(),
  })

  const mergeOptions = [
    { value: '', label: 'Select an existing team…' },
    ...allTeams.map((t) => ({ value: String(t.id), label: t.name })),
  ]

  function openReview(suggestion: Suggestion) {
    setReviewSuggestion(suggestion)
    setReviewAction('accept')
    setReviewEditName(suggestion.name)
    setReviewEditDescription(suggestion.description ?? '')
    setReviewLeaderId(String(suggestion.suggestedBy.id))
    setMergeTargetId('')
    setAdminNotes('')
    setVolunteerSearchInput('')
    setVolunteerSearch('')
  }

  function openAdd() {
    setAddName('')
    setAddDescription('')
    setAddLumaUrl('')
    setAddDocUrl('')
    setShowAdd(true)
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddSubmitting(true)
    try {
      await createTeamMutation.mutateAsync({
        name: addName.trim(),
        description: addDescription.trim() || null,
        lumaUrl: addLumaUrl.trim() || null,
        docUrl: addDocUrl.trim() || null,
      })
      await invalidateItems()
      showToast('Team added', 'success')
      setShowAdd(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add team', 'error')
    } finally {
      setAddSubmitting(false)
    }
  }

  async function submitReview(e: React.FormEvent, suggestion: Suggestion) {
    e.preventDefault()
    setReviewSubmitting(true)
    try {
      const body: Record<string, unknown> = { action: reviewAction }
      if (reviewAction === 'accept') {
        body.name = reviewEditName.trim()
        body.description = reviewEditDescription.trim() || null
        if (reviewLeaderId) body.leaderId = Number(reviewLeaderId)
      } else if (reviewAction === 'merge') {
        body.mergedIntoId = mergeTargetId
      }
      if (adminNotes.trim()) body.adminNotes = adminNotes.trim()

      await reviewSuggestionMutation.mutateAsync({
        id: suggestion.id,
        ...body,
      } as Parameters<typeof reviewSuggestionMutation.mutateAsync>[0])

      await invalidateItems()

      const actionLabels: Record<ReviewAction, string> = {
        accept: 'accepted',
        merge: 'merged',
        on_hold: 'put on hold',
        decline: 'declined',
      }
      showToast(`Suggestion ${actionLabels[reviewAction]}`, 'success')
      setReviewSuggestion(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update suggestion', 'error')
    } finally {
      setReviewSubmitting(false)
    }
  }

  async function deleteItem(item: DisplayItem) {
    try {
      if (item.kind === 'team') {
        await deleteTeamMutation.mutateAsync({ id: item.id })
      } else {
        await deleteSuggestionMutation.mutateAsync({ id: item.id })
      }
      await invalidateItems()
      showToast('Deleted', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    } finally {
      setDeleteTarget(null)
    }
  }

  function itemStatus(item: DisplayItem): string {
    return item.kind === 'team' ? 'active' : item.status
  }

  if (loading || !user) return null

  return (
    <>
      <main className="container py-5 pb-15">
        <div className="flex items-center justify-between mb-2">
          <h1 className="m-0">Teams</h1>
          <Button size="sm" onClick={openAdd}>
            Add team
          </Button>
        </div>
        <p className="text-text-light mb-6">
          Manage active teams and review volunteer suggestions.
        </p>

        <div className="flex flex-wrap gap-4 mb-6">
          <FilterDropdown
            id="status-filter"
            label="Status"
            ariaLabel="Status filter"
            value={statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={(v) => setStatusFilter(v)}
          />
        </div>

        {loadingItems ? (
          <div className="text-center py-10 text-text-light">Loading…</div>
        ) : items.length === 0 ? (
          <p className="text-text-light">No teams found.</p>
        ) : (
          <div className="space-y-4">
            {items.map((item) => {
              const status = itemStatus(item)
              return (
                <article
                  key={`${item.kind}-${item.id}`}
                  className="bg-surface rounded-xl shadow px-5 py-4 flex items-center justify-between gap-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{item.name}</span>
                      <Badge variant={suggestionStatusVariant(status)}>
                        {STATUS_LABEL[status] ?? status}
                      </Badge>
                      {item.kind === 'team' && (
                        <span className="text-xs text-text-light">
                          {item.members.length} member{item.members.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {item.kind === 'suggestion' && (
                      <p className="text-sm text-text-light m-0 mt-1">
                        Suggested by{' '}
                        <Link
                          href={`/admin/volunteers/${item.suggestedBy.id}`}
                          className="text-brand-text no-underline hover:text-primary"
                        >
                          {item.suggestedBy.name}
                        </Link>
                        {' · '}
                        {formatDate(item.createdAt)}
                      </p>
                    )}
                    {item.kind === 'suggestion' && item.adminNotes && (
                      <p className="text-sm text-text-light mt-2 mb-0 italic">{item.adminNotes}</p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {item.kind === 'team' && (
                      <Link href={`/admin/teams/${item.id}`}>
                        <Button size="sm" variant="secondary">
                          Manage
                        </Button>
                      </Link>
                    )}
                    {item.kind === 'suggestion' && (
                      <Button size="sm" onClick={() => openReview(item)}>
                        {item.status === TeamSuggestionStatus.declined ||
                        item.status === TeamSuggestionStatus.on_hold
                          ? 'Re-review'
                          : 'Review'}
                      </Button>
                    )}
                    <Button size="sm" variant="danger" onClick={() => setDeleteTarget(item)}>
                      Delete
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </main>

      {/* Add Team Modal */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAdd(false)
          }}
        >
          <div className="bg-surface rounded-xl shadow-lg max-w-125 w-full">
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 role="heading">Add team</h2>
              <Button variant="ghost" icon onClick={() => setShowAdd(false)} aria-label="Close">
                ×
              </Button>
            </div>
            <div className="p-6">
              <form onSubmit={submitAdd}>
                <div className="mb-5">
                  <label htmlFor="add-name">Team name</label>
                  <input
                    id="add-name"
                    type="text"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="e.g., Comms, Outreach"
                  />
                </div>
                <div className="mb-5">
                  <label htmlFor="add-description">Description</label>
                  <textarea
                    id="add-description"
                    rows={2}
                    value={addDescription}
                    onChange={(e) => setAddDescription(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="mb-5">
                  <label htmlFor="add-luma">Luma calendar URL</label>
                  <input
                    id="add-luma"
                    type="text"
                    value={addLumaUrl}
                    onChange={(e) => setAddLumaUrl(e.target.value)}
                    placeholder="https://luma.com/…"
                  />
                </div>
                <div className="mb-5">
                  <label htmlFor="add-doc">Team doc URL</label>
                  <input
                    id="add-doc"
                    type="text"
                    value={addDocUrl}
                    onChange={(e) => setAddDocUrl(e.target.value)}
                    placeholder="https://docs.google.com/…"
                  />
                </div>
                <div className="pt-4 border-t border-brand-border flex gap-3 justify-end">
                  <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={addSubmitting || !addName.trim()}>
                    {addSubmitting ? 'Saving…' : 'Add team'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Review Suggestion Modal */}
      {reviewSuggestion && (
        <div
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReviewSuggestion(null)
          }}
        >
          <div className="bg-surface rounded-xl shadow-lg max-w-125 w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 role="heading">Review suggestion</h2>
              <Button
                variant="ghost"
                icon
                onClick={() => setReviewSuggestion(null)}
                aria-label="Close"
              >
                ×
              </Button>
            </div>

            <div className="p-6">
              <p className="text-text-light mb-1 text-sm">
                Suggested by {reviewSuggestion.suggestedBy.name}
              </p>
              <p className="font-semibold mb-5">{reviewSuggestion.name}</p>

              <form onSubmit={(e) => submitReview(e, reviewSuggestion)}>
                <div className="mb-5">
                  <label>Action</label>
                  <div className="flex flex-col gap-3 mt-2">
                    {(
                      [
                        {
                          value: 'accept',
                          label: 'Accept',
                          desc: 'Add as a new team (suggester becomes leader)',
                        },
                        { value: 'merge', label: 'Merge', desc: 'Link to an existing team' },
                        { value: 'on_hold', label: 'On hold', desc: 'Keep for later review' },
                        { value: 'decline', label: 'Decline', desc: 'Not adding at this time' },
                      ] as { value: ReviewAction; label: string; desc: string }[]
                    ).map((opt) => (
                      <Radio
                        key={opt.value}
                        name="action"
                        value={opt.value}
                        checked={reviewAction === opt.value}
                        onChange={() => setReviewAction(opt.value)}
                      >
                        <span>
                          <strong>{opt.label}</strong>: {opt.desc}
                        </span>
                      </Radio>
                    ))}
                  </div>
                </div>

                {reviewAction === 'accept' && (
                  <>
                    <div className="mb-4">
                      <label htmlFor="review-name">Team name</label>
                      <input
                        id="review-name"
                        type="text"
                        value={reviewEditName}
                        onChange={(e) => setReviewEditName(e.target.value)}
                        placeholder="Team name"
                      />
                    </div>
                    <div className="mb-5">
                      <label htmlFor="review-description">Description</label>
                      <textarea
                        id="review-description"
                        rows={2}
                        value={reviewEditDescription}
                        onChange={(e) => setReviewEditDescription(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    <div className="mb-5">
                      <FilterDropdown
                        id="review-leader"
                        label="Team leader"
                        ariaLabel="Select team leader"
                        value={reviewLeaderId}
                        options={
                          volunteerOptions.some((o) => o.value === reviewLeaderId)
                            ? volunteerOptions
                            : [
                                {
                                  value: String(reviewSuggestion.suggestedBy.id),
                                  label: reviewSuggestion.suggestedBy.name,
                                },
                                ...volunteerOptions,
                              ]
                        }
                        onChange={setReviewLeaderId}
                        onQueryChange={setVolunteerSearchInput}
                        searchable
                      />
                      <p className="text-sm text-text-light mt-1">
                        Defaults to the suggester, pick someone else if they shouldn&apos;t lead it.
                      </p>
                    </div>
                  </>
                )}

                {reviewAction === 'merge' && (
                  <div className="mb-5">
                    <FilterDropdown
                      id="merge-target"
                      label="Merge into existing team"
                      ariaLabel="Select existing team to merge into"
                      value={mergeTargetId === '' ? '' : String(mergeTargetId)}
                      options={mergeOptions}
                      onChange={(v) => setMergeTargetId(v ? Number(v) : '')}
                      searchable
                    />
                  </div>
                )}

                {(reviewAction === 'on_hold' || reviewAction === 'decline') && (
                  <div className="mb-5">
                    <label htmlFor="admin-notes">
                      Note for volunteer{' '}
                      <span className="text-text-light font-normal">(optional)</span>
                    </label>
                    <textarea
                      id="admin-notes"
                      rows={3}
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      className="w-full"
                    />
                    <p className="text-sm text-text-light mt-1">
                      This note will be shared with the volunteer.
                    </p>
                  </div>
                )}

                <div className="pt-4 border-t border-brand-border flex gap-3 justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setReviewSuggestion(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      reviewSubmitting ||
                      (reviewAction === 'accept' && !reviewEditName.trim()) ||
                      (reviewAction === 'merge' && !mergeTargetId)
                    }
                    variant={reviewAction === 'decline' ? 'danger' : 'primary'}
                  >
                    {reviewSubmitting ? 'Saving…' : 'Confirm'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null)
          }}
        >
          <div className="bg-surface rounded-xl shadow-lg max-w-md w-full">
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 role="heading">Confirm delete</h2>
              <Button variant="ghost" icon onClick={() => setDeleteTarget(null)} aria-label="Close">
                ×
              </Button>
            </div>
            <div className="p-6">
              <p>
                Delete <strong>{deleteTarget.name}</strong>? This cannot be undone.
              </p>
              <div className="pt-4 border-t border-brand-border flex gap-3 justify-end mt-4">
                <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => deleteItem(deleteTarget)}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
