'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import FilterDropdown, { FilterOption } from '@/components/FilterDropdown'
import { orpc } from '@/lib/orpc'

const DEBOUNCE_MS = 300
const RESULT_LIMIT = 20

interface Props {
  id: string
  label: string
  ariaLabel: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  hideLabel?: boolean
  triggerClassName?: string
  enabled?: boolean
}

// Reusable volunteer picker: typeahead over a server-side search (name/bio) rather than a
// client-side filter over a preloaded page, since the volunteer list can grow far past
// what's reasonable to fetch upfront. Each option shows name plus location context
// (local group or country) so admins can make location-aware assignments, and to a global
// admin the email too. Accounts marked as duplicates never appear.
export default function VolunteerSelect({
  id,
  label,
  ariaLabel,
  value,
  onChange,
  placeholder = '— Select volunteer —',
  required,
  hideLabel,
  triggerClassName,
  enabled = true,
}: Props) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data } = useQuery({
    ...orpc.volunteers.list.queryOptions({
      input: { limit: RESULT_LIMIT, search: search || undefined },
    }),
    enabled,
  })
  const volunteers = data?.volunteers ?? []

  // Remember whichever option was last picked so the trigger keeps showing its label
  // even after a later search no longer includes it in the fetched page.
  const [selectedOption, setSelectedOption] = useState<FilterOption | null>(null)

  // Label stays just the name — it's what the trigger shows once selected, and what the
  // e2e suite matches on. The rest goes in the description, which the search also matches
  // and which stays out of the option's accessible name.
  const volunteerOptions: FilterOption[] = volunteers.map((v) => ({
    value: String(v.id),
    label: v.name,
    description:
      [v.email, [v.localGroup, v.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ') ||
      undefined,
  }))
  const options: FilterOption[] = [
    { value: '', label: placeholder },
    ...(selectedOption && !volunteerOptions.some((o) => o.value === selectedOption.value)
      ? [selectedOption]
      : []),
    ...volunteerOptions,
  ]

  return (
    <FilterDropdown
      id={id}
      label={label}
      ariaLabel={ariaLabel}
      value={value}
      options={options}
      onChange={(v) => {
        setSelectedOption(options.find((o) => o.value === v) ?? null)
        onChange(v)
      }}
      onQueryChange={setSearchInput}
      searchable
      required={required}
      hideLabel={hideLabel}
      triggerClassName={triggerClassName}
    />
  )
}
