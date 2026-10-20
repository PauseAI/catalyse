'use client'

import { use } from 'react'
import Link from 'next/link'
import ProjectPorting from '@/components/ProjectPorting'
import { useRequireConfirmed } from '@/lib/hooks/auth'
import PageLoading from '@/components/PageLoading'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'

/**
 * A linkable home for the export/import round trip. The same flow is available as a modal from
 * the project sidebar; this page keeps it addressable, which is what `_meta.docs` on every
 * export points at.
 */
export default function ProjectImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = use(params)
  const projectId = parseInt(idParam, 10)
  const { user, loading } = useRequireConfirmed()

  if (loading || !user) return <PageLoading />

  return (
    <main className="container py-5 pb-15">
      <H1 role="heading">Export and import</H1>
      <P className="text-text-light mb-4">
        Take the project out as a file, edit it, and put it back. You&apos;ll see exactly what would
        change before anything is written.{' '}
        <Link className="text-primary-text underline" href={`/projects/${projectId}`}>
          Back to project
        </Link>
      </P>

      <ProjectPorting projectId={projectId} />
    </main>
  )
}
