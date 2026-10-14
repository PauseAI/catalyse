import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Suggest a local group' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
