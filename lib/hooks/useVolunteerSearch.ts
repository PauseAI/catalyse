'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

const DEBOUNCE_MS = 300
const RESULT_LIMIT = 20

/**
 * A page of directory matches for a `LocalVolunteerSelect`, searched on the server as the user types.
 * Each candidate's description is their local group and country, or their free-text location,
 * to tell two people of the same name apart.
 */
export function useVolunteerSearch(enabled: boolean) {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input])

  const { data } = useQuery({
    ...orpc.volunteers.list.queryOptions({
      input: { limit: RESULT_LIMIT, search: search || undefined },
    }),
    enabled,
    placeholderData: keepPreviousData,
  })
  const candidates = (data?.volunteers ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    description: [v.localGroup, v.country].filter(Boolean).join(', ') || v.location || undefined,
  }))
  // Clearing applies at once, so a picker reopened straight after a search lists everyone,
  // not the old matches arriving a moment late.
  const setQuery = (q: string) => {
    setInput(q)
    if (q === '') setSearch('')
  }
  return { candidates, setQuery }
}
