'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import FilterDropdown from '@/components/FilterDropdown'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'
import { countryLabel } from '@/lib/filter-options'
import { H1, H2 } from '@/components/Heading'
import { P } from '@/components/Text'
import FormLabel from '@/components/FormLabel'
import Input from '@/components/ui/Input'

const POOL = 'pool'
const NO_COUNTRY = '__none__'

/** Every national chapter, opening one for a new country, and placing the holding pool. */
export default function AdminChaptersPage() {
  const { user, loading } = useRequireAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [country, setCountry] = useState('')
  const [poolSearch, setPoolSearch] = useState('')
  const [poolCountryFilter, setPoolCountryFilter] = useState('')

  const enabled = !!user?.isAdmin
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

  if (loading || !user?.isAdmin || !data) return null

  const chapterOptions = data.chapters.map((c) => ({ value: String(c.id), label: c.name }))

  // The country someone gave at signup, not the chapter it maps to — this is what tells us
  // who actually has nowhere to go versus who just hasn't been placed yet.
  const poolCountryOptions = [
    { value: '', label: 'All' },
    ...[...new Set(pool.map((p) => p.country).filter((c): c is string => !!c))]
      .sort((a, b) => countryLabel(a).localeCompare(countryLabel(b)))
      .map((c) => ({ value: c, label: countryLabel(c) })),
    ...(pool.some((p) => !p.country) ? [{ value: NO_COUNTRY, label: 'No country given' }] : []),
  ]
  const filteredPool = pool
    .filter(
      (p) =>
        !poolCountryFilter ||
        (poolCountryFilter === NO_COUNTRY ? !p.country : p.country === poolCountryFilter),
    )
    .filter(
      (p) =>
        !poolSearch ||
        p.name.toLowerCase().includes(poolSearch.toLowerCase()) ||
        p.email?.toLowerCase().includes(poolSearch.toLowerCase()),
    )
    .sort(
      (a, b) => (a.country ?? '').localeCompare(b.country ?? '') || a.name.localeCompare(b.name),
    )

  return (
    <main className="container py-5 pb-15">
      <H1>National chapters</H1>

      <section className="mb-8">
        {data.chapters.length === 0 ? (
          <P className="text-text-light">No chapters yet.</P>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-3">
            {data.chapters.map((c) => (
              <li key={c.id} className={`card ${SECTION_CARD} overflow-hidden wrap-break-word`}>
                <div className="flex justify-between items-center gap-4 flex-wrap">
                  <div>
                    <Link href={`/admin/chapters/${c.id}`} className="font-semibold">
                      {c.name}
                    </Link>
                    <P className="text-text-light text-sm m-0">
                      {c.lead ? `Led by ${c.lead.name}` : 'No lead'} · {c.deputyCount}{' '}
                      {c.deputyCount === 1 ? 'deputy' : 'deputies'} · {c.memberCount}{' '}
                      {c.memberCount === 1 ? 'member' : 'members'}
                    </P>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.availableCountries.length > 0 && (
        <section className={`card ${SECTION_CARD} mb-8`}>
          <H2 className="mt-0">Open a chapter</H2>
          <P className="text-text-light text-sm">
            Everyone in the holding pool who lives in that country moves into it.
          </P>
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
        <H2>Holding pool</H2>
        <P className="text-text-light text-sm">
          People whose country has no chapter. Global admins approve their applications and run
          their projects until they are placed.
        </P>
        {pool.length === 0 ? (
          <P className="text-text-light">Nobody is waiting.</P>
        ) : (
          <>
            <div className="flex gap-3 items-end flex-wrap mb-4">
              <div>
                <FormLabel htmlFor="pool-search">Search</FormLabel>
                <Input
                  type="search"
                  id="pool-search"
                  placeholder="Name or email…"
                  value={poolSearch}
                  onChange={(e) => setPoolSearch(e.target.value)}
                />
              </div>
              <FilterDropdown
                id="pool-country-filter"
                label="Country given at signup"
                ariaLabel="Country given at signup"
                value={poolCountryFilter}
                options={poolCountryOptions}
                onChange={setPoolCountryFilter}
                searchable
              />
            </div>
            {filteredPool.length === 0 ? (
              <P className="text-text-light">Nothing matches.</P>
            ) : (
              <ul className="list-none p-0 m-0 grid gap-2">
                {filteredPool.map((p) => (
                  <li
                    key={p.id}
                    className="flex justify-between items-center gap-4 flex-wrap border-b border-brand-border py-2"
                  >
                    <div>
                      <Link className="text-primary-text underline" href={`/volunteers/${p.id}`}>
                        {p.name}
                      </Link>
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
          </>
        )}
      </section>
    </main>
  )
}
