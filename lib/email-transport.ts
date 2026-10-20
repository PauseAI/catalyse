import { randomUUID } from 'node:crypto'
import { Resend } from 'resend'
import { env } from './env'
import { logger } from './logger'

export type OutgoingEmail = {
  to: string
  subject: string
  html: string
  replyTo?: string
}

/**
 * The last hop of an outgoing email. Templates in `lib/email.ts` build an OutgoingEmail
 * and hand it to whichever transport `emailTransport()` returns; tests swap in their own
 * with `setEmailTransport`.
 */
export abstract class EmailTransport {
  /** Resolves true once the email has been accepted; false when it could not be sent. */
  abstract send(email: OutgoingEmail): Promise<boolean>
  /** False when sends are dropped, so callers can skip email-only features. */
  configured(): boolean {
    return true
  }
}

type EmailEnv = Pick<typeof env, 'STUB_EMAIL' | 'RESEND_API_KEY' | 'FROM_EMAIL' | 'REPLY_TO_EMAIL'>

/** The part of the Resend SDK this transport uses, so tests can pass a fake client. */
export type ResendClient = Pick<Resend, 'emails'>

export class ResendTransport extends EmailTransport {
  constructor(
    private readonly config: EmailEnv,
    private readonly resend: ResendClient = new Resend(config.RESEND_API_KEY),
  ) {
    super()
  }

  async send({ to, subject, html, replyTo }: OutgoingEmail): Promise<boolean> {
    try {
      const payload: Parameters<Resend['emails']['send']>[0] = {
        from: this.config.FROM_EMAIL,
        to: [to],
        subject,
        html,
      }
      const effectiveReplyTo = replyTo || this.config.REPLY_TO_EMAIL
      if (effectiveReplyTo) payload.replyTo = effectiveReplyTo
      const { error } = await this.resend.emails.send(payload)
      if (error) {
        logger.error(`[EMAIL ERROR] ${error.message}`)
        return false
      }
      return true
    } catch (err) {
      logger.error(err, '[EMAIL ERROR]')
      return false
    }
  }
}

/** Development transport: writes each email to disk and logs the path so it can be opened. */
export class FileStubTransport extends EmailTransport {
  static readonly DIR = '/tmp/catalyse-emails'

  async send({ to, subject, html }: OutgoingEmail): Promise<boolean> {
    const fs = await import('fs/promises')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const slug = subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60)
    // A fan-out sends several same-subject emails within one millisecond, so the timestamp
    // alone would name the same file for each of them.
    const file = `${FileStubTransport.DIR}/${timestamp}_${slug}_${randomUUID().slice(0, 8)}.html`
    await fs.mkdir(FileStubTransport.DIR, { recursive: true })
    await fs.writeFile(file, html)
    logger.info(`[EMAIL STUB] To: ${to} | Subject: ${subject}\n[EMAIL STUB] Preview: ${file}`)
    return true
  }
}

/** Used when neither a stub nor an API key is configured: logs the send and drops it. */
export class UnconfiguredTransport extends EmailTransport {
  async send({ to, subject }: OutgoingEmail): Promise<boolean> {
    logger.info(`[EMAIL NOT CONFIGURED] Would send to ${to}: ${subject}`)
    return false
  }

  configured(): boolean {
    return false
  }
}

export function createEmailTransport(config: EmailEnv = env): EmailTransport {
  if (config.STUB_EMAIL) return new FileStubTransport()
  if (config.RESEND_API_KEY) return new ResendTransport(config)
  return new UnconfiguredTransport()
}

let current: EmailTransport | undefined

/** The process-wide transport, built from the environment on first use. */
export function emailTransport(): EmailTransport {
  return (current ??= createEmailTransport())
}

/**
 * Replaces the process-wide transport; `undefined` makes the next call rebuild it from
 * the environment. Returns the previous transport so a caller can restore it.
 */
export function setEmailTransport(
  transport: EmailTransport | undefined,
): EmailTransport | undefined {
  const previous = current
  current = transport
  return previous
}
