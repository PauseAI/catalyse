'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { SECTION_CARD } from '@/lib/ui-classes'
import Button from '@/components/Button'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [clientError, setClientError] = useState('')

  const mutation = useMutation({
    ...orpc.auth.resetPassword.mutationOptions(),
    onSuccess: () => router.push('/login'),
  })

  if (!token) {
    return (
      <div className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word text-center`}>
        <h3 className="text-error">Invalid link</h3>
        <p className="text-text-light my-4">
          This reset link is invalid or has expired. Please request a new one.
        </p>
        <Button href="/forgot-password" variant="outline">
          Request New Link
        </Button>
      </div>
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setClientError('')

    if (password !== passwordConfirm) {
      setClientError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setClientError('Password must be at least 8 characters')
      return
    }

    mutation.mutate({ token: token!, newPassword: password })
  }

  const error =
    clientError ||
    (mutation.error instanceof Error
      ? mutation.error.message
      : mutation.error
        ? 'Reset failed'
        : '')

  return (
    <form
      method="post"
      className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word`}
      onSubmit={handleSubmit}
    >
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 p-4 rounded-lg mb-4 bg-red-100 text-red-800 border border-red-300 dark:bg-red-900 dark:text-red-300 dark:border-red-600"
        >
          {error}
        </div>
      )}

      <div className="mb-5">
        <label htmlFor="password" className="required">
          New Password
        </label>
        <input
          type="password"
          id="password"
          name="password"
          required
          minLength={8}
          autoFocus
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="mb-5">
        <label htmlFor="password_confirm" className="required">
          Confirm Password
        </label>
        <input
          type="password"
          id="password_confirm"
          name="password_confirm"
          required
          minLength={8}
          placeholder="Type your password again"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Resetting…' : 'Reset Password'}
      </Button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <>
      <main className="container py-5 pb-15">
        <div className="sm:max-w-[400px] my-15 mx-auto">
          <h1 className="text-center">Set new password</h1>
          <Suspense fallback={<div className="text-center py-10 text-text-light">Loading…</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </main>
    </>
  )
}
