import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { runScheduledJobs } from '@/lib/cron-jobs'

// The one cron trigger: the cron service calls it every hour (railway.cron.toml), and each job
// runs when it is due (lib/cron-jobs.ts).
// Can be triggered manually: POST with Authorization: Bearer <CRON_SECRET>
export async function POST(request: NextRequest) {
  const authError = checkCronAuth(request)
  if (authError) return authError
  return NextResponse.json(await runScheduledJobs())
}
