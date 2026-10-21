'use client'

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRequireConfirmed } from '@/lib/hooks/auth'
import { useDocumentTitle } from '@/lib/hooks/useDocumentTitle'
import { orpc } from '@/lib/orpc'
import ProjectEditor from '@/components/ProjectEditor'
import { H1 } from '@/components/Heading'

export default function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = use(params)
  const projectId = parseInt(idParam, 10)
  const { user, loading } = useRequireConfirmed()
  // The same query ProjectEditor makes, so it is fetched once.
  const { data: project } = useQuery({
    ...orpc.projects.getById.queryOptions({ input: { id: projectId } }),
    enabled: !!user,
  })
  useDocumentTitle(project && `Edit ${project.title}`)

  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <H1 role="heading">Edit project</H1>
      <ProjectEditor projectId={projectId} />
    </main>
  )
}
