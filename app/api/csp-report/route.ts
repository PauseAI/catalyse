import { prisma } from '@/lib/prisma'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const SINGLETON_ID = 1
// Real CSP violation reports are a few hundred bytes; reject anything implausibly large
// before parsing, so an unauthenticated caller can't use this endpoint to burn memory or
// flood Railway logs with an oversized payload.
const MAX_BODY_BYTES = 8_192

// The fields logged from each report shape: legacy `report-uri` (kebab-case) and Reporting
// API (camelCase). Everything else is dropped, since the logs sit outside GDPR export and
// deletion. URL fields keep only origin and path: their query strings and fragments can
// carry analytics IDs or reset tokens.
const URL_FIELDS = new Set([
  'blocked-uri',
  'document-uri',
  'referrer',
  'source-file',
  'blockedURL',
  'documentURL',
  'sourceFile',
])
const PLAIN_FIELDS = new Set([
  'violated-directive',
  'effective-directive',
  'line-number',
  'column-number',
  'disposition',
  'status-code',
  'violatedDirective',
  'effectiveDirective',
  'lineNumber',
  'columnNumber',
  'statusCode',
])

function originAndPath(value: string): string {
  try {
    const url = new URL(value)
    if (url.origin !== 'null') return url.origin + url.pathname
  } catch {
    // A keyword such as 'inline' or 'eval', or a URL the browser reported unparseably.
  }
  return value.split(/[?#]/, 1)[0]
}

// Undefined drops the field: an unknown key, or a known one holding an object or array.
function redactField(key: string, value: unknown): unknown {
  if (!URL_FIELDS.has(key) && !PLAIN_FIELDS.has(key)) return undefined
  if (typeof value === 'string') return URL_FIELDS.has(key) ? originAndPath(value) : value
  const scalar = value === null || typeof value === 'number' || typeof value === 'boolean'
  return scalar ? value : undefined
}

function redact(violation: unknown): Record<string, unknown> {
  if (typeof violation !== 'object' || violation === null || Array.isArray(violation)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(violation)
      .map(([key, value]) => [key, redactField(key, value)])
      .filter(([, value]) => value !== undefined),
  )
}

// Browsers POST here unauthenticated whenever the page's CSP (see next.config.ts) blocks
// something, per the `report-uri` directive. Redacted details go to Railway logs for
// debugging; only a running count is persisted, and jobs/csp-summary.ts digests it into
// a daily email so a burst of reports can't spam admins.
export async function POST(request: Request) {
  const { allowed, retryAfterMs } = checkRateLimit(request, 'csp-report', {
    limit: 30,
    windowMs: 60_000,
  })
  if (!allowed) return rateLimitResponse(retryAfterMs)

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 })
  }

  let violation: unknown
  try {
    const payload = await request.json()
    violation = payload?.['csp-report'] ?? (Array.isArray(payload) ? payload[0]?.body : payload)
  } catch {
    // Malformed report body; still record that something was blocked.
  }

  console.error('[CSP VIOLATION]', JSON.stringify(redact(violation)))

  await prisma.platformSettings
    .update({ where: { id: SINGLETON_ID }, data: { cspViolationCount: { increment: 1 } } })
    .catch((e) => console.error('[CSP VIOLATION] Failed to record count:', e))

  return new Response(null, { status: 204 })
}
