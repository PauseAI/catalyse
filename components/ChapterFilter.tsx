'use client'

import { useQuery } from '@tanstack/react-query'
import FilterDropdown from '@/components/FilterDropdown'
import { orpc } from '@/lib/orpc'

/** A chapter filter's value as a query takes it: '' is every chapter. */
export function chapterSelection(value: string): number | 'pool' | undefined {
  if (value === 'pool') return 'pool'
  return value ? Number(value) : undefined
}

/** For a global admin, who sees every chapter: narrows a list to one, or to the holding pool. */
export default function ChapterFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { data: chapters = [] } = useQuery(orpc.chapters.list.queryOptions())
  return (
    <FilterDropdown
      id="chapter-filter"
      label="Chapter"
      ariaLabel="Chapter filter"
      value={value}
      options={[
        { value: '', label: 'All chapters' },
        ...chapters.map((c) => ({ value: String(c.id), label: c.name })),
        { value: 'pool', label: 'Holding pool' },
      ]}
      onChange={onChange}
      searchable
    />
  )
}
