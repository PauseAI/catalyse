'use client'

import { Suspense } from 'react'
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
    const { keptEmail, signedOut } = confirm.data
    const stillSignedIn = !!user && !signedOut
    return (
      <div className={CARD}>
        <h1>Accounts merged</h1>
        <p className="text-text-light mt-4 mb-6">
          Everything is in one account now. Sign in to it as {keptEmail ?? 'before'}.
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
        <p className="text-text-light mt-4 mb-6">
          {preview.error instanceof Error ? preview.error.message : 'The link is missing its code.'}{' '}
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
        {mergedName} ({mergedEmail}) will be merged into {keptName} ({keptEmail}). Its projects,
        tasks, teams and messages move across, and you sign in as {keptEmail} from then on.
      </p>
      {confirm.error instanceof Error && (
        <p className="text-error mt-4" role="alert">
          {confirm.error.message}
        </p>
      )}
      <div className="mt-6">
        <Button onClick={() => confirm.mutate({ token })} disabled={confirm.isPending}>
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
