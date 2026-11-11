import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { runScheduledJobs } from '@/lib/cron-jobs'

// The cron service calls this every hour (railway.cron.toml); each job runs when it is due.
// Can be triggered manually: POST with Authorization: Bearer <CRON_SECRET>
export async function POST(request: NextRequest) {
  const authError = checkCronAuth(request)
  if (authError) return authError
  return NextResponse.json(await runScheduledJobs())
}
