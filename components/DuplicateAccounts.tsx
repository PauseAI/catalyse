'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Button from '@/components/Button'
import DuplicatePairs from '@/components/DuplicatePairs'
import FullVolunteerSelect from '@/components/FullVolunteerSelect'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'
import { H3, H4 } from '@/components/Heading'
import { P } from '@/components/Text'

export interface Account {
  id: number
  name: string
  email: string | null
}

function AccountLink({ account }: { account: Account }) {
  return (
    <>
      <Link className="text-primary-text underline" href={`/admin/volunteers/${account.id}`}>
        {account.name}
      </Link>
      {account.email && <span className="text-text-light text-sm"> · {account.email}</span>}
    </>
  )
}

/**
 * The other accounts held by the same person. A global admin marks this account as a duplicate
 * of the one to keep, or clears the mark; chapter staff only see what has been marked.
 */
export default function DuplicateAccounts({
  volunteer,
  canMark,
  onChange,
}: {
  volunteer: Account & { duplicateOf: Account | null; duplicates: Account[] }
  canMark: boolean
  onChange: () => Promise<unknown>
}) {
  const showToast = useToast()
  const [keeperId, setKeeperId] = useState('')
  const mark = useMutation({
    ...orpc.admin.volunteers.markDuplicate.mutationOptions(),
    onSuccess: async (r) => {
      showToast(r.message, 'success')
      setKeeperId('')
      await onChange()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error'),
  })
  const { duplicateOf, duplicates } = volunteer
  if (!canMark && !duplicateOf && duplicates.length === 0) return null

  return (
    <section className={`${SECTION_CARD} mb-6`}>
      <H3 className="mt-0">Duplicate accounts</H3>
      {duplicateOf ? (
        <div className="flex justify-between items-center gap-4 flex-wrap">
          <P className="m-0">
            A second account of <AccountLink account={duplicateOf} />. It cannot be given a chapter
            role.
          </P>
          {canMark && (
            <Button
              size="sm"
              variant="secondary"
              disabled={mark.isPending}
              onClick={() => mark.mutate({ id: volunteer.id, duplicateOfId: null })}
            >
              Not a duplicate
            </Button>
          )}
        </div>
      ) : (
        <>
          {duplicates.length > 0 ? (
            <>
              <P className="mt-0 mb-2">Other accounts of the same person:</P>
              <ul className="list-none p-0 mt-0 mb-4 grid gap-1">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    <AccountLink account={d} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <P className="text-text-light mt-0">
              No other accounts are marked as this person&apos;s.
            </P>
          )}
          {canMark && (
            <div className="mb-4">
              <H4 className="mt-0 mb-2">Possibly the same person</H4>
              <DuplicatePairs
                volunteerId={volunteer.id}
                emptyText="No other account looks like this one."
              />
            </div>
          )}
          {canMark && (
            <form
              className="flex gap-3 items-end flex-wrap"
              onSubmit={(e) => {
                e.preventDefault()
                mark.mutate({ id: volunteer.id, duplicateOfId: Number(keeperId) })
              }}
            >
              <FullVolunteerSelect
                id="duplicate-of"
                label="Mark as a duplicate of"
                ariaLabel="Mark as a duplicate of"
                value={keeperId}
                onChange={setKeeperId}
                placeholder="Choose the account to keep"
              />
              <Button type="submit" disabled={!keeperId || mark.isPending}>
                Mark as duplicate
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  )
}
