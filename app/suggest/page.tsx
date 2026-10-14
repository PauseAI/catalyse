'use client'

import { useEffect } from 'react'
import { useRequireAuth } from '@/lib/hooks/auth'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import Button from '@/components/Button'
import PageLoading from '@/components/PageLoading'
import { orpc } from '@/lib/orpc'
import { MAX_VOLUNTEER_DRAFTS } from '@/lib/project-status'

export default function SuggestPage() {
  const router = useRouter()
  const { user, loading } = useRequireAuth()

  const { data: drafts = [], isPending: draftsPending } = useQuery({
    ...orpc.projects.myDrafts.queryOptions(),
    enabled: !!user,
  })

  // First-time proposers skip straight to the form; once someone has drafts, this page
  // shows the drafts list with a button into the form instead.
  useEffect(() => {
    if (!draftsPending && drafts.length === 0) router.replace('/suggest/new')
  }, [draftsPending, drafts.length, router])

  if (loading || !user || draftsPending || drafts.length === 0) return <PageLoading />

  // Admins are not held to the draft limit; see projects.create.
  const atDraftLimit = !user.isAdmin && drafts.length >= MAX_VOLUNTEER_DRAFTS

  return (
    <main className="container py-5 pb-15">
      <h1 role="heading">Propose a project</h1>
      <p>
        Have an idea for something PauseAI should do? Propose it here! Our team will review it and,
        if approved, it&apos;ll be visible to all volunteers.
      </p>

      <div className="max-w-4xl bg-surface rounded-xl shadow p-4 sm:p-6 mb-4">
        <h2 className="mt-0 mb-3">My Drafts</h2>
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

      {atDraftLimit ? (
        <p className="text-text-light">
          You have {drafts.length} drafts. Finish or delete one first.
        </p>
      ) : (
        <Button href="/suggest/new">Propose a project</Button>
      )}
    </main>
  )
}
