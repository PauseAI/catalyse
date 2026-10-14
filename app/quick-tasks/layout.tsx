import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Quick tasks' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
