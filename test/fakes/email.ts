import { EmailTransport, type OutgoingEmail } from '@/lib/email-transport'

/**
 * Captures every email the app tries to send, so a test can assert on the real recipient,
 * subject and rendered body instead of on which template function was called.
 * `test/setup-db.ts` installs one per test file and empties it before each test.
 */
export class MemoryEmailTransport extends EmailTransport {
  readonly sent: OutgoingEmail[] = []
  private pendingFailures = 0
  private isConfigured = true

  async send(email: OutgoingEmail): Promise<boolean> {
    if (this.pendingFailures > 0) {
      this.pendingFailures--
      throw new Error('stub email failure')
    }
    this.sent.push(email)
    return true
  }

  configured(): boolean {
    return this.isConfigured
  }

  /** Makes the next `count` sends throw, as a network failure would. */
  failNext(count = 1): void {
    this.pendingFailures = count
  }

  /** Makes every send throw until the next `reset()`. */
  failAll(): void {
    this.pendingFailures = Infinity
  }

  /** Reports email as unavailable, so callers skip it; sends still work. */
  setConfigured(value: boolean): void {
    this.isConfigured = value
  }

  /**
   * Gives fire-and-forget sends time to land, so asserting that nobody was emailed proves it
   * rather than passing while a send is still rendering.
   */
  async settle(ms = 250): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  reset(): void {
    this.sent.length = 0
    this.pendingFailures = 0
    this.isConfigured = true
  }

  get last(): OutgoingEmail {
    const email = this.sent.at(-1)
    if (!email) throw new Error('no email has been sent')
    return email
  }

  /** Every email sent to `address`, most recent last. */
  to(address: string): OutgoingEmail[] {
    return this.sent.filter((e) => e.to === address)
  }

  /** The most recent email to `address`; unlike `last`, unaffected by mail to anyone else. */
  lastTo(address: string): OutgoingEmail {
    const email = this.to(address).at(-1)
    if (!email) throw new Error(`no email has been sent to ${address}`)
    return email
  }
}

/** The value of a `?param=` query parameter in the first link of `email` that carries one. */
export function linkParam(email: OutgoingEmail, param: string): string {
  const match = email.html.match(new RegExp(`[?&]${param}=([^"&<\\s]+)`))
  if (!match) throw new Error(`no ${param}= link in email "${email.subject}"`)
  return decodeURIComponent(match[1])
}

export const emails = new MemoryEmailTransport()
