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
}

/**
 * Typeahead over a fixed, already-fetched candidate list — unlike `VolunteerSelect`, which
 * searches the whole directory on the server. Typing filters the list; Enter or a click on a
 * result adds that candidate immediately, so nothing is held as a persisted selection and the
 * trigger always reads as `placeholder`.
 */
export default function MemberPicker({
  id,
  label,
  ariaLabel,
  candidates,
  onAdd,
  placeholder = 'Add a member',
  hideLabel,
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
      hideLabel={hideLabel}
      placeholderLabel={placeholder}
    />
  )
}
