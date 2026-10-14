'use client'

import { use } from 'react'
import { useRequireConfirmed } from '@/lib/hooks/auth'
import ProjectEditor from '@/components/ProjectEditor'

export default function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = use(params)
  const { user, loading } = useRequireConfirmed()

  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <h1 role="heading">Edit project</h1>
      <ProjectEditor projectId={parseInt(idParam, 10)} />
    </main>
  )
}
