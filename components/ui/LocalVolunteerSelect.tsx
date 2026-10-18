'use client'

import FilterDropdown, { FilterOption } from '@/components/FilterDropdown'

/** `description` is a muted line under the name, such as where they are. */
type Candidate = { id: number; name: string; description?: string }

interface Props {
  id: string
  label: string
  ariaLabel: string
  candidates: Candidate[]
  onAdd: (id: number, candidate: Candidate) => void
  placeholder?: string
  hideLabel?: boolean
  /** The typed search text, for a caller that fetches `candidates` to match it. */
  onQueryChange?: (query: string) => void
  /** Mounts open, with focus in the search input. */
  autoFocus?: boolean
  /** The results closed without a pick, by Escape or a click outside. */
  onClose?: (reason: 'escape' | 'outside') => void
}

/**
 * Typeahead over a candidate list the caller already has — unlike `FullVolunteerSelect`, which
 * searches the server. Typing filters the list; Enter or a click on a result adds that
 * candidate immediately, so nothing is held as a persisted selection and the trigger always
 * reads as `placeholder`.
 */
export default function LocalVolunteerSelect({
  id,
  label,
  ariaLabel,
  candidates,
  onAdd,
  placeholder = 'Add a member',
  hideLabel,
  onQueryChange,
  autoFocus,
  onClose,
}: Props) {
  const byValue = new Map(candidates.map((c) => [String(c.id), c]))
  const options: FilterOption[] = candidates.map((c) => ({
    value: String(c.id),
    label: c.name,
    description: c.description,
  }))

  return (
    <FilterDropdown
      id={id}
      label={label}
      ariaLabel={ariaLabel}
      value=""
      options={options}
      onChange={(v) => {
        const picked = byValue.get(v)
        if (picked) onAdd(picked.id, picked)
      }}
      searchable
      onQueryChange={onQueryChange}
      hideLabel={hideLabel}
      placeholderLabel={placeholder}
      defaultOpen={autoFocus}
      onClose={onClose}
    />
  )
}
