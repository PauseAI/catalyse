import Link from 'next/link'
import Button from '@/components/Button'

export default function NotFound() {
  return (
    <main className="container py-5 pb-15">
      <div className="max-w-[400px] my-15 mx-auto text-center">
        <h1>Page not found</h1>
        <p className="text-text-light mb-8">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <div className="flex flex-col gap-3 items-center">
          <Button href="/">Go home</Button>
          <Link href="/projects" className="text-sm">
            Browse projects
          </Link>
          <Link href="/dashboard" className="text-sm">
            Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
