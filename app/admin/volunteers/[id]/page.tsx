'use client'

import { use, useState } from 'react'
import { useRequireAdmin } from '@/lib/hooks/auth'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import FilterDropdown, { useFilterOptions } from '@/components/FilterDropdown'
import Tabs from '@/components/Tabs'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

interface Skill {
  id: number
  name: string
  categoryName: string
}
interface Endorsement {
  id: number
  skillId: number
  skillName: string
  skillCategory: string
  endorsedByName: string
  rating: string
  notes: string | null
  createdAt: string
}
interface AdminNote {
  id: number
  content: string
  category: string
  authorName: string
  createdAt: string
  updatedAt: string
}
interface QuickTask {
  id: number
  title: string
  status: string
  skillName: string | null
  reviewRating: string | null
}
interface ProjectHistory {
  id: number
  title: string
  status: string
  ownerId: number | null
  proposedById: number | null
}
interface VolunteerDetail {
  id: number
  name: string
  email: string
  bio: string | null
  location: string | null
  localGroup: string | null
  availabilityHoursPerWeek: number | null
  discordHandle: string | null
  signalNumber: string | null
  whatsappNumber: string | null
  consentMakeProfileVisibleInDirectory: boolean
  isAdmin: boolean
  createdAt: string
  skills: Skill[]
  endorsements: Endorsement[]
  adminNotes: AdminNote[]
  quickTasks: QuickTask[]
  projectHistory: ProjectHistory[]
}

const NOTE_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'skill_feedback', label: 'Skill Feedback' },
  { value: 'reliability', label: 'Reliability' },
  { value: 'fit', label: 'Fit' },
] as const

const RATING_OPTIONS = [
  { value: 'verified', label: 'Verified - Can deliver' },
  { value: 'strong', label: 'Strong - Highly skilled' },
] as const

const BASED_ON_OPTIONS = [
  { value: 'direct_observation', label: 'Direct Observation' },
  { value: 'project_outcome', label: 'Project Outcome' },
  { value: 'quick_task', label: 'Quick Task' },
] as const

type Tab = 'admin_notes' | 'quick_tasks' | 'project_history' | 'endorse_skill'

