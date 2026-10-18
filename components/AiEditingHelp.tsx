'use client'

import { useState } from 'react'
import Button from '@/components/Button'
import { PROJECT_IMPORT_GUIDE } from '@/lib/project-porting-docs'
import { H2 } from '@/components/Heading'
import { P } from '@/components/Text'

/**
 * The authoring rules, at the moment someone is thinking about editing the file.
 *
 * Collapsed by default: most imports are a round trip that needs no instructions at all, and
 * this is long. The copy button matters more than the reading — the guide is written to be
 * pasted into an assistant alongside the file, not scrolled through here.
 */
export default function AiEditingHelp() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(PROJECT_IMPORT_GUIDE)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the text is on the page either way.
      setOpen(true)
    }
  }

  return (
    <div className="bg-surface rounded-xl shadow p-4 sm:p-6 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <H2 className="m-0 text-base">Editing this file with an AI assistant</H2>
          <P className="text-text-light m-0 text-sm">
            Copy these rules into the assistant along with your export, so it produces a file the
            importer will accept.
          </P>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy instructions'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Read'}
          </Button>
        </div>
      </div>

      {open && (
        <pre className="bg-brand-bg border-brand-border mt-4 max-h-96 overflow-auto rounded-lg border p-4 text-xs whitespace-pre-wrap">
          {PROJECT_IMPORT_GUIDE}
        </pre>
      )}
    </div>
  )
}
