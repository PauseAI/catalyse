'use client'

import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import Button from '@/components/Button'
import { H2 } from '@/components/Heading'
import { P } from '@/components/Text'
import { useAuth } from '@/lib/auth-context'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'

/** The viewer-specific parts of the privacy page: the session is only known in the browser. */
export function ExportData() {
  const { user } = useAuth()
  const showToast = useToast()

  const exportMutation = useMutation({
    ...orpc.privacy.export.mutationOptions(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `catalyse-data-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('Data exported successfully!', 'success')
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error')
    },
  })

  if (!user) return null

  return (
    <div className={`${SECTION_CARD} overflow-hidden wrap-break-word mb-6`}>
      <H2>Export your data</H2>
      <P className="text-text-light mb-4">
        Download all your data in JSON format. This includes your profile, skills, projects and
        tasks, messages, comments, and notes admins have written about you.
      </P>
      <Button
        variant="secondary"
        onClick={() => exportMutation.mutate({})}
        disabled={exportMutation.isPending}
      >
        {exportMutation.isPending ? 'Preparing…' : 'Download my data'}
      </Button>
    </div>
  )
}

export function LogInPrompt() {
  const { user, loading } = useAuth()
  if (loading || user) return null

  return (
    <div className={`${SECTION_CARD} overflow-hidden wrap-break-word text-center mb-6`}>
      <P className="text-text-light">
        <Link className="text-primary-text underline" href="/login">
          Log in
        </Link>{' '}
        to export your data or manage your account.
      </P>
    </div>
  )
}
