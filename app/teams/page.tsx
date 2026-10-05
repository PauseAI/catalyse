'use client'

import Link from 'next/link'
import { useRequireAuth } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { teamApplicationSentMessage } from '@/lib/action-messages'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import ViewSwitch, { PEOPLE_VIEWS } from '@/components/ViewSwitch'

export default function TeamsPage() {
  const { user, loading } = useRequireAuth()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({ ...orpc.teams.list.queryOptions(), enabled: !!user })
  const teams = data?.teams ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.teams.list.key() })

  const applyMutation = useMutation({
    ...orpc.teams.apply.mutationOptions(),
    onSuccess: (_data, variables) => {
      const team = teams.find((t) => t.id === variables.id)
      showToast(teamApplicationSentMessage(team?.name ?? 'this team'), 'success')
      void invalidate()
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to apply', 'error')
    },
  })

  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <div className="flex items-center justify-between mb-2">
        <h1 className="m-0">Teams</h1>
        <Link href="/suggest-team">
          <Button size="sm" variant="secondary">
            Suggest a Team
          </Button>
        </Link>
      </div>
      <ViewSwitch label="People" views={PEOPLE_VIEWS} current="/teams" className="mb-4" />
      <p className="text-text-light mb-6">
        Teams are groups that collaborate on a particular kind of project, such as a country or
        region, or a function like communications. Joining a team lets you see its projects and work
        with its members. Apply to any number of teams; a team leader reviews each application.
      </p>

      {isLoading ? (
        <Skeleton label="Loading teams…" />
      ) : teams.length === 0 ? (
        <EmptyState
          title="No teams yet."
          body="Suggest one for a group that collaborates on a kind of project."
          action={<Button href="/suggest-team">Suggest a Team</Button>}
        />
      ) : (
        <div className="space-y-4">
          {teams.map((team) => {
            const isMember = team.viewerRole !== null
            return (
              <article
                key={team.id}
                className="bg-surface rounded-xl shadow px-5 py-4 flex items-start justify-between gap-4"
              >
                <div>
                  <p className="font-semibold m-0">
                    <Link
                      href={`/teams/${team.id}`}
                      className="text-brand-text no-underline hover:text-primary"
                    >
                      {team.name}
                    </Link>
                    {team.viewerRole === 'leader' && (
                      <span className="text-xs px-2 py-0.5 ml-2 rounded-full font-medium bg-primary/10 text-primary">
                        Leader
                      </span>
                    )}
                  </p>
                  {team.description && (
                    <p className="text-sm text-text-light mt-1 mb-0 whitespace-pre-wrap">
                      {team.description}
                    </p>
                  )}
                  <p className="text-xs text-text-light m-0 mt-1">
                    {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
                    {team.leaders.length > 0 &&
                      ` · Led by ${team.leaders.map((l) => l.name).join(', ')}`}
                  </p>
                  <div className="flex gap-3 mt-2 text-sm">
                    {team.lumaUrl && (
                      <a
                        href={team.lumaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-text no-underline hover:text-primary"
                      >
                        Meeting calendar
                      </a>
                    )}
                    {team.docUrl && (
                      <a
                        href={team.docUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-text no-underline hover:text-primary"
                      >
                        Team doc
                      </a>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  {user.isAdmin || team.viewerRole === 'leader' ? (
                    <Link href={`/admin/teams/${team.id}`}>
                      <Button size="sm" variant="secondary">
                        Manage Members
                      </Button>
                    </Link>
                  ) : isMember ? (
                    <Link href={`/teams/${team.id}`}>
                      <Button size="sm" variant="secondary">
                        View team
                      </Button>
                    </Link>
                  ) : team.viewerRequestStatus === 'pending' ? (
                    <Button size="sm" variant="secondary" disabled>
                      Application Pending
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={applyMutation.isPending}
                      onClick={() => applyMutation.mutate({ id: team.id })}
                    >
                      Apply to Join
                    </Button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
