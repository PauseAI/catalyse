'use client'

import { use, useEffect, useState } from 'react'
import { useRequireApproved } from '@/lib/hooks/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ORPCError } from '@orpc/client'
import Button from '@/components/Button'
import VolunteerSelect from '@/components/VolunteerSelect'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'
import PageLoading from '@/components/PageLoading'

interface TeamMember {
  id: number
  name: string
  email: string | null
  role: 'member' | 'leader'
}

export default function AdminTeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = use(params)
  const teamId = parseInt(idParam, 10)
  const { user, loading } = useRequireApproved()
  const router = useRouter()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const {
    data: team,
    isLoading,
    error,
  } = useQuery({
    ...orpc.teams.getManageable.queryOptions({ input: { id: teamId } }),
    enabled: !!user,
    retry: false,
  })

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [lumaUrl, setLumaUrl] = useState('')
  const [docUrl, setDocUrl] = useState('')
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (!team || initialized) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(team.name)
    setDescription(team.description ?? '')
    setLumaUrl(team.lumaUrl ?? '')
    setDocUrl(team.docUrl ?? '')
    setInitialized(true)
  }, [team, initialized])

  const [assignVolunteerId, setAssignVolunteerId] = useState('')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const { data: joinRequestsData } = useQuery({
    ...orpc.teams.listJoinRequests.queryOptions({ input: { teamId } }),
    enabled: !!team,
  })
  const joinRequests = joinRequestsData?.requests ?? []

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.teams.getManageable.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.teams.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.teams.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.teams.listJoinRequests.key() }),
    ])

  const updateTeamMutation = useMutation({ ...orpc.teams.update.mutationOptions() })
  const deleteTeamMutation = useMutation({ ...orpc.admin.teams.delete.mutationOptions() })
  const assignMemberMutation = useMutation({ ...orpc.teams.assignMember.mutationOptions() })
  const setMemberRoleMutation = useMutation({ ...orpc.teams.setMemberRole.mutationOptions() })
  const removeMemberMutation = useMutation({ ...orpc.teams.removeMember.mutationOptions() })
  const reviewJoinRequestMutation = useMutation({
    ...orpc.teams.reviewJoinRequest.mutationOptions(),
  })

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    try {
      await updateTeamMutation.mutateAsync({
        id: teamId,
        name: name.trim(),
        description: description.trim() || null,
        lumaUrl: lumaUrl.trim() || null,
        docUrl: docUrl.trim() || null,
      })
      await invalidate()
      showToast('Team updated', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update team', 'error')
    }
  }

  function confirmDelete() {
    setShowDeleteDialog(false)
    deleteTeamMutation.mutate(
      { id: teamId },
      {
        onSuccess: () => {
          showToast('Team deleted', 'success')
          router.push('/admin/teams')
        },
        onError: (err: unknown) => {
          showToast(err instanceof Error ? err.message : 'Failed to delete team', 'error')
        },
      },
    )
  }

  async function addMember() {
    try {
      await assignMemberMutation.mutateAsync({
        teamId,
        volunteerId: Number(assignVolunteerId),
      })
      setAssignVolunteerId('')
      await invalidate()
      showToast('Volunteer added to team', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add member', 'error')
    }
  }

  async function toggleLeader(member: TeamMember) {
    try {
      const newRole = member.role === 'leader' ? 'member' : 'leader'
      await setMemberRoleMutation.mutateAsync({ teamId, volunteerId: member.id, role: newRole })
      await invalidate()
      showToast(newRole === 'leader' ? 'Promoted to leader' : 'Demoted to member', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update role', 'error')
    }
  }

  async function removeMember(member: TeamMember) {
    try {
      await removeMemberMutation.mutateAsync({ teamId, volunteerId: member.id })
      await invalidate()
      showToast('Member removed', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove member', 'error')
    }
  }

  async function reviewJoinRequest(id: number, action: 'accept' | 'decline') {
    try {
      await reviewJoinRequestMutation.mutateAsync({ id, action })
      await invalidate()
      showToast(action === 'accept' ? 'Request accepted' : 'Request declined', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to review request', 'error')
    }
  }

  const backHref = user?.isAdmin ? '/admin/teams' : '/teams'

  if (loading || !user) return <PageLoading />

  if (isLoading) {
    return (
      <main className="container py-5 pb-15">
        <div className="text-center py-10 text-text-light">Loading…</div>
      </main>
    )
  }

  if (error instanceof ORPCError && error.code === 'FORBIDDEN') {
    return (
      <main className="container py-5 pb-15">
        <p className="text-text-light">Only this team&apos;s leader or an admin can manage it.</p>
        <Link href={backHref} className="text-brand-text no-underline hover:text-primary">
          ← Back to teams
        </Link>
      </main>
    )
  }

  if (!team) {
    return (
      <main className="container py-5 pb-15">
        <p className="text-text-light">Team not found.</p>
        <Link href={backHref} className="text-brand-text no-underline hover:text-primary">
          ← Back to teams
        </Link>
      </main>
    )
  }

  return (
    <main className="container py-5 pb-15 max-w-2xl">
      <Link href={backHref} className="text-sm text-brand-text no-underline hover:text-primary">
        ← All teams
      </Link>
      <h1 className="mt-3 mb-6">{team.name}</h1>

      <div className={`${SECTION_CARD} mb-4`}>
        <h2>Team details</h2>
        <form onSubmit={handleSave}>
          <div className="mb-5">
            <label htmlFor="team-name">Team name</label>
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="mb-5">
            <label htmlFor="team-description">Description</label>
            <textarea
              id="team-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full"
            />
          </div>
          <div className="mb-5">
            <label htmlFor="team-luma">Luma calendar URL</label>
            <input
              id="team-luma"
              type="text"
              value={lumaUrl}
              onChange={(e) => setLumaUrl(e.target.value)}
              placeholder="https://luma.com/…"
            />
          </div>
          <div className="mb-5">
            <label htmlFor="team-doc">Team doc URL</label>
            <input
              id="team-doc"
              type="text"
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
              placeholder="https://docs.google.com/…"
            />
          </div>
          <div className="flex gap-3 justify-between">
            <Button type="submit" disabled={!name.trim() || updateTeamMutation.isPending}>
              {updateTeamMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            {user.isAdmin && (
              <Button type="button" variant="danger" onClick={() => setShowDeleteDialog(true)}>
                Delete team
              </Button>
            )}
          </div>
        </form>
      </div>

      {joinRequests.length > 0 && (
        <div className={`${SECTION_CARD} mb-4`}>
          <h2>Pending join requests</h2>
          <div className="space-y-3">
            {joinRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="m-0 font-medium">{r.volunteer.name}</p>
                  {r.message && <p className="m-0 text-xs text-text-light italic">{r.message}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => reviewJoinRequest(r.id, 'accept')}>
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => reviewJoinRequest(r.id, 'decline')}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${SECTION_CARD} mb-4`}>
        <h2>Members</h2>

        <div className="mb-5 pb-5 border-b border-brand-border flex items-end gap-2">
          <div className="flex-1">
            <VolunteerSelect
              id="assign-volunteer"
              label="Add a volunteer directly"
              ariaLabel="Select volunteer to add"
              value={assignVolunteerId}
              onChange={setAssignVolunteerId}
              placeholder="Select a volunteer…"
              enabled={!!user}
            />
          </div>
          <Button
            size="sm"
            disabled={!assignVolunteerId || assignMemberMutation.isPending}
            onClick={addMember}
          >
            Add
          </Button>
        </div>

        {team.members.length === 0 ? (
          <p className="text-text-light">No members yet.</p>
        ) : (
          <div className="space-y-3">
            {team.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="m-0 font-medium">{m.name}</p>
                  <p className="m-0 text-xs text-text-light">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {m.role === 'leader' && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">
                      Leader
                    </span>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => toggleLeader(m)}>
                    {m.role === 'leader' ? 'Demote' : 'Make leader'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => removeMember(m)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        id="confirm-delete-team"
        isOpen={showDeleteDialog}
        title="Delete this team?"
        body="Its members lose access to the projects scoped to it. This cannot be undone."
        confirmLabel="Delete team"
        busyLabel="Deleting…"
        danger
        busy={deleteTeamMutation.isPending}
        onConfirm={confirmDelete}
        onClose={() => setShowDeleteDialog(false)}
      />
    </main>
  )
}
