import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { CRON_JOBS } from '@/lib/cron-jobs'

// Can be triggered manually: POST with Authorization: Bearer <CRON_SECRET>
export async function POST(request: NextRequest) {
  const authError = checkCronAuth(request)
  if (authError) return authError

  try {
    return NextResponse.json({ backup: await CRON_JOBS.backup() })
  } catch (e) {
    // An incomplete backup throws so its run is recorded as failed; the caller still gets JSON.
    return NextResponse.json({ backup: { error: String(e) } }, { status: 500 })
  }
}
