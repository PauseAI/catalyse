import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin · Journalist outreach' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
