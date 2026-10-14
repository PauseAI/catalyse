'use client'

import { useEffect, useState, Suspense, FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { useAuth } from '@/lib/auth-context'
import Button from '@/components/Button'
import ResendConfirmation from '@/components/ResendConfirmation'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { user } = useAuth()

  const [resendEmail, setResendEmail] = useState('')
  const [resendSent, setResendSent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const verifyMutation = useMutation({
    ...orpc.auth.verifyEmail.mutationOptions(),
  })

  const resendMutation = useMutation({
    ...orpc.auth.resendVerification.mutationOptions(),
    onSettled: () => {
      setResendSent(true)
      setResendCooldown(60)
    },
  })

  useEffect(() => {
    if (!token) return
    verifyMutation.mutate({ token })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  function handleResend(e: FormEvent) {
    e.preventDefault()
    resendMutation.mutate({ email: resendEmail })
  }

  if (token && verifyMutation.isPending && !verifyMutation.isSuccess) {
    return (
      <div className="bg-surface rounded-xl shadow p-8 text-center">
        <p className="text-text-light">Confirming your email address…</p>
      </div>
    )
  }

  if (verifyMutation.isSuccess && verifyMutation.data.requiresPasswordReset) {
    return (
      <div className="bg-surface rounded-xl shadow p-8 text-center">
        <h1>Email confirmed!</h1>
        <p className="text-text-light mt-4 mb-6">
          This address has admin access, so to keep it safe we&#39;ve signed the account out
          everywhere and cleared its password. Set a new password, or sign in with Google.
        </p>
        <Button href="/forgot-password">Set a new password</Button>
      </div>
    )
  }

  if (verifyMutation.isSuccess) {
    return (
      <div className="bg-surface rounded-xl shadow p-8 text-center">
        <h1>Email confirmed!</h1>
        <p className="text-text-light mt-4 mb-6">
          Your email address has been confirmed. Your application is now under review, we&#39;ll
          notify you by email once it&#39;s been assessed.
        </p>
        <p className="text-text-light mb-6">In the meantime, you can browse available projects.</p>
        <Button href="/projects">Browse projects</Button>
      </div>
    )
  }

  const awaitingConfirmation = Boolean(user && !user.emailConfirmed)
  const errorMessage =
    verifyMutation.error instanceof Error
      ? verifyMutation.error.message
      : token
        ? 'Email confirmation failed'
        : awaitingConfirmation
          ? 'Open the link in the email we sent to confirm your address.'
          : 'Enter your email below to receive a confirmation link.'

  const alreadyUsed = errorMessage.includes('already been used')

  return (
    <div className="bg-surface rounded-xl shadow p-8 text-center">
      <h1 className={token ? 'text-error' : undefined}>
        {token ? 'Confirmation failed' : 'Confirm your email'}
      </h1>
      <p className="text-text-light mt-4 mb-6">{errorMessage}</p>
      {!alreadyUsed && user && awaitingConfirmation && (
        <div className="mt-2 pt-6 border-t border-border">
          <p className="text-text-light text-sm mb-3">
            We&#39;ll send a new link to <strong>{user.email}</strong>.
          </p>
          <ResendConfirmation email={user.email} />
        </div>
      )}
      {!alreadyUsed && !awaitingConfirmation && (
        <div className="mt-2 pt-6 border-t border-border text-left">
          {resendSent ? (
            <p className="text-text-light text-sm text-center">
              {resendCooldown > 0
                ? `Email sent! You can request another in ${resendCooldown}s.`
                : 'Email sent! Check your inbox.'}
            </p>
          ) : (
            <>
              <p className="text-text-light text-sm mb-3">Request a new confirmation link:</p>
              <form onSubmit={handleResend} className="flex gap-2">
                <input
                  type="email"
                  required
                  placeholder="Your email address"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  className="flex-1 border border-border rounded px-3 py-2 text-sm bg-background"
                />
                <Button type="submit" disabled={resendCooldown > 0} variant="outline">
                  Send
                </Button>
              </form>
            </>
          )}
        </div>
      )}
      {alreadyUsed && (
        <Button href="/login" variant="outline">
          Go to login
        </Button>
      )}
      <p className="text-text-light text-sm mt-6">
        Questions? Contact{' '}
        <a href="mailto:uk@pauseai.info" className="underline">
          uk@pauseai.info
        </a>
      </p>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <main className="container py-5 pb-15">
      <div className="max-w-lg mx-auto">
        <Suspense
          fallback={
            <div className="bg-surface rounded-xl shadow p-8 text-center">
              <p className="text-text-light">Loading…</p>
            </div>
          }
        >
          <VerifyEmailContent />
        </Suspense>
      </div>
    </main>
  )
}
