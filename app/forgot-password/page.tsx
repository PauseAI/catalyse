'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { SECTION_CARD } from '@/lib/ui-classes'
import Button from '@/components/Button'
import FormLabel from '@/components/FormLabel'
import { H1, H3 } from '@/components/Heading'
import Input from '@/components/ui/Input'
import { P } from '@/components/Text'
import TextLink from '@/components/TextLink'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [devUrl, setDevUrl] = useState('')

  const mutation = useMutation({
    ...orpc.auth.forgotPassword.mutationOptions(),
    onSuccess: (data) => {
      if (data._devResetUrl) setDevUrl(data._devResetUrl)
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate({ email: email.trim() })
  }

  return (
    <>
      <main className="container py-5 pb-15">
        <div className="sm:max-w-[400px] my-15 mx-auto">
          <H1 className="text-center">Reset password</H1>
          <P className="text-center text-text-light mb-8">
            Enter your email and we&apos;ll send you a reset link.
          </P>

          {mutation.isError && (
            <div
              role="alert"
              className="flex items-center gap-3 p-4 rounded-lg mb-4 bg-red-100 text-red-800 border border-red-300 dark:bg-red-900 dark:text-red-300 dark:border-red-600"
            >
              {mutation.error instanceof Error ? mutation.error.message : 'Something went wrong'}
            </div>
          )}

          {!mutation.isSuccess ? (
            <form
              className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word`}
              onSubmit={handleSubmit}
            >
              <div className="mb-5">
                <FormLabel htmlFor="email" required>
                  Email
                </FormLabel>
                <Input
                  type="email"
                  id="email"
                  name="email"
                  required
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? 'Sending…' : 'Send reset link'}
              </Button>

              <P className="text-center text-text-light mt-5">
                Remember your password?{' '}
                <Link className="text-primary-text underline" href="/login">
                  Login
                </Link>
              </P>
            </form>
          ) : (
            <div className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word`}>
              <div className="text-center">
                <H3 className="text-success">Check your email</H3>
                <P className="text-text-light my-4">
                  If an account exists with that email, you&apos;ll receive a password reset link
                  shortly.
                </P>
                <Button href="/login" variant="outline">
                  Back to login
                </Button>
                <P className="text-sm text-text-light mt-4">
                  Not receiving the email? Check your spam folder, or{' '}
                  <TextLink href="mailto:matilda@pauseai.info">contact support</TextLink>.
                </P>
              </div>
              {devUrl && (
                <div className="mt-6 pt-4 border-t border-brand-border">
                  <P className="text-[12px] text-text-light">Dev mode, Reset link:</P>
                  <a href={devUrl} className="break-all">
                    {devUrl}
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
