import type { Metadata } from 'next'

// Generic: who may see a project is decided per viewer, and the server render has none.
// The page titles the tab once the project loads (useDocumentTitle).
export const metadata: Metadata = { title: 'Project' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
