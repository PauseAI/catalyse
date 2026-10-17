'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import type { DuplicateReason } from '@/lib/duplicate-accounts'
import { formatDate } from '@/lib/format-date'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

const REASON_LABELS: Record<DuplicateReason, string> = {
  name: 'Same name',
  discord: 'Same Discord handle',
  phone: 'Same phone number',
}

/**
 * Pairs of accounts that look like one person, for a global admin to settle: keep one and mark
 * the other as its duplicate, or say they are two people. With `volunteerId`, that account's.
 */
export default function DuplicatePairs({
  volunteerId,
  emptyText,
}: {
  volunteerId?: number
  emptyText: string
}) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const { data: pairs } = useQuery(
    orpc.admin.volunteers.possibleDuplicates.queryOptions({ input: { volunteerId } }),
  )
  const settled = {
    onSuccess: async (r: { message: string }) => {
      showToast(r.message, 'success')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.admin.volunteers.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.admin.overview.key() }),
      ])
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error'),
  }
  const mark = useMutation({ ...orpc.admin.volunteers.markDuplicate.mutationOptions(), ...settled })
  const dismiss = useMutation({
    ...orpc.admin.volunteers.dismissDuplicate.mutationOptions(),
    ...settled,
  })
  const busy = mark.isPending || dismiss.isPending

  if (!pairs) return null
  if (pairs.length === 0) return <p className="text-text-light m-0">{emptyText}</p>

  return (
    <ul className="list-none p-0 m-0 grid gap-4">
      {pairs.map(({ a, b, reasons }) => (
        <li key={`${a.id}-${b.id}`} className="border border-brand-border rounded-lg p-4">
          <p className="text-sm text-text-light mt-0 mb-3">
            {reasons.map((r) => REASON_LABELS[r]).join(' · ')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [a, b],
              [b, a],
            ].map(([account, other]) => (
              <div
                key={account.id}
                role="group"
                aria-label={account.email ?? account.name}
                className="flex flex-col items-start gap-1 overflow-hidden wrap-break-word"
              >
                <Link href={`/admin/volunteers/${account.id}`}>{account.name}</Link>
                {account.email && <span className="text-sm">{account.email}</span>}
                <span className="text-sm text-text-light">
                  {[
                    account.chapterName ?? 'Holding pool',
                    account.role,
                    account.createdAt && `joined ${formatDate(account.createdAt)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <Button
                  size="sm"
                  className="mt-1"
                  disabled={busy}
                  onClick={() => mark.mutate({ id: other.id, duplicateOfId: account.id })}
                >
                  Keep this account
                </Button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            disabled={busy}
            onClick={() => dismiss.mutate({ ids: [a.id, b.id] })}
          >
            Not the same person
          </Button>
        </li>
      ))}
    </ul>
  )
}
