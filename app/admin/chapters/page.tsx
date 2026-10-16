'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import FilterDropdown from '@/components/FilterDropdown'
import { useRequireSuperAdmin } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'
import { countryLabel } from '@/lib/filter-options'

const POOL = 'pool'

/** Every national chapter, opening one for a new country, and placing the holding pool. */
export default function AdminChaptersPage() {
  const { user, loading } = useRequireSuperAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [country, setCountry] = useState('')

  const enabled = !!user?.isSuperAdmin
  const { data } = useQuery({ ...orpc.admin.chapters.list.queryOptions(), enabled })
  const { data: pool = [] } = useQuery({ ...orpc.admin.chapters.pool.queryOptions(), enabled })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.chapters.key() })
  }
  const onError = (err: unknown) =>
    showToast(err instanceof Error ? err.message : 'Something went wrong', 'error')

  const createMutation = useMutation({
    ...orpc.admin.chapters.create.mutationOptions(),
    onSuccess: (created) => {
      const placed = created.placedFromPool
      showToast(
        `${created.name} chapter opened${placed ? `, with ${placed} from the holding pool` : ''}`,
        'success',
      )
      setCountry('')
      refresh()
    },
    onError,
  })

  const reassignMutation = useMutation({
    ...orpc.admin.chapters.reassign.mutationOptions(),
    onSuccess: () => {
      showToast('Moved', 'success')
      refresh()
    },
    onError,
  })

  if (loading || !user?.isSuperAdmin || !data) return null

  const chapterOptions = data.chapters.map((c) => ({ value: String(c.id), label: c.name }))

  return (
    <main className="container py-5 pb-15">
      <h1>National chapters</h1>

      <section className="mb-8">
        {data.chapters.length === 0 ? (
          <p className="text-text-light">No chapters yet.</p>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-3">
            {data.chapters.map((c) => (
              <li key={c.id} className={`card ${SECTION_CARD} overflow-hidden wrap-break-word`}>
                <div className="flex justify-between items-center gap-4 flex-wrap">
                  <div>
                    <Link href={`/admin/chapters/${c.id}`} className="font-semibold">
                      {c.name}
                    </Link>
                    <p className="text-text-light text-sm m-0">
                      {c.lead ? `Led by ${c.lead.name}` : 'No lead'} · {c.deputyCount}{' '}
                      {c.deputyCount === 1 ? 'deputy' : 'deputies'} · {c.memberCount}{' '}
                      {c.memberCount === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.availableCountries.length > 0 && (
        <section className={`card ${SECTION_CARD} mb-8`}>
          <h2 className="mt-0">Open a chapter</h2>
          <p className="text-text-light text-sm">
            Everyone in the holding pool who lives in that country moves into it.
          </p>
          <form
            className="flex gap-3 items-end flex-wrap"
            onSubmit={(e) => {
              e.preventDefault()
              if (country) createMutation.mutate({ country })
            }}
          >
            <FilterDropdown
              id="new-chapter-country"
              label="Country"
              ariaLabel="Country"
              value={country}
              placeholderLabel="Choose a country"
              options={data.availableCountries.map((c) => ({ value: c.value, label: c.label }))}
              onChange={setCountry}
              searchable
            />
            <Button type="submit" disabled={!country || createMutation.isPending}>
              Open chapter
            </Button>
          </form>
        </section>
      )}

      <section>
        <h2>Holding pool</h2>
        <p className="text-text-light text-sm">
          People whose country has no chapter. Global admins approve their applications and run
          their projects until they are placed.
        </p>
        {pool.length === 0 ? (
          <p className="text-text-light">Nobody is waiting.</p>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-2">
            {pool.map((p) => (
              <li
                key={p.id}
                className="flex justify-between items-center gap-4 flex-wrap border-b border-brand-border py-2"
              >
                <div>
                  <Link href={`/volunteers/${p.id}`}>{p.name}</Link>
                  <span className="text-text-light text-sm">
                    {' '}
                    · {countryLabel(p.country) || 'No country given'}
                  </span>
                </div>
                <FilterDropdown
                  id={`place-${p.id}`}
                  label={`Move ${p.name} to`}
                  ariaLabel={`Move ${p.name} to`}
                  hideLabel
                  value={POOL}
                  placeholderLabel="Move to…"
                  options={[{ value: POOL, label: 'Move to…' }, ...chapterOptions]}
                  onChange={(value) => {
                    if (value !== POOL) {
                      reassignMutation.mutate({ volunteerId: p.id, chapterId: Number(value) })
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
