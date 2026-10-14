'use client'

import { useMemo, useState } from 'react'
import { useRequireAdmin } from '@/lib/hooks/auth'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query'
import Button from '@/components/Button'
import { Badge } from '@/components/Badge'
import { suggestionStatusVariant } from '@/lib/status-labels'
import Radio from '@/components/Radio'
import FilterDropdown, { FilterOption, useFilterOptions } from '@/components/FilterDropdown'
import { orpc } from '@/lib/orpc'
import { COUNTRY_OPTIONS, countryLabel } from '@/lib/filter-options'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { LocalGroupSuggestionStatus } from '@/generated/prisma/enums'

type StatusFilter = 'all' | 'active' | 'pending' | 'on_hold' | 'declined'
type ReviewAction = 'accept' | 'merge' | 'on_hold' | 'decline'

interface LocalGroup {
  id: number
  name: string
  country: string
}

interface Suggestion {
  id: number
  name: string
  country: string
  status: 'pending' | 'on_hold' | 'declined'
  adminNotes: string | null
  createdAt: string
  suggestedBy: { id: number; name: string; email: string }
  mergedInto: { id: number; name: string } | null
}

type DisplayGroup = { kind: 'group' } & LocalGroup
type DisplaySuggestion = { kind: 'suggestion' } & Suggestion
type DisplayItem = DisplayGroup | DisplaySuggestion

const SUGGESTION_COUNTRIES = COUNTRY_OPTIONS.filter(
  (o) => o.value && o.value !== 'Remote' && o.value !== 'Other',
)

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

