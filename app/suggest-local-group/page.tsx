'use client'

import { useEffect, useState } from 'react'
import { useRequireAuth } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import FilterDropdown from '@/components/FilterDropdown'
import { orpc } from '@/lib/orpc'
import { COUNTRY_OPTIONS, countryLabel } from '@/lib/filter-options'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { Badge } from '@/components/Badge'
import {
  SUGGESTION_STATUS_LABELS,
  suggestionOutline,
  suggestionStatusVariant,
} from '@/lib/status-labels'
import { BLEED, SECTION_CARD } from '@/lib/ui-classes'
import { H1, H2 } from '@/components/Heading'
import { P } from '@/components/Text'
import FormLabel from '@/components/FormLabel'
import Input from '@/components/ui/Input'

const SUGGESTION_COUNTRIES = COUNTRY_OPTIONS.filter(
  (o) => o.value && o.value !== 'Remote' && o.value !== 'Other',
)

export default function SuggestLocalGroupPage() {
  const { user, loading } = useRequireAuth()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const [country, setCountry] = useState('')
  const [name, setName] = useState('')
  const [countryPrefilled, setCountryPrefilled] = useState(false)

  useEffect(() => {
    if (countryPrefilled || !user?.country) return
    if (!SUGGESTION_COUNTRIES.some((o) => o.value === user.country)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCountry(user.country)
    setCountryPrefilled(true)
  }, [user?.country, countryPrefilled])

  const { data, isLoading: loadingSuggestions } = useQuery({
    ...orpc.localGroupSuggestions.list.queryOptions(),
    enabled: !!user,
  })

  const suggestions = data?.suggestions ?? []

  const createMutation = useMutation({
    ...orpc.localGroupSuggestions.create.mutationOptions(),
    onSuccess: () => {
      setCountry('')
      setName('')
      showToast('Suggestion submitted!', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.localGroupSuggestions.list.key() })
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to submit suggestion', 'error')
    },
  })

  // TODO: when React Hook Form is added, map server ORPCError Zod issues back to
  // field errors via setError('country', ...) / setError('name', ...).
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({ name: name.trim(), country })
  }

  if (loading || !user) return null

  // A member suggests a group for their own chapter; someone in the holding pool picks a country.
  const countries = user.chapter
    ? SUGGESTION_COUNTRIES.filter((o) => o.value === user.chapter?.country)
    : SUGGESTION_COUNTRIES

  return (
    <>
      <main className="container py-5 pb-15">
        <H1>Suggest a local group</H1>
        <P className="text-text-light mb-6">
          Don&apos;t see your local group listed? Suggest it here and your chapter&apos;s organisers
          will review it.
        </P>

        <div className="sm:max-w-xl">
          <form onSubmit={handleSubmit} className={`${SECTION_CARD} mb-8`}>
            <div className="mb-5">
              <FilterDropdown
                id="country"
                label="Country/Group"
                ariaLabel="Select country/group"
                value={country}
                options={countries}
                onChange={setCountry}
              />
            </div>

            <div className="mb-5">
              <FormLabel htmlFor="name">Local group name</FormLabel>
              <Input
                id="name"
                type="text"
                placeholder="e.g., Bristol, Edinburgh, Birmingham"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <P className="text-sm text-text-light mt-1">
                Enter the city, region, or area name for the local group.
              </P>
            </div>

            <Button type="submit" disabled={createMutation.isPending || !country || !name.trim()}>
              {createMutation.isPending ? 'Submitting…' : 'Submit suggestion'}
            </Button>
          </form>

          {!loadingSuggestions && suggestions.length > 0 && (
            <div>
              <H2 className="text-lg font-semibold mb-4">Your previous suggestions</H2>
              <div className="space-y-3">
                {suggestions.map((s) => (
                  <article
                    key={s.id}
                    className={`bg-surface ${BLEED} shadow px-4 sm:px-5 py-4 flex items-start justify-between gap-4`}
                  >
                    <div>
                      <P className="font-semibold m-0">
                        {countryLabel(s.country)}, {s.name}
                        {s.mergedInto && (
                          <span className="text-text-light font-normal text-sm">
                            {' '}
                            (merged into {s.mergedInto.name})
                          </span>
                        )}
                      </P>
                      <P className="text-xs text-text-light m-0 mt-1">
                        Submitted {s.createdAt ? formatDate(s.createdAt) : ''}
                      </P>
                      {s.adminNotes && (
                        <P className="text-sm text-text-light mt-2 mb-0 italic">{s.adminNotes}</P>
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
    </>
  )
}
