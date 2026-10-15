import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Verify email' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
