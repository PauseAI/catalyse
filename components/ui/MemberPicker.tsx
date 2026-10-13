'use client'

import FilterDropdown, { FilterOption } from '@/components/FilterDropdown'

interface Props {
  id: string
  label: string
  ariaLabel: string
  candidates: { id: number; name: string }[]
  onAdd: (id: number) => void
  placeholder?: string
  hideLabel?: boolean
  /** The typed search text, for a caller that fetches `candidates` to match it. */
  onQueryChange?: (query: string) => void
}

/**
 * Typeahead over a candidate list the caller supplies — unlike `VolunteerSelect`, which holds
 * a selection. Typing filters the list; Enter or a click on a result adds that candidate
 * immediately, so nothing is held as a persisted selection and the trigger always reads as
 * `placeholder`.
 */
export default function MemberPicker({
  id,
  label,
  ariaLabel,
  candidates,
  onAdd,
  placeholder = 'Add a member',
  hideLabel,
  onQueryChange,
}: Props) {
  const options: FilterOption[] = candidates.map((c) => ({ value: String(c.id), label: c.name }))

  return (
    <FilterDropdown
      id={id}
      label={label}
      ariaLabel={ariaLabel}
      value=""
      options={options}
      onChange={(v) => {
        if (v) onAdd(Number(v))
      }}
      searchable
      onQueryChange={onQueryChange}
      hideLabel={hideLabel}
      placeholderLabel={placeholder}
    />
  )
}
