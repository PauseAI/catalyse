'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Button from '@/components/Button'
import { P } from '@/components/Text'
import { orpc } from '@/lib/orpc'

/** Sends a fresh confirmation link to an address the site already knows, at most once a minute. */
export default function ResendConfirmation({ email }: { email: string }) {
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const resendMutation = useMutation({
    ...orpc.auth.resendVerification.mutationOptions(),
    onSettled: () => {
      setSent(true)
      setCooldown(60)
    },
  })

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant="outline"
        onClick={() => resendMutation.mutate({ email })}
        disabled={cooldown > 0 || resendMutation.isPending}
      >
        Send it again
      </Button>
      {sent && (
        <P role="status" className="text-text-light text-sm m-0">
          {cooldown > 0
            ? `Email sent! You can request another in ${cooldown}s.`
            : 'Email sent! Check your inbox.'}
        </P>
      )}
    </div>
  )
}
