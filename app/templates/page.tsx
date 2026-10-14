'use client'

import { useRequireApproved } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Button from '@/components/Button'
import { Badge } from '@/components/Badge'
import { orpc } from '@/lib/orpc'
import { formatDate } from '@/lib/format-date'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'
import PageLoading from '@/components/PageLoading'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'

const card = `${SECTION_CARD} mb-4 overflow-hidden wrap-break-word`

export default function TemplatesLibraryPage() {
  const { user, loading } = useRequireApproved()
  const router = useRouter()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const { data: templates, isPending } = useQuery({
    ...orpc.templates.list.queryOptions({ input: {} }),
    enabled: !!user,
  })
  const { data: canInstantiateData } = useQuery({
    ...orpc.templates.canInstantiate.queryOptions(),
    enabled: !!user,
  })
  const canInstantiate = canInstantiateData?.canInstantiate ?? false

  const instantiate = useMutation({
    ...orpc.templates.instantiate.mutationOptions(),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: orpc.projects.myDrafts.key() })
      showToast('Draft created — update the title, location and team for your group', 'success')
      router.push(`/projects/${res.id}/edit`)
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Could not create project', 'error'),
  })

  if (loading || !user) return <PageLoading />

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0">Project templates</h1>
          <p className="text-text-light m-0">
            Reusable project structures for running the same program in a new country or local
            group.
          </p>
        </div>
        {user.isAdmin && <Button href="/templates/new">New template</Button>}
      </div>

      {isPending && <Skeleton label="Loading templates…" />}

      {templates?.length === 0 && (
        <EmptyState
          title="No templates yet."
          body={
            user.isAdmin
              ? 'Build one from scratch, or save an existing project as a template from its project page.'
              : 'Check back once an admin has published one.'
          }
          action={
            <Button href="/projects" variant="outline">
              Browse projects
            </Button>
          }
        />
      )}

      {templates?.map((t) => (
        <div key={t.id} className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-lg">{t.title}</h2>
                <Badge variant="neutral">{t.sourceType}</Badge>
              </div>
              {t.description && <p className="text-text-light mt-1 mb-0">{t.description}</p>}
              <p className="text-text-light mt-2 mb-0 text-sm">
                Used {t.usedCount} time{t.usedCount === 1 ? '' : 's'}
                {t.createdBy ? ` · Created by ${t.createdBy.name}` : ''}
                {t.createdAt ? ` · ${formatDate(t.createdAt)}` : ''}
              </p>
              {(t.sourceCountry || t.sourceLocalGroup || t.sourceTeam) && (
                <p className="text-text-light mt-1 mb-0 text-sm">
                  Previously:{' '}
                  {[t.sourceCountry, t.sourceLocalGroup, t.sourceTeam?.name]
                    .filter(Boolean)
                    .join(' / ')}
                </p>
              )}
            </div>
            {canInstantiate && t.sourceType === 'PROJECT' && (
              <Button
                size="sm"
                disabled={instantiate.isPending}
                onClick={() => instantiate.mutate({ templateId: t.id })}
              >
                {instantiate.isPending ? 'Creating…' : 'Use template'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
