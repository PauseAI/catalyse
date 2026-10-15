'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

export default function Footer() {
  const { data: versionData } = useQuery({
    ...orpc.version.get.queryOptions(),
    staleTime: Infinity,
  })
  const sha = versionData?.sha && versionData.sha !== 'dev' ? versionData.sha.slice(0, 7) : null
  const prMatch =
    typeof versionData?.env === 'string' ? versionData.env.match(/^catalyse-pr-(\d+)$/) : null
  const prNumber = prMatch ? parseInt(prMatch[1]) : null

  return (
    <footer className="border-t border-brand-border mt-auto py-6 text-sm text-muted xl:h-16 xl:py-0 xl:flex xl:items-center">
      <div className="container flex flex-wrap justify-center gap-x-6 gap-y-1">
        <Link href="/privacy" className="underline hover:text-foreground transition-colors">
          Privacy &amp; Data
        </Link>
        <a
          href="mailto:matilda@pauseai.info"
          className="underline hover:text-foreground transition-colors"
        >
          Contact
        </a>
        <a
          href="https://pauseai.info"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground transition-colors"
        >
          PauseAI
        </a>
        {prNumber && (
          <a
            href={`https://github.com/PauseAI/catalyse/pull/${prNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            PR #{prNumber}
          </a>
        )}
        {sha && (
          <span className="font-mono" title={sha}>
            {sha}
          </span>
        )}
      </div>
    </footer>
  )
}
