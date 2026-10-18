'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { client } from '@/lib/client'
import { OUTREACH_PATH, OUTREACH_TOKEN_STORAGE_KEY } from '@/lib/journalist-outreach'
import Button from '@/components/Button'
import { H3 } from '@/components/Heading'
import { P } from '@/components/Text'

function Verify() {
  const router = useRouter()
  const token = useSearchParams().get('token')
  const [error, setError] = useState(token ? '' : 'This link is missing its token.')
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    client.journalistOutreach
      .verify({ token })
      .then((res) => {
        localStorage.setItem(OUTREACH_TOKEN_STORAGE_KEY, res.token)
        router.replace(OUTREACH_PATH)
      })
      .catch((err: Error) => setError(err.message))
  }, [token, router])

  if (!error) return <P className="text-center py-10 text-text-light">Signing you in…</P>
  return (
    <div className="bg-surface rounded-xl shadow p-4 sm:p-6 text-center">
      <H3 className="text-error">Link not valid</H3>
      <P className="text-text-light my-4">{error}</P>
      <Button href={OUTREACH_PATH} variant="outline">
        Request a new link
      </Button>
    </div>
  )
}

export default function OutreachVerifyPage() {
  return (
    <main className="container py-5 pb-15">
      <div className="max-w-[400px] my-15 mx-auto">
        <Suspense fallback={null}>
          <Verify />
        </Suspense>
      </div>
    </main>
  )
}
