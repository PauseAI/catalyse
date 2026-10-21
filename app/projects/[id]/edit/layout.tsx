import type { Metadata } from 'next'

// Generic for the reason in ../layout.tsx.
export const metadata: Metadata = { title: 'Edit project' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
