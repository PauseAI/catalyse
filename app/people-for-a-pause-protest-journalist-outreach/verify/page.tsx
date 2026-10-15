'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { client } from '@/lib/client'
import { OUTREACH_PATH, OUTREACH_TOKEN_STORAGE_KEY } from '@/lib/journalist-outreach'
import Button from '@/components/Button'

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

  if (!error) return <p className="text-center py-10 text-text-light">Signing you in…</p>
  return (
    <div className="bg-surface rounded-xl shadow p-4 sm:p-6 text-center">
      <h3 className="text-error">Link not valid</h3>
      <p className="text-text-light my-4">{error}</p>
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
