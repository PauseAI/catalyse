import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Calls for volunteers' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
