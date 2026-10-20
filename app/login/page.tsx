'use client'

import { useState, useEffect, useCallback, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Script from 'next/script'
import { useQuery, useMutation } from '@tanstack/react-query'
import Button from '@/components/Button'
import FormLabel from '@/components/FormLabel'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'
import Input from '@/components/ui/Input'
import { useAuth } from '@/lib/auth-context'
import { orpc } from '@/lib/orpc'
import { SECTION_CARD } from '@/lib/ui-classes'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  )
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading, setToken } = useAuth()
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [user, loading, router])

  const { data: googleClientIdData } = useQuery({
    ...orpc.auth.googleClientId.queryOptions(),
    staleTime: Infinity,
  })
  const googleClientId = googleClientIdData?.clientId ?? ''

  const loginMutation = useMutation({
    ...orpc.auth.login.mutationOptions(),
    onSuccess: async (data) => {
      await setToken(data.token)
      router.push('/dashboard')
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Login failed'),
  })
  const submitting = loginMutation.isPending

  const googleSignInMutation = useMutation({
    ...orpc.auth.google.mutationOptions(),
    onSuccess: async (data, variables) => {
      if (data.isPending) {
        // No account exists yet — hand off to the signup page's application form
        // rather than creating one now, so a Google sign-in never bypasses the
        // mandatory application fields.
        sessionStorage.setItem(
          'google_pending_auth',
          JSON.stringify({
            credential: variables.credential,
            stub: variables.stub,
            name: data.name,
            email: data.email,
          }),
        )
        router.push('/signup')
      } else if (data.token) {
        await setToken(data.token)
        router.push('/dashboard')
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Google sign-in failed'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    loginMutation.mutate({ email: email.trim(), password })
  }

  const handleGoogleResponse = useCallback(
    (response: { credential: string }) => {
      googleSignInMutation.mutate({ credential: response.credential })
    },
    [googleSignInMutation],
  )

  const initGoogleButton = useCallback(() => {
    const win = window as Window &
      typeof globalThis & {
        google?: {
          accounts: {
            id: {
              initialize: (c: unknown) => void
              renderButton: (el: Element | null, opts: unknown) => void
            }
          }
        }
      }
    if (!win.google?.accounts?.id || !googleClientId) return
    win.google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleResponse })
    const btnEl = document.getElementById('g_signin_btn')
    const btnWidth = Math.min(400, Math.max(200, btnEl?.offsetWidth ?? 350))
    win.google.accounts.id.renderButton(btnEl, {
      theme: 'outline',
      size: 'large',
      width: btnWidth,
      text: 'sign_in_with',
    })
  }, [googleClientId, handleGoogleResponse])

  useEffect(() => {
    initGoogleButton()
  }, [initGoogleButton])

  if (loading) return null

  return (
    <>
      {googleClientId && (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={initGoogleButton}
        />
      )}
      <main className="container py-5 pb-15">
        <div className="sm:max-w-[400px] my-15 mx-auto">
          <H1 className="text-center">Welcome back</H1>
          <P className="text-center text-text-light mb-8">
            Login to access your dashboard and projects.
          </P>

          {error && (
            <div
              role="alert"
              className="flex items-center gap-3 p-4 rounded-lg mb-4 bg-red-100 text-red-800 border border-red-300 dark:bg-red-900 dark:text-red-300 dark:border-red-600"
            >
              {error}
            </div>
          )}

          <div className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word`}>
            {googleClientId && (
              <div className="text-center mb-5">
                <div id="g_signin_btn" className="flex justify-center" />
                <div className="flex items-center my-5 gap-4">
                  <hr className="flex-1 border-none border-t border-brand-border" />
                  <span className="text-text-light text-sm">or use email</span>
                  <hr className="flex-1 border-none border-t border-brand-border" />
                </div>
              </div>
            )}

            <form method="post" onSubmit={handleSubmit}>
              <div className="mb-5">
                <FormLabel htmlFor="email" required>
                  Email
                </FormLabel>
                <Input
                  type="email"
                  id="email"
                  name="email"
                  required
                  autoFocus={!email}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="mb-5">
                <FormLabel htmlFor="password" required>
                  Password
                </FormLabel>
                <Input
                  type="password"
                  id="password"
                  name="password"
                  required
                  autoFocus={!!email}
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Logging in…' : 'Login'}
              </Button>

              <P className="text-center mt-4">
                <Link className="text-primary-text underline" href="/forgot-password">
                  Forgot your password?
                </Link>
              </P>
              <P className="text-center text-text-light mt-3">
                Don&apos;t have an account?{' '}
                <Link className="text-primary-text underline" href="/signup">
                  Sign up
                </Link>
              </P>
            </form>
          </div>
        </div>
      </main>
    </>
  )
}
