'use client'

import { useEffect } from 'react'
import Button from '@/components/Button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="container py-5 pb-15">
      <div className="max-w-[400px] my-15 mx-auto text-center">
        <h1>Something went wrong</h1>
        <p className="text-text-light mb-8">
          An unexpected error occurred. You can try again, or head back home.
        </p>
        <div className="flex flex-col gap-3 items-center">
          <Button onClick={reset}>Try Again</Button>
          <Button href="/" variant="outline">
            Go Home
          </Button>
        </div>
      </div>
    </main>
  )
}
