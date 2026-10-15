import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Accept invite' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
