'use client'

import { useRequireAdmin } from '@/lib/hooks/auth'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'
import TextLink from '@/components/TextLink'

export default function StorybookAdminPage() {
  const { user, token, loading } = useRequireAdmin()
  if (loading || !user?.isAdmin) return null

  const viewUrl = `/admin/storybook/view/?token=${encodeURIComponent(token ?? '')}`

  return (
    <main className="container pt-8 pb-16">
      <H1 className="mb-1">Storybook</H1>
      <P className="text-text-light mb-4">
        The component catalogue and audit built from main, opened in a new tab.
      </P>
      <TextLink href={viewUrl} target="_blank" rel="noreferrer">
        Open Storybook ↗
      </TextLink>
    </main>
  )
}
