'use client'

import { useRequireAdmin } from '@/lib/hooks/auth'
import { useQuery } from '@tanstack/react-query'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'
import { SECTION_CARD } from '@/lib/ui-classes'

export default function AdminProjectsPage() {
  const { user, loading } = useRequireAdmin()

  const { data: drafts = [] } = useQuery({
    ...orpc.admin.projects.myDrafts.queryOptions(),
    enabled: !!user,
  })

  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <h1 role="heading">Org projects</h1>
      <p className="text-text-light mb-6">
        Create a project on behalf of PauseAI. This skips the approval process.
      </p>

      {drafts.length > 0 && (
        <div className={`max-w-4xl ${SECTION_CARD} mb-4`}>
          <h2 className="mt-0 mb-3">My drafts</h2>
          <ul className="flex flex-col gap-2">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex items-center justify-between gap-3 bg-brand-bg rounded-lg p-3 border border-brand-border"
              >
                <span className="font-medium">{draft.title || 'Untitled draft'}</span>
                <Button href={`/projects/${draft.id}/edit`} size="sm">
                  Manage
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button href="/admin/projects/new">New project</Button>
    </main>
  )
}
