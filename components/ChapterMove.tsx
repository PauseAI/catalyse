'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import FilterDropdown from '@/components/FilterDropdown'
import { COUNTRY_OPTIONS, countryLabel } from '@/lib/filter-options'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

/**
 * Asking to move to another country, and so to its chapter, which decides. Shown inside the
 * profile form, so it submits nothing itself: its buttons are plain buttons.
 */
export default function ChapterMove({ country }: { country: string }) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const { data: pending, isPending } = useQuery(orpc.chapterTransfers.mine.queryOptions())

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.chapterTransfers.mine.key() })
  const onError = (err: unknown) =>
    showToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
  const request = useMutation({
    ...orpc.chapterTransfers.request.mutationOptions(),
    onSuccess: async () => {
      showToast('Request sent', 'success')
      setOpen(false)
      await refresh()
    },
    onError,
  })
  const cancel = useMutation({
    ...orpc.chapterTransfers.cancel.mutationOptions(),
    onSuccess: async () => {
      showToast('Request cancelled', 'success')
      await refresh()
    },
    onError,
  })

  if (isPending) return null
  if (pending) {
    return (
      <p className="text-sm m-0 mt-2" role="status">
        You asked to move to {countryLabel(pending.toCountry)}; its organisers will decide.{' '}
        <Button type="button" size="sm" variant="secondary" onClick={() => cancel.mutate({})}>
          Cancel request
        </Button>
      </p>
    )
  }
  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="mt-2"
        onClick={() => setOpen(true)}
      >
        Moving to another country?
      </Button>
    )
  }
  return (
    <div className="mt-3 grid gap-3">
      <FilterDropdown
        id="move-country"
        label="Country you are moving to"
        ariaLabel="Country you are moving to"
        value={to}
        options={COUNTRY_OPTIONS.filter((o) => o.value !== country)}
        onChange={setTo}
        searchable
      />
      <div>
        <label htmlFor="move-reason">Anything they should know (optional)</label>
        <textarea id="move-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={!to || request.isPending}
          onClick={() => request.mutate({ country: to, reason: reason.trim() || null })}
        >
          Ask to move
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Not now
        </Button>
      </div>
    </div>
  )
}
