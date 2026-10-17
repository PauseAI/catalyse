/** `birchbenji@gmail.com` as `b••••••••i@gmail.com`: enough for its owner to know it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  const local = email.slice(0, at)
  const hidden = '•'.repeat(Math.max(local.length - 2, 1))
  const shown = local.length > 2 ? `${local[0]}${hidden}${local.at(-1)}` : `${local[0]}${hidden}`
  return `${shown}${email.slice(at)}`
}