export default function AdminVolunteerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, loading } = useRequireAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('admin_notes')

  // Note add form
  const [noteContent, setNoteContent] = useState('')
  const { value: noteCategory, onChange: setNoteCategory } = useFilterOptions(
    NOTE_CATEGORIES,
    'general',
  )

  // Note inline edit
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editingNoteContent, setEditingNoteContent] = useState('')
  const [deleteNoteId, setDeleteNoteId] = useState<number | null>(null)

  // Endorsement form
  const [endorseSkillId, setEndorseSkillId] = useState('')
  const { value: endorseRating, onChange: setEndorseRating } = useFilterOptions(
    RATING_OPTIONS,
    'verified',
  )
  const { value: endorseBasedOn, onChange: setEndorseBasedOn } = useFilterOptions(
    BASED_ON_OPTIONS,
    'direct_observation',
  )

  const { data: vol, isPending: loadingData } = useQuery({
    ...orpc.admin.volunteers.getById.queryOptions({ input: { id: Number(id) } }),
    enabled: !!user?.isAdmin,
    select: (d) => d as unknown as VolunteerDetail,
  })
  const { data: flatSkills = [] } = useQuery({
    ...orpc.skills.list.queryOptions({ input: {} }),
    enabled: !!user?.isAdmin,
    select: (cats) =>
      cats.flatMap((cat) =>
        cat.skills.map((s) => ({ id: s.id, name: s.name, categoryName: cat.name })),
      ),
  })

  const volQueryKey = orpc.admin.volunteers.getById.key({ input: { id: Number(id) } })
  const invalidateVol = () => queryClient.invalidateQueries({ queryKey: volQueryKey })

  const createNoteMutation = useMutation({ ...orpc.admin.notes.create.mutationOptions() })
  const updateNoteMutation = useMutation({ ...orpc.admin.notes.update.mutationOptions() })
  const deleteNoteMutation = useMutation({ ...orpc.admin.notes.delete.mutationOptions() })
  const addEndorsementMutation = useMutation({
    ...orpc.admin.volunteers.addEndorsement.mutationOptions(),
  })

  async function addNote(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await createNoteMutation.mutateAsync({
        volunteerId: Number(id),
        content: noteContent,
        category: noteCategory,
      })
      showToast('Note added.', 'success')
      setNoteContent('')
      setNoteCategory('general')
      await invalidateVol()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function saveEditedNote(noteId: number) {
    setSubmitting(true)
    try {
      await updateNoteMutation.mutateAsync({ id: noteId, content: editingNoteContent })
      showToast('Note updated.', 'success')
      setEditingNoteId(null)
      setEditingNoteContent('')
      await invalidateVol()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDeleteNote(noteId: number) {
    setDeleteNoteId(null)
    try {
      await deleteNoteMutation.mutateAsync({ id: noteId })
      showToast('Note deleted.', 'success')
      await invalidateVol()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed', 'error')
    }
  }

  async function addEndorsement(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await addEndorsementMutation.mutateAsync({
        volunteerId: Number(id),
        skillId: parseInt(endorseSkillId),
        rating: endorseRating,
        source: endorseBasedOn,
      })
      showToast('Skill endorsed!', 'success')
      setEndorseSkillId('')
      setEndorseRating('verified')
      setEndorseBasedOn('direct_observation')
      await invalidateVol()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !user) return null

  if (loadingData) {
    return (
      <>
        <main className="container py-5 pb-15">
          <div className="text-center py-10 text-text-light">Loading…</div>
        </main>
      </>
    )
  }

  if (!vol) {
    return (
      <>
        <main className="container py-5 pb-15">
          <p className="text-error">Volunteer not found.</p>
          <Button href="/volunteers" variant="secondary" className="mt-4">
            Back
          </Button>
        </main>
      </>
    )
  }

  return (
    <>
      <main className="container py-5 pb-15">
        <div className="mb-4">
          <Link href="/volunteers" className="text-text-light">
            &larr; Back to Volunteers
          </Link>
        </div>

        {/* Profile header */}
        <div className="bg-surface rounded-xl shadow p-4 sm:p-6 mb-6 overflow-hidden wrap-break-word">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h1 className="mb-1">{vol.name}</h1>
              <p className="text-text-light m-0">{vol.email}</p>
            </div>
            <div className="flex gap-2">
              {vol.isAdmin && (
                <span className="py-0.5 px-2 rounded-xl text-[0.8rem] bg-blue-100 dark:bg-blue-950">
                  Admin
                </span>
              )}
              {!vol.consentMakeProfileVisibleInDirectory && (
                <span className="py-0.5 px-2 rounded-xl text-[0.8rem] bg-amber-50 dark:bg-amber-900">
                  Profile Hidden
                </span>
              )}
            </div>
          </div>
          {vol.bio && <p className="mb-0 whitespace-pre-wrap">{vol.bio}</p>}
        </div>

        {/* Skills and contact info */}
        <div className="bg-surface rounded-xl shadow p-4 sm:p-6 mb-6 overflow-hidden wrap-break-word">
          <h3>Skills (Self-Assessed)</h3>
          {vol.skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {vol.skills.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center px-3 py-1 bg-accent text-secondary-dark rounded-full text-sm font-medium dark:bg-gray-700 dark:text-gray-300"
                >
                  {s.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-text-light mb-4">No skills listed.</p>
          )}

          <h3>Verified Skills (Endorsed)</h3>
          <div id="endorsements" className="mb-4">
            {vol.endorsements.length > 0 ? (
              vol.endorsements.map((e) => (
                <div key={e.id} className="py-1.5 border-b border-brand-border text-sm">
                  <strong>{e.skillName}</strong>: {e.rating} · by {e.endorsedByName}
                </div>
              ))
            ) : (
              <p className="text-text-light">No endorsements yet.</p>
            )}
          </div>

          <h3>Contact Info</h3>
          <div id="contactInfo" className="text-sm">
            <p className="my-1">
              <strong>Email:</strong> {vol.email}
            </p>
            {vol.location && (
              <p className="my-1">
                <strong>Location:</strong> {vol.location}
              </p>
            )}
            {vol.localGroup && (
              <p className="my-1">
                <strong>Local Group:</strong> {vol.localGroup}
              </p>
            )}
            {vol.availabilityHoursPerWeek && (
              <p className="my-1">
                <strong>Availability:</strong> {vol.availabilityHoursPerWeek}h/week
              </p>
            )}
            {vol.discordHandle && (
              <p className="my-1">
                <strong>Discord:</strong> {vol.discordHandle}
              </p>
            )}
            {vol.signalNumber && (
              <p className="my-1">
                <strong>Signal:</strong> {vol.signalNumber}
              </p>
            )}
            {vol.whatsappNumber && (
              <p className="my-1">
                <strong>WhatsApp:</strong> {vol.whatsappNumber}
              </p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-surface rounded-xl shadow p-4 sm:p-6 mb-4 overflow-hidden wrap-break-word">
          <Tabs
            role="tablist"
            tabs={
              [
                { key: 'admin_notes', label: 'Admin Notes' },
                { key: 'quick_tasks', label: 'Quick Tasks' },
                { key: 'project_history', label: 'Project History' },
                { key: 'endorse_skill', label: 'Endorse Skill' },
              ] as { key: Tab; label: string }[]
            }
            activeTab={activeTab}
            onChange={setActiveTab}
          />

          {/* Admin Notes tab */}
          {activeTab === 'admin_notes' && (
            <div>
              <div id="notesList">
                {vol.adminNotes.length === 0 && (
                  <p className="text-text-light mb-4">No notes yet.</p>
                )}
                {vol.adminNotes.map((n) => (
                  <div key={n.id} className="py-3 border-b border-brand-border">
                    {editingNoteId === n.id ? (
                      <div>
                        <label htmlFor={`edit-note-${n.id}`} className="text-sm block mb-1">
                          Edit note
                        </label>
                        <textarea
                          id={`edit-note-${n.id}`}
                          rows={3}
                          value={editingNoteContent}
                          onChange={(e) => setEditingNoteContent(e.target.value)}
                          className="w-full mb-2"
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => saveEditedNote(n.id)}
                            disabled={submitting}
                          >
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingNoteId(null)
                              setEditingNoteContent('')
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[0.8rem] px-1.5 py-px rounded-lg bg-brand-bg">
                              {n.category.replace(/_/g, ' ')}
                            </span>
                            <span className="text-text-light text-[0.8rem] ml-2">
                              by {n.authorName}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setEditingNoteId(n.id)
                                setEditingNoteContent(n.content)
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setDeleteNoteId(n.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap">{n.content}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <form onSubmit={addNote} className="mt-4">
                <div className="flex gap-3 mb-2 flex-wrap">
                  <div className="m-0">
                    <FilterDropdown
                      id="note-category"
                      label="Category"
                      ariaLabel="Category"
                      value={noteCategory}
                      options={NOTE_CATEGORIES}
                      onChange={(v) => setNoteCategory(v)}
                    />
                  </div>
                </div>
                <div className="mb-5">
                  <label htmlFor="note-content">Note</label>
                  <textarea
                    id="note-content"
                    rows={3}
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    required
                    placeholder="Add an admin note…"
                    className="w-full"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={submitting}>
                  Add Note
                </Button>
              </form>
            </div>
          )}

          {/* Quick Tasks tab */}
          {activeTab === 'quick_tasks' && (
            <div>
              {vol.quickTasks.length === 0 ? (
                <p className="text-text-light">No Quick Tasks assigned yet.</p>
              ) : (
                vol.quickTasks.map((t) => (
                  <div
                    key={t.id}
                    className="text-sm py-2 border-b border-brand-border flex justify-between"
                  >
                    <span>
                      {t.title}
                      {t.skillName && ` (${t.skillName})`}
                    </span>
                    <span className="text-text-light">
                      {t.status}
                      {t.reviewRating && ` · ${t.reviewRating}`}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Project History tab */}
          {activeTab === 'project_history' && (
            <div>
              {vol.projectHistory.length === 0 ? (
                <p className="text-text-light">No project history.</p>
              ) : (
                vol.projectHistory.map((p) => (
                  <div
                    key={p.id}
                    className="py-2 border-b border-brand-border flex justify-between"
                  >
                    <Link href={`/projects/${p.id}`} className="font-medium">
                      {p.title}
                    </Link>
                    <div className="text-sm text-text-light">
                      {p.ownerId === vol.id ? 'owner' : 'proposer'} · {p.status.replace(/_/g, ' ')}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Endorse Skill tab */}
          {activeTab === 'endorse_skill' && (
            <div>
              <h3>Endorse a Skill</h3>
              <form onSubmit={addEndorsement} className="flex flex-col gap-3 max-w-[480px]">
                <div className="m-0">
                  <FilterDropdown
                    id="endorse-skill"
                    label="Skill"
                    ariaLabel="Skill"
                    value={endorseSkillId}
                    options={[
                      { value: '', label: 'Select skill…' },
                      ...flatSkills.map((s) => ({
                        value: String(s.id),
                        label: `${s.name} (${s.categoryName})`,
                      })),
                    ]}
                    onChange={(v) => setEndorseSkillId(v)}
                    searchable
                  />
                </div>
                <div className="m-0">
                  <FilterDropdown
                    id="endorse-rating"
                    label="Rating"
                    ariaLabel="Rating"
                    value={endorseRating}
                    options={RATING_OPTIONS}
                    onChange={(v) => setEndorseRating(v)}
                  />
                </div>
                <div className="m-0">
                  <FilterDropdown
                    id="endorse-based-on"
                    label="Based On"
                    ariaLabel="Based On"
                    value={endorseBasedOn}
                    options={BASED_ON_OPTIONS}
                    onChange={(v) => setEndorseBasedOn(v)}
                  />
                </div>
                <div>
                  <Button type="submit" variant="secondary" disabled={submitting}>
                    Endorse Skill
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>

      {deleteNoteId !== null && (
        <ConfirmDialog
          id="confirm-delete-note"
          isOpen
          title="Delete this note?"
          body="The note is removed for every admin. This cannot be undone."
          confirmLabel="Delete note"
          danger
          onConfirm={() => void confirmDeleteNote(deleteNoteId)}
          onClose={() => setDeleteNoteId(null)}
        />
      )}
    </>
  )
}
