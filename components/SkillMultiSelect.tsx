'use client'

import { useQuery } from '@tanstack/react-query'
import FilterDropdown, { type FilterOption } from '@/components/FilterDropdown'
import { orpc } from '@/lib/orpc'

/**
 * Picks any number of skills: type to filter the list, pick one to add it, and remove it again
 * with its chip's button. Each pick returns focus to the field, so a keyboard can add several.
 */
export default function SkillMultiSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number[]
  onChange: (skillIds: number[]) => void
}) {
  const { data: categories = [] } = useQuery(orpc.skills.list.queryOptions())
  const names = new Map(categories.flatMap((c) => c.skills.map((s) => [s.id, s.name])))
  const options: FilterOption[] = categories.flatMap((c) => {
    const left = c.skills.filter((s) => !value.includes(s.id))
    if (!left.length) return []
    return [
      { value: `category-${c.id}`, label: c.name, header: true },
      ...left.map((s) => ({ value: String(s.id), label: s.name, indent: true })),
    ]
  })
  const remove = (skillId: number) => {
    onChange(value.filter((x) => x !== skillId))
    document.getElementById(id)?.focus()
  }

  return (
    <div>
      <FilterDropdown
        id={id}
        label={label}
        ariaLabel={label}
        value=""
        placeholderLabel={value.length ? 'Add another skill' : 'Add a skill'}
        options={options}
        searchable
        onChange={(v) => onChange([...value, Number(v)])}
      />
      {value.length > 0 && (
        <ul
          aria-label={`${label}: chosen`}
          className="flex flex-wrap gap-2 list-none p-0 mt-2 mb-0"
        >
          {value.map((skillId) => {
            const name = names.get(skillId) ?? 'A removed skill'
            return (
              <li
                key={skillId}
                className="inline-flex items-center gap-1 pl-3 pr-1 py-0.5 rounded-full bg-accent text-sm"
              >
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => remove(skillId)}
                  className="w-6 h-6 rounded-full hover:bg-brand-border focus:outline-2 focus:outline-secondary"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
