import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { env } from './env'
import { logger } from './logger'

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, which would itself leak the length.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function checkCronAuth(request: NextRequest): NextResponse | null {
  const secret = env.CRON_SECRET
  if (!secret) {
    logger.error('[CRON] CRON_SECRET env var not set')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  const auth = request.headers.get('authorization')
  if (!auth || !secretsMatch(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
