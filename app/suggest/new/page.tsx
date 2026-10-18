'use client'

import { useRequireAuth } from '@/lib/hooks/auth'
import ProjectEditor from '@/components/ProjectEditor'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'

export default function SuggestNewProjectPage() {
  const { user, loading } = useRequireAuth()

  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <H1 role="heading">Propose a project</H1>
      <P>
        Have an idea for something PauseAI should do? Propose it here! Our team will review it and,
        if approved, it&apos;ll be visible to all volunteers.
      </P>

      <div className="max-w-4xl">
        <ProjectEditor variant="volunteer" />
      </div>
    </main>
  )
}
