'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRequireAuth } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { Badge } from '@/components/Badge'
import {
  SUGGESTION_STATUS_LABELS,
  suggestionOutline,
  suggestionStatusVariant,
} from '@/lib/status-labels'
import { BLEED, SECTION_CARD } from '@/lib/ui-classes'

export default function SuggestTeamPage() {
  const { user, loading } = useRequireAuth()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { data, isLoading: loadingSuggestions } = useQuery({
    ...orpc.teamSuggestions.list.queryOptions(),
    enabled: !!user,
  })

  const suggestions = data?.suggestions ?? []

  const createMutation = useMutation({
    ...orpc.teamSuggestions.create.mutationOptions(),
    onSuccess: () => {
      setName('')
      setDescription('')
      showToast('Suggestion submitted!', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.teamSuggestions.list.key() })
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to submit suggestion', 'error')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({ name: name.trim(), description: description.trim() || null })
  }

  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <h1>Suggest a team</h1>
      <p className="text-text-light mb-2">
        Don&apos;t see a team for what you&apos;re working on? Suggest one and an admin will review
        it.
      </p>
      <p className="text-text-light mb-6">
        A team is for a group that collaborates on a kind of project, such as a country, a region or
        a function. For a one-off goal, <Link href="/suggest">propose a project</Link> instead.
      </p>

      <div className="sm:max-w-xl">
        <form onSubmit={handleSubmit} className={`${SECTION_CARD} mb-8`}>
          <div className="mb-5">
            <label htmlFor="name">Team name</label>
            <input
              id="name"
              type="text"
              placeholder="e.g., Comms, Outreach, Policy"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="mb-5">
            <label htmlFor="description">
              Description <span className="text-text-light font-normal">(optional)</span>
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this team work on?"
              className="w-full"
            />
          </div>

          <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
            {createMutation.isPending ? 'Submitting…' : 'Submit suggestion'}
          </Button>
        </form>

        {!loadingSuggestions && suggestions.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Your previous suggestions</h2>
            <div className="space-y-3">
              {suggestions.map((s) => (
                <article
                  key={s.id}
                  className={`bg-surface ${BLEED} shadow px-4 sm:px-5 py-4 flex items-start justify-between gap-4`}
                >
                  <div>
                    <p className="font-semibold m-0">
                      {s.name}
                      {s.mergedInto && (
                        <span className="text-text-light font-normal text-sm">
                          {' '}
                          (merged into {s.mergedInto.name})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-text-light m-0 mt-1">
                      Submitted {s.createdAt ? formatDate(s.createdAt) : ''}
                    </p>
                    {s.adminNotes && (
                      <p className="text-sm text-text-light mt-2 mb-0 italic">{s.adminNotes}</p>
                    )}
                  </div>
                  <Badge
                    variant={suggestionStatusVariant(s.status)}
                    outline={suggestionOutline(s.status)}
                    className="whitespace-nowrap"
                  >
                    {SUGGESTION_STATUS_LABELS[s.status] ?? s.status}
                  </Badge>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
