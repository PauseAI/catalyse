'use client'

import { useEffect } from 'react'
import Button from '@/components/Button'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'

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
        <H1>Something went wrong</H1>
        <P className="text-text-light mb-8">
          An unexpected error occurred. You can try again, or head back home.
        </P>
        <div className="flex flex-col gap-3 items-center">
          <Button onClick={reset}>Try again</Button>
          <Button href="/" variant="outline">
            Go home
          </Button>
        </div>
      </div>
    </main>
  )
}
