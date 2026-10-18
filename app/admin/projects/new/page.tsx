'use client'

import { useRequireStaff } from '@/lib/hooks/auth'
import { useRouter } from 'next/navigation'
import ProjectEditor from '@/components/ProjectEditor'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'

export default function AdminCreateProjectPage() {
  const router = useRouter()
  const { user, loading } = useRequireStaff()

  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <H1 role="heading">Org projects</H1>
      <P className="text-text-light mb-6">
        Create a project on behalf of PauseAI. This skips the approval process.
      </P>

      <div className="max-w-4xl">
        <ProjectEditor variant="admin" onCancel={() => router.push('/admin/projects')} />
      </div>
    </main>
  )
}
