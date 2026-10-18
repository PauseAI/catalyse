'use client'

import { useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth-context'
import { orpc } from '@/lib/orpc'
import { SECTION_CARD } from '@/lib/ui-classes'
import Button from '@/components/Button'
import { H2 } from '@/components/Heading'
import { P } from '@/components/Text'

function AcceptInviteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { user, loading } = useAuth()

  const mutation = useMutation({
    ...orpc.admin.admins.acceptInvite.mutationOptions(),
  })

  function getStatus() {
    if (loading) return 'loading'
    if (!token) return 'error'
    if (!user) return 'needs-login'
    if (mutation.isPending || mutation.isIdle) return 'loading'
    if (mutation.isSuccess) return 'success'
    return 'error'
  }
  const status = getStatus()

  useEffect(() => {
    if (loading || !token || !user) return
    mutation.mutate({ inviteToken: token })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, token])

  useEffect(() => {
    if (status === 'success') {
      const t = setTimeout(() => router.push('/dashboard'), 2000)
      return () => clearTimeout(t)
    }
  }, [status, router])

  if (status === 'loading') {
    return (
      <div className="text-center py-10 text-text-light">
        <div className="spinner" />
        Processing invite…
      </div>
    )
  }

  if (status === 'needs-login') {
    const redirectUrl =
      typeof window !== 'undefined' ? encodeURIComponent(window.location.href) : ''
    return (
      <div className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word text-center`}>
        <H2>Chapter staff invite</H2>
        <P className="text-text-light my-4">
          You&apos;ve been invited to help run a national chapter on Catalyse.
        </P>
        <P className="mb-6">Please log in or sign up with the invited email address to accept.</P>
        <Button href={`/login?redirect=${redirectUrl}`}>Log in</Button>
        <Button href={`/signup?redirect=${redirectUrl}`} variant="outline" className="ml-2">
          Sign up
        </Button>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word text-center`}>
        <H2>Welcome to the team!</H2>
        <P className="text-text-light my-4">You now help run your chapter. Redirecting…</P>
        <Button href="/admin/triage">Go to admin dashboard</Button>
      </div>
    )
  }

  const errorMsg = !token
    ? 'This link is missing its invite code. Open the link from your invite email again.'
    : mutation.error instanceof Error
      ? mutation.error.message
      : 'Failed to accept invite'

  return (
    <div className={`${SECTION_CARD} mb-4 overflow-hidden wrap-break-word text-center`}>
      <H2>Invite not accepted</H2>
      <P className="my-4 text-error">{errorMsg}</P>
      <P className="text-text-light text-sm mb-6">
        Need help? Contact{' '}
        <a href="mailto:uk@pauseai.info" className="underline">
          uk@pauseai.info
        </a>
        .
      </P>
      <Button href="/" variant="outline">
        Back to home
      </Button>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <>
      <main className="container py-5 pb-15">
        <div className="sm:max-w-[500px] my-15 mx-auto text-center">
          <Suspense fallback={<div className="text-center py-10 text-text-light">Loading…</div>}>
            <AcceptInviteContent />
          </Suspense>
        </div>
      </main>
    </>
  )
}
