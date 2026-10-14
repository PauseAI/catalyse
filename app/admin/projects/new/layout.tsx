import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin · New project' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
