'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { useAuth } from '@/lib/auth-context'
import Button from '@/components/Button'

const CARD = 'bg-surface rounded-xl shadow p-8 text-center'

/**
 * Where the link in a merge email lands. It asks before merging, so a mail scanner that follows
 * the link merges nothing.
 */
function MergeAccountsContent() {
  const token = useSearchParams().get('token') ?? ''
  const { user, refreshUser } = useAuth()
  const [signInWith, setSignInWith] = useState<'kept' | 'merged'>('kept')
  const preview = useQuery({
    ...orpc.accountMerges.preview.queryOptions({ input: { token } }),
    enabled: !!token,
    retry: false,
  })
  const confirm = useMutation({
    ...orpc.accountMerges.confirm.mutationOptions(),
    // A session on the merged account has ended; asking again clears it from this tab.
    onSuccess: () => refreshUser(),
  })

  if (confirm.isSuccess) {
    const { email, signedOut } = confirm.data
    const stillSignedIn = !!user && !signedOut
    return (
      <div className={CARD}>
        <h1>Accounts merged</h1>
        <p className="text-text-light mt-4 mb-6">
          Everything is in one account now. Sign in to it as {email ?? 'before'}.
        </p>
        {stillSignedIn ? (
          <Button href="/dashboard">Go to your dashboard</Button>
        ) : (
          <Button href="/login">Sign in</Button>
        )}
      </div>
    )
  }

  if (!token || preview.isError) {
    return (
      <div className={CARD}>
        <h1>This link doesn&#39;t work</h1>
        <p className="text-text-light mt-4">
          {preview.error instanceof Error ? preview.error.message : 'The link is missing its code'}.
        </p>
        <p className="text-text-light mt-2 mb-6">
          Sign in and ask for a new one from the prompt to merge your accounts.
        </p>
        <Button href="/login">Sign in</Button>
      </div>
    )
  }

  if (!preview.data) {
    return (
      <div className={CARD}>
        <p className="text-text-light">Loading…</p>
      </div>
    )
  }

  const { keptName, keptEmail, mergedName, mergedEmail } = preview.data
  return (
    <div className={CARD}>
      <h1>Merge your accounts</h1>
      <p className="text-text-light mt-4">
        {mergedName} ({mergedEmail}) and {keptName} ({keptEmail}) will become one account, with the
        projects, tasks, teams and messages of both.
      </p>
      {keptEmail && mergedEmail && (
        <fieldset className="mt-6 text-left">
          <legend className="font-semibold mb-2">Sign in from then on with</legend>
          {(
            [
              ['kept', keptEmail],
              ['merged', mergedEmail],
            ] as const
          ).map(([value, address]) => (
            <label key={value} className="flex items-center gap-2 py-1">
              <input
                type="radio"
                name="sign-in-with"
                value={value}
                checked={signInWith === value}
                onChange={() => setSignInWith(value)}
              />
              {address}
            </label>
          ))}
          <p className="text-text-light text-sm mt-2">
            With its password, if it has one. The other address stops working.
          </p>
        </fieldset>
      )}
      {confirm.error instanceof Error && (
        <p className="text-error mt-4" role="alert">
          {confirm.error.message}
        </p>
      )}
      <div className="mt-6">
        <Button onClick={() => confirm.mutate({ token, signInWith })} disabled={confirm.isPending}>
          {confirm.isPending ? 'Merging…' : 'Merge accounts'}
        </Button>
      </div>
    </div>
  )
}

export default function MergeAccountsPage() {
  return (
    <main className="container py-5 pb-15">
      <div className="max-w-lg mx-auto">
        <Suspense fallback={null}>
          <MergeAccountsContent />
        </Suspense>
      </div>
    </main>
  )
}
