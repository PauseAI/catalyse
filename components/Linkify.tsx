import React from 'react'
import TextLink from '@/components/TextLink'

// Only http(s) URLs become links, so a `javascript:` or `data:` scheme stays plain text.
// The first character after `//` must be part of a host, so trimming punctuation off the
// end can never leave a bare scheme.
const URL_PATTERN = /https?:\/\/[\w-][^\s<>"]*/gi
// Sentence punctuation that follows a URL in prose rather than belonging to it.
const TRAILING_PUNCTUATION = /[.,;:!?'")\]]+$/

/** Renders `text` with its http(s) URLs as links that open in a new tab. */
export default function Linkify({ text }: { text: string | null }) {
  if (!text) return null
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '')
    parts.push(text.slice(last, match.index))
    parts.push(
      <TextLink key={match.index} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </TextLink>,
    )
    last = match.index + url.length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}
