// A mention is stored in comment content as `@[Name](id)`. The composer shows it as `@Name`
// and encodes it on submit; the server reads the ids to notify, and the view renders a chip.

export type MentionMember = { id: number; name: string }

export type MentionPart = string | MentionMember

const TOKEN_RE = /@\[([^\]\n]+)\]\((\d+)\)/g

/** A name without the characters the token syntax uses; the composer inserts `@` + this. */
export function tokenName(name: string): string {
  return name.replace(/[[\]()\n]/g, '')
}

export function mentionToken(member: MentionMember): string {
  return `@[${tokenName(member.name)}](${member.id})`
}

export function mentionedIds(content: string): number[] {
  return [...new Set([...content.matchAll(TOKEN_RE)].map((m) => Number(m[2])))]
}

/** Content as a person reads it, for notification bodies and the edit box. */
export function mentionsToPlain(content: string): string {
  return content.replace(TOKEN_RE, (_, name: string) => `@${name}`)
}

export function splitMentions(content: string): MentionPart[] {
  const parts: MentionPart[] = []
  let last = 0
  for (const m of content.matchAll(TOKEN_RE)) {
    if (m.index > last) parts.push(content.slice(last, m.index))
    parts.push({ name: m[1], id: Number(m[2]) })
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push(content.slice(last))
  return parts
}

/** Turns each `@Name` of a picked member back into its token; longer names match first. */
export function encodeMentions(text: string, picked: MentionMember[]): string {
  const byName = new Map(picked.map((m) => [tokenName(m.name), m]))
  if (byName.size === 0) return text
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`@(${escaped.join('|')})(?![\\p{L}\\p{N}_])`, 'gu')
  return text.replace(re, (_, name: string) => mentionToken(byName.get(name) as MentionMember))
}

/** The inverse of `encodeMentions`, for loading a saved comment into the edit box. */
export function decodeMentions(content: string): { text: string; picked: MentionMember[] } {
  const picked = splitMentions(content).filter((p): p is MentionMember => typeof p !== 'string')
  return { text: mentionsToPlain(content), picked }
}
