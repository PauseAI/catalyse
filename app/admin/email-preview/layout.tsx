import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin · Email preview' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