export default function AdminLocalGroupsPage() {
  const { user, loading } = useRequireAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const { value: statusFilter, onChange: setStatusFilter } = useFilterOptions(
    STATUS_FILTER_OPTIONS,
    'all',
  )
  const [countryFilter, setCountryFilter] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DisplayItem | null>(null)

  // Add group modal
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addCountry, setAddCountry] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)

  // Edit group modal
  const [editGroup, setEditGroup] = useState<LocalGroup | null>(null)
  const [editName, setEditName] = useState('')
  const [editCountry, setEditCountry] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  // Review suggestion modal
  const [reviewSuggestion, setReviewSuggestion] = useState<Suggestion | null>(null)
  const [reviewAction, setReviewAction] = useState<ReviewAction>('accept')
  const [reviewEditName, setReviewEditName] = useState('')
  const [reviewEditCountry, setReviewEditCountry] = useState('')
  const [mergeTargetId, setMergeTargetId] = useState<number | ''>('')
  const [adminNotes, setAdminNotes] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  const fetchGroups = statusFilter === 'all' || statusFilter === 'active'
  const fetchPending = statusFilter === 'all' || statusFilter === LocalGroupSuggestionStatus.pending
  const fetchOnHold = statusFilter === 'all' || statusFilter === LocalGroupSuggestionStatus.on_hold
  const fetchDeclined = statusFilter === 'all' || statusFilter === 'declined'

  const { data: allGroupsData } = useQuery({
    ...orpc.localGroups.list.queryOptions({ input: {} }),
    enabled: !!user?.isAdmin,
  })
  const allGroups: LocalGroup[] = (allGroupsData?.groups ?? []) as LocalGroup[]

  const [groupsResult, pendingResult, onHoldResult, declinedResult] = useQueries({
    queries: [
      {
        ...orpc.admin.localGroups.list.queryOptions({ input: {} }),
        enabled: !!user?.isAdmin && fetchGroups,
      },
      {
        ...orpc.admin.localGroups.listSuggestions.queryOptions({
          input: { status: LocalGroupSuggestionStatus.pending },
        }),
        enabled: !!user?.isAdmin && fetchPending,
      },
      {
        ...orpc.admin.localGroups.listSuggestions.queryOptions({
          input: { status: LocalGroupSuggestionStatus.on_hold },
        }),
        enabled: !!user?.isAdmin && fetchOnHold,
      },
      {
        ...orpc.admin.localGroups.listSuggestions.queryOptions({ input: { status: 'declined' } }),
        enabled: !!user?.isAdmin && fetchDeclined,
      },
    ],
  })

  const loadingItems =
    (fetchGroups && groupsResult.isFetching) ||
    (fetchPending && pendingResult.isFetching) ||
    (fetchOnHold && onHoldResult.isFetching) ||
    (fetchDeclined && declinedResult.isFetching)

  const items = useMemo<DisplayItem[]>(() => {
    const groups: DisplayGroup[] =
      fetchGroups && groupsResult.data
        ? (groupsResult.data.groups as LocalGroup[]).map((g) => ({ kind: 'group' as const, ...g }))
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
    return [...groups, ...suggestions].sort((a, b) => {
      const cc = a.country.localeCompare(b.country)
      return cc !== 0 ? cc : a.name.localeCompare(b.name)
    })
  }, [
    fetchGroups,
    fetchPending,
    fetchOnHold,
    fetchDeclined,
    groupsResult.data,
    pendingResult.data,
    onHoldResult.data,
    declinedResult.data,
  ])

  const { data: deleteTargetProjectsData, isFetching: loadingDeleteProjects } = useQuery({
    ...orpc.projects.list.queryOptions({
      input: { localGroup: deleteTarget?.name ?? '', limit: 100 },
    }),
    enabled: !!deleteTarget && deleteTarget.kind === 'group',
  })
  const deleteTargetProjects = deleteTargetProjectsData?.projects ?? []

  const invalidateItems = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.localGroups.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.localGroups.listSuggestions.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.localGroups.list.key() }),
    ])

  const createGroupMutation = useMutation({ ...orpc.admin.localGroups.create.mutationOptions() })
  const updateGroupMutation = useMutation({ ...orpc.admin.localGroups.update.mutationOptions() })
  const reviewSuggestionMutation = useMutation({
    ...orpc.admin.localGroups.reviewSuggestion.mutationOptions(),
  })
  const deleteGroupMutation = useMutation({ ...orpc.admin.localGroups.delete.mutationOptions() })
  const deleteSuggestionMutation = useMutation({
    ...orpc.admin.localGroups.deleteSuggestion.mutationOptions(),
  })

  const displayItems = countryFilter ? items.filter((i) => i.country === countryFilter) : items

  const countryOptions = [
    { value: '', label: 'All countries' },
    ...Array.from(new Set(items.map((i) => i.country)))
      .sort()
      .map((c) => ({ value: c, label: countryLabel(c) })),
  ]

  const mergeOptions = [
    { value: '', label: 'Select an existing group…' },
    ...allGroups.map((g) => ({
      value: String(g.id),
      label: `${countryLabel(g.country)}, ${g.name}`,
    })),
  ]

  function openEdit(group: LocalGroup) {
    setEditGroup(group)
    setEditName(group.name)
    setEditCountry(group.country)
  }

  function openReview(suggestion: Suggestion) {
    setReviewSuggestion(suggestion)
    setReviewAction('accept')
    setReviewEditName(suggestion.name)
    setReviewEditCountry(suggestion.country)
    setMergeTargetId('')
    setAdminNotes('')
  }

  function openAdd() {
    setAddName('')
    setAddCountry('')
    setShowAdd(true)
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddSubmitting(true)
    try {
      await createGroupMutation.mutateAsync({ name: addName.trim(), country: addCountry })
      await invalidateItems()
      showToast('Local group added', 'success')
      setShowAdd(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add group', 'error')
    } finally {
      setAddSubmitting(false)
    }
  }

  async function submitEdit(e: React.FormEvent, group: LocalGroup) {
    e.preventDefault()
    setEditSubmitting(true)
    try {
      await updateGroupMutation.mutateAsync({
        id: group.id,
        name: editName.trim(),
        country: editCountry,
      })
      await invalidateItems()
      showToast('Local group updated', 'success')
      setEditGroup(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update group', 'error')
    } finally {
      setEditSubmitting(false)
    }
  }

  async function submitReview(e: React.FormEvent, suggestion: Suggestion) {
    e.preventDefault()
    setReviewSubmitting(true)
    try {
      const body: Record<string, unknown> = { action: reviewAction }
      if (reviewAction === 'accept') {
        body.name = reviewEditName.trim()
        body.country = reviewEditCountry.trim()
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
      if (item.kind === 'group') {
        await deleteGroupMutation.mutateAsync({ id: item.id })
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
    return item.kind === 'group' ? 'active' : item.status
  }

  if (loading || !user) return null

  return (
    <>
      <main className="container py-5 pb-15">
        <div className="flex items-center justify-between mb-2">
          <h1 className="m-0">Local groups</h1>
          <Button size="sm" onClick={openAdd}>
            Add local group
          </Button>
        </div>
        <p className="text-text-light mb-6">
          Manage active local groups and review volunteer suggestions.
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
          <FilterDropdown
            id="country-filter"
            label="Country/Group"
            ariaLabel="Country/Group filter"
            value={countryFilter}
            options={countryOptions}
            onChange={(v) => setCountryFilter(v)}
          />
        </div>

        {loadingItems ? (
          <div className="text-center py-10 text-text-light">Loading…</div>
        ) : displayItems.length === 0 ? (
          <p className="text-text-light">No local groups found.</p>
        ) : (
          <div className="space-y-4">
            {displayItems.map((item) => {
              const status = itemStatus(item)
              return (
                <article
                  key={`${item.kind}-${item.id}`}
                  className="bg-surface rounded-xl shadow px-5 py-4 flex items-center justify-between gap-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">
                        {countryLabel(item.country)}, {item.name}
                      </span>
                      <Badge variant={suggestionStatusVariant(status)}>
                        {STATUS_LABEL[status] ?? status}
                      </Badge>
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
                    {item.kind === 'group' && (
                      <Button size="sm" variant="secondary" onClick={() => openEdit(item)}>
                        Edit
                      </Button>
                    )}
                    {item.kind === 'suggestion' && (
                      <Button size="sm" onClick={() => openReview(item)}>
                        {item.status === LocalGroupSuggestionStatus.declined ||
                        item.status === LocalGroupSuggestionStatus.on_hold
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

      {/* Add Group Modal */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAdd(false)
          }}
        >
          <div className="bg-surface rounded-xl shadow-lg max-w-125 w-full">
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 role="heading">Add local group</h2>
              <Button variant="ghost" icon onClick={() => setShowAdd(false)} aria-label="Close">
                ×
              </Button>
            </div>
            <div className="p-6">
              <form onSubmit={submitAdd}>
                <div className="mb-5">
                  <FilterDropdown
                    id="add-country"
                    label="Country"
                    ariaLabel="Select country/group"
                    value={addCountry}
                    options={SUGGESTION_COUNTRIES}
                    onChange={setAddCountry}
                    searchable
                  />
                </div>
                <div className="mb-5">
                  <label htmlFor="add-name">Group name</label>
                  <input
                    id="add-name"
                    type="text"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="e.g., Bristol, Edinburgh"
                  />
                </div>
                <div className="pt-4 border-t border-brand-border flex gap-3 justify-end">
                  <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={addSubmitting || !addCountry || !addName.trim()}>
                    {addSubmitting ? 'Saving…' : 'Add group'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {editGroup && (
        <div
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditGroup(null)
          }}
        >
          <div className="bg-surface rounded-xl shadow-lg max-w-125 w-full">
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 role="heading">Edit local group</h2>
              <Button variant="ghost" icon onClick={() => setEditGroup(null)} aria-label="Close">
                ×
              </Button>
            </div>
            <div className="p-6">
              <form onSubmit={(e) => submitEdit(e, editGroup)}>
                <div className="mb-5">
                  <FilterDropdown
                    id="edit-country"
                    label="Country"
                    ariaLabel="Select country/group"
                    value={editCountry}
                    options={SUGGESTION_COUNTRIES}
                    onChange={setEditCountry}
                    searchable
                  />
                </div>
                <div className="mb-5">
                  <label htmlFor="edit-name">Group name</label>
                  <input
                    id="edit-name"
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g., Bristol, Edinburgh"
                  />
                </div>
                <div className="pt-4 border-t border-brand-border flex gap-3 justify-end">
                  <Button type="button" variant="secondary" onClick={() => setEditGroup(null)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={editSubmitting || !editCountry || !editName.trim()}
                  >
                    {editSubmitting ? 'Saving…' : 'Save changes'}
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
              <p className="font-semibold mb-5">
                {countryLabel(reviewSuggestion.country)}, {reviewSuggestion.name}
              </p>

              <form onSubmit={(e) => submitReview(e, reviewSuggestion)}>
                <div className="mb-5">
                  <label>Action</label>
                  <div className="flex flex-col gap-3 mt-2">
                    {(
                      [
                        { value: 'accept', label: 'Accept', desc: 'Add as a new local group' },
                        { value: 'merge', label: 'Merge', desc: 'Link to an existing local group' },
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
                      <label htmlFor="review-name">Group name</label>
                      <input
                        id="review-name"
                        type="text"
                        value={reviewEditName}
                        onChange={(e) => setReviewEditName(e.target.value)}
                        placeholder="Group name"
                      />
                      <p className="text-sm text-text-light mt-1">
                        Adjust capitalisation or spelling if needed.
                      </p>
                    </div>
                    <div className="mb-5">
                      <label htmlFor="review-country">Country</label>
                      <input
                        id="review-country"
                        type="text"
                        value={reviewEditCountry}
                        onChange={(e) => setReviewEditCountry(e.target.value)}
                        placeholder="Country"
                      />
                    </div>
                  </>
                )}

                {reviewAction === 'merge' && (
                  <div className="mb-5">
                    <FilterDropdown
                      id="merge-target"
                      label="Merge into existing group"
                      ariaLabel="Select existing group to merge into"
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
                      placeholder={
                        {
                          on_hold: "e.g., We're looking into existing groups in this area first…",
                          decline:
                            "e.g., Thanks for the suggestion. This area isn't something we're able to support at the moment.",
                        }[reviewAction] ?? ''
                      }
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
                      (reviewAction === 'accept' &&
                        (!reviewEditName.trim() || !reviewEditCountry.trim())) ||
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
                Delete{' '}
                <strong>
                  {countryLabel(deleteTarget.country)}, {deleteTarget.name}
                </strong>
                ? This cannot be undone.
              </p>
              {deleteTarget.kind === 'group' &&
                (loadingDeleteProjects ? (
                  <p className="text-sm text-text-light">Checking affected projects…</p>
                ) : deleteTargetProjects.length > 0 ? (
                  <div className="mt-3 mb-1">
                    <p className="text-sm font-medium mb-2">
                      The following projects will have their local group removed:
                    </p>
                    <ul className="text-sm space-y-1 pl-4 list-disc">
                      {deleteTargetProjects.map((p) => (
                        <li key={p.id}>
                          <Link
                            href={`/projects/${p.id}`}
                            className="text-brand-text no-underline hover:text-primary"
                            target="_blank"
                          >
                            {p.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null)}
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
